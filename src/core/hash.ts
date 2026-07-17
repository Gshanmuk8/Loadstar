/**
 * LODESTAR — canonical serialization and hash chaining.
 *
 * This is the mechanical basis of the entire trust claim. If canonicalization is not
 * stable across versions, previously written chains stop verifying — and a record that
 * cannot be verified is worth nothing. Treat any change to `canonicalJSON` as a
 * breaking change to the record format, not a refactor.
 *
 * See ARCHITECTURE.md §4.
 */

import { createHash } from 'node:crypto'

/** The prevHash of the first event in a session. */
export const GENESIS_HASH = '0'.repeat(64)

/**
 * Deterministic JSON: object keys sorted, recursively.
 *
 * JSON.stringify preserves insertion order, so two structurally identical events
 * built by different code paths can serialize differently and hash differently.
 * Sorting removes that.
 *
 * `undefined` is dropped (matching JSON.stringify). `null` is preserved — the two
 * are not interchangeable here: `reversible: null` means "unknown", which is a
 * different claim from "not recorded".
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue
    out[key] = canonicalize(obj[key])
  }
  return out
}

/** sha256 over the canonical form, hex-encoded. */
export function hashOf(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value), 'utf8').digest('hex')
}

/**
 * The chain link: hash = H(prevHash || canonicalJSON(event minus hash)).
 *
 * `prevHash` is included in the hashed body, which is what makes the chain a chain:
 * altering any earlier event changes every subsequent hash, so tampering leaves a
 * mark. Tamper-*evident*, not tamper-proof — the guarantee is detection, not
 * prevention. Do not let the docs or the UI overclaim this.
 */
export function chainHash(prevHash: string, body: Record<string, unknown>): string {
  return createHash('sha256')
    .update(prevHash, 'utf8')
    .update(canonicalJSON(body), 'utf8')
    .digest('hex')
}
