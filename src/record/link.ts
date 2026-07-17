/**
 * LODESTAR — the Link object: the declared layer (P5) and identity correction (P4).
 *
 * ---------------------------------------------------------------------------
 * A LINK IS AN EVIDENCE OBJECT, NOT A LEDGER — V1-DESIGN-REVIEW §8.2
 * ---------------------------------------------------------------------------
 *
 * The proposal's per-author chained ledger was killed: multi-device authors fork
 * their own chain on a dumb transport, a single claim can never be deleted without
 * breaking the history, and it duplicated the store discipline. So a link is an
 * immutable, content-addressed object in the SAME store as records —
 * `links/<2hex>/<linkId>.link.json`. `linkId` is built exactly like `recordId`
 * (`hashOf(canonical minus the id)`), so there is one hashing discipline, not two,
 * and the file on disk IS the canonical form (D-059).
 *
 * ---------------------------------------------------------------------------
 * A LINK IS A CLAIM. IT NEVER REACHES A FACT — P5
 * ---------------------------------------------------------------------------
 *
 * Nothing here is read by the fact engine (`src/facts/`). Two link types feed
 * identity RESOLUTION (a re-grouping, never a fact); one (`retracts`) nullifies
 * another link; the rest are inert annotations. The author is an UNAUTHENTICATED
 * claimed string — signatures are V2. This module makes claims storable and
 * verifiable; it does not make them true.
 */

import { hashOf, canonicalJSON } from '../core/hash.js'

export const LINK_FORMAT = 'lodestar-link'
export const LINK_FORMAT_VERSION = 1

/**
 * The declared link types. `identity:*` feed resolution; `retracts` nullifies a
 * link; the rest are inert organization. `x-<ns>:<type>` (and, per GRAPH-SPEC §5,
 * ANY unknown non-empty string) are tolerated and counted — never rejected (F4).
 */
export const KNOWN_LINK_TYPES = [
  'relates-to',
  'supersedes',
  'mission',
  'incident',
  'review',
  'identity:same-repo',
  'identity:distinct-repos',
  'retracts',
] as const

export interface Link {
  format: typeof LINK_FORMAT
  formatVersion: typeof LINK_FORMAT_VERSION
  linkId: string
  /** Claimed, unauthenticated until V2 keys. */
  author: string
  /** ISO 8601, a stated clock — never proven by anything in V1. */
  ts: string
  type: string
  from: string
  to: string
  reason: string
}

/** The id is the content address: sha256 of the canonical form with `linkId` removed. */
export function computeLinkId(link: Omit<Link, 'linkId'> | Link): string {
  const body: Record<string, unknown> = { ...link }
  delete body['linkId']
  return hashOf(body)
}

/**
 * The canonical bytes of a link — what is written to disk and hashed over.
 *
 * Identical form to the hash input modulo `linkId` (D-059), so the file on disk is
 * exactly what any independent implementation recomputes the id from.
 */
export function serializeLink(link: Link): string {
  return canonicalJSON(link)
}

// ---------------------------------------------------------------------------
// Addresses — GRAPH-SPEC §3, extended with the repo address for identity endpoints.
// ---------------------------------------------------------------------------

const RECORD_ADDR = /^evidence:record\/([0-9a-f]{64})(#\d+)?$/
const LINK_ADDR = /^evidence:link\/([0-9a-f]{64})$/
const REPO_ADDR_PREFIX = 'evidence:repo/'

export type AddressKind = 'record' | 'link' | 'repo' | 'external'

/** Classify an address string. `external` is any non-empty non-`evidence:` value. */
export function addressKind(addr: string): AddressKind | null {
  if (typeof addr !== 'string' || addr.length === 0) return null
  if (RECORD_ADDR.test(addr)) return 'record'
  if (LINK_ADDR.test(addr)) return 'link'
  if (addr.startsWith(REPO_ADDR_PREFIX) && addr.length > REPO_ADDR_PREFIX.length) return 'repo'
  if (addr.startsWith('evidence:')) return null // an evidence: address we cannot parse
  return 'external'
}

/** The repo signal named by `evidence:repo/<signal>`, or null if not a repo address. */
export function repoSignalOf(addr: string): string | null {
  return addr.startsWith(REPO_ADDR_PREFIX) ? addr.slice(REPO_ADDR_PREFIX.length) : null
}

/** The linkId targeted by `evidence:link/<id>`, or null. */
export function linkTargetOf(addr: string): string | null {
  return LINK_ADDR.exec(addr)?.[1] ?? null
}

/** Wrap a bare repo signal as a repo address (CLI ergonomics — stored form is always an address). */
export function repoAddress(signal: string): string {
  return `${REPO_ADDR_PREFIX}${signal}`
}

// ---------------------------------------------------------------------------
// Checking — verify-on-add, mirroring checkRecord.
// ---------------------------------------------------------------------------

export interface LinkCheckResult {
  ok: boolean
  verdict: 'verified' | 'invalid' | 'altered'
  errors: string[]
  link?: Link
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const isHex64 = (v: unknown): v is string => isStr(v) && /^[0-9a-f]{64}$/.test(v)

/**
 * Run the link checks over a parsed value. Deterministic error strings.
 *
 * Verdicts mirror checkRecord: `invalid` (not a link / bad version / malformed),
 * `altered` (parses but linkId ≠ content), `verified` (all checks pass).
 */
export function checkLink(value: unknown): LinkCheckResult {
  if (!isObj(value) || value['format'] !== LINK_FORMAT) {
    return { ok: false, verdict: 'invalid', errors: ['not a LODESTAR link (missing format marker)'] }
  }
  if (value['formatVersion'] !== LINK_FORMAT_VERSION) {
    return {
      ok: false,
      verdict: 'invalid',
      errors: [
        `link format version ${String(value['formatVersion'])} is not supported ` +
          `(supports ${LINK_FORMAT_VERSION}); a newer implementation may exist`,
      ],
    }
  }

  const errs: string[] = []
  const need = (cond: boolean, msg: string): void => {
    if (!cond) errs.push(msg)
  }
  need(isHex64(value['linkId']), 'linkId: expected 64 lowercase hex characters')
  need(isStr(value['author']) && (value['author'] as string).length > 0, 'author: expected a non-empty string')
  need(isStr(value['ts']) && (value['ts'] as string).length > 0, 'ts: expected an ISO 8601 string')
  need(isStr(value['type']) && (value['type'] as string).length > 0, 'type: expected a non-empty string')
  need(isStr(value['from']) && (value['from'] as string).length > 0, 'from: expected an address')
  need(isStr(value['to']) && (value['to'] as string).length > 0, 'to: expected an address or URL')
  need(isStr(value['reason']), 'reason: expected a string (may be empty)')
  if (errs.length) return { ok: false, verdict: 'invalid', errors: errs }

  const link = value as unknown as Link

  // `from` must be a resolvable evidence address; `to` may additionally be external.
  if (addressKind(link.from) === null || addressKind(link.from) === 'external') {
    errs.push(`from: "${link.from}" is not an evidence address (record/link/repo)`)
  }
  if (addressKind(link.to) === null) {
    errs.push(`to: "${link.to}" is not a valid address or URL`)
  }

  // Identity links relate two REPOSITORIES; retraction targets a LINK. Typed endpoints
  // that don't match the type's meaning are a malformed claim, not a storable one.
  if (link.type === 'identity:same-repo' || link.type === 'identity:distinct-repos') {
    if (addressKind(link.from) !== 'repo' || addressKind(link.to) !== 'repo') {
      errs.push(`${link.type}: from and to must both be repo addresses (evidence:repo/<signal>)`)
    }
    if (repoSignalOf(link.from) !== null && repoSignalOf(link.from) === repoSignalOf(link.to)) {
      errs.push(`${link.type}: from and to name the same repository`)
    }
  }
  if (link.type === 'retracts' && addressKind(link.to) !== 'link') {
    errs.push('retracts: `to` must be a link address (evidence:link/<id>)')
  }
  if (errs.length) return { ok: false, verdict: 'invalid', errors: errs }

  const expectedId = computeLinkId(link)
  if (expectedId !== link.linkId) {
    return {
      ok: false,
      verdict: 'altered',
      errors: [`link id: stated ${link.linkId}, canonical content hashes to ${expectedId}`],
      link,
    }
  }

  return { ok: true, verdict: 'verified', errors: [], link }
}

/** Mint a link, computing its id. `ts`/`author`/`reason` are the caller's claim. */
export function makeLink(input: Omit<Link, 'format' | 'formatVersion' | 'linkId'>): Link {
  const body: Omit<Link, 'linkId'> = {
    format: LINK_FORMAT,
    formatVersion: LINK_FORMAT_VERSION,
    ...input,
  }
  return { ...body, linkId: computeLinkId(body) }
}

// ---------------------------------------------------------------------------
// Retraction and identity directives — the pure derivations resolution consumes.
// ---------------------------------------------------------------------------

/**
 * The active (non-retracted) subset of a link set.
 *
 * A link is retracted iff some `retracts` link targets its exact linkId (§2.3).
 * Monotone, one level, no fixpoint: `retracts` links are not themselves retractable,
 * and re-assertion is a NEW link (different ts/reason ⇒ different linkId) the old
 * retraction does not cover. A `retracts` whose target is absent is a tolerated no-op.
 * Deterministic: input order cannot change the output set.
 */
export function activeLinks(links: Link[]): { active: Link[]; retractedIds: Set<string> } {
  const retracted = new Set<string>()
  for (const l of links) {
    if (l.type !== 'retracts') continue
    const target = linkTargetOf(l.to)
    if (target) retracted.add(target)
  }
  const active = links.filter((l) => !retracted.has(l.linkId))
  return { active, retractedIds: retracted }
}

export interface IdentityDirective {
  kind: 'merge' | 'distinct'
  /** Repo signals, as stored in the link endpoints. Sorted so [a,b] is canonical. */
  a: string
  b: string
  /** The link this came from — for disclosure and attribution. */
  linkId: string
  author: string
}

/**
 * Derive identity directives from the ACTIVE link set, deterministically ordered.
 *
 * Only `identity:same-repo` / `identity:distinct-repos` produce directives; a link
 * whose endpoints are not both repo addresses is skipped (checkLink already refuses
 * those on add, so this is belt-and-suspenders for foreign objects arrived via git).
 */
export function deriveIdentityDirectives(links: Link[]): IdentityDirective[] {
  const { active } = activeLinks(links)
  const directives: IdentityDirective[] = []
  for (const l of active) {
    const kind = l.type === 'identity:same-repo' ? 'merge' : l.type === 'identity:distinct-repos' ? 'distinct' : null
    if (!kind) continue
    const a = repoSignalOf(l.from)
    const b = repoSignalOf(l.to)
    if (a === null || b === null) continue
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    directives.push({ kind, a: lo, b: hi, linkId: l.linkId, author: l.author })
  }
  return directives.sort(
    (x, y) =>
      x.kind.localeCompare(y.kind) ||
      x.a.localeCompare(y.a) ||
      x.b.localeCompare(y.b) ||
      x.linkId.localeCompare(y.linkId),
  )
}
