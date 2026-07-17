/**
 * LODESTAR — the golden-vector session.
 *
 * ---------------------------------------------------------------------------
 * ONE FIXED SESSION THAT PINS THE ENTIRE FORMAT — D-060
 * ---------------------------------------------------------------------------
 *
 * Every value here is a constant: ids, timestamps, payloads, order. Seeding a store
 * from this fixture therefore produces byte-identical events, hashes, and Evidence
 * Record on every machine, every OS, every run — which is what lets the committed
 * vectors in spec/vectors/ act as the format's conformance suite. If a change to
 * hashing, canonicalization, the hashed field set, or the record shape lands, the
 * vector tests fail, and THAT is the signal that the change is a format change
 * (RECORD-SPEC.md §6) rather than a refactor.
 *
 * The session is designed to exercise, in one record:
 *   - every implemented fact: RF-01 (fail-then-pass, with ancestry subsumption of a
 *     child failure), RF-02 (dirty tree), RF-04 (writes after the last completed test,
 *     two files), RF-05 (content revert), RF-06 (signal kill), RF-07 (out-of-scope write)
 *   - a narration-tier event, so the tier rules are pinned (in the timeline, never in facts)
 *   - a coverage probe with a shadowed command, so DEGRADED is pinned
 *   - process ancestry via execId/parentExecId, so subsumption is pinned
 *   - snapshot refs, mtimes, withheld-free writes, and a session.start identity payload
 *
 * Do not edit casually. Editing this file regenerates different vectors, and
 * regenerating vectors is a declared format event, not a chore (see spec/generate-vectors.ts).
 */

import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import type { DatabaseSync } from 'node:sqlite'
import type { Actor, DraftEvent } from '../types/events.js'

export const VECTOR_SESSION_ID = 'vector-session-0001'

const AGENT: Actor = { kind: 'agent', runtimeId: 'vector-runtime' }
const CWD = '/vector/project'

const at = (iso: string): number => Date.parse(iso)

function file(path: string, inScope: boolean): NonNullable<DraftEvent['target']> {
  return { raw: path, resolved: path, kind: 'file', inScope }
}

/** The fixed drafts, in append order. The store assigns seq, prevHash, and hash. */
export function vectorDrafts(): DraftEvent[] {
  const e = (
    n: number,
    ts: string,
    rest: Omit<DraftEvent, 'id' | 'sessionId' | 'ts' | 'monotonicTs' | 'actor'>,
  ): DraftEvent => ({
    id: `evt-${String(n).padStart(4, '0')}`,
    sessionId: VECTOR_SESSION_ID,
    ts,
    monotonicTs: n * 1000,
    actor: AGENT,
    ...rest,
  })

  return [
    e(1, '2026-01-02T03:04:01.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'session.start',
      payload: {
        runtimeId: 'vector-runtime',
        cwd: CWD,
        argv: ['vector-agent'],
        machineId: 'vector-machine-0001',
        runtimeVersion: '9.9.9',
        model: 'vector-model-1',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
      },
    }),
    e(2, '2026-01-02T03:04:02.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'agent.output',
      payload: {
        coverageProbe: {
          commands: [
            { command: 'npm', status: 'observed', resolvedTo: '/vector/shims/npm' },
            { command: 'node', status: 'observed', resolvedTo: '/vector/shims/node' },
            { command: 'git', status: 'shadowed', resolvedTo: '/vector/other/git' },
          ],
        },
      },
    }),
    // The agent's own account. Present so the vectors pin the tier rules: it appears in
    // the timeline labelled as narration and is unreachable from every fact.
    e(3, '2026-01-02T03:04:03.000Z', {
      source: 'stdio',
      signalTier: 'narration',
      kind: 'agent.output',
      payload: { text: 'Working on the payment bug. All tests pass.' },
    }),
    e(4, '2026-01-02T03:04:10.000Z', {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: file(`${CWD}/src/config.mjs`, true),
      payload: {
        path: `${CWD}/src/config.mjs`,
        bytesBefore: 100,
        bytesAfter: 120,
        mtimeMs: at('2026-01-02T03:04:10.000Z'),
      },
      snapshotRef: { before: 'blob-cfg-1', after: 'blob-cfg-2' },
    }),
    e(5, '2026-01-02T03:04:12.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.spawn',
      target: { raw: 'npm test', resolved: '/vector/bin/npm', kind: 'process', inScope: true },
      payload: {
        command: 'npm test',
        args: ['test'],
        cwd: CWD,
        execId: 'exec-npm-1',
        resolvedPath: '/vector/bin/npm',
      },
    }),
    // A child failure underneath the failing `npm test`: observed ancestry, so RF-01
    // subsumes it into the parent's evidence instead of raising a second alarm (D-034).
    e(6, '2026-01-02T03:04:14.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.exit',
      payload: {
        command: 'node payments.test.mjs',
        exitCode: 1,
        durationMs: 800,
        cwd: CWD,
        execId: 'exec-node-1',
        parentExecId: 'exec-npm-1',
        stderrTail: 'FAIL: 2 tests failed',
      },
    }),
    e(7, '2026-01-02T03:04:15.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.exit',
      payload: {
        command: 'npm test',
        exitCode: 1,
        durationMs: 1200,
        cwd: CWD,
        execId: 'exec-npm-1',
        resolvedPath: '/vector/bin/npm',
      },
    }),
    e(8, '2026-01-02T03:04:20.000Z', {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: file(`${CWD}/src/payments.mjs`, true),
      payload: {
        path: `${CWD}/src/payments.mjs`,
        bytesBefore: 500,
        bytesAfter: 510,
        mtimeMs: at('2026-01-02T03:04:20.000Z'),
      },
      snapshotRef: { before: 'blob-pay-1', after: 'blob-pay-2' },
    }),
    e(9, '2026-01-02T03:04:30.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.exit',
      payload: {
        command: 'npm test',
        exitCode: 0,
        durationMs: 900,
        cwd: CWD,
        execId: 'exec-npm-2',
        resolvedPath: '/vector/bin/npm',
      },
    }),
    // Modified AFTER the passing run — the flagship fact (RF-04), pinned with explicit
    // effect fields so their hashing is covered too.
    e(10, '2026-01-02T03:04:40.000Z', {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: file(`${CWD}/src/payments.mjs`, true),
      effectClass: 'write',
      blastRadius: 'file',
      reversible: true,
      payload: {
        path: `${CWD}/src/payments.mjs`,
        bytesBefore: 510,
        bytesAfter: 512,
        mtimeMs: at('2026-01-02T03:04:40.000Z'),
      },
      snapshotRef: { before: 'blob-pay-2', after: 'blob-pay-3' },
    }),
    // Reverted to content it held earlier in the session (RF-05) — and after the last
    // test run, so it is also RF-04's second file.
    e(11, '2026-01-02T03:04:41.000Z', {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: file(`${CWD}/src/config.mjs`, true),
      payload: {
        path: `${CWD}/src/config.mjs`,
        bytesBefore: 120,
        bytesAfter: 100,
        mtimeMs: at('2026-01-02T03:04:41.000Z'),
      },
      snapshotRef: { before: 'blob-cfg-2', after: 'blob-cfg-1' },
    }),
    e(12, '2026-01-02T03:04:45.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.exit',
      payload: {
        command: 'node build.mjs',
        exitCode: null,
        signal: 'SIGKILL',
        durationMs: 3000,
        cwd: CWD,
        execId: 'exec-build-1',
      },
    }),
    e(13, '2026-01-02T03:04:50.000Z', {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: file('/vector/home/.bashrc', false),
      effectClass: 'write',
      payload: {
        path: '/vector/home/.bashrc',
        bytesBefore: 40,
        bytesAfter: 60,
        mtimeMs: at('2026-01-02T03:04:50.000Z'),
      },
    }),
    e(14, '2026-01-02T03:04:55.000Z', {
      source: 'git',
      signalTier: 'groundTruth',
      kind: 'git.status',
      payload: {
        dirtyAtEnd: ['src/payments.mjs', 'src/config.mjs'],
        branch: 'main',
        head: '0123456789abcdef0123456789abcdef01234567',
      },
    }),
    e(15, '2026-01-02T03:05:00.000Z', {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'session.end',
      payload: { exitCode: 0, durationMs: 59000 },
    }),
  ]
}

export interface VectorStore {
  db: DatabaseSync
  store: SqliteEventStore
  sessionId: string
  close(): void
}

/**
 * An in-memory store seeded with the fixed session.
 *
 * The session row is inserted directly rather than through `createSession`, which
 * mints a random id and reads the clock — the two things a vector must never do.
 * The EVENTS go through the real `append`, so seq assignment, hashing, and chain
 * linking are the production code path, not a reimplementation of it.
 */
export function seedVectorStore(): VectorStore {
  const db = openDatabase(':memory:')
  const store = new SqliteEventStore(db)

  db.prepare(
    `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    VECTOR_SESSION_ID,
    1,
    'vector-runtime',
    'Fix the payment bug',
    '2026-01-02T03:04:00.000Z',
    '2026-01-02T03:05:00.000Z',
    0,
    CWD,
  )

  for (const draft of vectorDrafts()) store.append(draft)

  return { db, store, sessionId: VECTOR_SESSION_ID, close: () => db.close() }
}
