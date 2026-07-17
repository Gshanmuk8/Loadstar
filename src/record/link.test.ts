/**
 * The Link object — vectors, checking, retraction, directive derivation (M4).
 *
 * The `spec/link-vectors.json` cases were committed as the format's conformance suite:
 * the canonical link pins the exact `linkId` an independent implementation must
 * reproduce, and the reject cases pin verify-on-add. The behavioral tests below cover
 * what static vectors cannot express cleanly — retraction (whose targets reference
 * minted ids) and identity-directive derivation.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkLink,
  computeLinkId,
  makeLink,
  activeLinks,
  deriveIdentityDirectives,
  addressKind,
  repoAddress,
  repoSignalOf,
  linkTargetOf,
  type Link,
} from './link.js'

const VECTORS = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  'spec',
  'link-vectors.json',
)

const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as {
  canonical: { link: Omit<Link, 'linkId'>; expectedLinkId: string }
  reject: Array<{ name: string; value: unknown; expectVerdict: 'invalid' | 'altered' }>
}

// ===========================================================================
// Vectors — the conformance suite.
// ===========================================================================

describe('link vectors (conformance)', () => {
  it('reproduces the canonical linkId exactly', () => {
    expect(computeLinkId(vectors.canonical.link)).toBe(vectors.canonical.expectedLinkId)
  })

  it('the canonical link, sealed with its id, verifies', () => {
    const link = { ...vectors.canonical.link, linkId: vectors.canonical.expectedLinkId } as Link
    const check = checkLink(link)
    expect(check.ok, check.errors.join('; ')).toBe(true)
    expect(check.verdict).toBe('verified')
  })

  it('refuses every reject vector with the stated verdict', () => {
    expect(vectors.reject.length).toBeGreaterThan(0)
    for (const v of vectors.reject) {
      const check = checkLink(v.value)
      expect(check.ok, v.name).toBe(false)
      expect(check.verdict, v.name).toBe(v.expectVerdict)
    }
  })
})

// ===========================================================================
// makeLink + checkLink round-trip.
// ===========================================================================

describe('makeLink / checkLink', () => {
  const base = {
    author: 'alice',
    ts: '2026-07-20T00:00:00.000Z',
    reason: 'because',
  }

  it('mints a verifying link of each known-ish type', () => {
    const rel = makeLink({ ...base, type: 'relates-to', from: 'evidence:record/' + 'a'.repeat(64), to: 'https://tracker/1' })
    expect(checkLink(rel).ok).toBe(true)

    const same = makeLink({ ...base, type: 'identity:same-repo', from: repoAddress('github.com/a/b'), to: repoAddress('github.com/c/d') })
    expect(checkLink(same).ok).toBe(true)

    // An x-namespaced type is tolerated (F4).
    const ext = makeLink({ ...base, type: 'x-acme:owns', from: 'evidence:record/' + 'b'.repeat(64), to: 'https://x' })
    expect(checkLink(ext).ok).toBe(true)
  })

  it('any tampering of a sealed link flips it to altered', () => {
    const link = makeLink({ ...base, type: 'relates-to', from: 'evidence:record/' + 'a'.repeat(64), to: 'https://x' })
    const tampered = { ...link, reason: 'something else' }
    const check = checkLink(tampered)
    expect(check.ok).toBe(false)
    expect(check.verdict).toBe('altered')
  })

  it('refuses an identity link whose endpoints name the same repo', () => {
    const link = {
      format: 'lodestar-link',
      formatVersion: 1,
      linkId: '0'.repeat(64),
      author: 'a',
      ts: '2026-07-20T00:00:00.000Z',
      type: 'identity:same-repo',
      from: repoAddress('github.com/a/b'),
      to: repoAddress('github.com/a/b'),
      reason: '',
    }
    expect(checkLink(link).ok).toBe(false)
  })
})

// ===========================================================================
// Addresses.
// ===========================================================================

describe('addresses', () => {
  it('classifies each address form', () => {
    expect(addressKind('evidence:record/' + 'a'.repeat(64))).toBe('record')
    expect(addressKind('evidence:record/' + 'a'.repeat(64) + '#3')).toBe('record')
    expect(addressKind('evidence:link/' + 'b'.repeat(64))).toBe('link')
    expect(addressKind('evidence:repo/github.com/a/b')).toBe('repo')
    expect(addressKind('https://example.com/x')).toBe('external')
    expect(addressKind('')).toBe(null)
    // An evidence: address we cannot parse is not silently treated as external.
    expect(addressKind('evidence:bogus/xyz')).toBe(null)
  })

  it('extracts repo signals and link targets', () => {
    expect(repoSignalOf('evidence:repo/github.com/a/b')).toBe('github.com/a/b')
    expect(repoSignalOf('evidence:record/x')).toBe(null)
    expect(linkTargetOf('evidence:link/' + 'c'.repeat(64))).toBe('c'.repeat(64))
    expect(linkTargetOf('evidence:repo/x')).toBe(null)
  })
})

// ===========================================================================
// Retraction — one level, monotone, cycle-free.
// ===========================================================================

describe('retraction', () => {
  const mk = (over: Partial<Omit<Link, 'linkId'>>): Link =>
    makeLink({
      author: 'a',
      ts: '2026-07-20T00:00:00.000Z',
      type: 'relates-to',
      from: 'evidence:record/' + 'a'.repeat(64),
      to: 'https://x',
      reason: '',
      ...over,
    })

  it('a retracts link removes exactly its target from the active set', () => {
    const l1 = mk({ reason: 'one' })
    const l2 = mk({ reason: 'two' })
    const r = mk({ type: 'retracts', to: `evidence:link/${l1.linkId}` })
    const { active, retractedIds } = activeLinks([l1, l2, r])
    expect(retractedIds.has(l1.linkId)).toBe(true)
    expect(active.map((l) => l.linkId).sort()).toEqual([l2.linkId, r.linkId].sort())
  })

  it('retracting an absent link is a tolerated no-op', () => {
    const l1 = mk({ reason: 'one' })
    const r = mk({ type: 'retracts', to: `evidence:link/${'f'.repeat(64)}` })
    const { active } = activeLinks([l1, r])
    expect(active.map((l) => l.linkId).sort()).toEqual([l1.linkId, r.linkId].sort())
  })

  it('re-assertion (a new link) is not covered by the old retraction', () => {
    const l1 = mk({ reason: 'one', ts: '2026-07-20T00:00:00.000Z' })
    const r = mk({ type: 'retracts', to: `evidence:link/${l1.linkId}` })
    // Same claim, different ts ⇒ different linkId ⇒ active again.
    const l1b = mk({ reason: 'one', ts: '2026-07-21T00:00:00.000Z' })
    const { active, retractedIds } = activeLinks([l1, r, l1b])
    expect(retractedIds.has(l1.linkId)).toBe(true)
    expect(active.some((l) => l.linkId === l1b.linkId)).toBe(true)
  })

  it('is order-independent', () => {
    const l1 = mk({ reason: 'one' })
    const r = mk({ type: 'retracts', to: `evidence:link/${l1.linkId}` })
    const forward = activeLinks([l1, r]).retractedIds
    const backward = activeLinks([r, l1]).retractedIds
    expect([...backward].sort()).toEqual([...forward].sort())
  })
})

// ===========================================================================
// Identity directives.
// ===========================================================================

describe('deriveIdentityDirectives', () => {
  const mk = (over: Partial<Omit<Link, 'linkId'>>): Link =>
    makeLink({
      author: 'a',
      ts: '2026-07-20T00:00:00.000Z',
      type: 'identity:same-repo',
      from: repoAddress('github.com/a/b'),
      to: repoAddress('github.com/c/d'),
      reason: '',
      ...over,
    })

  it('derives merge/distinct directives, sorted, canonicalized [a,b]', () => {
    const same = mk({})
    const distinct = mk({ type: 'identity:distinct-repos', from: repoAddress('z'), to: repoAddress('a') })
    const dirs = deriveIdentityDirectives([same, distinct])
    expect(dirs).toHaveLength(2)
    const merge = dirs.find((d) => d.kind === 'merge')!
    expect([merge.a, merge.b]).toEqual(['github.com/a/b', 'github.com/c/d'])
    const dist = dirs.find((d) => d.kind === 'distinct')!
    // Endpoints sorted so [a,b] is canonical regardless of link direction.
    expect([dist.a, dist.b]).toEqual(['a', 'z'])
  })

  it('ignores non-identity link types', () => {
    const rel = makeLink({ author: 'a', ts: '2026-07-20T00:00:00.000Z', type: 'relates-to', from: 'evidence:record/' + 'a'.repeat(64), to: 'https://x', reason: '' })
    expect(deriveIdentityDirectives([rel])).toEqual([])
  })

  it('a retracted identity link produces no directive', () => {
    const same = mk({})
    const r = makeLink({ author: 'a', ts: '2026-07-20T00:00:00.000Z', type: 'retracts', from: repoAddress('x'), to: `evidence:link/${same.linkId}`, reason: '' })
    expect(deriveIdentityDirectives([same, r])).toEqual([])
  })
})
