/**
 * LODESTAR — building the Evidence Record from the ledger.
 *
 * ---------------------------------------------------------------------------
 * BUILT FROM THE LEDGER, DETERMINISTICALLY, OR NOT AT ALL — D-059
 * ---------------------------------------------------------------------------
 *
 * Everything here is a pure function of the ledger's bytes. No clock is read, no
 * random id is minted, no environment is consulted: the same database state produces a
 * byte-identical record with the same `recordId`, today and in five years. That
 * property is load-bearing — it is what makes the record content-addressable, what
 * makes "these two records are the same evidence" a hash comparison instead of a
 * judgment call, and what lets a test pin the whole format with golden vectors
 * (spec/vectors/).
 *
 * The judgments (`evidence.*`) are computed HERE, once, at build time — not by the
 * report, not by a renderer. The SessionReport is derived from the record
 * (facts/report.ts `reportFromRecord`), which extends D-049 one layer down: renderers
 * render the report, the report derives from the record, the record derives from the
 * ledger. One direction, no opinions on the way up.
 */

import { hashOf, GENESIS_HASH } from '../core/hash.js'
import { verifyEvents, chainHead } from '../core/chain.js'
import { LODESTAR_VERSION } from '../core/version.js'
import type { SqliteEventStore } from '../storage/event-store.js'
import type { LodestarEvent, SessionStartPayload } from '../types/events.js'
import type { CommandCoverage } from '../recorder/shims.js'
import {
  FACT_CATALOG,
  evaluateEvents,
  interferenceEvents,
  limitationsEvents,
} from '../facts/index.js'
import {
  RECORD_FORMAT,
  RECORD_FORMAT_VERSION,
  type EvidenceRecord,
  type IntegrityStatus,
  type RecordIdentity,
} from './types.js'

function payloadOf<T>(e: LodestarEvent): T {
  return e.payload as T
}

/** Coverage as it was measured at session start, read back out of the ledger. */
function coverageFromRecord(groundTruth: LodestarEvent[]): CommandCoverage[] {
  for (const e of groundTruth) {
    if (e.kind !== 'agent.output') continue
    const probe = payloadOf<{ coverageProbe?: { commands?: CommandCoverage[] } }>(e).coverageProbe
    if (probe?.commands) return probe.commands
  }
  return []
}

function recorderErrorsFromRecord(groundTruth: LodestarEvent[]): string[] {
  return groundTruth
    .filter((e) => e.kind === 'agent.output')
    .map((e) => payloadOf<{ recorderError?: string; recorder?: string }>(e))
    .filter((p) => typeof p.recorderError === 'string')
    .map((p) => `${p.recorder ?? 'recorder'}: ${p.recorderError}`)
}

/**
 * Everything that stops this record from being complete.
 *
 * ---------------------------------------------------------------------------
 * EVERY BRANCH HERE IS A DEMOTION, AND THAT IS THE DESIGN
 * ---------------------------------------------------------------------------
 *
 * The temptation with a status word is to keep it green unless something is obviously
 * wrong, because green feels like a working product. That instinct is precisely
 * backwards for a trust tool: `VERIFIED` is a promise that there are no holes, so
 * anything we cannot see has to spend it.
 *
 * `shadowed` and `unknown` both demote, for different reasons that must not be merged
 * (D-040): shadowed means the command ran somewhere we could not watch; unknown means
 * we could not even find out. Both leave the record incomplete; only the wording
 * differs.
 *
 * (Moved here from facts/report.ts: what makes evidence incomplete is a property of
 * the evidence, computed when the record is built, identical on every surface.)
 */
function degradations(
  groundTruth: LodestarEvent[],
  coverage: CommandCoverage[],
  closed: boolean,
  recorderErrors: string[],
): string[] {
  const notes: string[] = []

  if (!closed) {
    notes.push(
      'This session has no end event. It is still running, or the wrapper died before it ' +
        'could close the record — anything after the last event was not observed.',
    )
  }

  const shadowed = coverage.filter((c) => c.status === 'shadowed').map((c) => c.command)
  if (shadowed.length) {
    notes.push(
      `Shims were shadowed on PATH for: ${shadowed.join(', ')}. If the agent ran these, ` +
        'LODESTAR did not see it, and their absence from this report proves nothing.',
    )
  }

  const unknown = coverage.filter((c) => c.status === 'unknown').map((c) => c.command)
  if (unknown.length) {
    notes.push(
      `Coverage could not be measured for: ${unknown.join(', ')}. This is a statement ` +
        'about LODESTAR, not about whether those commands ran.',
    )
  }

  if (!coverage.length) {
    notes.push(
      'Command coverage was never probed for this session, so there is no measurement of ' +
        'which commands LODESTAR could observe.',
    )
  }

  for (const err of recorderErrors) {
    notes.push(`A recorder failed during this session — ${err}. Its events are missing.`)
  }

  // Content withheld is a hole in the *evidence*, even though withholding it is correct.
  // RF-05 cannot see a revert it has no hashes for, so the report must not imply it looked.
  const withheld = groundTruth.filter(
    (e) =>
      e.kind === 'file.write' &&
      payloadOf<{ contentWithheld?: string }>(e).contentWithheld,
  )
  if (withheld.length) {
    const reasons = [
      ...new Set(withheld.map((e) => payloadOf<{ contentWithheld?: string }>(e).contentWithheld)),
    ]
    notes.push(
      `${withheld.length} file change(s) were recorded without content (${reasons.join(', ')}). ` +
        'The change is in the record; the bytes are not, so content-based facts could not ' +
        'be computed for them.',
    )
  }

  return notes
}

/**
 * The record's content address: sha256 over the canonical record with `recordId`
 * itself omitted. Defined here and in RECORD-SPEC.md §5; the standalone verifier
 * recomputes it independently.
 */
export function computeRecordId(record: Omit<EvidenceRecord, 'recordId'> | EvidenceRecord): string {
  const body: Record<string, unknown> = { ...record }
  delete body['recordId']
  return hashOf(body)
}

/**
 * Build the Evidence Record for one session.
 *
 * Returns `null` only when the session does not exist. Every other failure state is a
 * value inside the record — a broken chain is a record that SAYS it is broken, not an
 * error, because "this record was altered" is the single most important thing a record
 * can ever say.
 */
export function buildRecord(store: SqliteEventStore, sessionId: string): EvidenceRecord | null {
  const session = store.getSession(sessionId)
  if (!session) return null

  const events = store.query({ sessionId })
  const chain = verifyEvents(events)
  const groundTruth = events.filter((e) => e.signalTier === 'groundTruth')

  // The fact engine filters tiers itself (D-009); handing it the full array is safe by
  // construction. It is handed the full array anyway so the gate lives in ONE place.
  const facts = evaluateEvents(events)
  const limitations = limitationsEvents(events)
  const interference = interferenceEvents(events)

  const coverage = coverageFromRecord(groundTruth)
  const recorderErrors = recorderErrorsFromRecord(groundTruth)
  const closed = groundTruth.some((e) => e.kind === 'session.end')
  const degraded = degradations(groundTruth, coverage, closed, recorderErrors)
  const status: IntegrityStatus = !chain.intact ? 'BROKEN' : degraded.length ? 'DEGRADED' : 'VERIFIED'

  // Identity from the CHAINED session.start event, groundTruth tier only — the mutable
  // sessions table frames the record (subject); it never supplies identity (D-035).
  const start = groundTruth.find((e) => e.kind === 'session.start')
  const sp = start ? payloadOf<SessionStartPayload>(start) : undefined
  const identity: RecordIdentity = {}
  if (sp?.machineId) identity.machineId = sp.machineId
  if (sp?.runtimeVersion) identity.runtimeVersion = sp.runtimeVersion
  if (sp?.model) identity.model = sp.model
  if (sp?.gitCommit !== undefined) identity.gitCommit = sp.gitCommit

  const body: Omit<EvidenceRecord, 'recordId'> = {
    format: RECORD_FORMAT,
    formatVersion: RECORD_FORMAT_VERSION,
    generator: { name: 'lodestar', version: LODESTAR_VERSION },
    subject: {
      sessionId: session.id,
      sessionNumber: session.number,
      runtimeId: session.runtimeId,
      mission: session.mission ?? null,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      exitCode: session.exitCode ?? null,
      cwd: session.cwd,
    },
    identity,
    observations: {
      genesis: GENESIS_HASH,
      head: chainHead(events),
      count: events.length,
      events,
    },
    evidence: {
      catalog: [...FACT_CATALOG],
      facts,
      limitations,
      interference,
      coverage,
      recorderErrors,
      closed,
      integrity: { status, chain, degraded },
    },
  }

  return { ...body, recordId: computeRecordId(body) }
}
