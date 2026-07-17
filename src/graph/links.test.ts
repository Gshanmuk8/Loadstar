/**
 * The declared layer, end to end (M4).
 *
 * Three claims under attack:
 *   1. A declared `identity:same-repo` link merges what the automatic rules kept apart
 *      (the rename, I-5), and `distinct-repos` answers a fork candidate (I-6) — while
 *      the automatic rules themselves never merge (F2).
 *   2. A link is a CLAIM and can never reach a fact (P5): adding non-identity links
 *      leaves the fact view byte-identical; an identity link re-groups repos but
 *      changes no fact's id, statement, or citation.
 *   3. Links share the store discipline: verify-on-add, dedupe, misfile detection,
 *      verify-on-pull, and rebuild determinism — exactly as records do.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEvidence, resolveIdentities } from './identity.js'
import { deriveIdentityDirectives, makeLink, repoAddress, serializeLink, type Link } from '../record/link.js'
import { corpusRecords, seedCorpusGraph } from './corpus-fixture.js'
import {
  addLinkValue,
  addRecordValue,
  initGraph,
  openGraph,
  verifyGraph,
  readLinks,
  type Graph,
} from './store.js'
import { configureShare, syncGraph } from './sync.js'
import { queryRepos, queryLinks, queryDivergences, reportJson, reindex } from './graph-index.js'

let dir: string
let graph: Graph
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-links-'))
  graph = seedCorpusGraph(join(dir, '.lodestar-graph'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

const sameRepoLink = (a: string, b: string, author = 'alice'): Link =>
  makeLink({
    author,
    ts: '2026-07-20T00:00:00.000Z',
    type: 'identity:same-repo',
    from: repoAddress(a),
    to: repoAddress(b),
    reason: 'rename',
  })

// ===========================================================================
// 1. Resolution — declared merges and distinctness, purely.
// ===========================================================================

describe('declared identity resolution (pure)', () => {
  // A fork/rename shape: two origins sharing a root — the automatic rules split it
  // and emit a lineage candidate (F2). Exactly the I-5 shape.
  const forkSplit = () => [
    buildEvidence({ recordId: 'r-a', sessionId: 's-a', cwd: '/a', gitRemotes: [{ name: 'origin', url: 'https://github.com/acme/infra' }], gitRootCommits: ['root0000000000000000000000000000000000aa'] }),
    buildEvidence({ recordId: 'r-b', sessionId: 's-b', cwd: '/b', gitRemotes: [{ name: 'origin', url: 'https://github.com/acme/platform' }], gitRootCommits: ['root0000000000000000000000000000000000aa'] }),
  ]

  it('automatic rules never merge — the split stands without a link (F2)', () => {
    const res = resolveIdentities(forkSplit(), [])
    expect(res.groups).toHaveLength(2)
    expect(res.candidates.some((c) => c.kind === 'lineage')).toBe(true)
    expect(res.appliedMerges).toEqual([])
  })

  it('a same-repo link merges the two groups and clears the open candidate', () => {
    const link = sameRepoLink('github.com/acme/infra', 'github.com/acme/platform')
    const directives = deriveIdentityDirectives([link])
    const res = resolveIdentities(forkSplit(), directives)

    expect(res.groups).toHaveLength(1)
    expect(res.groups[0]!.declared).toBe(true)
    expect(res.groups[0]!.origins).toEqual(['github.com/acme/infra', 'github.com/acme/platform'])
    expect(res.appliedMerges).toHaveLength(1)
    // No OPEN lineage candidate remains (they are one group now).
    expect(res.candidates.filter((c) => !c.declared)).toEqual([])
  })

  it('a distinct link suppresses the candidate but never splits the groups', () => {
    const link = makeLink({
      author: 'carol',
      ts: '2026-07-20T00:00:00.000Z',
      type: 'identity:distinct-repos',
      from: repoAddress('github.com/acme/infra'),
      to: repoAddress('github.com/acme/platform'),
      reason: 'genuine fork',
    })
    const res = resolveIdentities(forkSplit(), deriveIdentityDirectives([link]))
    expect(res.groups).toHaveLength(2) // still apart
    const cand = res.candidates.find((c) => c.kind === 'lineage')!
    expect(cand.declared).toBe('distinct')
    expect(cand.declaredBy).toBe('carol')
  })

  it('a merge naming a signal that matches nothing is disclosed, not obeyed', () => {
    const link = sameRepoLink('github.com/acme/infra', 'github.com/nobody/ghost')
    const res = resolveIdentities(forkSplit(), deriveIdentityDirectives([link]))
    expect(res.groups).toHaveLength(2)
    expect(res.appliedMerges).toEqual([])
    expect(res.unresolved).toHaveLength(1)
    expect(res.unresolved[0]!.reason).toBe('unresolvable')
  })

  it('a merge of two already-one signals is redundant, disclosed', () => {
    // Both signals name the same origin group.
    const ev = [
      buildEvidence({ recordId: 'r-a', sessionId: 's-a', cwd: '/a', gitRemotes: [{ name: 'origin', url: 'https://github.com/acme/x' }], gitRootCommits: ['root0000000000000000000000000000000000aa'] }),
    ]
    const link = sameRepoLink('github.com/acme/x', 'root:root0000000') // both resolve to the one group
    const res = resolveIdentities(ev, deriveIdentityDirectives([link]))
    expect(res.groups).toHaveLength(1)
    expect(res.unresolved[0]?.reason).toBe('redundant')
  })

  it('is order-independent under directives too', () => {
    const links = [
      sameRepoLink('github.com/acme/infra', 'github.com/acme/platform'),
    ]
    const dirs = deriveIdentityDirectives(links)
    const forward = JSON.stringify(resolveIdentities(forkSplit(), dirs))
    const rev = forkSplit().reverse()
    const backward = JSON.stringify(resolveIdentities(rev, dirs))
    expect(backward).toBe(forward)
  })
})

// ===========================================================================
// 2. The P5 gate — a link never reaches a fact.
// ===========================================================================

describe('P5 — a link can never reach a fact', () => {
  it('non-identity links leave the fact view byte-identical', () => {
    const before = reportJson(queryDivergences(graph))
    const rec = corpusRecords()[0]!
    addLinkValue(graph, makeLink({ author: 'a', ts: '2026-07-20T00:00:00.000Z', type: 'relates-to', from: `evidence:record/${rec.recordId}`, to: 'https://tracker/42', reason: 'ticket' }), 'x')
    addLinkValue(graph, makeLink({ author: 'a', ts: '2026-07-20T00:00:00.000Z', type: 'incident', from: `evidence:record/${rec.recordId}`, to: 'https://incident/7', reason: 'the July 10 incident' }), 'x')
    const after = reportJson(queryDivergences(graph))
    expect(after).toBe(before)
  })

  it('an identity merge re-groups repos but changes no fact statement or citation', () => {
    const factsOf = (): string[] =>
      queryDivergences(graph).divergences.map((d) => `${d.factId}|${d.statement}|${d.citations.join(',')}`).sort()
    const before = factsOf()

    addLinkValue(graph, sameRepoLink('github.com/acme/infra', 'github.com/acme/platform'), 'x')

    // Repos DID change (the two groups merged) — proving the link took effect...
    const repos = queryRepos(graph)
    expect(repos.groups.some((g) => g.declared)).toBe(true)
    // ...but every fact's id, statement, and citations are exactly as before.
    expect(factsOf()).toEqual(before)
  })
})

// ===========================================================================
// 3. Store discipline for links.
// ===========================================================================

describe('link store discipline', () => {
  it('adds, dedupes, and verifies a link', () => {
    const link = sameRepoLink('github.com/acme/infra', 'github.com/acme/platform')
    expect(addLinkValue(graph, link, 'x').status).toBe('added')
    expect(addLinkValue(graph, link, 'x').status).toBe('duplicate')

    const v = verifyGraph(graph)
    expect(v.storeIntact).toBe(true)
    expect(v.linkCount).toBe(1)
    expect(readLinks(graph).links).toHaveLength(1)
  })

  it('refuses a record placed as a link and a link placed as a record', () => {
    const rec = corpusRecords()[0]!
    // A record value is not a link.
    expect(addLinkValue(graph, rec, 'x').status).toBe('refused')
    // A link value is not a record.
    const link = sameRepoLink('a', 'b')
    expect(addRecordValue(graph, link as unknown, 'x').status).toBe('refused')
  })

  it('detects a misfiled link (content ≠ filename)', () => {
    const link = sameRepoLink('github.com/acme/infra', 'github.com/acme/platform')
    addLinkValue(graph, link, 'x')
    // Corrupt the stored bytes in place (a tamper after storage).
    const shard = join(graph.linksDir, link.linkId.slice(0, 2))
    const file = readdirSync(shard).find((f) => f.endsWith('.link.json'))!
    writeFileSync(join(shard, file), serializeLink({ ...link, reason: 'tampered' }), 'utf8')
    const v = verifyGraph(graph)
    expect(v.storeIntact).toBe(false)
    expect(v.links.some((o) => !o.ok)).toBe(true)
  })

  it('flags a dangling endpoint without failing the store', () => {
    const link = makeLink({ author: 'a', ts: '2026-07-20T00:00:00.000Z', type: 'relates-to', from: `evidence:record/${'a'.repeat(64)}`, to: 'https://x', reason: '' })
    addLinkValue(graph, link, 'x')
    const v = verifyGraph(graph)
    expect(v.storeIntact).toBe(true) // dangling is non-fatal
    expect(v.danglingLinks).toBe(1)
    expect(queryLinks(graph).links.find((l) => l.linkId === link.linkId)!.dangling).toBe(true)
  })
})

// ===========================================================================
// 4. Sync + determinism.
// ===========================================================================

describe('links sync and rebuild determinism', () => {
  it('sync propagates links over a path share; a hostile link is refused on pull', () => {
    const share = join(dir, 'team-share')
    const a = initGraph(join(dir, 'a', '.lodestar-graph'))
    addRecordValue(a, corpusRecords()[0]!, 'r0')
    addLinkValue(a, sameRepoLink('github.com/acme/infra', 'github.com/acme/platform'), 'l0')
    configureShare(a, share, { create: true })
    syncGraph(a, { cwd: join(dir, 'a') })

    // The share now holds the link. A fresh consumer pulls it, verified.
    const remote = openGraph(share)
    expect(readLinks(remote).links).toHaveLength(1)

    // Plant a hostile (tampered) link in the share, then a consumer syncs.
    const good = readLinks(remote).links[0]!
    const shard = join(remote.linksDir, good.linkId.slice(0, 2))
    // Same filename, tampered bytes — linkId no longer matches content.
    const file = readdirSync(shard).find((f) => f.endsWith('.link.json'))!
    writeFileSync(join(shard, file), serializeLink({ ...good, reason: 'forged' }), 'utf8')

    const c = initGraph(join(dir, 'c', '.lodestar-graph'))
    configureShare(c, share)
    const report = syncGraph(c, { cwd: join(dir, 'c') })
    expect(report.refusedFromRemote.some((r) => r.errors?.some((e) => /link id/.test(e)))).toBe(true)
    // c's store stays intact — the forgery never entered it.
    expect(verifyGraph(c).storeIntact).toBe(true)
  })

  it('two rebuilds answer repos + links byte-identically, with links present', () => {
    addLinkValue(graph, sameRepoLink('github.com/acme/infra', 'github.com/acme/platform'), 'l0')
    addLinkValue(graph, makeLink({ author: 'a', ts: '2026-07-20T00:00:00.000Z', type: 'relates-to', from: `evidence:record/${corpusRecords()[0]!.recordId}`, to: 'https://x', reason: '' }), 'l1')
    const snap = (): string[] => [reportJson(queryRepos(graph)), reportJson(queryLinks(graph))]
    reindex(graph)
    const first = snap()
    rmSync(graph.indexDb, { force: true })
    reindex(graph)
    expect(snap()).toEqual(first)
  })
})

// ===========================================================================
// 5. The investigation this milestone earns — I-12.
// ===========================================================================

describe('I-12 · "we confirmed the rename — do infra and platform read as one repo now?"', () => {
  it('the declared link merges them, attributed, and repos shows one group', () => {
    // Before: two groups, one open lineage candidate (this is I-5).
    const before = queryRepos(graph)
    expect(before.groups.filter((g) => g.displayName.startsWith('github.com/acme/')).map((g) => g.displayName))
      .toEqual(expect.arrayContaining(['github.com/acme/infra', 'github.com/acme/platform']))

    // The human records the answer.
    addLinkValue(graph, sameRepoLink('github.com/acme/infra', 'github.com/acme/platform', 'alice'), 'l0')

    // After: platform folds into infra; the merge is attributed and cited.
    const after = queryRepos(graph)
    expect(after.groups.some((g) => g.displayName === 'github.com/acme/platform')).toBe(false)
    const merged = after.groups.find((g) => g.displayName === 'github.com/acme/infra')!
    expect(merged.declared).toBe(true)
    expect(after.appliedMerges).toHaveLength(1)
    expect(after.appliedMerges[0]!.author).toBe('alice')
    expect(after.appliedMerges[0]!.cite).toMatch(/^evidence:link\/[0-9a-f]{64}$/)

    // query links shows it as an active, non-retracted, non-dangling claim.
    const links = queryLinks(graph)
    expect(links.links).toHaveLength(1)
    expect(links.links[0]!.retracted).toBe(false)
    expect(links.links[0]!.type).toBe('identity:same-repo')

    // And the store still verifies.
    expect(verifyGraph(graph).storeIntact).toBe(true)
  })
})
