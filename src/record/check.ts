/**
 * LODESTAR — in-process Evidence Record verification.
 *
 * The graph must never store an object it has not verified (GRAPH-SPEC §2:
 * verify-on-add is a store property, not a client courtesy). This runs the
 * RECORD-SPEC §7 checks — structure, record id, session identity, chain, frame,
 * fact pointers, tier rule, integrity-claim consistency — in-process.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE FIRST IMPLEMENTATION, NOT A THIRD — D-060 PRESERVED
 * ---------------------------------------------------------------------------
 *
 * It reuses `verifyEvents`, `chainHead`, and `computeRecordId` — the same functions
 * the builder uses — so it cannot drift from the generator. The standalone verifier
 * (verifier/lodestar-verify.mjs) remains the format's only INDEPENDENT
 * implementation, and the tests cross-pin this checker against it on identical
 * accept and reject fixtures. Deduplicating the standalone verifier into an import
 * of this file would silently delete the second implementation; do not.
 */

import { verifyEvents, chainHead } from '../core/chain.js'
import { GENESIS_HASH } from '../core/hash.js'
import { computeRecordId } from './build.js'
import { RECORD_FORMAT, RECORD_FORMAT_VERSION, type EvidenceRecord } from './types.js'
import type { LodestarEvent } from '../types/events.js'

export interface CheckResult {
  ok: boolean
  /**
   * `invalid`  — not a record, unsupported version, or structurally malformed.
   * `altered`  — parses as a record but the bytes do not verify.
   * `verified` — every §7 check passed.
   */
  verdict: 'verified' | 'invalid' | 'altered'
  /** Human-readable failures, in check order. Empty when ok. */
  errors: string[]
  /** The record, when structurally sound enough to hand back. */
  record?: EvidenceRecord
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const isHex64 = (v: unknown): v is string => isStr(v) && /^[0-9a-f]{64}$/.test(v)

/**
 * Structural checks — the subset that makes the deeper checks safe to run.
 *
 * Deliberately lighter than the standalone verifier's field-by-field walk: this
 * checker's callers hold TypeScript types downstream, so the gate here is "cannot
 * crash, cannot lie about identity", and unknown extra fields are tolerated
 * (RECORD-SPEC §5.1 — reserved and future keys must not be rejected).
 */
function structural(r: Record<string, unknown>): string[] {
  const errs: string[] = []
  const need = (cond: boolean, msg: string): void => {
    if (!cond) errs.push(msg)
  }

  need(isHex64(r['recordId']), 'recordId: expected 64 lowercase hex characters')
  const gen = r['generator']
  need(isObj(gen) && isStr(gen['name']) && isStr(gen['version']), 'generator: expected { name, version }')

  const s = r['subject']
  if (isObj(s)) {
    need(isStr(s['sessionId']), 'subject.sessionId: expected a string')
    need(isNum(s['sessionNumber']), 'subject.sessionNumber: expected a number')
    need(isStr(s['runtimeId']), 'subject.runtimeId: expected a string')
    need(isStr(s['startedAt']), 'subject.startedAt: expected a string')
    need(isStr(s['cwd']), 'subject.cwd: expected a string')
  } else {
    errs.push('subject: expected an object')
  }

  const o = r['observations']
  if (isObj(o)) {
    need(o['genesis'] === GENESIS_HASH, 'observations.genesis: expected the genesis constant')
    need(isHex64(o['head']), 'observations.head: expected 64 lowercase hex characters')
    need(isNum(o['count']), 'observations.count: expected a number')
    need(Array.isArray(o['events']), 'observations.events: expected an array')
  } else {
    errs.push('observations: expected an object')
  }

  const ev = r['evidence']
  if (isObj(ev)) {
    need(Array.isArray(ev['catalog']), 'evidence.catalog: expected an array')
    need(Array.isArray(ev['facts']), 'evidence.facts: expected an array')
    const integ = ev['integrity']
    need(
      isObj(integ) &&
        isStr(integ['status']) &&
        ['VERIFIED', 'DEGRADED', 'BROKEN'].includes(integ['status'] as string) &&
        Array.isArray(integ['degraded']),
      'evidence.integrity: expected { status: VERIFIED|DEGRADED|BROKEN, degraded: [] }',
    )
  } else {
    errs.push('evidence: expected an object')
  }

  return errs
}

/**
 * Run the RECORD-SPEC §7 checks over a parsed value.
 *
 * Deterministic: same value, same result, same error strings.
 */
export function checkRecord(value: unknown): CheckResult {
  if (!isObj(value) || value['format'] !== RECORD_FORMAT) {
    return {
      ok: false,
      verdict: 'invalid',
      errors: ['not a LODESTAR evidence record (missing format marker)'],
    }
  }
  if (value['formatVersion'] !== RECORD_FORMAT_VERSION) {
    return {
      ok: false,
      verdict: 'invalid',
      errors: [
        `format version ${String(value['formatVersion'])} is not supported ` +
          `(supports ${RECORD_FORMAT_VERSION}); a newer implementation may exist`,
      ],
    }
  }

  const structuralErrors = structural(value)
  if (structuralErrors.length) {
    return { ok: false, verdict: 'invalid', errors: structuralErrors }
  }

  // Structurally sound — safe to treat as the type for the deeper checks.
  const record = value as unknown as EvidenceRecord
  const errors: string[] = []
  const events = record.observations.events as LodestarEvent[]

  // §7.2 — the content address matches the content.
  const expectedId = computeRecordId(record)
  if (expectedId !== record.recordId) {
    errors.push(
      `record id: stated ${record.recordId}, canonical content hashes to ${expectedId}`,
    )
  }

  // §7.3 — every event belongs to the subject session (no spliced records).
  const foreign = events.filter((e) => e.sessionId !== record.subject.sessionId).length
  if (foreign) errors.push(`session identity: ${foreign} event(s) carry a different sessionId`)

  // §7.4 — the chain.
  const chain = verifyEvents(events)
  if (!chain.intact) {
    errors.push(
      `hash chain: event ${chain.brokenAt}: ${chain.reason} ` +
        `(${chain.eventsChecked} verified before the break)`,
    )
  }

  // §7.5 — the stated frame matches the events.
  const head = chainHead(events)
  if (head !== record.observations.head) {
    errors.push(`chain head: stated ${record.observations.head}, events end at ${head}`)
  }
  if (events.length !== record.observations.count) {
    errors.push(
      `event count: stated ${record.observations.count}, record carries ${events.length}`,
    )
  }

  // §7.6 + §7.7 — fact pointers resolve exactly, at groundTruth tier only.
  const byId = new Map(events.map((e) => [e.id, e]))
  for (const f of record.evidence.facts) {
    for (const ptr of f.evidence) {
      const e = byId.get(ptr.eventId)
      if (!e) errors.push(`${f.id}: cites event ${ptr.eventId}, which is not in the record`)
      else {
        if (e.seq !== ptr.eventSeq) errors.push(`${f.id}: cites seq ${ptr.eventSeq}, event has seq ${e.seq}`)
        if (e.ts !== ptr.ts) errors.push(`${f.id}: cites ts ${ptr.ts}, event has ts ${e.ts}`)
        if (e.signalTier !== 'groundTruth') {
          errors.push(`${f.id}: cites a ${e.signalTier}-tier event (${ptr.eventId})`)
        }
      }
    }
  }

  // §7.8 — the stated status is consistent with what these bytes verify to.
  const stated = record.evidence.integrity
  const expectedStatus = !chain.intact ? 'BROKEN' : stated.degraded.length ? 'DEGRADED' : 'VERIFIED'
  if (stated.status !== expectedStatus) {
    errors.push(
      `integrity claim: record states ${stated.status}; these bytes verify to ${expectedStatus}`,
    )
  }

  if (errors.length) return { ok: false, verdict: 'altered', errors, record }
  return { ok: true, verdict: 'verified', errors: [], record }
}
