/**
 * The session views added by D-073 — replay, explain, and the report's new sections —
 * tested at the same layer as the graph CLI: exit codes, section presence, tamper
 * behavior, and determinism. Wording holds meaning and meaning lives in the model,
 * so these tests pin plumbing and the load-bearing labels, not aesthetics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { vectorDrafts, VECTOR_SESSION_ID } from '../../record/vector-fixture.js'
import { extractMission } from '../main.js'
import { cmdReplay } from './replay.js'
import { cmdExplain } from './explain.js'
import { cmdReport } from './report.js'

let dir: string
let stdout: string[]
let prevCwd: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-views-'))
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
    /* Windows holds handles sometimes; the tmpdir reaper gets it */
  }
})

const text = (): string => stdout.join('')

/** A project whose ledger holds the golden-vector session — every fact, every tier. */
function seedProject(): void {
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
      'pin the record format',
      '2026-01-02T03:04:00.000Z',
      '2026-01-02T03:05:00.000Z',
      0,
      '/vector/project',
    )
    for (const draft of vectorDrafts()) store.append(draft)
  } finally {
    db.close()
  }
  process.chdir(dir)
}

function tamper(): void {
  const db = openDatabase(join(dir, '.lodestar', 'lodestar.db'))
  try {
    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE seq = 2").run('{"forged":true}')
  } finally {
    db.close()
  }
}

describe('lodestar replay', () => {
  it('renders the full timeline with tier labels and evidence markers, exit 0', () => {
    seedProject()
    expect(cmdReplay([])).toBe(0)
    const t = text()
    expect(t).toContain('Timeline (')
    expect(t).toContain('session started')
    expect(t).toContain('Mission')
    expect(t).toContain('pin the record format')
    // Narration must be visibly labelled as the agent's own voice.
    expect(t).toContain('[claimed]')
    // The cited-event marker exists (vector session fires facts).
    expect(t).toContain('●')
    expect(t).toContain('Result:')
  })

  it('is deterministic: two runs render byte-identical output', () => {
    seedProject()
    cmdReplay([])
    const first = text()
    stdout = []
    cmdReplay([])
    expect(text()).toBe(first)
  })

  it('exits 1 for a missing session, 2 for a tampered record', () => {
    seedProject()
    expect(cmdReplay(['999'])).toBe(1)
    tamper()
    stdout = []
    expect(cmdReplay([])).toBe(2)
    expect(text()).toContain('altered after it was written')
  })
})

describe('lodestar explain', () => {
  it('lists the declared catalog, expands evidence, carries assumptions', () => {
    seedProject()
    expect(cmdExplain([])).toBe(0)
    const t = text()
    expect(t).toContain('What was checked (7)')
    expect(t).toContain('RF-01')
    expect(t).toContain('Evidence, resolved:')
    // RF-04 fires in the vector session; its clock assumption must travel with it.
    expect(t).toContain('assumes')
    expect(t).toContain('Limitations (')
  })

  it('refuses to explain a tampered record, exit 2', () => {
    seedProject()
    tamper()
    expect(cmdExplain([])).toBe(2)
    expect(text()).toContain('Nothing in this record can be explained')
  })
})

describe('lodestar report — the D-073 sections', () => {
  it('renders commands, files changed, and the result line from the model', async () => {
    seedProject()
    expect(await cmdReport(['--terminal'])).toBe(0)
    const t = text()
    expect(t).toContain('Commands (')
    expect(t).toContain('Files changed (')
    expect(t).toContain('Result:')
  })
})

describe('run --mission parsing', () => {
  it('takes --mission before the agent name only', () => {
    expect(extractMission(['--mission', 'refactor auth', 'claude', '--verbose'])).toEqual({
      mission: 'refactor auth',
      rest: ['claude', '--verbose'],
    })
  })

  it('never consumes flags that belong to the agent', () => {
    expect(extractMission(['claude', '--mission', 'x'])).toEqual({
      mission: null,
      rest: ['claude', '--mission', 'x'],
    })
  })

  it('tolerates a dangling --mission with no value', () => {
    expect(extractMission(['--mission'])).toEqual({ mission: null, rest: ['--mission'] })
  })
})
