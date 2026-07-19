/**
 * `lodestar memory` (D-073) — a view over the ledger and the graph, never a store.
 * Pins: session digest, declared-claims rendering, graceful no-graph path, and the
 * deterministic JSON form.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { vectorDrafts, VECTOR_SESSION_ID } from '../../record/vector-fixture.js'
import { buildRecord } from '../../record/build.js'
import { initGraph, addRecordValue, addLinkValue } from '../../graph/index.js'
import { makeLink, repoAddress } from '../../record/link.js'
import { cmdMemory } from './memory.js'

let dir: string
let stdout: string[]
let prevCwd: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-memory-'))
  prevCwd = process.cwd()
  stdout = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(prevCwd)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

const text = (): string => stdout.join('')

function seedProject(): ReturnType<typeof buildRecord> {
  mkdirSync(join(dir, '.lodestar'), { recursive: true })
  writeFileSync(join(dir, '.lodestar', 'config.json'), '{}', 'utf8')
  const db = openDatabase(join(dir, '.lodestar', 'lodestar.db'))
  try {
    const store = new SqliteEventStore(db)
    db.prepare(
      `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      VECTOR_SESSION_ID,
      1,
      'vector-runtime',
      'remember this',
      '2026-01-02T03:04:00.000Z',
      '2026-01-02T03:05:00.000Z',
      0,
      '/vector/project',
    )
    for (const draft of vectorDrafts()) store.append(draft)
    const record = buildRecord(store, VECTOR_SESSION_ID)
    process.chdir(dir)
    return record
  } finally {
    db.close()
  }
}

describe('lodestar memory', () => {
  it('digests sessions and says where declared claims would live when no graph exists', () => {
    seedProject()
    expect(cmdMemory([])).toBe(0)
    const t = text()
    expect(t).toContain('Sessions (1)')
    expect(t).toContain('remember this')
    expect(t).toContain('No evidence graph found')
  })

  it('renders declared claims from the graph, attributed and marked as claims', () => {
    const record = seedProject()
    const graph = initGraph(join(dir, '.lodestar-graph'))
    expect(addRecordValue(graph, record, 'test').status).toBe('added')
    const link = makeLink({
      type: 'mission',
      from: repoAddress('memory-test-repo'),
      to: repoAddress('memory-test-repo'),
      author: 'tester',
      reason: 'decided in the review',
      ts: '2026-01-03T00:00:00.000Z',
    })
    expect(addLinkValue(graph, link, 'test').status).toBe('added')

    expect(cmdMemory([])).toBe(0)
    const t = text()
    expect(t).toContain('Declared claims (1)')
    expect(t).toContain('decided in the review')
    expect(t).toContain('by tester')
    // The epistemic label is load-bearing (P5): claims, not observations.
    expect(t).toContain('claims, not observations')
    expect(t).toContain('unauthenticated')
  })

  it('--json is parseable and carries both halves', () => {
    seedProject()
    expect(cmdMemory(['--json'])).toBe(0)
    const parsed = JSON.parse(text()) as { sessions: unknown[]; links: unknown }
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.links).toBeNull()
  })

  it('an empty project has an honest empty answer, exit 0', () => {
    mkdirSync(join(dir, '.lodestar'), { recursive: true })
    writeFileSync(join(dir, '.lodestar', 'config.json'), '{}', 'utf8')
    openDatabase(join(dir, '.lodestar', 'lodestar.db')).close()
    process.chdir(dir)
    expect(cmdMemory([])).toBe(0)
    expect(text()).toContain('Nothing recorded yet')
  })
})
