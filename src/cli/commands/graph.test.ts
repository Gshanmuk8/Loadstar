/**
 * The graph CLI, tested at the layer where M-V's only field-found bug lived.
 *
 * The `--graph` flag-position bug shipped because nothing exercised argument
 * parsing; a smoke test then "passed" by comparing two usage dumps. These tests
 * hold the CLI's contract: flag positions, exit codes, JSON output validity, and
 * the stale-index narration. Rendering aesthetics are not asserted — wording holds
 * meaning, and meaning is asserted through the library's reports; here we pin the
 * plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { buildRecord } from '../../record/build.js'
import { serializeRecord } from '../../record/serialize.js'
import { vectorDrafts } from '../../record/vector-fixture.js'
import type { EvidenceRecord } from '../../record/types.js'
import { listRecordFiles, openGraph } from '../../graph/index.js'
import { cmdGraph } from './graph.js'

let dir: string
let stdout: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-cli-'))
  stdout = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function fixtureRecord(): EvidenceRecord {
  const db = openDatabase(':memory:')
  try {
    const store = new SqliteEventStore(db)
    db.prepare(
      `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('cli-s1', 1, 'vector-runtime', null, '2026-01-02T03:04:00.000Z', '2026-01-02T03:05:00.000Z', 0, '/vector/project')
    for (const draft of vectorDrafts()) store.append({ ...draft, sessionId: 'cli-s1', id: `cli-${draft.id}` })
    return buildRecord(store, 'cli-s1')!
  } finally {
    db.close()
  }
}

const text = (): string => stdout.join('')

describe('lodestar graph CLI', () => {
  it('init → add → query --json → verify, with exit codes', async () => {
    const graphDir = join(dir, '.lodestar-graph')
    expect(await cmdGraph(['init', graphDir])).toBe(0)

    const file = join(dir, 'r.record.json')
    writeFileSync(file, serializeRecord(fixtureRecord()), 'utf8')
    expect(await cmdGraph(['add', file, '--graph', graphDir])).toBe(0)

    stdout = []
    expect(await cmdGraph(['query', 'repos', '--json', '--graph', graphDir])).toBe(0)
    const report = JSON.parse(text()) as { coverage: { records: number } }
    expect(report.coverage.records).toBe(1)

    expect(await cmdGraph(['verify', '--graph', graphDir])).toBe(0)
  })

  it('accepts --graph BEFORE the subcommand too (the M-V regression)', async () => {
    const graphDir = join(dir, '.lodestar-graph')
    await cmdGraph(['init', graphDir])
    expect(await cmdGraph(['--graph', graphDir, 'verify'])).toBe(0)
    expect(await cmdGraph(['--graph', graphDir, 'query', 'repos', '--json'])).toBe(0)
  })

  it('narrates a stale index on a human query after an out-of-band add', async () => {
    const graphDir = join(dir, '.lodestar-graph')
    await cmdGraph(['init', graphDir])
    const file = join(dir, 'r.record.json')
    const record = fixtureRecord()
    writeFileSync(file, serializeRecord(record), 'utf8')
    await cmdGraph(['add', file, '--graph', graphDir])

    // Out-of-band: a second record appears the way `git pull` delivers one.
    const graph = openGraph(graphDir)
    const re = structuredClone(record)
    re.generator = { name: 'other', version: '1.0' }
    const { computeRecordId } = await import('../../record/build.js')
    re.recordId = computeRecordId(re)
    const target = join(graph.recordsDir, re.recordId.slice(0, 2))
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, `${re.recordId}.record.json`), serializeRecord(re), 'utf8')

    stdout = []
    expect(await cmdGraph(['query', 'repos', '--graph', graphDir])).toBe(0)
    expect(text()).toMatch(/index was stale/)
    expect(text()).toMatch(/out of band/)
  })

  it('refuses a tampered add with exit 1; verify reports tampered stores with exit 2', async () => {
    const graphDir = join(dir, '.lodestar-graph')
    await cmdGraph(['init', graphDir])
    const record = structuredClone(fixtureRecord())
    ;(record.observations.events[6]!.payload as { exitCode?: number }).exitCode = 0
    const file = join(dir, 'forged.record.json')
    writeFileSync(file, serializeRecord(record), 'utf8')
    expect(await cmdGraph(['add', file, '--graph', graphDir])).toBe(1)

    // A clean add, then tamper the stored bytes: verify must exit 2.
    const good = join(dir, 'good.record.json')
    writeFileSync(good, serializeRecord(fixtureRecord()), 'utf8')
    await cmdGraph(['add', good, '--graph', graphDir])
    const graph = openGraph(graphDir)
    const [stored] = listRecordFiles(graph)
    copyFileSync(stored!, stored!) // touch-free no-op guard
    writeFileSync(stored!, '{"format":"lodestar-evidence-record","formatVersion":1}', 'utf8')
    expect(await cmdGraph(['verify', '--graph', graphDir])).toBe(2)
  })

  it('unknown queries and missing args fail with exit 1, never a stack trace', async () => {
    const graphDir = join(dir, '.lodestar-graph')
    await cmdGraph(['init', graphDir])
    expect(await cmdGraph(['query', 'nonsense', '--graph', graphDir])).toBe(1)
    expect(await cmdGraph(['query', 'file-history', '--graph', graphDir])).toBe(1) // missing args → usage
    expect(await cmdGraph(['nonsense-subcommand'])).toBe(1)
  })
})
