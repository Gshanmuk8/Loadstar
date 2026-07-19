/**
 * `lodestar run <agent>` — the execution boundary wrapper.
 *
 * LODESTAR becomes the agent's parent process. This is the one relationship the OS
 * guarantees us: a parent, and only a parent, learns its child's exit status. See
 * DECISIONS.md D-023.
 *
 * ---------------------------------------------------------------------------
 * FAILURE BEHAVIOR — the contract, stated before the code
 * ---------------------------------------------------------------------------
 *
 * The wrapper must not become a single point of failure. V0 observes; it does not
 * govern. So the answers are all the same direction:
 *
 *   If recording fails       → the agent still runs. Always.
 *   Are actions blocked?     → NEVER. V0 has no blocking. That is V2, and it has not
 *                              earned the right (PRODUCT-SPEC "Do NOT build").
 *   Are they allowed?        → Yes. Fail-open is correct for a system of record; a
 *                              recorder that can stop your work is a liability, not an
 *                              asset.
 *   What gets recorded?      → Whatever was captured before the failure, plus the
 *                              failure itself, plus reduced coverage. A gap is
 *                              declared, never hidden.
 *
 * The inversion for V2, noted so it is not lost: once LODESTAR *gates* actions,
 * fail-open becomes wrong for irreversible ones. The fail-mode is a safety feature
 * then. It is not one now, and pretending otherwise would be building V2 early.
 */

import { fileURLToPath } from 'node:url'
import { constants } from 'node:os'
import { dirname, join } from 'node:path'
import { Recorder, type SessionSummary } from '../../recorder/index.js'
import { findProjectRoot } from '../../core/project.js'
import { readConfig } from '../../core/config.js'
import { paths } from '../../core/project.js'
import { getAdapter, isOnPath, FLOOR_ONLY, type RuntimeAdapter } from '../../adapters/registry.js'
import { summarize } from '../../recorder/shims.js'
import { out, errOut, dim, bold, warn, fail, green, yellow, red, formatDuration } from '../ui.js'
import { requireProject } from './shared.js'

/**
 * Resolve the built shim entry next to this file.
 *
 * `shim-entry.js`, not `shim-runner.js` — the entry installs the warning filter before
 * anything loads node:sqlite. See shim-entry.ts.
 */
function shimRunnerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'recorder', 'shim-entry.js')
}

/**
 * An agent with no adapter still gets recorded.
 *
 * D-004: the ground-truth floor needs no adapter, so any agent's disk and process
 * effects are observable from day one — degraded, disclosed, but real. This is what
 * makes the cross-agent claim true at V0 without violating depth-on-one.
 */
function adapterFor(command: string): RuntimeAdapter {
  return (
    getAdapter(command) ?? {
      id: command,
      displayName: command,
      bin: command,
      capabilities: FLOOR_ONLY,
    }
  )
}

export interface RunOptions {
  /** The human's stated intent, from `run --mission`. Declared, never inferred. */
  mission?: string | null
}

export async function cmdRun(command: string, args: string[], opts: RunOptions = {}): Promise<number> {
  const root = findProjectRoot()
  if (!root) return requireProject()

  // The flag wins; the environment variable is the fallback that also serves the sugar
  // form (`lodestar claude`), whose argv belongs entirely to the agent (D-073).
  const mission = opts.mission ?? process.env['LODESTAR_MISSION'] ?? null

  const adapter = adapterFor(command)

  if (!isOnPath(adapter.bin)) {
    errOut()
    errOut(fail(`${adapter.displayName} not found on PATH.`))
    errOut(dim(`  Looked for: ${adapter.bin}`))
    errOut()
    return 127
  }

  const config = readConfig(paths(root).config)
  if (!config.recording) {
    out(dim('LODESTAR recording is disabled in config. Running the agent unwrapped.'))
  }

  const recorder = new Recorder({
    root,
    runtimeId: adapter.id,
    mission,
    argv: args,
    capabilities: adapter.capabilities,
    shims: config.recording,
    shimRunner: shimRunnerPath(),
  })

  // ---- start recording, but never at the agent's expense -------------------
  let started = false
  try {
    const session = await recorder.start()
    started = true
    out(dim(`LODESTAR recording · session #${String(session.number).padStart(3, '0')}`))
    printProbe(recorder)
    out()
  } catch (err) {
    // Fail-open. The developer asked to run an agent; a broken recorder is our problem,
    // not theirs.
    errOut(warn('LODESTAR could not start recording. Running the agent unrecorded.'))
    errOut(dim(`  ${err instanceof Error ? err.message : String(err)}`))
    errOut()
  }

  // ---- run the agent -------------------------------------------------------
  //
  // The wrapper must OUTLIVE the agent's signals (D-074). A terminal Ctrl-C is
  // delivered to the whole foreground process group — the agent AND this wrapper.
  // What the agent does with it is its own business (Claude Code treats SIGINT as
  // "cancel" and keeps running; a build dies with it). The wrapper's default was to
  // die on the spot, before `recorder.stop()` could run — so every interrupted
  // session stayed open forever and `session.end` never entered the chain. Ignoring
  // the signal here changes nothing for the agent: it still receives its own copy
  // from the terminal, and whichever way it responds, `proc.run` resolves and the
  // session closes honestly (exit code, or 128+signal below).
  const survive = (): void => {}
  process.on('SIGINT', survive)
  process.on('SIGTERM', survive)
  process.on('SIGHUP', survive)

  let exitCode: number | null = null
  let signal: string | null = null
  try {
    const result = await recorder.proc.run(adapter.bin, args, {
      // Inherit everything. stdin, TTY, colors, signals, exit code — all pass through
      // untouched, or `lodestar claude` stops feeling like `claude` and the wedge dies.
      inherit: true,
      env: started ? recorder.agentEnv : process.env,
    })
    exitCode = result.exitCode
    signal = result.signal
  } catch (err) {
    errOut(fail(`Failed to launch ${adapter.displayName}: ${err instanceof Error ? err.message : String(err)}`))
    exitCode = 127
  }

  // ---- close the session ---------------------------------------------------
  // Still under the signal guard: a second Ctrl-C landing while the session is being
  // sealed must not orphan it — closing takes milliseconds, and dying inside it is
  // the exact failure the guard exists to remove.
  if (started) {
    try {
      const summary = await recorder.stop(exitCode)
      if (config.sessionEndSummary) printSummary(summary)
    } catch (err) {
      errOut(warn(`LODESTAR could not close the session cleanly: ${err instanceof Error ? err.message : String(err)}`))
      errOut(dim('  Events recorded before the failure are still in the record.'))
    }
  }
  process.removeListener('SIGINT', survive)
  process.removeListener('SIGTERM', survive)
  process.removeListener('SIGHUP', survive)

  // The agent's exit code is the wrapper's exit code. Always. Scripts wrap agents, and
  // a wrapper that invents its own status breaks every one of them.
  //
  // This used to be `exitCode ?? 0`, three lines under that sentence, and it invented the
  // most dangerous status there is. `exitCode` is null exactly when the child was killed
  // by a signal — Ctrl-C, SIGTERM from a CI timeout, an OOM kill — so `lodestar claude`
  // reported **success** for a session that was killed mid-work. Any script wrapping the
  // agent saw 0 and carried on.
  //
  // `recorder.stop(exitCode)` was already recording the null honestly, which made this
  // worse rather than better: the ledger said "killed, no exit code" while the process
  // told the shell "fine". The record and the wrapper disagreed, and the wrapper was the
  // one being trusted by automation.
  //
  // 128 + signal is the shell convention; fall back to 1 only if the platform does not
  // name the signal, because a coarse non-zero is honest and a zero is not.
  if (exitCode !== null) return exitCode
  if (signal) {
    const n = (constants.signals as Record<string, number | undefined>)[signal]
    return typeof n === 'number' ? 128 + n : 1
  }
  return 0
}

/**
 * Show what this session can and cannot see, before it starts.
 *
 * Printed up front rather than buried in a report, because a developer who is about to
 * trust a record deserves to know its holes while they still have the option not to.
 */
function printProbe(recorder: Recorder): void {
  const cmds = recorder.coverageSnapshot.commands
  if (!cmds.length) return

  const s = summarize(cmds)

  // ---------------------------------------------------------------------------
  // EVERY STATE IS PRINTED, INCLUDING THE ONES THAT EMBARRASS US — D-040
  // ---------------------------------------------------------------------------
  //
  // This used to render `observed` and `shadowed` only. So when the probe failed
  // wholesale — which it did for every PowerShell and cmd.exe user, silently — the CLI
  // printed *no coverage line at all* while the ledger filled with real events. "We could
  // not measure" and "there is nothing to report" looked identical, and silence reads as
  // all-clear.
  //
  // `unknown` is the loudest of the four on purpose. A hole we know about is a disclosure;
  // a hole we cannot see is a warning about the record itself.
  if (s.observed.length) out(dim(`  observed: ${s.observed.join(' ')}`))
  if (s.shadowed.length) {
    // These commands will run and we will not see their exit codes.
    out(dim(`  ${yellow('not observed')}: ${s.shadowed.join(' ')} ${dim('(shadowed on PATH)')}`))
  }
  if (s.absent.length) {
    // Measured absent — nothing to observe. Distinct from `unknown`, which is us failing.
    out(dim(`  not installed: ${s.absent.join(' ')}`))
  }
  if (s.unknown.length) {
    const why = cmds.find((c) => c.status === 'unknown')?.reason
    out(`  ${yellow('COVERAGE UNKNOWN')}: ${s.unknown.join(' ')}`)
    if (why) out(dim(`    ${why}`))
    out(dim('    LODESTAR could not measure these. Their absence from the record proves nothing.'))
  }
}

function printSummary(summary: SessionSummary): void {
  const { session, coverage } = summary
  const duration = session.endedAt
    ? formatDuration(new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime())
    : ''

  out()
  out(
    `${bold('LODESTAR')}  session #${String(session.number).padStart(3, '0')}  ${dim('·')}  ${session.runtimeId}${duration ? `  ${dim('·')}  ${duration}` : ''}`,
  )
  out()
  out(`  ${summary.events} events recorded`)

  if (summary.git?.dirtyAtEnd.length) {
    out(`  ${summary.git.dirtyAtEnd.length} file(s) left uncommitted`)
  }

  // ---------------------------------------------------------------------------
  // THE FACTS WERE COMPUTED AND THROWN AWAY
  // ---------------------------------------------------------------------------
  //
  // `recorder.stop()` has always run `evaluate()` and returned the facts in the summary.
  // Nothing read them. `lodestar report` was a stub, so the hook the entire product is
  // built around — PRODUCT-SPEC §4, "the feature that makes people install" — reached a
  // human through no code path at all.
  //
  // The count only, deliberately. This is the wrapper's exit line, not the report: it
  // tells the developer a fact exists and where to read it. Rendering the facts twice, in
  // two places, is how two renderers drift into two different answers (D-049).
  if (summary.facts.length) {
    out()
    out(`  ${yellow('▪')} ${summary.facts.length} Reality Fact(s) observed — see ${bold('lodestar report')}`)
  }

  const cov = summarize(coverage.commands)
  if (cov.shadowed.length) {
    out()
    out(dim(`  Not observed: ${cov.shadowed.join(' ')}`))
  }
  // A record whose own coverage is unmeasured must say so at the end too, not only up
  // front — this is the line the developer reads before trusting the session.
  if (cov.unknown.length) {
    out()
    out(`  ${yellow('Coverage unknown')}: ${cov.unknown.join(' ')}`)
    out(dim('    These were never measured; silence about them is not evidence.'))
  }
  if (coverage.errors.length) {
    out()
    for (const e of coverage.errors) out(`  ${yellow('⚠')} ${dim(e)}`)
  }

  out()
  out(
    summary.integrityIntact
      ? dim(`  Record integrity: ${green('✓')} verified`)
      : `  Record integrity: ${red('✗ BROKEN')}`,
  )
  out()
  out(dim('  lodestar report     see what actually happened'))
  out()
}
