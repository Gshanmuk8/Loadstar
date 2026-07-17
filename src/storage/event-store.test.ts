/**
 * These tests exercise the one property LODESTAR sells: the record cannot be quietly
 * altered. If any of these fail, the product's central claim is false — treat a
 * failure here as a stop-the-line event, not a flaky test.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { openDatabase } from './db.js'
import { SqliteEventStore } from './event-store.js'
import { GENESIS_HASH, canonicalJSON } from '../core/hash.js'
import type { DraftEvent } from '../types/events.js'

let db: DatabaseSync
let store: SqliteEventStore
let sessionId: string

function draft(overrides: Partial<DraftEvent> = {}): DraftEvent {
  return {
    id: randomUUID(),
    sessionId,
    ts: new Date().toISOString(),
    monotonicTs: 0,
    source: 'process',
    signalTier: 'groundTruth',
    kind: 'process.exit',
    actor: { kind: 'agent', runtimeId: 'claude-code' },
    payload: { command: 'npm test', exitCode: 1, durationMs: 1200 },
    ...overrides,
  }
}

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new SqliteEventStore(db)
  sessionId = store.createSession({ runtimeId: 'claude-code', cwd: '/tmp/x' }).id
})

describe('canonical JSON', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }))
  })

  it('sorts nested keys too', () => {
    expect(canonicalJSON({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}')
  })

  it('distinguishes null from absent', () => {
    // `reversible: null` means "unknown"; absent means "not recorded". Different claims.
    expect(canonicalJSON({ a: null })).not.toBe(canonicalJSON({}))
  })
})

describe('chain construction', () => {
  it('starts from the genesis hash', () => {
    const e = store.append(draft())
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe(GENESIS_HASH)
  })

  it('links each event to the previous one', () => {
    const a = store.append(draft())
    const b = store.append(draft())
    expect(b.seq).toBe(2)
    expect(b.prevHash).toBe(a.hash)
  })

  it('assigns seq itself and ignores caller intent', () => {
    // A caller that could choose its own seq could rewrite history by filling a gap.
    store.append(draft())
    const second = store.append({ ...draft(), ...({ seq: 99 } as object) } as DraftEvent)
    expect(second.seq).toBe(2)
  })

  it('keeps chains independent per session', () => {
    const other = store.createSession({ runtimeId: 'claude-code', cwd: '/tmp/y' })
    store.append(draft())
    const first = store.append(draft({ sessionId: other.id }))
    expect(first.seq).toBe(1)
    expect(first.prevHash).toBe(GENESIS_HASH)
  })
})

describe('verify', () => {
  it('accepts an untouched chain', () => {
    for (let i = 0; i < 5; i++) store.append(draft())
    const r = store.verify(sessionId)
    expect(r.intact).toBe(true)
    expect(r.eventsChecked).toBe(5)
  })

  it('accepts an empty session', () => {
    expect(store.verify(sessionId).intact).toBe(true)
  })

  it('detects a tampered payload', () => {
    store.append(draft())
    store.append(draft())
    store.append(draft())

    // Triggers block UPDATE, so simulate an attacker editing the file out of band.
    db.exec('DROP TRIGGER events_no_update')
    db.prepare('UPDATE events SET payload = ? WHERE seq = 2').run(
      JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 1200 }),
    )

    const r = store.verify(sessionId)
    expect(r.intact).toBe(false)
    expect(r.brokenAt).toBe(2)
    expect(r.reason).toMatch(/does not match its hash/)
  })

  it('detects a deleted event as a sequence gap', () => {
    store.append(draft())
    store.append(draft())
    store.append(draft())

    db.exec('DROP TRIGGER events_no_delete')
    db.prepare('DELETE FROM events WHERE seq = 2').run()

    const r = store.verify(sessionId)
    expect(r.intact).toBe(false)
    expect(r.reason).toMatch(/sequence gap/)
  })

  it('detects a re-hashed event whose prevHash no longer matches', () => {
    // The subtle attack: recompute the tampered event's own hash so it is
    // self-consistent. The chain still breaks, because the NEXT event's prevHash
    // points at the old hash. This is the property that makes it a chain.
    store.append(draft())
    store.append(draft())
    store.append(draft())

    db.exec('DROP TRIGGER events_no_update')
    db.prepare('UPDATE events SET payload = ?, hash = ? WHERE seq = 2').run(
      JSON.stringify({ tampered: true }),
      'f'.repeat(64),
    )

    expect(store.verify(sessionId).intact).toBe(false)
  })
})

describe('append-only enforcement', () => {
  it('rejects UPDATE at the database', () => {
    store.append(draft())
    expect(() => db.prepare('UPDATE events SET kind = ? WHERE seq = 1').run('file.write')).toThrow(
      /append-only/,
    )
  })

  it('rejects DELETE at the database', () => {
    store.append(draft())
    expect(() => db.prepare('DELETE FROM events WHERE seq = 1').run()).toThrow(/append-only/)
  })

  it('has no update or delete on the store interface', () => {
    expect((store as unknown as Record<string, unknown>)['update']).toBeUndefined()
    expect((store as unknown as Record<string, unknown>)['delete']).toBeUndefined()
  })
})

describe('query', () => {
  it('filters by signal tier — the Reality Facts Rule, enforced in code', () => {
    store.append(draft({ signalTier: 'groundTruth' }))
    store.append(draft({ signalTier: 'narration', kind: 'agent.output', source: 'stdio' }))

    const facts = store.query({ sessionId, signalTier: 'groundTruth' })
    expect(facts).toHaveLength(1)
    // Narration is unreachable from the facts code path. By construction, not convention.
    expect(facts.every((e) => e.signalTier === 'groundTruth')).toBe(true)
  })

  it('filters by kind', () => {
    store.append(draft({ kind: 'process.exit' }))
    store.append(draft({ kind: 'file.write' }))
    expect(store.query({ sessionId, kind: 'file.write' })).toHaveLength(1)
  })

  it('filters by resolved file path', () => {
    store.append(
      draft({
        kind: 'file.write',
        source: 'fs',
        target: { raw: 'src/auth.ts', resolved: '/p/src/auth.ts', kind: 'file', inScope: true },
      }),
    )
    store.append(
      draft({
        kind: 'file.write',
        source: 'fs',
        target: { raw: 'src/db.ts', resolved: '/p/src/db.ts', kind: 'file', inScope: true },
      }),
    )
    expect(store.query({ sessionId, file: 'auth.ts' })).toHaveLength(1)
  })

  it('round-trips every optional field', () => {
    const written = store.append(
      draft({
        target: { raw: '$T', resolved: '/p/src/auth.ts', kind: 'file', inScope: true },
        effectClass: 'write',
        blastRadius: 'repo',
        reversible: true,
        taint: false,
        missionId: 'm1',
        snapshotRef: { before: 'a', after: 'b' },
      }),
    )
    const [read] = store.query({ sessionId })
    expect(read).toEqual(written)
  })

  it('distinguishes reversible false from unknown', () => {
    // `false` (cannot be undone) and absent (we do not know) drive different V2
    // decisions. Collapsing them would make an irreversible action look merely
    // unknown — which is exactly the direction a trust product must not err in.
    store.append(draft({ reversible: false }))
    store.append(draft())
    const [a, b] = store.query({ sessionId })
    expect(a?.reversible).toBe(false)
    expect(b?.reversible).toBeUndefined()
  })

  it('round-trips reversible true', () => {
    store.append(draft({ reversible: true }))
    expect(store.query({ sessionId })[0]?.reversible).toBe(true)
  })
})

describe('sessions', () => {
  it('numbers sessions monotonically for humans', () => {
    const b = store.createSession({ runtimeId: 'claude-code', cwd: '/tmp' })
    const c = store.createSession({ runtimeId: 'claude-code', cwd: '/tmp' })
    expect(b.number).toBe(2)
    expect(c.number).toBe(3)
  })

  it('records the exit code on close', () => {
    store.endSession(sessionId, 1)
    expect(store.getSession(sessionId)?.exitCode).toBe(1)
  })

  it('lists newest first', () => {
    store.createSession({ runtimeId: 'claude-code', cwd: '/tmp' })
    expect(store.listSessions()[0]?.number).toBe(2)
  })
})
