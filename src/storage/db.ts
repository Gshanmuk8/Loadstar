/**
 * LODESTAR — database schema and connection.
 *
 * Uses node:sqlite (built in to Node 22.5+) rather than a native module. See
 * DECISIONS.md D-019: better-sqlite3 has no prebuilt binary for current Node and
 * falls back to a source build requiring Visual Studio, which breaks the
 * "under three minutes to first value" requirement on a stock Windows machine.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const SCHEMA_VERSION = 1

/**
 * Append-only is enforced in three places, on purpose:
 *   1. The EventStore interface has no update/delete.
 *   2. These triggers reject UPDATE/DELETE at the database.
 *   3. The hash chain makes any out-of-band edit detectable.
 *
 * (1) stops honest mistakes. (2) stops raw SQL. (3) catches anyone who bypasses both
 * by editing the file directly. The record is the only thing this product sells; one
 * lock is not enough.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  number     INTEGER NOT NULL UNIQUE,
  runtime_id TEXT NOT NULL,
  mission    TEXT,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  exit_code  INTEGER,
  cwd        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  ts           TEXT NOT NULL,
  monotonic_ts INTEGER NOT NULL,
  source       TEXT NOT NULL,
  signal_tier  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  actor        TEXT NOT NULL,
  target       TEXT,
  effect_class TEXT,
  blast_radius TEXT,
  reversible   INTEGER,
  taint        INTEGER,
  mission_id   TEXT,
  payload      TEXT NOT NULL,
  snapshot_ref TEXT,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  UNIQUE (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions (id)
);

CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_tier        ON events (signal_tier);
CREATE INDEX IF NOT EXISTS idx_events_kind        ON events (kind);
CREATE INDEX IF NOT EXISTS idx_events_ts          ON events (ts);

CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'LODESTAR: events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'LODESTAR: events are append-only');
END;
`

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)

  // WAL: concurrent reads while the recorder writes. The dashboard reads the same
  // file the recorder is appending to — and since Phase 6, so do shim processes.
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA synchronous = NORMAL;')
  // Shims are separate processes appending to the same chain. Without a busy timeout a
  // concurrent `npm test` and `git status` would race for the write lock and one would
  // fail instantly with SQLITE_BUSY, silently losing an event. Wait instead.
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)

  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION),
  )

  return db
}
