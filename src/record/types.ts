/**
 * LODESTAR — the Evidence Record: the canonical, portable artifact.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — D-059
 * ---------------------------------------------------------------------------
 *
 * Before this layer there were three shapes of "what happened": the ledger (SQLite,
 * machine-local, the source), the SessionReport (a computed view model, rebuilt per
 * render, never persisted), and the HTML export (a rendering, carrying judgments a
 * recipient could not recheck). None of them was a durable, addressable, *portable*
 * unit — the thing a person can hand to someone else, keep for five years, and verify
 * without trusting the sender.
 *
 * The Evidence Record is that unit. It is:
 *
 *   - **canonical**     — one serialization (core/hash.ts `canonicalJSON`), specified
 *                         in docs/RECORD-SPEC.md, reproducible by an independent
 *                         implementation.
 *   - **deterministic** — built from the ledger alone. The same ledger state produces
 *                         a byte-identical record. There is no `createdAt` inside the
 *                         record for exactly this reason: an export timestamp would
 *                         make two exports of the same evidence hash differently,
 *                         which would make the content address a lie.
 *   - **content-addressed** — `recordId` is the sha256 of the canonical record with
 *                         `recordId` itself omitted. Two records with the same id
 *                         carry the same bytes; a changed byte changes the id.
 *   - **renderer-independent** — the SessionReport (facts/report.ts) is DERIVED from
 *                         this record, and so is everything a renderer shows. The
 *                         record is the single source of truth; renderers are three
 *                         layouts of it (D-049 extended downward).
 *
 * The layering, bottom to top (see ARCHITECTURE.md):
 *
 *   Execution Boundary → Observation → Evidence → EVIDENCE RECORD → Verification → Presentation
 *      (recorder/)      (types/events)  (facts/)     (this file)    (core/chain,      (facts/report,
 *                                                                    verifier/)        report/, cli/)
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PROTECTED, AND WHAT IS NOT — the honesty boundary
 * ---------------------------------------------------------------------------
 *
 * Only `observations.events` are hash-chained. Everything in `evidence` is a computed
 * claim BY the generator OVER those events — deterministic and re-derivable, but not
 * independently proven by the standalone verifier (recomputing facts requires the fact
 * engine; the verifier checks that every fact's evidence pointers resolve, not that
 * the fact was correctly computed). `subject` is framing read from the mutable
 * sessions table (D-035) — identity that must be trusted comes from the
 * `session.start` event, which IS chained, and lives in `identity`.
 *
 * The record states this split rather than implying more: the verifier's output lists
 * what it verified and what it cannot, in so many words. A trust artifact that lets
 * its own metadata borrow the chain's credibility is overclaiming by layout.
 */

import type { LodestarEvent, VerifyResult } from '../types/events.js'
import type { RealityFact } from '../facts/index.js'
import type { CommandCoverage } from '../recorder/shims.js'

/** The format discriminator. An independent reader keys on this, never on filename. */
export const RECORD_FORMAT = 'lodestar-evidence-record'

/**
 * The format version. Bump ONLY with a decision in DECISIONS.md and a spec update —
 * a version bump means previously written verifiers reject new records, which is the
 * compatibility contract working, not failing. Additive optional fields do not bump
 * this (RECORD-SPEC.md §6); changes to hashing, canonicalization, or required fields do.
 */
export const RECORD_FORMAT_VERSION = 1

/**
 * How much of this record can be trusted, in one word.
 *
 * Three states, and the boundaries between them are the whole point:
 *
 * - `VERIFIED` — the chain recomputes AND no evidence is missing. Every claim in the
 *   record rests on something observed.
 * - `DEGRADED` — the chain recomputes but some evidence was never captured: a shadowed
 *   shim, an unmeasured probe, a recorder that errored, a session that never closed.
 *   The facts present are still true; the record is simply not complete, and it says so.
 * - `BROKEN` — the chain does not recompute. Something rewrote the record.
 *
 * **`VERIFIED` must never be reachable by accident.** It is the only state that invites
 * a developer to stop reading, so every gap we know about has to demote it. That
 * asymmetry is deliberate: a false `DEGRADED` costs the user thirty seconds, a false
 * `VERIFIED` costs them the bug they installed LODESTAR to catch.
 *
 * (Moved here from facts/report.ts: integrity is a property of the EVIDENCE, not of
 * its presentation. The report re-exports these for its renderers.)
 */
export type IntegrityStatus = 'VERIFIED' | 'DEGRADED' | 'BROKEN'

export interface Integrity {
  status: IntegrityStatus
  /** The raw chain result. `BROKEN` is exactly `!chain.intact`. */
  chain: VerifyResult
  /**
   * Why the status is `DEGRADED`, in the words the user reads.
   *
   * Empty when `VERIFIED`. Never empty when `DEGRADED` — a degraded state with no
   * stated reason is a shrug, and a shrug is what this product replaces.
   */
  degraded: string[]
}

/**
 * What this record is about — the session frame.
 *
 * Read from the sessions table, which is mutable by design (D-035): `endedAt` and
 * `exitCode` are unknowable at start. The frame is context, NOT chained evidence.
 * A consumer that needs provable identity reads `identity` (from the chained
 * `session.start` event) and the events themselves.
 */
export interface RecordSubject {
  sessionId: string
  /** Human-readable, per-project. Display affordance only — never key on it (D-017). */
  sessionNumber: number
  runtimeId: string
  mission: string | null
  startedAt: string
  endedAt: string | null
  exitCode: number | null
  cwd: string
}

/** Which build produced this record. Provenance for the computed `evidence` layer. */
export interface RecordGenerator {
  name: string
  version: string
}

/**
 * Session identity, read from the `session.start` event — the CHAINED copy, not the
 * mutable table (the same rule as facts/report.ts, for the same reason: identity that
 * can be silently rewritten is not identity).
 */
export interface RecordIdentity {
  machineId?: string
  runtimeVersion?: string
  model?: string
  gitCommit?: string | null
}

/**
 * The protected layer: the complete, seq-ordered event list of one session, plus the
 * chain frame a verifier checks it against.
 *
 * `head` is the content address of the whole observation set — every event is
 * reachable from it via `prevHash`. `count` is stated so truncation is detectable
 * even before the chain walk runs.
 *
 * Note what is NOT here: blob contents. `snapshotRef`s are hashes into the local blob
 * store, which is deletable by design (D-037). A record carries the same privacy
 * posture as the ledger — redacted command lines, no file bytes.
 */
export interface RecordObservations {
  genesis: string
  head: string
  count: number
  events: LodestarEvent[]
}

/**
 * The computed layer: what the fact engine concluded from the observations, with the
 * engine's declared coverage (`catalog`) so silence is interpretable.
 *
 * Everything here is deterministic over `observations.events` — same events, same
 * generator version, same evidence. It is a claim, not a proof: see the header.
 */
export interface RecordEvidence {
  /** Every fact id the engine evaluated. Facts absent from a record with a catalog
   *  entry were evaluated and did not fire — a measurement, not a gap. */
  catalog: RealityFact['id'][]
  facts: RealityFact[]
  /** What could not be determined. Read alongside `facts`, never instead of them. */
  limitations: string[]
  /** Where LODESTAR itself changed the outcome (D-039). */
  interference: string[]
  /** Per-command shim coverage as MEASURED at session start. Empty means never probed. */
  coverage: CommandCoverage[]
  /** Recorder failures, from the record itself. Holes we know about. */
  recorderErrors: string[]
  /** False when no `session.end` event exists — everything after the last event is unobserved. */
  closed: boolean
  integrity: Integrity
}

/**
 * The Evidence Record. See the file header; see docs/RECORD-SPEC.md for the wire
 * format an independent implementation targets.
 *
 * Top-level keys `attestations`, `links`, and `extensions` are RESERVED by the spec
 * for V2 (signed attestations) and V3 (knowledge links). They are deliberately not
 * declared here: reserving the names now costs nothing and prevents an extension from
 * squatting on them later; declaring them would be building V2 early.
 */
export interface EvidenceRecord {
  format: typeof RECORD_FORMAT
  formatVersion: number
  /**
   * sha256 (lowercase hex) of the canonical record with `recordId` omitted.
   * The record's content address — cite it, dedupe by it, verify against it.
   */
  recordId: string
  generator: RecordGenerator
  subject: RecordSubject
  identity: RecordIdentity
  observations: RecordObservations
  evidence: RecordEvidence
}
