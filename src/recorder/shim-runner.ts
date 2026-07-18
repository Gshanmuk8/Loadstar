/**
 * LODESTAR — the shim runner.
 *
 * Runs in place of an intercepted command. Every `npm test` the agent issues lands here
 * first. This process becomes the command's real parent, which is the only way to learn
 * its exit code (D-023).
 *
 * ---------------------------------------------------------------------------
 * THE GOVERNING RULE: NEVER BREAK THE COMMAND
 * ---------------------------------------------------------------------------
 *
 * This code sits in the critical path of a developer's work. If any part of recording
 * fails — the database is locked, the session vanished, the disk is full — the command
 * must still run and still return its true exit code. Recording is best-effort;
 * execution is not.
 *
 * Every recording call is therefore wrapped, and every failure path still execs. There
 * is exactly one thing this file must never do: manufacture success. A swallowed
 * failure is worse than no record at all, because the record would then be a lie rather
 * than a gap.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { constants } from 'node:os'
import { randomUUID } from 'node:crypto'
import { isBatchTarget, resolveOnPath, spawnSpec, unsafeBatchArg } from './exec-command.js'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { classifyCommand } from './classify.js'
import { redactCommand, redactDeep } from '../core/redact.js'
import type {
  DraftEvent,
  ProcessExitPayload,
  ProcessIdentity,
  ProcessSpawnPayload,
} from '../types/events.js'
import {
  ENV_DB,
  ENV_EXEC_ID,
  ENV_RUNTIME,
  ENV_SESSION,
  ENV_SHIM_DIR,
  ENV_T0,
} from './shim-runner-env.js'

/**
 * Find the real binary, skipping our own shim directory.
 *
 * Without the skip, the shim would find itself and fork bomb. This is the single most
 * dangerous line in the file. The scan itself lives in exec-command.ts (D-072) — it is
 * the same resolution the launcher needs, and two copies of it is how the launcher
 * shipped without one.
 */
function findReal(command: string, shimDir: string): string | null {
  return resolveOnPath(command, { excludeDir: shimDir })
}

interface Recorder {
  spawn: (payload: ProcessSpawnPayload) => void
  exit: (payload: ProcessExitPayload) => void
  /** The shim could not execute the command. A gap, recorded as a gap. */
  failed: (info: { command: string; reason: string; identity?: ProcessIdentity }) => void
  /**
   * LODESTAR refused to run the command. Recorded so its own interference is visible.
   *
   * NOT a process.exit: nothing ran, so there is no exit status. The command's *parent*
   * will exit non-zero because of us, and without this event no reader could tell that
   * LODESTAR — not the agent — is the reason. See D-039.
   */
  interfered: (info: { command: string; reason: string }) => void
}

/**
 * Best-effort recorder.
 *
 * Returns a no-op recorder if anything is missing or broken. The command runs either
 * way; the difference is only whether it leaves a trace. A session that lost its
 * recorder produces a gap, and a gap is visible in the sequence — which is the honest
 * outcome.
 */
function makeRecorder(): Recorder {
  const noop: Recorder = { spawn: () => {}, exit: () => {}, failed: () => {}, interfered: () => {} }

  const sessionId = process.env[ENV_SESSION]
  const dbPath = process.env[ENV_DB]
  if (!sessionId || !dbPath || !existsSync(dbPath)) return noop

  let store: SqliteEventStore
  let db: ReturnType<typeof openDatabase>
  try {
    db = openDatabase(dbPath)
    store = new SqliteEventStore(db)
  } catch {
    return noop
  }

  const t0 = Number(process.env[ENV_T0] ?? Date.now())
  const runtimeId = process.env[ENV_RUNTIME] ?? 'unknown'

  const base = (): Omit<DraftEvent, 'kind' | 'payload' | 'source'> => ({
    id: randomUUID(),
    sessionId,
    ts: new Date().toISOString(),
    monotonicTs: Date.now() - t0,
    signalTier: 'groundTruth',
    actor: { kind: 'agent', runtimeId },
  })

  // ---------------------------------------------------------------------------
  // THE SECOND APPEND PATH — redaction must land here too
  // ---------------------------------------------------------------------------
  //
  // `RecordingContext.emit()` applies redaction as a floor for every recorder in-process.
  // The shim is a *separate process* and cannot use it: it builds DraftEvents by hand and
  // calls `store.append` directly. So the floor has to be re-established here, or it is
  // not a floor at all — it is a floor with a hole in the highest-traffic path, which is
  // the shape of every bug in DECISIONS.md.
  //
  // main() already redacts the command with structure (`redactArgs` knows `--token <x>`
  // from position). This is the backstop beneath it, and it also covers the one string
  // main() does not own: the spawn error text in `failed()`, which is written by the OS
  // and routinely quotes the full command line back at us. `redactText` is idempotent, so
  // the passes compose.
  const safeAppend = (draft: DraftEvent): void => {
    store.append(redactDeep(draft).value)
  }

  return {
    spawn(payload) {
      try {
        const full = [payload.command, ...payload.args].join(' ')
        const signals = classifyCommand(full)
        safeAppend({
          ...base(),
          source: 'process',
          kind: 'process.spawn',
          target: { raw: full, resolved: full, kind: 'process', inScope: true },
          payload,
          ...signals,
        })
      } catch {
        /* recording is best-effort; the command is not */
      }
    },
    exit(payload) {
      try {
        const signals = classifyCommand(payload.command)
        safeAppend({
          ...base(),
          source: 'process',
          kind: 'process.exit',
          target: { raw: payload.command, resolved: payload.command, kind: 'process', inScope: true },
          payload,
          ...signals,
        })
      } catch {
        /* as above */
      }
      close()
    },
    interfered(info) {
      try {
        safeAppend({
          ...base(),
          source: 'process',
          kind: 'agent.output',
          payload: {
            recorder: 'shim',
            lodestarInterference: true,
            command: info.command,
            reason: info.reason,
          },
        })
      } catch {
        /* best-effort */
      }
      close()
    },
    failed(info) {
      // Deliberately NOT a process.exit event. The command never ran, so there is no
      // exit status to report, and inventing one would let a downstream fact treat a
      // phantom run as real. This is recorded as a recorder error — a declared gap.
      try {
        safeAppend({
          ...base(),
          source: 'process',
          kind: 'agent.output',
          payload: {
            recorder: 'shim',
            recorderError: `failed to execute '${info.command}': ${info.reason}`,
            ...(info.identity ?? {}),
          },
        })
      } catch {
        /* best-effort */
      }
      close()
    },
  }

  function close(): void {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Run the real command, correctly, on both platforms.
 *
 * The mechanics — batch detection, cmd.exe wrapping, quoting — live in exec-command.ts
 * (D-072), where the launcher shares them. The refusal rule stays HERE: refusing does
 * break a command, which the governing rule at the top of this file forbids — but that
 * rule is about *recording* failure ("the database is locked, the disk is full"), where
 * execution is still correct. When execution itself cannot be made faithful (`%VAR%` in
 * an argument to a batch target), refusing is the honest failure; running something the
 * developer did not write is not. See unsafeBatchArg in exec-command.ts.
 */
function execute(real: string, args: string[]): ReturnType<typeof spawnSync> {
  const spec = spawnSpec(real, args)
  return spawnSync(spec.file, spec.args, {
    stdio: 'inherit',
    shell: false,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  })
}

/**
 * How many shim layers deep we are.
 *
 * A pure safety net. The baked-in `--shim-dir` should make recursion impossible, but
 * "should" is what the previous version said too — and it fork bombed. If a future
 * change breaks self-exclusion again, this turns an unbounded recursion that hangs the
 * developer's machine into a single loud error.
 *
 * ---------------------------------------------------------------------------
 * WHY 12 AND NOT 3
 * ---------------------------------------------------------------------------
 *
 * The budget was 3, justified by "a legitimate nesting exists (`npm test` runs `node`),
 * so depth 2 is normal". That underestimates real toolchains, and **this repository's own
 * `package.json` blew through it**:
 *
 *   npm run check → npm run stress → npm run build → tsc → tsc.cmd → node   (depth 4)
 *
 * Depth is inherited through the entire process tree and never resets, so every nested
 * `npm run` costs a level. pnpm workspace recursion and `npm run clean && tsc` chains go
 * deeper still.
 *
 * The consequence was the worst kind of bug for this product: the agent's command broke
 * *under LODESTAR* and worked without it, and LODESTAR then recorded `npm run check`
 * exiting non-zero as `groundTruth` — a Reality Fact that is literally true, caused
 * entirely by LODESTAR, and reported as the agent's failure. The recorder would have been
 * manufacturing the evidence it exists to observe.
 *
 * 12 is chosen to sit far above any legitimate nesting while still bounding a runaway
 * loop to something the OS shrugs off. The guard is for the fork-bomb class, where depth
 * climbs without limit in milliseconds — it does not need a tight bound to catch that,
 * and a tight bound is what made it fire on real work.
 */
const MAX_SHIM_DEPTH = 12

function main(): number {
  const argv = process.argv.slice(2)

  // The shim dir is baked into the shim script at install time. See shims.ts — it must
  // NOT be inferred from argv[1] (that is dist/recorder/, not the shim dir) and must not
  // depend on an env var a login shell or sandbox could strip.
  let shimDir = ''
  if (argv[0] === '--shim-dir') {
    shimDir = argv[1] ?? ''
    argv.splice(0, 2)
  }
  if (!shimDir) shimDir = process.env[ENV_SHIM_DIR] ?? ''

  const [command, ...args] = argv
  if (!command) return 1

  // ---- recursion guard ----------------------------------------------------
  const depth = Number(process.env['LODESTAR_SHIM_DEPTH'] ?? '0') + 1
  if (depth > MAX_SHIM_DEPTH) {
    process.stderr.write(
      `lodestar: shim recursion detected for '${command}' (depth ${depth}). Refusing to run.\n` +
        `lodestar: this is a LODESTAR bug. Run the command outside 'lodestar run' to proceed.\n`,
    )
    refused(command, `shim recursion guard tripped at depth ${depth}`)
    return 126
  }
  process.env['LODESTAR_SHIM_DEPTH'] = String(depth)

  if (!shimDir) {
    // We cannot safely resolve the real binary without knowing what to exclude —
    // scanning PATH could find this shim again. Fail loudly rather than risk a loop.
    process.stderr.write(`lodestar: shim directory unknown; refusing to run '${command}'.\n`)
    refused(command, 'shim directory unknown')
    return 126
  }

  const real = findReal(command, shimDir)

  if (!real) {
    // Nothing to exec. Report it the way a shell would, rather than inventing a code.
    process.stderr.write(`lodestar: ${command}: command not found\n`)
    return 127
  }

  // Can we pass these arguments through cmd.exe without altering them? If not, refuse:
  // running the command with different arguments than the developer wrote, and then
  // recording the arguments they wrote, would put a lie in an immutable ledger.
  if (isBatchTarget(real)) {
    const bad = unsafeBatchArg(args)
    if (bad !== null) {
      process.stderr.write(
        `lodestar: cannot run '${command}' faithfully: an argument contains ` +
          `%VAR% or a newline, which cmd.exe expands before ${command} can see it.\n` +
          `lodestar: argument: ${bad}\n` +
          `lodestar: refusing rather than running something you did not write. ` +
          `Run this command outside 'lodestar run' to proceed.\n`,
      )
      refused(command, 'argument contains %VAR% or a newline; cmd.exe would rewrite it')
      return 126
    }
  }

  const recorder = makeRecorder()
  const started = Date.now()

  // ---- process ancestry, observed rather than inferred ---------------------
  //
  // Mint this execution's id and publish it before exec'ing. Anything this command spawns
  // through a shim reads it as its parent, so the tree is recorded by the only party that
  // actually witnessed the relationship: the parent itself, at the moment of the spawn.
  //
  // Set even when recording is unavailable — a no-op recorder must not silently break
  // ancestry for descendants that CAN record. See D-034.
  const parentExecId = process.env[ENV_EXEC_ID]
  const execId = randomUUID()
  process.env[ENV_EXEC_ID] = execId

  const identity: ProcessIdentity = { execId }
  if (parentExecId) identity.parentExecId = parentExecId

  // ---- redact once, before anything is recorded ----------------------------
  //
  // This is the highest-value redaction point in the product: these are the agent's own
  // commands, and agents run `curl -H "Authorization: Bearer …"`, `psql postgres://…`,
  // and `npm publish --token …` routinely. The store is append-only, so a secret that
  // lands here is permanent. See core/redact.ts.
  //
  // `execute()` below receives the REAL argv. Only the record is filtered.
  const safe = redactCommand(command, args)

  recorder.spawn({
    ...identity,
    command: safe.value.command,
    args: safe.value.args,
    cwd: process.cwd(),
    pid: process.pid,
    // What PATH actually resolved to. We computed it to exec it and used to discard it,
    // so the record said what the agent typed and never what ran. D-043.
    resolvedPath: real,
  })

  // stdio is always inherited: the developer and the agent must see the command exactly
  // as they would without us. It is also why we do not capture output — interposing
  // pipes changes TTY detection, and therefore changes program behavior.
  const result = execute(real, args)

  // ---- did the command actually run? --------------------------------------
  if (result.error || (result.status === null && !result.signal)) {
    // We failed to execute it. Say so on stderr and DO NOT record an exit event —
    // recording `exit null` here would put a phantom run in the ledger, and a fact
    // engine downstream would treat a command that never ran as one that did.
    //
    // A gap is honest. An invented event is not.
    const why = result.error instanceof Error ? result.error.message : 'unknown spawn failure'
    process.stderr.write(`lodestar: failed to run '${command}' (${why})\n`)
    process.stderr.write(`lodestar: the command did NOT run. This is a LODESTAR bug, not yours.\n`)
    recorder.failed({ command: safe.value.full, reason: why, identity })
    return 126 // shell convention: found but not executable
  }

  const exitCode = result.status
  const signal = result.signal ?? null

  recorder.exit({
    ...identity,
    command: safe.value.full,
    exitCode,
    signal,
    durationMs: Date.now() - started,
    // cwd on the EXIT event, not just spawn: RF-01 groups on exits, and without it a pass
    // in one directory cancelled a real failure in another. D-043.
    cwd: process.cwd(),
    resolvedPath: real,
  })

  // Propagate the truth, exactly.
  //
  // A signal-terminated process has a null status. The shell convention is 128 + signal,
  // and the number IS portably available via os.constants.signals — the previous comment
  // here claimed otherwise and returned 1, which told the developer's shell that a
  // Ctrl-C'd `npm test` had failed an assertion (1) rather than been interrupted (130).
  // `cmd || fallback` and every interrupt-detecting script behaved differently under
  // LODESTAR than without it, which is exactly the workflow change the wedge cannot
  // afford. The signal name still goes in the record; this is the execution path.
  if (exitCode === null) return signal ? exitCodeForSignal(signal) : 1
  return exitCode
}

/**
 * Shell convention: a process killed by signal N reports 128 + N.
 *
 * Falls back to 1 for a signal this platform does not name, rather than guessing a
 * number — an invented code is the one thing worse than a coarse one.
 */
function exitCodeForSignal(signal: string): number {
  const n = (constants.signals as Record<string, number | undefined>)[signal]
  return typeof n === 'number' ? 128 + n : 1
}

/**
 * Record that LODESTAR refused to run a command.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY REFUSAL PATH MUST WRITE THIS — D-039
 * ---------------------------------------------------------------------------
 *
 * Each refusal returns 126 and, until now, recorded NOTHING. That is the exact failure
 * this file's own sibling warns about: "a bypassed shim emits nothing; silence is
 * indistinguishable from the command never ran."
 *
 * The damage is not the missing event — it is who gets blamed for it. The refusing shim
 * exits 126; its PARENT (`npm run check`) inherits that and exits non-zero; the parent's
 * shim records that honestly as groundTruth; and RF-01 then reports
 * `npm run check exited with code 2` — computable, reproducible, neutrally stated,
 * evidence-linked, and a **false accusation**, because LODESTAR caused it.
 *
 * That is the case the four Reality Facts rules cannot catch, because they assume
 * LODESTAR is not a participant. The shim makes it one. This event is how the record
 * says so.
 *
 * Best-effort like every other recording call: a refusal that cannot be recorded still
 * refuses, and still prints to stderr.
 */
function refused(command: string, reason: string): void {
  try {
    makeRecorder().interfered({ command, reason })
  } catch {
    /* recording is best-effort; the refusal is not */
  }
}

export function runShim(): number {
  return main()
}
