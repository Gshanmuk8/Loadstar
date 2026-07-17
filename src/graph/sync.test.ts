/**
 * One-command sharing, attacked (M3 §3).
 *
 * The claims: sync is set union (no conflicts exist to resolve), idempotent,
 * verify-on-pull (a shared folder is where tampered objects arrive from),
 * offline-first (capture never depends on connectivity), and transport-neutral
 * (a dumb directory and a git remote behave identically at the store level).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { writeConfig } from '../core/config.js'
import { paths } from '../core/project.js'
import { serializeRecord } from '../record/serialize.js'
import { corpusRecords } from './corpus-fixture.js'
import {
  addRecordValue,
  initGraph,
  openGraph,
  verifyGraph,
  walkStore,
  type Graph,
} from './store.js'
import { configureShare, readShare, syncGraph } from './sync.js'
import { queryRepos, reportJson } from './graph-index.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-sync-'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

const records = corpusRecords()

function graphWith(name: string, recordIdx: number[]): Graph {
  const g = initGraph(join(dir, name, '.lodestar-graph'))
  for (const i of recordIdx) addRecordValue(g, records[i]!, `r${i}`)
  return g
}

describe('path-share sync', () => {
  it('round-trips: A pushes, B pulls, both answer identically', () => {
    const share = join(dir, 'team-share')
    const a = graphWith('a', [0, 1, 2])
    const b = graphWith('b', [3, 4])

    configureShare(a, share, { create: true })
    configureShare(b, share)

    const syncA = syncGraph(a, { cwd: dir })
    expect(syncA.pushed).toHaveLength(3)
    expect(syncA.pulled).toHaveLength(0)

    const syncB = syncGraph(b, { cwd: dir })
    expect(syncB.pulled).toHaveLength(3)
    expect(syncB.pushed).toHaveLength(2)

    const syncA2 = syncGraph(a, { cwd: dir })
    expect(syncA2.pulled).toHaveLength(2)
    expect(syncA2.pushed).toHaveLength(0)

    expect(reportJson(queryRepos(a))).toBe(reportJson(queryRepos(b)))
  })

  it('is idempotent: a second sync moves nothing', () => {
    const share = join(dir, 'team-share')
    const a = graphWith('a', [0, 1])
    configureShare(a, share, { create: true })
    syncGraph(a, { cwd: dir })
    const again = syncGraph(a, { cwd: dir })
    expect(again.pulled).toHaveLength(0)
    expect(again.pushed).toHaveLength(0)
    expect(again.ok).toBe(true)
  })

  it('verifies on pull: a tampered object in the share is refused, named, and left in place', () => {
    const share = join(dir, 'team-share')
    const a = graphWith('a', [0])
    configureShare(a, share, { create: true })
    syncGraph(a, { cwd: dir })

    // Plant a hostile object in the share under a plausible name: rewrite the
    // FAILING exit (event 3 of w1-bob-1 is the exit-1 npm test) into a pass.
    const forged = structuredClone(records[1]!)
    const failExit = forged.observations.events.find(
      (e) => e.kind === 'process.exit' && (e.payload as { exitCode?: unknown }).exitCode === 1,
    )!
    ;(failExit.payload as { exitCode: number }).exitCode = 0
    const fakeId = 'e'.repeat(64)
    const fanout = join(share, 'records', fakeId.slice(0, 2))
    mkdirSync(fanout, { recursive: true })
    writeFileSync(join(fanout, `${fakeId}.record.json`), serializeRecord(forged), 'utf8')

    const b = graphWith('b', [])
    configureShare(b, share)
    const sync = syncGraph(b, { cwd: dir })

    expect(sync.pulled).toHaveLength(1) // the honest record came through
    expect(sync.refusedFromRemote).toHaveLength(1)
    expect(sync.refusedFromRemote[0]!.errors!.join('\n')).toMatch(/hash|record id/)
    // Local store intact; the hostile file stays remote for a human to remove.
    expect(verifyGraph(b).storeIntact).toBe(true)
    expect(walkStore(b).objectFiles).toHaveLength(1)
  })

  it('refuses to bless a mistyped share path, creates only with --create', () => {
    const a = graphWith('a', [0])
    expect(() => configureShare(a, join(dir, 'nope'))).toThrow(/--create/)
    expect(readShare(a)).toBeNull()
    configureShare(a, join(dir, 'nope'), { create: true })
    expect(readShare(a)).toEqual({ type: 'path', target: join(dir, 'nope') })
  })

  it('degrades offline: unreachable share collects locally and says so, exit-ok', () => {
    const share = join(dir, 'mounted')
    const a = graphWith('a', [0])
    configureShare(a, share, { create: true })
    renameSync(share, join(dir, 'unmounted')) // the drive went away

    const sync = syncGraph(a, { cwd: dir })
    expect(sync.ok).toBe(true)
    expect(sync.warnings.join(' ')).toMatch(/unreachable/)
    expect(sync.pushed).toHaveLength(0)
  })

  it('collects from a surrounding project, skipping open sessions by default', () => {
    const project = join(dir, 'proj')
    const p = paths(project)
    mkdirSync(p.sessions, { recursive: true })
    writeConfig(p.config)
    const db = openDatabase(p.db)
    // Two sessions: one properly ended, one still open. Direct rows + real chains.
    db.prepare(
      `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
       VALUES ('s-done', 1, 'test-rt', NULL, '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z', 0, ?),
              ('s-open', 2, 'test-rt', NULL, '2026-07-02T00:00:00.000Z', NULL, NULL, ?)`,
    ).run(project, project)
    const store = new SqliteEventStore(db)
    for (const sid of ['s-done', 's-open']) {
      store.append({
        id: `${sid}-e1`,
        sessionId: sid,
        ts: '2026-07-01T00:00:01.000Z',
        monotonicTs: 1000,
        source: 'process',
        signalTier: 'groundTruth',
        kind: 'session.start',
        actor: { kind: 'agent', runtimeId: 'test-rt' },
        payload: { runtimeId: 'test-rt', cwd: project, argv: [] },
      })
    }
    db.close()

    const a = graphWith('a', [])
    const sync = syncGraph(a, { cwd: project })
    expect(sync.collectedFrom).toBe(project)
    expect(sync.collected.map((c) => c.status).sort()).toEqual(['added', 'skipped-open'])

    const sealed = syncGraph(a, { cwd: project, includeOpen: true })
    expect(sealed.collected.some((c) => c.status === 'added')).toBe(true)
  })
})

describe('git-transport sync', () => {
  it('round-trips through a real bare remote with the user’s own git', () => {
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

    const bare = join(dir, 'origin.git')
    mkdirSync(bare, { recursive: true })
    try {
      git(bare, 'init', '--bare', '--quiet')
    } catch {
      return // no git on this machine; the path-transport suite carries the model
    }

    // In git mode the clone root IS the graph root — one directory, one repo.
    const cloneA = join(dir, 'cloneA')
    git(dir, 'clone', '--quiet', bare, cloneA)
    git(cloneA, 'config', 'user.email', 't@t')
    git(cloneA, 'config', 'user.name', 't')
    const ga = initGraph(cloneA)
    git(cloneA, 'add', '-A')
    git(cloneA, 'commit', '--quiet', '-m', 'graph init')
    git(cloneA, 'push', '--quiet')
    configureShare(ga, '--git')

    addRecordValue(ga, records[0]!, 'r0')
    const syncA = syncGraph(ga, { cwd: dir })
    expect(syncA.ok).toBe(true)
    expect(syncA.pushed).toHaveLength(1)

    // B clones AFTER A's push — the record arrives via the clone itself, so B's
    // first sync correctly pulls nothing new. (The first draft of this test
    // expected pulled=1 here; the model was right and the expectation was wrong.)
    const cloneB = join(dir, 'cloneB')
    git(dir, 'clone', '--quiet', bare, cloneB)
    git(cloneB, 'config', 'user.email', 't@t')
    git(cloneB, 'config', 'user.name', 't')
    const gb = openGraph(cloneB)
    configureShare(gb, '--git')
    const syncB = syncGraph(gb, { cwd: dir })
    expect(syncB.pulled).toHaveLength(0)
    expect(syncB.pushed).toHaveLength(0)
    expect(reportJson(queryRepos(gb))).toBe(reportJson(queryRepos(ga)))

    // The pull path proper: B adds, pushes; A pulls it through sync.
    addRecordValue(gb, records[1]!, 'r1')
    expect(syncGraph(gb, { cwd: dir }).pushed).toHaveLength(1)
    expect(syncGraph(ga, { cwd: dir }).pulled).toHaveLength(1)
    expect(reportJson(queryRepos(ga))).toBe(reportJson(queryRepos(gb)))
  })
})
