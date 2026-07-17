/**
 * The investigations — M3's reason to exist.
 *
 * Each test is a question an engineering team would actually ask, answered ONLY
 * through the public queries, asserting the answer AND that its citations resolve
 * to verified records. These are the validation this milestone can honestly claim:
 * the graph answers real question *shapes* over a realistic corpus. What they
 * cannot claim — that real developers will share evidence unprompted — is scored
 * separately in M3's stop-report.
 *
 * The rule these tests enforced during development (D-068): a question the queries
 * could not answer was the ONLY license to add a query. `timeline` and `coverage`
 * exist because I-4 and I-7 failed without them; everything else on the candidate
 * list (repository evolution, integrity history, per-query agent filters) was
 * answerable by composition and was therefore not built.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { LODESTAR_VERSION } from '../core/version.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRecord } from '../record/check.js'
import { corpusRecords, seedCorpusGraph } from './corpus-fixture.js'
import { readRecord, type Graph } from './store.js'
import {
  queryCoverage,
  queryDivergences,
  queryFileHistory,
  queryRepoHistory,
  queryRepos,
  queryTimeline,
  reindex,
  reportJson,
} from './graph-index.js'

let dir: string
let graph: Graph

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-inv-'))
  graph = seedCorpusGraph(join(dir, '.lodestar-graph'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

/** A citation is only worth its resolution: fetch the record and re-verify it. */
function assertResolves(graphRef: Graph, citation: string): void {
  const id = /^evidence:record\/([0-9a-f]{64})/.exec(citation)?.[1]
  expect(id, `citation shape: ${citation}`).toBeTruthy()
  const record = readRecord(graphRef, id!)
  expect(record, `citation resolves: ${citation}`).toBeTruthy()
  expect(checkRecord(record!).ok, `cited record verifies: ${citation}`).toBe(true)
}

describe('the corpus itself', () => {
  it('is deterministic: two builds produce identical record ids', () => {
    const a = corpusRecords().map((r) => r.recordId)
    const b = corpusRecords().map((r) => r.recordId)
    expect(b).toEqual(a)
  })
})

describe('investigations', () => {
  it('I-1 · "what touched charge.mjs around the July 10 incident, and when?"', () => {
    const report = queryFileHistory(graph, 'github.com/acme/payments', 'src/charge.mjs')
    const incidentDay = report.changes.filter((c) => c.occurredAt.startsWith('2026-07-10'))
    // Bob's two writes (14:20, 14:41) and Carol's hotfix write (19:15).
    expect(incidentDay).toHaveLength(3)
    const lateEdit = incidentDay.find((c) => c.occurredAt.startsWith('2026-07-10T14:41'))
    expect(lateEdit, 'the post-test edit is in the history').toBeTruthy()
    expect(lateEdit!.agent).toBe('codex')
    expect(lateEdit!.machine).toBe('m-bob')
    assertResolves(graph, lateEdit!.cite)
  })

  it('I-2 · "was that change test-observed?" — RF-04 names the incident, with citations', () => {
    const report = queryDivergences(graph, 'github.com/acme/payments', 'RF-04')
    const incident = report.divergences.filter((d) => d.ts.startsWith('2026-07-10'))
    expect(incident.length).toBeGreaterThanOrEqual(1)
    expect(incident[0]!.statement).toMatch(/charge\.mjs modified after the last test run/)
    expect(incident[0]!.agent).toBe('codex')
    for (const c of incident[0]!.citations) assertResolves(graph, c)
  })

  it('I-3 · "who else has been in that file recently?" — contention across three developers', () => {
    const report = queryFileHistory(graph, 'github.com/acme/payments', 'src/charge.mjs')
    const week2 = report.changes.filter(
      (c) => c.occurredAt >= '2026-07-06' && c.occurredAt < '2026-07-11',
    )
    const machines = new Set(week2.map((c) => c.machine))
    expect(machines).toEqual(new Set(['m-alice', 'm-bob', 'm-carol']))
    const agents = new Set(week2.map((c) => c.agent))
    expect(agents).toEqual(new Set(['claude-code', 'codex']))
  })

  it('I-4 · "what happened on Alice’s machine this week, across every repo?" — timeline', () => {
    const report = queryTimeline(graph, { machine: 'm-alice', since: '2026-07-13' })
    const repos = new Set(report.sessions.map((s) => s.repo))
    // Cross-repository interleaving in one answer — the question no per-repo query
    // could compose, and the reason `timeline` exists (D-068).
    expect(repos.has('github.com/acme/platform')).toBe(true)
    expect(repos.has('github.com/acme/payments')).toBe(true)
    for (const s of report.sessions) {
      expect(s.machine).toBe('m-alice')
      assertResolves(graph, s.cite)
    }
    // The failing make-test session is visible with its fact, not summarized away.
    const failing = report.sessions.find((s) => s.factIds.includes('RF-01'))
    expect(failing?.repo).toBe('github.com/acme/platform')
  })

  it('I-5 · "why do infra and platform look like two repos?" — the rename, honestly split', () => {
    const repos = queryRepos(graph)
    const names = repos.groups.map((g) => g.displayName)
    expect(names).toContain('github.com/acme/infra')
    expect(names).toContain('github.com/acme/platform')
    const lineage = repos.candidates.find(
      (c) =>
        c.kind === 'lineage' &&
        c.between.includes('github.com/acme/infra') &&
        c.between.includes('github.com/acme/platform'),
    )
    expect(lineage, 'rename surfaces as a lineage candidate, one link from merged').toBeTruthy()
  })

  it('I-6 · "is the contractor working on our web repo or a fork?" — fork split + lineage', () => {
    const repos = queryRepos(graph)
    expect(repos.groups.map((g) => g.displayName)).toContain('github.com/contractor/web')
    const lineage = repos.candidates.find(
      (c) => c.kind === 'lineage' && c.between.includes('github.com/contractor/web'),
    )
    expect(lineage).toBeTruthy()
    const fork = queryRepoHistory(graph, 'github.com/contractor/web')
    expect(fork.sessions.every((s) => s.agent === 'aider')).toBe(true)
  })

  it('I-7 · "which machines are we even seeing, and since when?" — coverage, no judgments', () => {
    const report = queryCoverage(graph)
    const carol = report.machines.find((m) => m.machineId === 'm-carol')!
    // Carol goes quiet after the July 10 hotfix. The graph states last-seen and
    // stops — "too quiet" needs an expected cadence nobody declared.
    expect(carol.lastSeen.startsWith('2026-07-10')).toBe(true)
    const alice = report.machines.find((m) => m.machineId === 'm-alice')!
    expect(alice.lastSeen.startsWith('2026-07-16')).toBe(true)
    expect(JSON.stringify(report)).not.toMatch(/stale|silent|inactive/i)
  })

  it('I-8 · "anything unfinished out there?" — the open session is DEGRADED, visibly', () => {
    const report = queryTimeline(graph, { agent: 'aider' })
    const open = report.sessions.find((s) => s.endedAt === null)
    expect(open).toBeTruthy()
    expect(open!.integrityStatus).toBe('DEGRADED')
    expect(queryCoverage(graph).degradedSessions).toBeGreaterThanOrEqual(1)
  })

  it('I-9 · "this session was re-analyzed — do we see both?" — reanalyses disclosed', () => {
    const report = queryRepoHistory(graph, 'github.com/acme/payments')
    const incident = report.sessions.find((s) => s.startedAt === '2026-07-10T14:00:00.000Z')!
    expect(incident.reanalyses).toBe(1)
    // Election is lexicographic (D-066): 'lodestar' > 'aider-emit', so the full
    // catalog stays primary here and the incident's RF-04 remains visible (I-2).
    // Asserted via the live version constant — the corpus is built by the real
    // buildRecord, so a frozen literal here would rot on every release.
    expect(incident.generator).toBe(`lodestar ${LODESTAR_VERSION}`)
  })

  it('I-10 · "a vendor-emitted session says nothing about RF-04 — clean?" — no: disclosed', () => {
    const report = queryDivergences(graph, undefined, 'RF-04')
    // nova-emit won the election for dana’s first session and never evaluates RF-04:
    // its silence is named, not absorbed into an all-clear.
    expect(report.rfNotEvaluated).toBeTruthy()
    expect(report.rfNotEvaluated!.sessions).toBeGreaterThanOrEqual(1)
    expect(report.catalogs['nova-emit 1.0']).toEqual(['RF-01'])
  })

  it('I-11 · "what killed dana’s tests?" — the SIGKILL is a cited fact, not a story', () => {
    const report = queryDivergences(graph, 'github.com/contractor/web', 'RF-06')
    expect(report.divergences.length).toBeGreaterThanOrEqual(1)
    expect(report.divergences[0]!.statement).toMatch(/terminated by SIGKILL/)
    for (const c of report.divergences[0]!.citations) assertResolves(graph, c)
  })
})

describe('corpus-scale determinism', () => {
  it('reindex twice → byte-identical answers across all six queries', () => {
    const snap = (): string[] => [
      reportJson(queryRepos(graph)),
      reportJson(queryRepoHistory(graph, 'github.com/acme/payments')),
      reportJson(queryFileHistory(graph, 'github.com/acme/payments', 'src/charge.mjs')),
      reportJson(queryDivergences(graph)),
      reportJson(queryTimeline(graph, {})),
      reportJson(queryCoverage(graph)),
    ]
    reindex(graph)
    const first = snap()
    rmSync(graph.indexDb, { force: true })
    reindex(graph)
    expect(snap()).toEqual(first)
  })
})
