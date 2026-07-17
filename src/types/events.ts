/**
 * LODESTAR — canonical event schema.
 *
 * This file is the single most consequential artifact in V0. See ARCHITECTURE.md §4.
 *
 * The schema is designed for V2/V3, not V0. V0 populates fields it does not use,
 * because the alternative is migrating an immutable, hash-chained record later —
 * which is not a migration but a credibility problem.
 *
 * Do not add runtime-specific fields. Runtime independence is enforced here.
 */

/** Where an event came from. */
export type EventSource = 'adapter' | 'fs' | 'process' | 'git' | 'stdio'

/**
 * How much the event can be trusted.
 *
 * This exists to make the Reality Facts Rule mechanically enforceable rather than a
 * convention. Reality Facts query `groundTruth` only, so narration is unreachable
 * from that code path and a claim-parsing fact cannot be built by accident.
 *
 * - `narration`   — the agent's own account. Its *belief*. Context only, never reasoned over.
 * - `intent`      — what the agent requested, post-resolution, via the runtime adapter.
 * - `groundTruth` — what actually happened, observed from outside the agent.
 */
export type SignalTier = 'narration' | 'intent' | 'groundTruth'

export type EventKind =
  | 'session.start'
  | 'session.end'
  | 'mission.stated'
  | 'file.read'
  | 'file.write'
  | 'file.delete'
  | 'process.spawn'
  | 'process.exit'
  | 'net.request'
  | 'git.commit'
  | 'git.ref_update'
  /**
   * Working-tree state, read directly by the recorder at session end.
   *
   * Emitted unconditionally for a repo. `dirtyAtEnd` used to ride on `git.ref_update`,
   * which is only emitted when HEAD moves — so the evidence for "session ended dirty"
   * was absent in precisely the case that fact exists to detect: the agent edited files
   * and did NOT commit. See D-047.
   */
  | 'git.status'
  | 'agent.output'

/** V2 Prevention signals. Computed at V0, unused at V0. */
export type EffectClass = 'read' | 'write' | 'execute' | 'network' | 'destroy'
export type BlastRadius = 'file' | 'module' | 'repo' | 'service' | 'account'

export interface Actor {
  /** Runtime id, e.g. 'claude-code'. `human` for the developer's own edits. */
  kind: 'agent' | 'human'
  runtimeId?: string
  sessionScopedId?: string
}

export interface EventTarget {
  /** What the agent asked for — may contain unexpanded variables or aliases. */
  raw: string
  /**
   * What the system will actually touch, post-expansion and post-alias.
   * Recording what the agent said it would do is nearly worthless.
   * Recording what the system is about to do is the entire value of the product.
   */
  resolved: string
  kind: 'file' | 'process' | 'url' | 'ref'
  /** False if outside the configured project scope — a blast-radius signal. */
  inScope: boolean
}

export interface SnapshotRef {
  before?: string
  after?: string
}

// ---------------------------------------------------------------------------
// Payloads — discriminated by `kind`.
// ---------------------------------------------------------------------------

/**
 * Identity of one command execution, and its place in the process tree.
 *
 * ---------------------------------------------------------------------------
 * WHY PID IS NOT ENOUGH, AND WHY ANCESTRY IS IN THE SCHEMA
 * ---------------------------------------------------------------------------
 *
 * `npm test` spawning `node` produces two genuine, independently-observed failures for
 * one underlying cause. Reporting both as separate Reality Facts is crying wolf (D-025),
 * but the fix must not be "dedupe by string similarity" — that is guessing, and a fact
 * built on a guess is exactly what the Reality Facts Rule forbids.
 *
 * The honest fix needs to *know* that the `node` process was a child of the `npm`
 * process. PIDs cannot express that in the record: they are reused by the OS, they are
 * meaningless once the process exits, and a sampler that read them later would be
 * inferring parentage rather than observing it.
 *
 * So each shim invocation mints an `execId` and hands it to its children through the
 * environment it already controls. A child's `parentExecId` is therefore **observed at
 * the moment of spawn by the parent itself** — not reconstructed afterward. That is the
 * difference between evidence and inference, and it is why this belongs in the schema
 * rather than in the fact engine.
 *
 * Absent on both fields means "not observed" — a shim was shadowed, or the process was
 * not spawned through the boundary. It must never be read as "no parent". See D-034.
 */
export interface ProcessIdentity {
  /** This execution's correlation id. Stable across its own spawn and exit events. */
  execId?: string
  /** The `execId` of the execution that spawned this one, when observed. */
  parentExecId?: string
}

export interface ProcessSpawnPayload extends ProcessIdentity {
  command: string
  args: string[]
  cwd: string
  pid?: number
  /**
   * The binary PATH actually resolved to — `C:\Program Files\nodejs\npm.cmd`, not `npm`.
   *
   * The shim computes this to exec it and used to throw it away, so the record said *what
   * the agent typed* and never *what actually ran*. Those differ exactly when it matters:
   * a shadowing `npm` earlier on PATH is invisible in the name and obvious in the path.
   * Recording the name alone is the mistake this product exists to avoid.
   */
  resolvedPath?: string
}

export interface ProcessExitPayload extends ProcessIdentity {
  command: string
  exitCode: number | null
  signal?: string | null
  durationMs: number
  /**
   * Where the command ran.
   *
   * Recorded at spawn and dropped from exit, which let RF-01 treat `npm test` in
   * `packages/api` and `packages/web` as one command — so a pass in one directory
   * deleted a real failure in the other. Two directories are two histories. See D-043.
   */
  cwd?: string
  /** The binary PATH actually resolved to. See `ProcessSpawnPayload.resolvedPath`. */
  resolvedPath?: string
  /** Truncated. Never store unbounded output in the record. */
  stdoutTail?: string
  stderrTail?: string
}

export interface FileChangePayload {
  path: string
  bytesBefore?: number
  bytesAfter?: number
  binary?: boolean
  /**
   * The file's modification time, as the OS reports it.
   *
   * ---------------------------------------------------------------------------
   * THIS IS WHAT MAKES "AFTER" OBSERVABLE INSTEAD OF INFERRED — D-044
   * ---------------------------------------------------------------------------
   *
   * RF-04 says "modified after the last test run". It used to derive "after" from `seq` —
   * the order events were APPENDED. But the fs recorder waits for writes to settle
   * (`awaitWriteFinish`, 120 ms) and then hashes the file before emitting, while process
   * events emit immediately. So fs events are systematically back-dated in `seq`, and the
   * most ordinary agent sequence there is — edit a file, then run the tests — recorded as
   * though the test ran first.
   *
   * `seq` orders OBSERVATIONS. `mtimeMs` orders OCCURRENCES. RF-04 needs the second, and
   * the OS already knows it: `statSync` is called anyway, so this costs nothing.
   *
   * Wall-clock, and compared only against `process.exit` times taken from the same clock
   * on the same machine. A malicious `touch` could backdate it — that is T3, and out of
   * scope per THREAT-MODEL.md.
   */
  mtimeMs?: number
  /**
   * Why this event has no content snapshot, when it has none.
   *
   * Absence of a `snapshotRef` is ambiguous on its own — it could mean unchanged,
   * unreadable, too large, or deliberately withheld. A record that cannot distinguish
   * those is a record with an undeclared hole, which is the failure mode this product
   * exists to avoid. So the reason is stated, never inferred:
   *
   * - `sensitive`  — credential-shaped path (`.env`, `id_rsa`, `*.pem`). Never read.
   * - `oversized`  — larger than the snapshot bound. Surfaces as RF-10.
   * - `unreadable` — we saw the change and could not read the file. A real gap.
   *
   * The event itself is always recorded. Only the bytes are withheld. See D-033.
   */
  contentWithheld?: 'sensitive' | 'oversized' | 'unreadable'
}

export interface SessionStartPayload {
  runtimeId: string
  cwd: string
  argv: string[]

  // ---- Identity: captured now because the ledger is immutable ----------------
  //
  // These live in this EVENT rather than the `sessions` table on purpose. The events
  // table is append-only and hash-chained; the sessions table has no triggers and is
  // freely UPDATE-able (D-035). Identity that can be silently rewritten is not identity.
  //
  // Captured now because evidence not captured is gone forever — not because migration is
  // hard. Adding an optional field later is easy; reconstructing which model made a
  // decision six months ago is impossible.

  /**
   * Stable, non-reversible id for this machine.
   *
   * `events.ts` already names the hard V1 problem as "merging chains from many machines
   * while keeping them verifiable" — and there was no machine identity in the schema.
   * A hash rather than the hostname: it identifies without publishing the developer's
   * machine name into a record they may share.
   */
  machineId?: string
  /** e.g. the `claude` CLI version. Which *version* of the agent did this. */
  runtimeVersion?: string
  /**
   * The model behind the agent, when the runtime reports one.
   *
   * The question V4 governance is asked — "which model made this decision?" — and the one
   * that cannot be answered retroactively. Session-scoped at V0: an agent that switches
   * models mid-session is not represented, which is a known limit, not an oversight.
   */
  model?: string
  /** git HEAD when the session began. The repository state every later event sits on. */
  gitCommit?: string | null

  // ---- Identity evidence: captured for V1's graph-time resolution (GRAPH-SPEC §4) --
  //
  // Records carry identity EVIDENCE, never identity conclusions — resolution happens
  // in the graph, where it can be plural, recomputable, and correctable. Baking a
  // repoId guess into an immutable record would preserve the guess forever
  // (V1-DESIGN-REVIEW §6). Both fields are payload-internal and optional: adding them
  // is additive under RECORD-SPEC §6 and does NOT bump the record format — the
  // conformance vectors prove it by not changing.

  /**
   * The repository's remotes (fetch URLs), credentials stripped at capture.
   * Producers must never emit userinfo — a token in a remote URL would land in an
   * append-only ledger, where it can never be removed (same reasoning as D-042).
   */
  gitRemotes?: Array<{ name: string; url: string }>
  /**
   * Roots of HEAD's history (`rev-list --max-parents=0`), sorted ascending, capped at
   * the 16 smallest so the kept set is deterministic (subtree-merge pathologies can
   * mint many roots). The fork/mirror/rename join signal remotes cannot provide.
   */
  gitRootCommits?: string[]
}

export interface SessionEndPayload {
  exitCode: number | null
  durationMs: number
}

// ---------------------------------------------------------------------------
// The event.
// ---------------------------------------------------------------------------

export interface LodestarEvent {
  id: string
  sessionId: string
  /** Total order within a session. Gapless — a gap means loss, and loss must be visible. */
  seq: number

  /** Wall clock, ISO 8601. */
  ts: string
  /** Milliseconds since session start. Wall clocks skew; ordering must not depend on them. */
  monotonicTs: number

  source: EventSource
  signalTier: SignalTier
  kind: EventKind
  actor: Actor

  target?: EventTarget

  // ---- V2/V3 signals: computed at V0, consumed later. Do not remove. ----
  /** Prevention signal. */
  effectClass?: EffectClass
  /** Prevention signal. */
  blastRadius?: BlastRadius
  /**
   * Prevention + Fix signal. Autonomy is safe exactly to the degree mistakes are
   * reversible.
   *
   * Three states, and absence is one of them: `true` (undoable), `false` (not
   * undoable), absent (we do not know). There is deliberately no `null` — it would
   * mean "explicitly unknown" as distinct from "never assessed", and the hash body
   * normalizes both to null anyway, so the chain could not preserve the difference.
   * A type must not promise what the record cannot keep. If V2 needs "we looked and
   * could not tell" as a distinct claim, add an explicit `reversibilityAssessed`
   * field rather than overloading this one.
   */
  reversible?: boolean
  /** Prevention signal. Did untrusted content enter context this turn? The prompt-injection fingerprint. */
  taint?: boolean
  /** Mission-coherence (V2) and Direction (V3) signal. See DECISIONS.md D-007. */
  missionId?: string

  /** Discriminated by `kind`. */
  payload: unknown

  /** Before/after blob refs for file writes. Powers V0 diffs and Fix-layer rollback. */
  snapshotRef?: SnapshotRef

  // ---- Tamper-evidence ----
  prevHash: string
  /** H(prevHash || canonicalJSON(event minus hash)). Canonicalization must be stable across versions. */
  hash: string
}

/** An event before the store assigns ordering and chain fields. */
export type DraftEvent = Omit<LodestarEvent, 'seq' | 'prevHash' | 'hash'>

export interface EventFilter {
  sessionId?: string
  signalTier?: SignalTier
  kind?: EventKind | EventKind[]
  /** Matches against `target.resolved`. */
  file?: string
  since?: string
  until?: string
  limit?: number
}

export interface VerifyResult {
  intact: boolean
  eventsChecked: number
  /** First `seq` where the chain breaks, if any. */
  brokenAt?: number
  reason?: string
}

// ---------------------------------------------------------------------------
// Sessions.
// ---------------------------------------------------------------------------

export interface Session {
  id: string
  /**
   * Human-readable, per-project, monotonic. A developer should be able to say
   * "session 124" out loud. Display affordance only — never key anything on it.
   * See DECISIONS.md D-017.
   */
  number: number
  runtimeId: string
  /** The stated mission, when the adapter can capture one. */
  mission?: string | null
  startedAt: string
  endedAt?: string | null
  exitCode?: number | null
  cwd: string
}

/**
 * Append-only by interface, not by convention.
 *
 * The absence of `update` and `delete` is this interface's most important feature.
 * A store whose interface admits mutation is append-only by convention only — and
 * convention is not what a tamper-evident record is sold on.
 *
 * The database enforces this independently with triggers, so a raw SQL path cannot
 * bypass it either. Two locks, because this is the one property the product sells.
 *
 * V1 replaces the implementation, not the interface. The hard V1 problem is merging
 * chains from many machines while keeping them verifiable; that constraint belongs
 * in this design now, not discovered later.
 */
export interface EventStore {
  append(event: DraftEvent): LodestarEvent
  query(filter: EventFilter): LodestarEvent[]
  verify(sessionId: string): VerifyResult
}
