/**
 * The three M2 queries, the self-healing index, and the store hardening — attacked.
 *
 * Claims under test:
 *   1. file-history joins one file ACROSS machines and path styles (the repo-relative
 *      rule, D-066 §2.4) and never double-counts re-analyzed sessions.
 *   2. divergences carries citations, generator provenance, and catalog conditioning
 *      — a foreign generator's silence is disclosed, never read as absence.
 *   3. The index self-heals: missing, corrupted, schema-changed, or bypassed-by-
 *      out-of-band-sync, every query answers from the store's present truth (E1 fix).
 *   4. Rebuild determinism holds for ALL queries, byte for byte.
 *   5. The store refuses oversized inputs and explains broken-session refusals
 *      (D-065) instead of refusing silently.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { buildRecord, computeRecordId } from '../record/build.js'
import { LODESTAR_VERSION } from '../core/version.js'
import { vectorDrafts } from '../record/vector-fixture.js'
import type { EvidenceRecord } from '../record/types.js'
import type { DraftEvent } from '../types/events.js'
import {
  addRecordFile,
  addRecordValue,
  initGraph,
  listRecordFiles,
  MAX_RECORD_BYTES,
  verifyGraph,
  type Graph,
} from './store.js'
import {
  indexFreshness,
  queryDivergences,
  queryFileHistory,
  queryRepoHistory,
  queryRepos,
  reindex,
  reportJson,
} from './graph-index.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-q-'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

interface FixtureOpts {
  cwd?: string
  machineId?: string
  remotes?: Array<{ name: string; url: string }>
  roots?: string[]
  generator?: { name: string; version: string }
  catalog?: string[]
}

/**
 * A fully valid record over the golden session's events, re-keyed and re-homed:
 * the working directory (and therefore every file path) is rewritten to `cwd`, so
 * tests can model the same repo cloned on different machines at different paths.
 */
function makeRecord(key: string, opts: FixtureOpts = {}): EvidenceRecord {
  const cwd = opts.cwd ?? '/vector/project'
  const cwdFragment = JSON.stringify(cwd).slice(1, -1)
  const db = openDatabase(':memory:')
  try {
    const store = new SqliteEventStore(db)
    const sessionId = `q-${key}`
    db.prepare(
      `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, 1, 'vector-runtime', null, '2026-01-02T03:04:00.000Z', '2026-01-02T03:05:00.000Z', 0, cwd)

    for (const draft of vectorDrafts()) {
      const rehomed = JSON.parse(
        JSON.stringify(draft).split('/vector/project').join(cwdFragment),
      ) as DraftEvent
      rehomed.id = `${key}-${draft.id}`
      rehomed.sessionId = sessionId
      if (draft.kind === 'session.start') {
        rehomed.payload = {
          ...(rehomed.payload as Record<string, unknown>),
          cwd,
          machineId: opts.machineId ?? 'vector-machine-0001',
          ...(opts.remotes ? { gitRemotes: opts.remotes } : {}),
          ...(opts.roots ? { gitRootCommits: opts.roots } : {}),
        }
      }
      store.append(rehomed)
    }
    const record = buildRecord(store, sessionId)
    if (!record) throw new Error('fixture did not build')
    if (opts.generator || opts.catalog) {
      const modified = structuredClone(record)
      if (opts.generator) modified.generator = opts.generator
      if (opts.catalog) modified.evidence.catalog = opts.catalog as EvidenceRecord['evidence']['catalog']
      modified.recordId = computeRecordId(modified)
      return modified
    }
    return record
  } finally {
    db.close()
  }
}

const ACME = [{ name: 'origin', url: 'https://github.com/acme/payments' }]

function seeded(): Graph {
  const graph = initGraph(join(dir, '.lodestar-graph'))
  // One repo, two machines, two path styles — including a Windows drive path.
  addRecordValue(graph, makeRecord('m1', { cwd: '/home/a/payments', machineId: 'm1', remotes: ACME }), 't')
  addRecordValue(graph, makeRecord('m2', { cwd: 'C:\\work\\payments', machineId: 'm2', remotes: ACME }), 't')
  return graph
}

describe('file-history', () => {
  it('joins one file across machines and path styles on the repo-relative path', () => {
    const graph = seeded()
    const report = queryFileHistory(graph, 'github.com/acme/payments', 'src/payments.mjs')

    // The golden session writes payments.mjs twice (events 8 and 10); two sessions → four.
    expect(report.changes).toHaveLength(4)
    expect(new Set(report.changes.map((c) => c.machine))).toEqual(new Set(['m1', 'm2']))
    // Occurrence time is mtime where recorded (D-044), and says so.
    expect(report.changes.every((c) => c.occurredSource === 'mtime')).toBe(true)
    // Sorted by occurrence, and every row cites into a record.
    const times = report.changes.map((c) => c.occurredAt)
    expect([...times].sort()).toEqual(times)
    expect(report.changes.every((c) => /^evidence:record\/[0-9a-f]{64}#\d+$/.test(c.cite))).toBe(true)
  })

  it('accepts the raw remote URL as the repo argument (names are signals)', () => {
    const graph = seeded()
    const viaRaw = queryFileHistory(graph, 'git@github.com:acme/payments.git', 'src/payments.mjs')
    expect(viaRaw.changes).toHaveLength(4)
  })

  it('an unknown path is an honest empty answer, not an error', () => {
    const graph = seeded()
    const report = queryFileHistory(graph, 'github.com/acme/payments', 'src/nope.mjs')
    expect(report.changes).toEqual([])
    expect(report.coverage.note).toMatch(/absence of records/)
  })

  it('never double-counts a re-analyzed session', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const base = makeRecord('a', { remotes: ACME })
    const re = structuredClone(base)
    re.generator = { name: 'zz-later-engine', version: '2.0' }
    re.recordId = computeRecordId(re)
    addRecordValue(graph, base, 't')
    addRecordValue(graph, re, 't')

    const report = queryFileHistory(graph, 'github.com/acme/payments', 'src/payments.mjs')
    expect(report.changes).toHaveLength(2) // one session's writes, once
    const history = queryRepoHistory(graph, 'github.com/acme/payments')
    expect(history.sessions).toHaveLength(1)
    expect(history.sessions[0]!.reanalyses).toBe(1)
    expect(history.sessions[0]!.generator).toBe('zz-later-engine 2.0')
  })
})

describe('repo-history', () => {
  it('lists sessions with integrity, counts, provenance, and citations', () => {
    const graph = seeded()
    const report = queryRepoHistory(graph, 'github.com/acme/payments')
    expect(report.sessions).toHaveLength(2)
    for (const s of report.sessions) {
      expect(s.integrityStatus).toBe('DEGRADED') // the golden session's honest status
      expect(s.facts).toBe(7)
      expect(/^evidence:record\/[0-9a-f]{64}$/.test(s.cite)).toBe(true)
    }
    expect(report.coverage.clockNote).toMatch(/stated/)
  })

  it('repo arguments resolve by signal strength: origin owns its URL; same-strength ties refuse', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const ROOT = 'aaaa000000000000000000000000000000000001'
    // A fork carrying acme as `upstream`, plus the real acme repo — sharing a root.
    addRecordValue(graph, makeRecord('a', { cwd: '/a', remotes: ACME, roots: [ROOT] }), 't')
    addRecordValue(
      graph,
      makeRecord('b', {
        cwd: '/b',
        roots: [ROOT],
        remotes: [
          { name: 'origin', url: 'https://github.com/bob/payments' },
          { name: 'upstream', url: 'https://github.com/acme/payments' },
        ],
      }),
      't',
    )
    // The common case must not break: the ORIGIN owner of the URL wins outright,
    // even though the fork also carries that URL as a non-origin remote.
    expect(queryRepoHistory(graph, 'github.com/acme/payments').repo.displayName).toBe(
      'github.com/acme/payments',
    )
    // A genuinely tied signal — the root both groups share — refuses with both names.
    expect(() => queryRepoHistory(graph, ROOT)).toThrow(/matches 2 repository groups/)
    // Unknown repo: honest refusal with a pointer.
    expect(() => queryRepoHistory(graph, 'github.com/nobody/nothing')).toThrow(/no repository matches/)
  })
})

describe('divergences', () => {
  it('is a cited, provenance-labelled fact timeline with catalog disclosure', () => {
    const graph = seeded()
    // A third session analyzed by a foreign generator that only evaluates RF-01.
    addRecordValue(
      graph,
      makeRecord('f', {
        cwd: '/f/payments',
        machineId: 'm3',
        remotes: ACME,
        generator: { name: 'aider-emit', version: '0.1' },
        catalog: ['RF-01'],
      }),
      't',
    )

    const all = queryDivergences(graph, 'github.com/acme/payments')
    expect(all.divergences.length).toBeGreaterThan(0)
    expect(all.divergences.every((d) => d.citations.length > 0)).toBe(true)
    const ts = all.divergences.map((d) => d.ts)
    expect([...ts].sort()).toEqual(ts)
    // The corpus's lodestar records are built by the REAL buildRecord, so their
    // generator string follows the live version — asserted via the constant, not a
    // frozen literal that rots on every release.
    expect(Object.keys(all.catalogs).sort()).toEqual(['aider-emit 0.1', `lodestar ${LODESTAR_VERSION}`])

    // --rf filter over a fact the foreign generator never evaluates → disclosure.
    const rf04 = queryDivergences(graph, 'github.com/acme/payments', 'RF-04')
    expect(rf04.divergences.every((d) => d.factId === 'RF-04')).toBe(true)
    expect(rf04.rfNotEvaluated).toBeTruthy()
    expect(rf04.rfNotEvaluated!.sessions).toBe(1)
    expect(rf04.rfNotEvaluated!.note).toMatch(/silence is not absence/)
  })
})

describe('self-healing index (the E1 fix)', () => {
  it('answers with no index at all — first query builds it', () => {
    const graph = seeded()
    expect(indexFreshness(graph).fresh).toBe(false)
    const report = queryRepos(graph)
    expect(report.coverage.records).toBe(2)
    expect(indexFreshness(graph).fresh).toBe(true)
  })

  it('heals after an out-of-band add (the git-pull scenario)', () => {
    const graphA = initGraph(join(dir, 'a', '.lodestar-graph'))
    const graphB = initGraph(join(dir, 'b', '.lodestar-graph'))
    const r1 = makeRecord('m1', { cwd: '/home/a/payments', remotes: ACME })
    const r2 = makeRecord('m2', { cwd: '/home/b/payments', remotes: ACME })
    addRecordValue(graphA, r1, 't')
    expect(queryRepos(graphA).coverage.records).toBe(1)

    // Simulate `git pull`: a record file appears without `add` ever running.
    addRecordValue(graphB, r2, 't')
    const [fileB] = listRecordFiles(graphB)
    const targetDir = join(graphA.recordsDir, r2.recordId.slice(0, 2))
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(fileB!, join(targetDir, `${r2.recordId}.record.json`))

    const f = indexFreshness(graphA)
    expect(f.fresh).toBe(false)
    expect(f.reason).toMatch(/out of band/)
    // The next query must answer from the pulled truth — no stale confident answer.
    expect(queryRepos(graphA).coverage.records).toBe(2)
  })

  it('heals a corrupted index file', () => {
    const graph = seeded()
    reindex(graph)
    writeFileSync(graph.indexDb, 'this is not a database', 'utf8')
    expect(queryRepos(graph).coverage.records).toBe(2)
  })

  it('heals a deleted index mid-life', () => {
    const graph = seeded()
    queryRepos(graph)
    rmSync(graph.indexDb, { force: true })
    expect(queryFileHistory(graph, 'github.com/acme/payments', 'src/payments.mjs').changes).toHaveLength(4)
  })
})

describe('rebuild determinism across every query', () => {
  it('reindex twice → byte-identical answers for all four queries', () => {
    const graph = seeded()
    const snap = (): string[] => [
      reportJson(queryRepos(graph)),
      reportJson(queryRepoHistory(graph, 'github.com/acme/payments')),
      reportJson(queryFileHistory(graph, 'github.com/acme/payments', 'src/payments.mjs')),
      reportJson(queryDivergences(graph)),
    ]
    reindex(graph)
    const first = snap()
    rmSync(graph.indexDb, { force: true })
    reindex(graph)
    expect(snap()).toEqual(first)
  })
})

describe('store hardening (M2)', () => {
  it('refuses an oversized file before parsing it', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const big = join(dir, 'big.record.json')
    writeFileSync(big, Buffer.alloc(MAX_RECORD_BYTES + 1, 0x20))
    const result = addRecordFile(graph, big)
    expect(result.status).toBe('refused')
    expect(result.errors!.join(' ')).toMatch(/ingestion bound/)
  })

  it('explains a broken-session refusal instead of refusing silently (D-065)', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const record = structuredClone(makeRecord('a', { remotes: ACME }))
    const exit = record.observations.events.find(
      (e) => e.kind === 'process.exit' && (e.payload as { exitCode?: unknown }).exitCode === 1,
    )!
    ;(exit.payload as { exitCode: number }).exitCode = 0
    record.evidence.integrity.status = 'BROKEN'
    record.recordId = computeRecordId(record)

    const result = addRecordValue(graph, record, 'broken')
    expect(result.status).toBe('refused')
    expect(result.errors!.join('\n')).toMatch(/D-065/)
    expect(result.errors!.join('\n')).toMatch(/indistinguishable from forgeries/)
  })

  it('a stray file at the top of records/ is detected, never silently skipped (E2)', () => {
    const graph = seeded()
    writeFileSync(join(graph.recordsDir, 'evil.json'), '{}', 'utf8')
    mkdirSync(join(graph.recordsDir, 'not-a-fanout'), { recursive: true })
    const result = verifyGraph(graph)
    expect(result.unrecognized.some((f) => f.endsWith('evil.json'))).toBe(true)
    expect(result.unrecognized.some((f) => f.endsWith('not-a-fanout'))).toBe(true)
    // Strays are anomalies, not object corruption: integrity is about objects.
    expect(result.storeIntact).toBe(true)
  })
})
