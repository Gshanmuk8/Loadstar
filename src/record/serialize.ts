/**
 * LODESTAR — Evidence Record serialization.
 *
 * A record on disk IS its canonical serialization: compact, keys sorted, exactly what
 * `recordId` is computed over (minus the `recordId` field itself). Writing anything
 * else — pretty-printed, key-ordered-by-insertion — would mean the file and the hash
 * input differ, and every independent implementation would have to know both forms.
 * One form, specified in RECORD-SPEC.md §2, everywhere.
 */

import { canonicalJSON } from '../core/hash.js'
import type { EvidenceRecord } from './types.js'

/** The canonical bytes of a record — what `lodestar report --record` writes. */
export function serializeRecord(record: EvidenceRecord): string {
  return canonicalJSON(record)
}

/**
 * The id of the `<script>` element that carries a record inside an exported HTML
 * report. Pinned by RECORD-SPEC.md §7 — the standalone verifier finds the record by
 * this marker, so an exported report is verifiable without exporting the JSON twice.
 */
export const RECORD_HTML_MARKER_ID = 'lodestar-evidence-record'

/**
 * The record as an inert `<script type="application/json">` block.
 *
 * Every `<` in the JSON is replaced with the six-character JSON escape \u003c.
 * A `<` only ever occurs inside JSON strings — the syntax itself has none —
 * so the escaped payload parses to identical values, while a literal "</script>" or
 * "<!--" cannot occur in the emitted bytes. The browser never executes the block; the
 * verifier extracts and parses it. Hashing is defined over the canonical form of the
 * parsed VALUE (RECORD-SPEC.md §5), so this escaping does not affect verification.
 */
export function recordScriptTag(record: EvidenceRecord): string {
  const json = serializeRecord(record).replace(/</g, '\\u003c')
  return `<script type="application/json" id="${RECORD_HTML_MARKER_ID}">${json}</script>`
}

/**
 * Pull the embedded record's JSON text out of an exported HTML report, or return
 * null when the page carries none. The inverse of `recordScriptTag`; the marker is
 * spec-pinned (RECORD-SPEC §7), and the first block wins — a conforming export
 * carries exactly one.
 */
export function extractRecordJsonFromHtml(html: string): string | null {
  const m = new RegExp(
    `<script type="application/json" id="${RECORD_HTML_MARKER_ID}">([\\s\\S]*?)</script>`,
  ).exec(html)
  return m ? m[1]! : null
}
