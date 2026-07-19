/**
 * D-074 — session lifecycle: the v1→v2 schema migration, wrapper PID plumbing, and
 * the read-time open-session states that keep a dead session from reading as
 * "running" forever.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, SCHEMA_VERSION } from './db.js'
import { SqliteEventStore } from './event-store.js'
import { openSessionState, describeOpenSession } from '../cli/commands/shared.js'
import type { Session } from '../types/events.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-lifecycle-'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

/** A database exactly as v1 created it: no wrapper_pid, schema_version 1. */
function createV1Db(path: string): void {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, runtime_id TEXT NOT NULL,
      mission TEXT, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER,
      cwd TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '1')
  db.prepare(
    `INSERT INTO sessions (id, number, runtime_id, started_at, cwd) VALUES (?, ?, ?, ?, ?)`,
  ).run('old-session', 1, 'claude-code', '2026-01-01T00:00:00.000Z', '/old/project')
  db.close()
}

describe('schema v1 → v2 migration', () => {
  it('adds wrapper_pid to an existing database without losing rows', () => {
    const path = join(dir, 'v1.db')
    createV1Db(path)

    const db = openDatabase(path)
    try {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      expect(cols.map((c) => c.name)).toContain('wrapper_pid')
      const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
        value: string
      }
      expect(version.value).toBe(String(SCHEMA_VERSION))

      const store = new SqliteEventStore(db)
      const old = store.getSession('old-session')
      expect(old).not.toBeNull()
      expect(old!.wrapperPid).toBeNull()
    } finally {
      db.close()
    }
  })

  it('is idempotent — reopening migrates nothing twice', () => {
    const path = join(dir, 'v1.db')
    createV1Db(path)
    openDatabase(path).close()
    const db = openDatabase(path)
    try {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      expect(cols.filter((c) => c.name === 'wrapper_pid')).toHaveLength(1)
    } finally {
      db.close()
    }
  })
})

describe('wrapper PID plumbing', () => {
  it('createSession stores it and reads it back', () => {
    const db = openDatabase(join(dir, 'fresh.db'))
    try {
      const store = new SqliteEventStore(db)
      const s = store.createSession({ runtimeId: 'test', cwd: dir, wrapperPid: process.pid })
      expect(store.getSession(s.id)!.wrapperPid).toBe(process.pid)
    } finally {
      db.close()
    }
  })
})

describe('open-session state (read-time, never evidence)', () => {
  const open = (wrapperPid: number | null): Session => ({
    id: 's',
    number: 1,
    runtimeId: 'test',
    mission: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    exitCode: null,
    cwd: dir,
    wrapperPid,
  })

  it('a live wrapper reads as running', () => {
    expect(openSessionState(open(process.pid))).toBe('running')
  })

  it('a dead wrapper reads as interrupted, and the wording says so', () => {
    // A real PID that is certainly dead: a process we spawned and already reaped.
    const dead = spawnSync(process.execPath, ['-e', '0']).pid as number
    expect(openSessionState(open(dead))).toBe('interrupted')
    expect(describeOpenSession('interrupted', dead)).toContain('never closed')
  })

  it('a pre-v2 session (no pid) reads as unknown, never as running', () => {
    expect(openSessionState(open(null))).toBe('unknown')
    expect(describeOpenSession('unknown')).toContain('may be running or interrupted')
  })

  it('refuses to judge a closed session', () => {
    const closed = { ...open(process.pid), endedAt: '2026-01-01T01:00:00.000Z' }
    expect(() => openSessionState(closed)).toThrow()
  })
})
