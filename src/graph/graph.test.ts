/**
 * The Evidence Graph store, index, and query — M-V's claims under test.
 *
 * The claims, in rising order of importance:
 *   1. The store is write-once, verify-on-add, idempotent — including under the
 *      concurrent/duplicate/tamper cases that dumb transports produce.
 *   2. `graph verify` detects every alteration class: edited content, misfiled
 *      objects, garbage — and keeps store integrity separate from evidence quality.
 *   3. The index is derived and DISPOSABLE: rebuilt twice, it answers the repos
 *      query byte-identically. This is V1's determinism contract.
 *   4. Backfill from a real recorded project works end to end, including the new
 *      identity-evidence capture — the dogfood criterion from V1-VALIDATION §10.
 *
 * Nothing here mocks anything: real files, real SQLite, real recorder sessions,
 * real git repos.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { buildRecord, computeRecordId } from '../record/build.js'
import { checkRecord } from '../record/check.js'
import { serializeRecord, recordScriptTag } from '../record/serialize.js'
import { vectorDrafts } from '../record/vector-fixture.js'
import type { EvidenceRecord } from '../record/types.js'
import { writeConfig } from '../core/config.js'
import { paths } from '../core/project.js'
import { Recorder } from '../recorder/index.js'
import { FLOOR_ONLY } from '../adapters/registry.js'
import {
  addFromProject,
  addRecordFile,
  addRecordValue,
  findGraphRoot,
  initGraph,
  listRecordFiles,
  openGraph,
  queryRepos,
  readRecord,
  reindex,
  reportJson,
  verifyGraph,
} from './index.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-graph-'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* Windows may hold a handle briefly */
  }
})

/**
 * A distinct, fully valid record: the golden fixture's session re-keyed. Optionally
 * gains identity evidence, so tests can produce origin-based and path-based groups.
 */
function makeRecord(
  key: string,
  identity?: { remotes?: Array<{ name: string; url: string }>; roots?: string[] },
): EvidenceRecord {
  const db = openDatabase(':memory:')
  try {
    const store = new SqliteEventStore(db)
    const sessionId = `graph-test-${key}`
    db.prepare(
      `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, 1, 'vector-runtime', null, '2026-01-02T03:04:00.000Z', '2026-01-02T03:05:00.000Z', 0, '/vector/project')

    for (const draft of vectorDrafts()) {
      const rekeyed = {
        ...draft,
        id: `${key}-${draft.id}`,
        sessionId,
      }
      if (identity && draft.kind === 'session.start') {
        rekeyed.payload = {
          ...(draft.payload as Record<string, unknown>),
          ...(identity.remotes ? { gitRemotes: identity.remotes } : {}),
          ...(identity.roots ? { gitRootCommits: identity.roots } : {}),
        }
      }
      store.append(rekeyed)
    }
    const record = buildRecord(store, sessionId)
    if (!record) throw new Error('fixture record did not build')
    return record
  } finally {
    db.close()
  }
}

describe('graph store', () => {
  it('init creates the manifest, gitignore, and layout; open validates; discovery walks up', () => {
    const graphDir = join(dir, '.lodestar-graph')
    const graph = initGraph(graphDir)
    expect(JSON.parse(readFileSync(join(graph.root, 'graph.json'), 'utf8'))).toEqual({
      format: 'lodestar-evidence-graph',
      formatVersion: 1,
    })
    expect(readFileSync(join(graph.root, '.gitignore'), 'utf8')).toContain('index/')
    expect(() => initGraph(graphDir)).toThrow(/already exists/)

    const nested = join(dir, 'a', 'b', 'c')
    mkdirSync(nested, { recursive: true })
    expect(findGraphRoot(nested)).toBe(graph.root)
    expect(openGraph(graph.root).root).toBe(graph.root)
  })

  it('add is verify-then-store and idempotent; the file on disk is the canonical bytes', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const record = makeRecord('a')

    const first = addRecordValue(graph, record, 'test')
    expect(first.status).toBe('added')
    const second = addRecordValue(graph, record, 'test')
    expect(second.status).toBe('duplicate')

    const files = listRecordFiles(graph)
    expect(files).toHaveLength(1)
    expect(readFileSync(files[0]!, 'utf8')).toBe(serializeRecord(record))
    expect(readRecord(graph, record.recordId)?.recordId).toBe(record.recordId)
  })

  it('refuses a tampered record with the checker’s wording — and the standalone verifier agrees', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const record = structuredClone(makeRecord('a'))
    const exit = record.observations.events.find(
      (e) => e.kind === 'process.exit' && (e.payload as { exitCode?: unknown }).exitCode === 1,
    )!
    ;(exit.payload as { exitCode: number }).exitCode = 0

    const result = addRecordValue(graph, record, 'forged')
    expect(result.status).toBe('refused')
    expect(result.errors!.join('\n')).toMatch(/does not match its hash|record id/)
    expect(listRecordFiles(graph)).toHaveLength(0)

    // Cross-pin: the in-process checker and the independent verifier must agree on
    // both directions — this rejects, and graph.test's accepted records pass it.
    const file = join(dir, 'forged.json')
    writeFileSync(file, serializeRecord(record), 'utf8')
    let code = 0
    try {
      execFileSync(process.execPath, [join(process.cwd(), 'verifier', 'lodestar-verify.mjs'), file], {
        encoding: 'utf8',
      })
    } catch (err) {
      code = (err as { status?: number }).status ?? -1
    }
    expect(code).toBe(2)
  })

  it('accepts records from files and from exported HTML', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const record = makeRecord('a')

    const jsonFile = join(dir, 'r.record.json')
    writeFileSync(jsonFile, serializeRecord(record), 'utf8')
    expect(addRecordFile(graph, jsonFile).status).toBe('added')

    const htmlFile = join(dir, 'report.html')
    writeFileSync(htmlFile, `<!doctype html><body>${recordScriptTag(record)}</body>`, 'utf8')
    expect(addRecordFile(graph, htmlFile).status).toBe('duplicate')

    const bare = join(dir, 'empty.html')
    writeFileSync(bare, '<!doctype html><body>no record here</body>', 'utf8')
    const refused = addRecordFile(graph, bare)
    expect(refused.status).toBe('refused')
    expect(refused.errors!.join(' ')).toMatch(/no embedded evidence record/)
  })

  it('verify separates store integrity from evidence quality, and names every failure class', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const a = makeRecord('a')
    const b = makeRecord('b')
    addRecordValue(graph, a, 'test')
    addRecordValue(graph, b, 'test')

    // Clean store: intact, and the fixture sessions are honestly DEGRADED
    // (shadowed shim in the coverage probe) — evidence quality, not store damage.
    const clean = verifyGraph(graph)
    expect(clean.storeIntact).toBe(true)
    expect(clean.recordCount).toBe(2)
    expect(clean.degradedRecords).toBe(2)

    // Class 1: edited content under the right name.
    const [fileA] = listRecordFiles(graph)
    writeFileSync(fileA!, readFileSync(fileA!, 'utf8').replace('"exitCode":1', '"exitCode":0'), 'utf8')
    const tampered = verifyGraph(graph)
    expect(tampered.storeIntact).toBe(false)
    expect(tampered.objects.find((o) => o.file === fileA)!.errors.join('\n')).toMatch(
      /record id|hash/,
    )

    // Restore, then class 2: a valid record misfiled under another id.
    writeFileSync(fileA!, serializeRecord(a), 'utf8')
    const wrongId = 'f'.repeat(64)
    const misfiledDir = join(graph.recordsDir, wrongId.slice(0, 2))
    mkdirSync(misfiledDir, { recursive: true })
    const misfiled = join(misfiledDir, `${wrongId}.record.json`)
    copyFileSync(fileA!, misfiled)
    const misfiledResult = verifyGraph(graph)
    expect(misfiledResult.storeIntact).toBe(false)
    expect(misfiledResult.objects.find((o) => o.file === misfiled)!.errors.join('\n')).toMatch(/misfiled/)
    rmSync(misfiled)

    // Class 3: garbage bytes and stray temps — named, never silently skipped.
    writeFileSync(join(graph.recordsDir, a.recordId.slice(0, 2), '.tmp-leftover'), 'x', 'utf8')
    const garbageName = 'a'.repeat(64)
    mkdirSync(join(graph.recordsDir, garbageName.slice(0, 2)), { recursive: true })
    writeFileSync(join(graph.recordsDir, garbageName.slice(0, 2), `${garbageName}.record.json`), '{not json', 'utf8')
    const messy = verifyGraph(graph)
    expect(messy.storeIntact).toBe(false)
    expect(messy.tempFiles).toHaveLength(1)
    expect(messy.objects.some((o) => o.errors.includes('not valid JSON'))).toBe(true)
  })
})

describe('derived index and the repos query', () => {
  function seededGraph() {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    // Two sessions of one origin-identified repo, one session of a path-only project.
    addRecordValue(
      graph,
      makeRecord('a', {
        remotes: [{ name: 'origin', url: 'git@github.com:acme/payments.git' }],
        roots: ['aaaa000000000000000000000000000000000001'],
      }),
      'test',
    )
    addRecordValue(
      graph,
      makeRecord('b', {
        remotes: [{ name: 'origin', url: 'https://github.com/acme/payments' }],
        roots: ['aaaa000000000000000000000000000000000001'],
      }),
      'test',
    )
    addRecordValue(graph, makeRecord('c'), 'test')
    return graph
  }

  it('groups records by resolved identity, with bases and coverage', () => {
    const graph = seededGraph()
    reindex(graph)
    const report = queryRepos(graph)

    expect(report.coverage.records).toBe(3)
    expect(report.coverage.sessions).toBe(3)
    expect(report.groups).toHaveLength(2)

    const acme = report.groups.find((g) => g.displayName === 'github.com/acme/payments')!
    expect(acme.basis).toBe('origin')
    expect(acme.sessions).toBe(2)

    const pathGroup = report.groups.find((g) => g.basis === 'path')!
    expect(pathGroup.sessions).toBe(1)
    expect(report.coverage.note).toMatch(/absence of records is not absence of activity/)
  })

  it('rebuilds deterministically: reindex twice, byte-identical answers', () => {
    const graph = seededGraph()

    reindex(graph)
    const first = reportJson(queryRepos(graph))

    // Kill the index completely — it is disposable by contract — and rebuild.
    rmSync(graph.indexDb, { force: true })
    reindex(graph)
    const second = reportJson(queryRepos(graph))

    expect(second).toBe(first)

    // And a third rebuild over the same store, without deleting: still identical.
    reindex(graph)
    expect(reportJson(queryRepos(graph))).toBe(first)
  })

  it('counts re-analyzed sessions once: same (sessionId, chainHead), two records', () => {
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const record = makeRecord('a')
    // A second artifact over the SAME observations — a different generator version
    // recomputed the evidence. Different recordId, same session key (F6). The
    // recordId is honestly recomputed, so the artifact verifies like any other.
    const reanalyzed = structuredClone(record)
    reanalyzed.generator = { ...reanalyzed.generator, version: '9.9.9' }
    reanalyzed.recordId = computeRecordId(reanalyzed)

    expect(addRecordValue(graph, record, 'v1').status).toBe('added')
    expect(addRecordValue(graph, reanalyzed, 'v2').status).toBe('added')

    reindex(graph)
    const report = queryRepos(graph)
    expect(report.coverage.records).toBe(2)
    expect(report.coverage.sessions).toBe(1)
    expect(report.groups[0]!.sessions).toBe(1)
  })

  it('queries never require a prior reindex — the index self-heals (M2, D-066)', () => {
    // M-V threw "run reindex" here; M2 replaced that contract with self-healing,
    // because a required manual step before correct answers is a stale-answer bug
    // waiting at every git pull. An empty graph answers honestly, not errors.
    const graph = initGraph(join(dir, '.lodestar-graph'))
    const report = queryRepos(graph)
    expect(report.groups).toEqual([])
    expect(report.coverage.records).toBe(0)
    expect(report.coverage.note).toMatch(/absence of records is not absence of activity/)
  })
})

describe('backfill dogfood — a real recorded project enters the graph', () => {
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

  it('records a real session, backfills it, groups it, verifies it', async () => {
    // A real project with a real git identity.
    const project = join(dir, 'proj')
    mkdirSync(join(project, 'src'), { recursive: true })
    const git = (...a: string[]) =>
      execFileSync('git', a, { cwd: project, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
    let gitAvailable = true
    try {
      git('init')
      git('remote', 'add', 'origin', 'https://ci-token:s3cr3t@github.com/acme/dogfood.git')
      git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'root')
    } catch {
      gitAvailable = false
    }

    const p = paths(project)
    mkdirSync(p.sessions, { recursive: true })
    writeConfig(p.config)
    openDatabase(p.db).close()

    const recorder = new Recorder({
      root: project,
      runtimeId: 'dogfood-runtime',
      mission: null,
      capabilities: FLOOR_ONLY,
    })
    await recorder.start()
    writeFileSync(join(project, 'src', 'a.mjs'), 'export const a = 1\n', 'utf8')
    await settle()
    await recorder.stop(0)

    const graph = initGraph(join(dir, '.lodestar-graph'))
    const results = addFromProject(graph, project)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.every((r) => r.status === 'added')).toBe(true)

    // The stored artifact verifies — and never carries the remote's credentials.
    const stored = readRecord(graph, results[0]!.recordId!)
    expect(stored).toBeTruthy()
    expect(checkRecord(stored!).ok).toBe(true)
    expect(serializeRecord(stored!)).not.toContain('s3cr3t')

    // Backfill twice: determinism makes it a no-op, not a duplicate corpus.
    const again = addFromProject(graph, project)
    expect(again.every((r) => r.status === 'duplicate')).toBe(true)

    reindex(graph)
    const report = queryRepos(graph)
    expect(report.coverage.records).toBe(results.length)
    if (gitAvailable) {
      const group = report.groups.find((g) => g.displayName === 'github.com/acme/dogfood')
      expect(group, 'origin-based group from real capture').toBeTruthy()
      expect(group!.basis).toBe('origin')
      expect(group!.agents).toContain('dogfood-runtime')
    } else {
      expect(report.groups[0]!.basis).toBe('path')
    }
  }, 30_000)
})
