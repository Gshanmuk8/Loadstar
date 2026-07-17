/**
 * LODESTAR — the recording context.
 *
 * Every recorder emits through this one place. That is deliberate: it is the only way
 * to guarantee every captured event carries a correct `signalTier`, a resolved target,
 * and monotonic ordering. A recorder that built its own event objects would eventually
 * get one of those wrong, and the wrong one would be `signalTier`.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import type {
  Actor,
  DraftEvent,
  EventKind,
  EventSource,
  EventTarget,
  LodestarEvent,
  SignalTier,
} from '../types/events.js'
import type { SqliteEventStore } from '../storage/event-store.js'
import { redactDeep } from '../core/redact.js'

export interface EmitInput {
  source: EventSource
  kind: EventKind
  payload: unknown
  /**
   * Defaults to `groundTruth`. Recorders in this directory observe reality from
   * outside the agent — that is what makes them the floor. A recorder that needs to
   * emit narration must say so explicitly, so the exception is visible in review.
   */
  signalTier?: SignalTier
  target?: EventTarget
  effectClass?: LodestarEvent['effectClass']
  blastRadius?: LodestarEvent['blastRadius']
  reversible?: boolean
  taint?: boolean
  snapshotRef?: LodestarEvent['snapshotRef']
}

export class RecordingContext {
  private readonly startedAtMs = Date.now()
  private readonly startedAtNs = process.hrtime.bigint()

  constructor(
    readonly store: SqliteEventStore,
    readonly sessionId: string,
    readonly root: string,
    readonly actor: Actor,
    readonly missionId?: string,
  ) {}

  /**
   * Milliseconds since session start, from a monotonic clock.
   *
   * Wall clocks skew, jump on NTP sync, and go backwards across DST. Ordering must
   * never depend on them — `ts` is for humans, `monotonicTs` is for the timeline.
   */
  monotonic(): number {
    return Number((process.hrtime.bigint() - this.startedAtNs) / 1_000_000n)
  }

  wallClock(): string {
    return new Date(this.startedAtMs + this.monotonic()).toISOString()
  }

  /**
   * Build a target with its true, resolved path.
   *
   * `raw` is what we were handed; `resolved` is what the filesystem will actually
   * touch. Recording only `raw` is the mistake the whole product exists to avoid.
   * `inScope` is a blast-radius signal: a write outside the project root is a
   * different kind of event, and RF-07 depends on it being computed here rather than
   * guessed later.
   */
  fileTarget(path: string): EventTarget {
    const resolved = isAbsolute(path) ? path : resolve(this.root, path)
    const rel = relative(this.root, resolved)
    return {
      raw: path,
      resolved,
      kind: 'file',
      inScope: rel !== '' && !rel.startsWith('..') && !isAbsolute(rel),
    }
  }

  /**
   * Construct and persist an event.
   *
   * ---------------------------------------------------------------------------
   * REDACTION IS APPLIED HERE, AS A FLOOR — see core/redact.ts and D-028
   * ---------------------------------------------------------------------------
   *
   * This class already exists because a recorder that built its own events would
   * eventually get one of the invariants wrong. Secrets are now one of those invariants,
   * and the argument is identical — with one addition that makes it stronger.
   *
   * The store is append-only and hash-chained: an event's payload is durable and
   * unremovable the instant `append` returns. So "remember to redact in your recorder" is
   * not a policy that can hold. It held for zero of the four event paths that existed
   * when it was written, and every future recorder is another chance to forget once,
   * permanently.
   *
   * Running it here means a contributor cannot put a `ghp_…` token in the ledger even if
   * they have never heard of `redact.ts`. The recorders still redact with structure
   * first (`redactArgs` knows `--token <x>` from position, which no generic pass can) —
   * this is the floor beneath that, not a replacement for it. `redactText` is idempotent,
   * so the two passes compose.
   *
   * `target` is redacted too: it carries the resolved command string for process events.
   */
  emit(input: EmitInput): LodestarEvent {
    const draft: DraftEvent = {
      id: randomUUID(),
      sessionId: this.sessionId,
      ts: this.wallClock(),
      monotonicTs: this.monotonic(),
      source: input.source,
      signalTier: input.signalTier ?? 'groundTruth',
      kind: input.kind,
      actor: this.actor,
      payload: redactDeep(input.payload).value,
    }
    if (input.target) draft.target = redactDeep(input.target).value
    if (input.effectClass) draft.effectClass = input.effectClass
    if (input.blastRadius) draft.blastRadius = input.blastRadius
    if (input.reversible !== undefined) draft.reversible = input.reversible
    if (input.taint !== undefined) draft.taint = input.taint
    if (input.snapshotRef) draft.snapshotRef = input.snapshotRef
    if (this.missionId) draft.missionId = this.missionId

    return this.store.append(draft)
  }
}
