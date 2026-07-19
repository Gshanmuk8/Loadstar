/**
 * LODESTAR — the recorder.
 *
 * Owns a session: opens it, starts the three ground-truth recorders, and closes it.
 * Phase 6's wrapper drives this around an agent process; the tests drive it directly.
 *
 * The governing rule, from USER-FLOW.md §4: **LODESTAR must never break the agent.**
 * A recorder that fails degrades the record and says so loudly. It does not throw into
 * the caller's session. V0 has not earned the right to be in anyone's way.
 */

import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { execFileSync } from 'node:child_process'
import { readConfig } from '../core/config.js'
import { redactArgs, redactText } from '../core/redact.js'
import { paths } from '../core/project.js'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import type { Session, SessionEndPayload, SessionStartPayload } from '../types/events.js'
import { shellSelectionEnvVars, type AdapterCapabilities } from '../adapters/registry.js'
import { RecordingContext } from './context.js'
import { FsRecorder } from './fs-recorder.js'
import { GitRecorder, type GitDelta } from './git-recorder.js'
import { ProcessRecorder } from './process-recorder.js'
import { SnapshotStore } from './snapshots.js'
import {
  detectProbeShell,
  installShims,
  probeCoverage,
  SHIMMED_COMMANDS,
  type CommandCoverage,
} from './shims.js'
import {
  ENV_DB,
  ENV_EXEC_ID,
  ENV_RUNTIME,
  ENV_SESSION,
  ENV_SHIM_DIR,
  ENV_T0,
} from './shim-runner-env.js'
import { evaluate, interference, type RealityFact } from '../facts/index.js'

export interface RecorderOptions {
  root: string
  runtimeId: string
  mission?: string | null
  argv?: string[]
  /** e.g. the `claude` CLI version, when the adapter can report one. */
  runtimeVersion?: string
  /** The model behind the agent, when the runtime reports one. See SessionStartPayload. */
  model?: string
  capabilities: AdapterCapabilities
  /**
   * Install PATH shims and probe their coverage. Off by default so the recorder stays
   * usable standalone (tests, Phase 5 behavior); the wrapper turns it on.
   */
  shims?: boolean
  /** Absolute path to the built shim-runner. Required when `shims` is true. */
  shimRunner?: string
}

/**
 * What the record does and does not cover.
 *
 * Reported honestly rather than implied. A trust product with silent holes is worse
 * than one with disclosed holes — API-DESIGN.md §3.
 */
export interface Coverage {
  filesystem: boolean
  git: boolean
  /**
   * The agent process itself — argv, PID, exit code, duration.
   * Certain, because we are genuinely its parent (D-023 Q2).
   */
  agentLifecycle: boolean
  toolCalls: boolean
  resolvedTargets: boolean
  baselineTruncated: boolean
  /**
   * Per-command shim coverage, MEASURED against the agent's own shell — never assumed.
   *
   * `observed`  — our shim wins PATH resolution; exit codes will be ground truth.
   * `shadowed`  — the command exists but something else on PATH wins; NOT observed.
   * `absent`    — measured: not installed on this machine at all. Nothing to observe.
   * `unknown`   — we could not measure. A statement about LODESTAR, not the command.
   *               Never collapse this into `absent`; they are opposite claims (D-040).
   *
   * This is the field that keeps D-023 honest. A shim that loses emits nothing, and
   * silence is indistinguishable from "never ran" — so we measure and declare instead.
   */
  commands: CommandCoverage[]
  errors: string[]
}

export interface SessionSummary {
  session: Session
  events: number
  coverage: Coverage
  git: GitDelta | null
  integrityIntact: boolean
  /** Computed from groundTruth events only. Empty is a valid, honest answer. */
  facts: RealityFact[]
}

export class Recorder {
  private db: ReturnType<typeof openDatabase> | null = null
  private store!: SqliteEventStore
  private context!: RecordingContext
  private fs: FsRecorder | null = null
  private git: GitRecorder | null = null
  private processes!: ProcessRecorder
  private session!: Session
  private readonly errors: string[] = []
  private coverage!: Coverage
  private agentEnvOverrides: NodeJS.ProcessEnv = {}
  /**
   * The root of this session's process tree.
   *
   * Minted here rather than in the shim because the agent process is the one execution
   * LODESTAR is genuinely the parent of (D-023 Q2) — everything else descends from it.
   */
  private readonly agentExecId = randomUUID()

  constructor(private readonly opts: RecorderOptions) {}

  get proc(): ProcessRecorder {
    return this.processes
  }

  get currentSession(): Session {
    return this.session
  }

  /** Coverage as measured at start. Read-only view for the CLI. */
  get coverageSnapshot(): Coverage {
    return this.coverage
  }

  async start(): Promise<Session> {
    const p = paths(this.opts.root)
    const config = readConfig(p.config)

    this.db = openDatabase(p.db)
    this.store = new SqliteEventStore(this.db)
    // The sessions table is written by raw SQL BEFORE RecordingContext exists, so it
    // bypasses emit()'s redaction floor entirely (D-042). The mission is human-typed and
    // routinely quotes a URL or a token. Redact at this call site — it is the only one.
    this.session = this.store.createSession({
      runtimeId: this.opts.runtimeId,
      cwd: this.opts.root,
      mission: this.opts.mission ? redactText(this.opts.mission).value : null,
      // For read-time liveness (D-074): if this process dies without closing the
      // session, `sessions`/`status` can tell "still running" from "interrupted".
      wrapperPid: process.pid,
    })

    this.context = new RecordingContext(this.store, this.session.id, this.opts.root, {
      kind: 'agent',
      runtimeId: this.opts.runtimeId,
    })

    this.processes = new ProcessRecorder(this.context)

    this.coverage = {
      filesystem: false,
      git: false,
      // True because we genuinely are the agent's parent (D-023 Q2). This claims the
      // agent process only — never what the agent spawns beneath it.
      agentLifecycle: true,
      toolCalls: this.opts.capabilities.toolCalls,
      resolvedTargets: this.opts.capabilities.resolvedTargets,
      baselineTruncated: false,
      commands: [],
      errors: this.errors,
    }

    // ---------------------------------------------------------------------------
    // argv needs the STRUCTURAL pass, not the text backstop — D-042
    // ---------------------------------------------------------------------------
    //
    // `emit()` applies `redactDeep`, which runs `redactText` over each string. That is a
    // floor, not a substitute: in `["--password", "s3cr3t"]` the secret matches no vendor
    // shape and is indistinguishable from an ordinary argument on its own. Only its
    // POSITION gives it away, and only `redactArgs` reads position.
    //
    // Measured:
    //   redactDeep(["--password","s3cr3t-db-pw"])  →  ["--password","s3cr3t-db-pw"]
    //   redactArgs(["--password","s3cr3t-db-pw"])  →  ["--password","[REDACTED]"]
    //
    // `redact.ts` explains exactly why structure beats text for argv, and this was the one
    // argv in the codebase that did not get it — landing in the append-only ledger, where
    // it can never be removed.
    const startPayload: SessionStartPayload = {
      runtimeId: this.opts.runtimeId,
      cwd: this.opts.root,
      argv: redactArgs(this.opts.argv ?? []).value,
      machineId: machineId(),
      gitCommit: headCommit(this.opts.root),
    }
    if (this.opts.runtimeVersion) startPayload.runtimeVersion = this.opts.runtimeVersion
    if (this.opts.model) startPayload.model = this.opts.model
    // Identity EVIDENCE for the V1 graph (GRAPH-SPEC §4.1) — observations, never
    // conclusions; resolution happens graph-side where it stays correctable. Omitted
    // entirely outside a repo: absence is the honest value, not empty arrays.
    const remotes = gitRemotes(this.opts.root)
    if (remotes.length) startPayload.gitRemotes = remotes
    const roots = gitRootCommits(this.opts.root)
    if (roots.length) startPayload.gitRootCommits = roots
    this.context.emit({ source: 'process', kind: 'session.start', payload: startPayload })

    if (this.opts.mission) {
      this.context.emit({
        source: 'adapter',
        kind: 'mission.stated',
        // The mission is what the human asked for, relayed by the runtime. It is not
        // observed reality, so it is intent — never groundTruth. Facts must not be
        // computed from it.
        signalTier: 'intent',
        payload: { mission: this.opts.mission },
      })
    }

    // Git first: read HEAD before the watcher can race a checkout.
    try {
      this.git = new GitRecorder(this.context, this.opts.root)
      const state = await this.git.start()
      this.coverage.git = state.isRepo
      if (!state.isRepo) this.git = null
    } catch (e) {
      this.git = null
      this.note('git', e)
    }

    try {
      const snapshots = new SnapshotStore(p.sessions, config.maxOutputBytes * 128)
      this.fs = new FsRecorder({
        root: this.opts.root,
        ignore: config.ignore,
        context: this.context,
        snapshots,
      })
      const baseline = await this.fs.start()
      this.coverage.filesystem = true
      this.coverage.baselineTruncated = baseline.truncated
    } catch (e) {
      this.fs = null
      this.note('filesystem', e)
    }

    if (this.opts.shims && this.opts.shimRunner) {
      try {
        this.setupShims(p.lodestarDir, p.db)
      } catch (e) {
        // Shims are an enhancement, not a prerequisite. Losing them costs command
        // exit codes; it must never cost the session.
        this.note('shims', e)
      }
    }

    return this.session
  }

  /**
   * Install shims, then MEASURE whether they actually win.
   *
   * The probe is the whole point (D-023). Shims are demoted by login shells that
   * rebuild PATH, and a demoted shim emits nothing — silence that reads as "the command
   * never ran". So we ask the agent's own shell what it resolves, per command, and
   * record the answer as evidence.
   */
  private setupShims(lodestarDir: string, dbPath: string): void {
    const shimDir = join(lodestarDir, 'shims')
    const install = installShims(shimDir, this.opts.shimRunner!, process.execPath, SHIMMED_COMMANDS)

    // The probe mirrors each runtime's shell-selection order; which env vars runtimes
    // consult is the registry's knowledge, not the recorder's (vendor neutrality).
    const shell = detectProbeShell(shellSelectionEnvVars())
    const coverage = probeCoverage(shimDir, install.pathValue, install.commands, shell)
    this.coverage.commands = coverage

    this.agentEnvOverrides = {
      PATH: install.pathValue,
      Path: install.pathValue, // Windows env keys are case-insensitive; Node's are not.
      [ENV_SESSION]: this.session.id,
      [ENV_DB]: dbPath,
      [ENV_SHIM_DIR]: shimDir,
      [ENV_RUNTIME]: this.opts.runtimeId,
      [ENV_T0]: String(Date.now()),
      // Roots the process tree at the agent itself, so a command the agent runs records
      // the agent as its parent rather than appearing to have sprung from nowhere. Every
      // shimmed descendant inherits and overwrites this in turn. See D-034.
      [ENV_EXEC_ID]: this.agentExecId,
    }

    // The probe result goes INTO the record, not just the summary. A reader months
    // later must be able to see what this session could and could not observe, without
    // trusting a number we printed at the time.
    this.context.emit({
      source: 'process',
      kind: 'agent.output',
      payload: {
        coverageProbe: {
          shell: shell ? `${shell.bin} ${shell.args.join(' ')}` : null,
          shimDir,
          commands: coverage,
        },
      },
    })
  }

  /**
   * Environment for the agent process: shim dir prepended to PATH, plus the session
   * handle its shims need to record against.
   */
  get agentEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.agentEnvOverrides }
  }

  async stop(exitCode: number | null): Promise<SessionSummary> {
    let git: GitDelta | null = null
    try {
      git = (await this.git?.finish()) ?? null
    } catch (e) {
      this.note('git', e)
    }

    try {
      await this.fs?.stop()
    } catch (e) {
      this.note('filesystem', e)
    }

    const endPayload: SessionEndPayload = {
      exitCode,
      durationMs: this.context.monotonic(),
    }
    this.context.emit({ source: 'process', kind: 'session.end', payload: endPayload })

    this.store.endSession(this.session.id, exitCode)

    const events = this.store.query({ sessionId: this.session.id })
    const integrity = this.store.verify(this.session.id)

    // LODESTAR's own interference belongs in the limitations block, not in the facts —
    // it is a statement about the recorder, not about the agent. See D-039.
    try {
      for (const note of interference(this.store, this.session.id)) this.errors.push(note)
    } catch {
      /* the record still stands without the annotation */
    }

    let facts: RealityFact[] = []
    try {
      facts = evaluate(this.store, this.session.id)
    } catch (e) {
      // A broken fact engine must not lose the record. The events are the asset; facts
      // are a view over them and can be recomputed at any time.
      this.note('facts', e)
    }

    const summary: SessionSummary = {
      session: this.session,
      events: events.length,
      coverage: this.coverage,
      git,
      integrityIntact: integrity.intact,
      facts,
    }

    this.db?.close()
    this.db = null
    return summary
  }

  /**
   * A recorder failed. Record it, keep going.
   *
   * The failure goes into both the coverage report and the event log — the record
   * should show its own gaps, since a reader of the log alone would otherwise see
   * silence and read it as "nothing happened".
   */
  private note(recorder: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    this.errors.push(`${recorder}: ${message}`)
    try {
      this.context.emit({
        source: 'process',
        kind: 'agent.output',
        payload: { recorderError: message, recorder },
      })
    } catch {
      // If we cannot even record the failure, there is nothing further to do that
      // would not risk the agent's session.
    }
  }
}

/**
 * A stable, non-reversible id for this machine.
 *
 * `events.ts` already names the hard V1 problem — "merging chains from many machines
 * while keeping them verifiable" — and the schema had no machine identity at all. This
 * closes that for a few lines, now, while the window is open: a field can be added later,
 * but a session recorded today without one can never be attributed retroactively.
 *
 * Hashed rather than the raw hostname. It identifies without publishing the developer's
 * machine name and OS username into a record they may hand to someone else. Not a secret —
 * anyone with the same hostname and user can recompute it — but an identifier should not
 * double as a disclosure.
 */
function machineId(): string {
  let raw: string
  try {
    raw = `${hostname()}\u0000${userInfo().username}`
  } catch {
    return 'unknown'
  }
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

/**
 * git HEAD at session start — the repository state every later event sits on.
 *
 * Read here rather than taken from GitRecorder because `session.start` is emitted before
 * the recorders spin up, and this belongs on the first event of the chain.
 *
 * `null` for "not a repo or git unavailable" is a real answer and must stay distinct from
 * a commit — an absent field would read as "we did not look".
 */
function headCommit(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * The repo's remotes, credentials stripped — identity evidence for the V1 graph.
 *
 * Fetch entries only: `git remote -v` lists fetch and push per remote; fetch is the
 * repo's identity-relevant address, push URLs vary per workflow and add nothing.
 * Credentials are stripped HERE, at capture, before the value can reach the
 * append-only ledger (D-042's rule: redact before the event exists) — the graph's
 * normalizer strips again later, but defense at the boundary is not optional.
 */
function gitRemotes(root: string): Array<{ name: string; url: string }> {
  let out: string
  try {
    out = execFileSync('git', ['remote', '-v'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
  } catch {
    return []
  }

  const seen = new Map<string, string>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(\S+)\s+\(fetch\)$/.exec(line.trim())
    if (!m) continue
    seen.set(m[1]!, stripUrlCredentials(m[2]!))
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, url]) => ({ name, url }))
}

/** Remove userinfo from a git URL. `https://user:token@host/x` → `https://host/x`. */
function stripUrlCredentials(url: string): string {
  // scheme://userinfo@rest  — strip everything between :// and @ (last @ in authority).
  const scheme = /^([a-z][a-z0-9+.-]*:\/\/)([^/]+)(\/.*)?$/i.exec(url)
  if (scheme) {
    const [, proto, authority, rest] = scheme
    const at = authority!.lastIndexOf('@')
    return at === -1 ? url : `${proto}${authority!.slice(at + 1)}${rest ?? ''}`
  }
  // scp-like user@host:path — the "user" is transport routing (git@), not a secret,
  // but a token smuggled as userinfo is: strip anything before @ that contains ':'.
  const scp = /^([^@]+)@([^:]+:.*)$/.exec(url)
  if (scp && scp[1]!.includes(':')) return scp[2]!
  return url
}

/**
 * Roots of HEAD's history — the join signal remotes cannot provide (offline clones,
 * forks, renames). Sorted ascending and capped at the 16 smallest so the kept set is
 * deterministic even for subtree-merge pathologies (GRAPH-SPEC §4.1).
 */
function gitRootCommits(root: string): string[] {
  try {
    const out = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[0-9a-f]{40}$/.test(l))
      .sort()
      .slice(0, 16)
  } catch {
    return []
  }
}
