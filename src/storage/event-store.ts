/**
 * LODESTAR — the append-only, hash-chained event store.
 *
 * This is the Record Layer. Everything above it — Explain, Gate, Prevent, Direct —
 * is a query or a decision over what this file writes. See ARCHITECTURE.md §1.
 */

import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { GENESIS_HASH, chainHash } from '../core/hash.js'
import { eventHashBody, verifyEvents } from '../core/chain.js'
import type {
  DraftEvent,
  EventFilter,
  EventKind,
  LodestarEvent,
  Session,
  VerifyResult,
} from '../types/events.js'

interface EventRow {
  id: string
  session_id: string
  seq: number
  ts: string
  monotonic_ts: number
  source: string
  signal_tier: string
  kind: string
  actor: string
  target: string | null
  effect_class: string | null
  blast_radius: string | null
  reversible: number | null
  taint: number | null
  mission_id: string | null
  payload: string
  snapshot_ref: string | null
  prev_hash: string
  hash: string
}

// The hashed body — the set of fields the chain protects — lives in core/chain.ts
// (`eventHashBody`), because it is the record format itself, shared verbatim by this
// store, the Evidence Record builder, and the record specification. See D-059.

function rowToEvent(r: EventRow): LodestarEvent {
  const ev: LodestarEvent = {
    id: r.id,
    sessionId: r.session_id,
    seq: r.seq,
    ts: r.ts,
    monotonicTs: r.monotonic_ts,
    source: r.source as LodestarEvent['source'],
    signalTier: r.signal_tier as LodestarEvent['signalTier'],
    kind: r.kind as EventKind,
    actor: JSON.parse(r.actor),
    payload: JSON.parse(r.payload),
    prevHash: r.prev_hash,
    hash: r.hash,
  }
  if (r.target) ev.target = JSON.parse(r.target)
  if (r.effect_class) ev.effectClass = r.effect_class as LodestarEvent['effectClass']
  if (r.blast_radius) ev.blastRadius = r.blast_radius as LodestarEvent['blastRadius']
  if (r.reversible !== null) ev.reversible = r.reversible === 1
  if (r.taint !== null) ev.taint = r.taint === 1
  if (r.mission_id) ev.missionId = r.mission_id
  if (r.snapshot_ref) ev.snapshotRef = JSON.parse(r.snapshot_ref)
  return ev
}

export class SqliteEventStore {
  constructor(private readonly db: DatabaseSync) {}

  // -- sessions ------------------------------------------------------------

  createSession(input: {
    runtimeId: string
    cwd: string
    mission?: string | null
  }): Session {
    const row = this.db.prepare('SELECT MAX(number) AS n FROM sessions').get() as {
      n: number | null
    }
    const number = (row?.n ?? 0) + 1

    const session: Session = {
      id: randomUUID(),
      number,
      runtimeId: input.runtimeId,
      mission: input.mission ?? null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      cwd: input.cwd,
    }

    this.db
      .prepare(
        `INSERT INTO sessions (id, number, runtime_id, mission, started_at, cwd)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.number,
        session.runtimeId,
        session.mission ?? null,
        session.startedAt,
        session.cwd,
      )

    return session
  }

  /**
   * Sessions are mutable; events are not. Closing a session updates two fields that
   * are unknowable at start. The *record* — the events — stays append-only, and the
   * session row carries no evidentiary weight beyond framing.
   */
  endSession(sessionId: string, exitCode: number | null): void {
    this.db
      .prepare('UPDATE sessions SET ended_at = ?, exit_code = ? WHERE id = ?')
      .run(new Date().toISOString(), exitCode, sessionId)
  }

  getSession(sessionId: string): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined
    return r ? this.sessionFromRow(r) : null
  }

  getSessionByNumber(number: number): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE number = ?').get(number) as
      | Record<string, unknown>
      | undefined
    return r ? this.sessionFromRow(r) : null
  }

  listSessions(limit = 50): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY number DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[]
    return rows.map((r) => this.sessionFromRow(r))
  }

  latestSession(): Session | null {
    const r = this.db
      .prepare('SELECT * FROM sessions ORDER BY number DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined
    return r ? this.sessionFromRow(r) : null
  }

  private sessionFromRow(r: Record<string, unknown>): Session {
    return {
      id: r['id'] as string,
      number: r['number'] as number,
      runtimeId: r['runtime_id'] as string,
      mission: (r['mission'] as string | null) ?? null,
      startedAt: r['started_at'] as string,
      endedAt: (r['ended_at'] as string | null) ?? null,
      exitCode: (r['exit_code'] as number | null) ?? null,
      cwd: r['cwd'] as string,
    }
  }

  // -- events --------------------------------------------------------------

  /**
   * Append one event, linking it to the chain.
   *
   * `seq` and `prevHash` are assigned here, never by the caller — a caller that could
   * choose its own sequence number could rewrite history by writing into a gap.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS A TRANSACTION — it is not optional
   * ---------------------------------------------------------------------------
   *
   * Since Phase 6, shims are separate OS processes appending to the same chain. Reading
   * the tip and inserting the next link is a read-modify-write, so two concurrent
   * writers would both read seq=N, both compute prevHash from the same tip, and both
   * write seq=N+1 — one losing to the UNIQUE constraint, and the chain forking in the
   * meantime.
   *
   * BEGIN IMMEDIATE takes the write lock up front, so the read of the tip and the
   * insert are atomic against other processes. Combined with busy_timeout, a concurrent
   * `npm test` and `git commit` serialize instead of racing.
   */
  append(draft: DraftEvent): LodestarEvent {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const event = this.appendLocked(draft)
      this.db.exec('COMMIT')
      return event
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Rollback can fail if the transaction is already gone. The original error is
        // the one worth reporting.
      }
      throw err
    }
  }

  private appendLocked(draft: DraftEvent): LodestarEvent {
    const tip = this.db
      .prepare('SELECT seq, hash FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT 1')
      .get(draft.sessionId) as { seq: number; hash: string } | undefined

    const seq = (tip?.seq ?? 0) + 1
    const prevHash = tip?.hash ?? GENESIS_HASH

    const withoutHash: Omit<LodestarEvent, 'hash'> = { ...draft, seq, prevHash }
    const hash = chainHash(prevHash, eventHashBody(withoutHash))
    const event: LodestarEvent = { ...withoutHash, hash }

    this.db
      .prepare(
        `INSERT INTO events (
           id, session_id, seq, ts, monotonic_ts, source, signal_tier, kind, actor,
           target, effect_class, blast_radius, reversible, taint, mission_id,
           payload, snapshot_ref, prev_hash, hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.sessionId,
        event.seq,
        event.ts,
        event.monotonicTs,
        event.source,
        event.signalTier,
        event.kind,
        JSON.stringify(event.actor),
        event.target ? JSON.stringify(event.target) : null,
        event.effectClass ?? null,
        event.blastRadius ?? null,
        event.reversible === undefined ? null : event.reversible ? 1 : 0,
        event.taint === undefined ? null : event.taint ? 1 : 0,
        event.missionId ?? null,
        JSON.stringify(event.payload),
        event.snapshotRef ? JSON.stringify(event.snapshotRef) : null,
        event.prevHash,
        event.hash,
      )

    return event
  }

  query(filter: EventFilter): LodestarEvent[] {
    const where: string[] = []
    const params: unknown[] = []

    if (filter.sessionId) {
      where.push('session_id = ?')
      params.push(filter.sessionId)
    }
    if (filter.signalTier) {
      where.push('signal_tier = ?')
      params.push(filter.signalTier)
    }
    if (filter.kind) {
      const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind]
      where.push(`kind IN (${kinds.map(() => '?').join(', ')})`)
      params.push(...kinds)
    }
    if (filter.file) {
      where.push("json_extract(target, '$.resolved') LIKE ?")
      params.push(`%${filter.file}%`)
    }
    if (filter.since) {
      where.push('ts >= ?')
      params.push(filter.since)
    }
    if (filter.until) {
      where.push('ts <= ?')
      params.push(filter.until)
    }

    const sql =
      `SELECT * FROM events` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY session_id, seq` +
      (filter.limit ? ` LIMIT ${Number(filter.limit)}` : '')

    return (this.db.prepare(sql).all(...(params as never[])) as unknown as EventRow[]).map(
      rowToEvent,
    )
  }

  /**
   * Walk the chain and recompute every link.
   *
   * This is the product's central claim made checkable by the user. The walk itself is
   * `verifyEvents` in core/chain.ts — pure and shared, so the store, the Evidence
   * Record builder, and the standalone verifier cannot hold three different opinions
   * of what "intact" means (D-059, the same reasoning as D-049 for renderers).
   */
  verify(sessionId: string): VerifyResult {
    return verifyEvents(this.query({ sessionId }))
  }
}
