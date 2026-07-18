/**
 * LODESTAR — process recorder.
 *
 * Records what a process actually did: its resolved command, its real exit code, and
 * how long it took. `"npm test exited with code 1"` (RF-01) is the headline Reality
 * Fact, and this file is the only thing that can produce it truthfully.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONLY RECORDS PROCESSES WE SPAWN — read before "improving" it
 * ---------------------------------------------------------------------------
 *
 * ARCHITECTURE.md C2 asks for "every process the agent spawns, with argv, exit code,
 * and duration". Exit codes are the hard half of that sentence, because **only a
 * parent process learns its child's exit code**. The obvious alternative — sampling
 * the OS process tree — was designed and rejected:
 *
 *   - It cannot produce exit codes at all. A sampler sees a PID appear and later
 *     disappear; the status is reaped by the real parent and is gone. That kills RF-01,
 *     which is the entire point of the recorder.
 *   - It misses anything shorter than the poll interval, so the record silently
 *     acquires holes — the worst possible failure for a trust product.
 *   - On Windows the only dependency-free enumeration is shelling out to PowerShell
 *     (~200ms of startup, per sample). Polling that at any useful rate burns CPU on
 *     the developer's machine, which violates "the developer does not change workflow"
 *     (USER-FLOW.md §4).
 *
 * Three costs, no exit codes. So it is not built. See DECISIONS.md D-021 for the
 * remaining options for agent-spawned children (PATH shims vs. the runtime adapter)
 * and why that decision is deferred to Phase 6 rather than guessed at now.
 *
 * What this file does give: exact, complete records for processes LODESTAR launches —
 * which is the mechanism Phase 6 uses for the agent itself, and the mechanism a shim
 * would call into.
 */

import { spawn } from 'node:child_process'
import { isBatchTarget, resolveOnPath, spawnSpec, unsafeBatchArg } from './exec-command.js'
import type { RecordingContext } from './context.js'
import { classifyCommand } from './classify.js'
import { redactCommand, redactText } from '../core/redact.js'
import type { ProcessExitPayload, ProcessSpawnPayload } from '../types/events.js'

export interface SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /**
   * Pass the child's stdio straight through to the terminal.
   *
   * Required when wrapping an agent: stdin, TTY behavior, colors, and signals must all
   * survive, or `lodestar claude` stops feeling like `claude` and the wedge is dead.
   * The cost is that we cannot also capture output — see `captureOutput`.
   */
  inherit?: boolean
  /** Capture stdout/stderr tails. Mutually exclusive with `inherit`. */
  captureOutput?: boolean
  /** Truncation bound. The record is text-shaped; unbounded output would break that. */
  maxOutputBytes?: number
}

export interface SpawnResult {
  exitCode: number | null
  signal: string | null
  durationMs: number
  stdoutTail?: string
  stderrTail?: string
}

/** Keep the tail, not the head: errors are at the end of output, and so is the summary. */
function tail(chunks: Buffer[], maxBytes: number): string {
  const buf = Buffer.concat(chunks)
  return buf.subarray(Math.max(0, buf.length - maxBytes)).toString('utf8')
}

export class ProcessRecorder {
  constructor(private readonly context: RecordingContext) {}

  /**
   * Spawn a process, record it, and return its real result.
   *
   * Emits `process.spawn` before execution and `process.exit` after. Both are
   * groundTruth: this process object is the source, not anybody's report about it.
   */
  async run(command: string, args: string[], opts: SpawnOptions = {}): Promise<SpawnResult> {
    const cwd = opts.cwd ?? this.context.root
    const maxOutputBytes = opts.maxOutputBytes ?? 8 * 1024
    const signals = classifyCommand([command, ...args].join(' '))

    // ---- redaction happens here, before any event exists -----------------------
    //
    // Not at render. The store is append-only and hash-chained, so a secret that reaches
    // the record cannot be deleted from it, and excising it would break the chain — which
    // makes an honest cleanup look exactly like tampering. See core/redact.ts.
    //
    // Note what is NOT redacted: the argv handed to `spawn` below. Execution uses the
    // real values; only the record is filtered. Redacting the exec path would break the
    // developer's command, which is the one thing this product must never do.
    const safe = redactCommand(command, args)
    const full = safe.value.full

    // ---- resolve what will actually execute — the D-072 launch bug ------------
    //
    // `spawn(command, …, { shell: false })` hands the bare name to CreateProcess, which
    // resolves `.exe` only. On Windows an npm-installed agent is a `.cmd` batch shim —
    // `claude` IS `claude.cmd` — so `lodestar claude` died with ENOENT on the very
    // machine where `claude` worked in every terminal. The resolution a shell would do
    // has to happen here, against the PATH the CHILD gets (the agent env, not ours),
    // and a batch target has to go through cmd.exe like the shim already does.
    const env = opts.env ?? process.env
    const resolved = process.platform === 'win32' ? resolveOnPath(command, { env }) : null

    if (resolved && isBatchTarget(resolved)) {
      // cmd.exe would expand `%VAR%` or truncate at a newline before the agent could
      // see the argument. Refuse rather than launch something the developer did not
      // write — same rule, same reasoning as the shim (exec-command.ts).
      const bad = unsafeBatchArg(args)
      if (bad !== null) {
        throw new Error(
          `cannot launch '${command}' faithfully: argument '${bad}' contains %VAR% or a newline, ` +
            `which cmd.exe rewrites before ${command} can see it. Run ${command} directly instead.`,
        )
      }
    }

    const spec = spawnSpec(resolved ?? command, args, env)
    const child = spawn(spec.file, spec.args, {
      cwd,
      env,
      stdio: opts.inherit ? 'inherit' : 'pipe',
      shell: false,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
    })

    const spawnPayload: ProcessSpawnPayload = {
      command: safe.value.command,
      args: safe.value.args,
      cwd,
    }
    if (child.pid !== undefined) spawnPayload.pid = child.pid
    // What PATH resolution actually chose, when we did the choosing. The shim records
    // this for every intercepted command (D-043); the agent's own launch deserves the
    // same honesty — `claude` and `claude.cmd` are different claims about what ran.
    if (resolved) spawnPayload.resolvedPath = resolved

    this.context.emit({
      source: 'process',
      kind: 'process.spawn',
      target: { raw: full, resolved: full, kind: 'process', inScope: true },
      payload: spawnPayload,
      ...signals,
    })

    const startedNs = process.hrtime.bigint()
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    if (opts.captureOutput && !opts.inherit) {
      child.stdout?.on('data', (c: Buffer) => stdout.push(c))
      child.stderr?.on('data', (c: Buffer) => stderr.push(c))
    }

    const result = await new Promise<SpawnResult>((res, rej) => {
      child.on('error', rej)
      child.on('close', (code, signal) => {
        res({
          exitCode: code,
          signal,
          durationMs: Number((process.hrtime.bigint() - startedNs) / 1_000_000n),
        })
      })
    })

    const exitPayload: ProcessExitPayload = {
      command: full,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      // RF-01 groups on command + cwd (D-043). The shim records this; so must we, or the
      // agent's own process exit groups under an empty cwd and could collide with a
      // shim-recorded run of the same command.
      cwd,
    }
    if (resolved) exitPayload.resolvedPath = resolved

    // Captured output is the likeliest place for a credential to surface: tools echo
    // connection strings, curl prints request headers, and stack traces carry both. The
    // record gets the redacted tail; the caller gets the real one, because internal logic
    // may need to read what actually happened.
    const realStdout = stdout.length ? tail(stdout, maxOutputBytes) : undefined
    const realStderr = stderr.length ? tail(stderr, maxOutputBytes) : undefined

    if (opts.captureOutput) {
      if (realStdout !== undefined) exitPayload.stdoutTail = redactText(realStdout).value
      if (realStderr !== undefined) exitPayload.stderrTail = redactText(realStderr).value
    }

    this.context.emit({
      source: 'process',
      kind: 'process.exit',
      target: { raw: full, resolved: full, kind: 'process', inScope: true },
      payload: exitPayload,
      ...signals,
    })

    if (opts.captureOutput) {
      if (realStdout !== undefined) result.stdoutTail = realStdout
      if (realStderr !== undefined) result.stderrTail = realStderr
    }
    return result
  }
}
