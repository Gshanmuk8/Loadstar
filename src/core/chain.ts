/**
 * LODESTAR — the hashed event body and pure chain verification.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE IS THE RECORD FORMAT — D-059
 * ---------------------------------------------------------------------------
 *
 * `eventHashBody` defines the exact set of fields the hash chain protects, and
 * `verifyEvents` defines what "intact" means. Together with `canonicalJSON` and
 * `chainHash` (core/hash.ts) they ARE the LODESTAR record format: an independent
 * implementation that reproduces these four functions reproduces our hashes.
 *
 * They are specified, with golden vectors, in docs/RECORD-SPEC.md. Any change here is
 * a format change: previously written chains stop verifying, the standalone verifier
 * (verifier/lodestar-verify.mjs) diverges, and the spec must version. Treat this file
 * the way you would treat the byte layout of a database page.
 *
 * Verification is PURE — an event array in, a result out — so the same walk runs in
 * three places and cannot disagree with itself:
 *   - `SqliteEventStore.verify`   over the local ledger
 *   - `buildRecord`               when an Evidence Record is produced
 *   - the standalone verifier     over an exported record, with no LODESTAR installed
 *     (an independent reimplementation, pinned to this one by the golden vectors)
 */

import type { LodestarEvent, VerifyResult } from '../types/events.js'
import { GENESIS_HASH, chainHash } from './hash.js'

/**
 * The body that gets hashed. Everything except `hash` itself.
 *
 * Field order here is irrelevant — canonicalJSON sorts keys — but the *set* of fields
 * is part of the record format. Adding a field to the event without adding it here
 * means the field is unprotected: it could be altered without breaking the chain.
 * Adding it here is a format change — see the header, and RECORD-SPEC.md §3.
 */
export function eventHashBody(e: Omit<LodestarEvent, 'hash'>): Record<string, unknown> {
  return {
    id: e.id,
    sessionId: e.sessionId,
    seq: e.seq,
    ts: e.ts,
    monotonicTs: e.monotonicTs,
    source: e.source,
    signalTier: e.signalTier,
    kind: e.kind,
    actor: e.actor,
    target: e.target ?? null,
    effectClass: e.effectClass ?? null,
    blastRadius: e.blastRadius ?? null,
    reversible: e.reversible ?? null,
    taint: e.taint ?? null,
    missionId: e.missionId ?? null,
    payload: e.payload,
    snapshotRef: e.snapshotRef ?? null,
    prevHash: e.prevHash,
  }
}

/**
 * Walk one session's chain and recompute every link.
 *
 * Pure: the input is the complete, seq-ordered event list of ONE session. The caller
 * owns ordering (the store queries `ORDER BY seq`; a record carries events already
 * ordered) — this function checks that the sequence is gapless from 1, that every
 * `prevHash` links, and that every hash recomputes from its content.
 *
 * It must stay cheap enough to run on every `lodestar status` — if verification
 * becomes something you only do when you already suspect a problem, it is not a
 * guarantee, it is a forensic tool.
 */
export function verifyEvents(events: LodestarEvent[]): VerifyResult {
  let prevHash = GENESIS_HASH

  for (const [i, e] of events.entries()) {
    const expectedSeq = i + 1
    if (e.seq !== expectedSeq) {
      return {
        intact: false,
        eventsChecked: i,
        brokenAt: e.seq,
        reason: `sequence gap: expected ${expectedSeq}, found ${e.seq}`,
      }
    }
    if (e.prevHash !== prevHash) {
      return {
        intact: false,
        eventsChecked: i,
        brokenAt: e.seq,
        reason: 'prevHash does not match the previous event',
      }
    }
    const { hash, ...rest } = e
    if (chainHash(prevHash, eventHashBody(rest)) !== hash) {
      return {
        intact: false,
        eventsChecked: i,
        brokenAt: e.seq,
        reason: 'event content does not match its hash',
      }
    }
    prevHash = hash
  }

  return { intact: true, eventsChecked: events.length }
}

/**
 * The chain head: the hash of the last event, or the genesis hash for an empty chain.
 *
 * This is the content address of the entire observation set — every event is reachable
 * from it through `prevHash`, so two records with the same head carry the same
 * observations. The Evidence Record exposes it as `observations.head`.
 */
export function chainHead(events: LodestarEvent[]): string {
  return events.length ? events[events.length - 1]!.hash : GENESIS_HASH
}
