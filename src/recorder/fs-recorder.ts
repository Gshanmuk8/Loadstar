/**
 * LODESTAR — filesystem recorder.
 *
 * The ground-truth floor and the PRIMARY signal (D-003). It needs no adapter and does
 * not care which agent is running, which is what makes cross-agent coverage real at V0
 * without violating depth-on-one (D-004). Everything else can have holes; this must
 * not.
 *
 * The before/after problem, and why there is a baseline pass:
 *
 * A watcher fires *after* a file has changed — by then the previous content is gone.
 * So we snapshot every watched file at session start and keep a path→snapshot map.
 * On change, `before` comes from the map and `after` from disk, and the map updates.
 * Without the baseline there is no "before", and without "before" there is no diff.
 */

import { watch, type FSWatcher } from 'chokidar'
import type { RecordingContext } from './context.js'
import type { SnapshotStore, FileSnapshot } from './snapshots.js'
import { classifyFileEvent } from './classify.js'
import { makeIgnoreMatcher } from './ignore.js'
import type { FileChangePayload } from '../types/events.js'

export interface FsRecorderOptions {
  root: string
  ignore: string[]
  context: RecordingContext
  snapshots: SnapshotStore
  /** Disclosed if exceeded. A silent cap on a trust record is a lie by omission. */
  maxBaselineFiles?: number
}

export interface BaselineResult {
  filesBaselined: number
  /** True when maxBaselineFiles was hit — coverage is incomplete and must say so. */
  truncated: boolean
}

/**
 * Editors and compilers write in chunks; without a stability window we snapshot a
 * half-written file and report a change that never really existed in that form.
 * Named here because `stop()` must out-wait it — see the comment there.
 */
const AWAIT_WRITE = { stabilityThreshold: 120, pollInterval: 20 }

/**
 * How long `stop()` lets the stability window drain before closing (D-076).
 *
 * The window plus two polls plus scheduling slack. Measured failure without it: an
 * agent that writes `auth.ts` and exits — the most ordinary ending a session has —
 * lost the write, because the event was still inside `awaitWriteFinish` when the
 * wrapper closed the watcher. Git saw 5 uncommitted files while the record said one
 * file changed; the primary signal was silently missing the agent's final edits.
 */
const STOP_GRACE_MS = AWAIT_WRITE.stabilityThreshold + AWAIT_WRITE.pollInterval * 2 + 140

export class FsRecorder {
  private watcher: FSWatcher | null = null
  private readonly known = new Map<string, FileSnapshot>()
  private ready = false
  private truncated = false
  private readonly maxBaselineFiles: number

  constructor(private readonly opts: FsRecorderOptions) {
    this.maxBaselineFiles = opts.maxBaselineFiles ?? 20_000
  }

  /** Resolves once the baseline is complete and live changes are being recorded. */
  async start(): Promise<BaselineResult> {
    const watcher = watch(this.opts.root, {
      // A matcher function, never glob strings — chokidar 4 accepts globs and silently
      // matches nothing, which watched our own database and looped. See ignore.ts.
      ignored: makeIgnoreMatcher(this.opts.root, this.opts.ignore),
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: AWAIT_WRITE,
    })
    this.watcher = watcher

    watcher.on('add', (p) => this.onAdd(p))
    watcher.on('change', (p) => this.onChange(p))
    watcher.on('unlink', (p) => this.onUnlink(p))
    // A watcher error is a hole in the record. It must never be swallowed, and it must
    // never take the agent down with it.
    watcher.on('error', (e) => this.onError(e))

    await new Promise<void>((res) => watcher.once('ready', () => res()))
    this.ready = true

    return { filesBaselined: this.known.size, truncated: this.truncated }
  }

  async stop(): Promise<void> {
    // A write in the agent's last STOP_GRACE_MS is still inside the stability window;
    // closing the watcher now would drop it, and the session's final edits are the
    // ones a reader most needs. A fixed, short wait: the session end moves by a
    // quarter-second; the record stops missing the agent's last save (D-076).
    if (this.watcher) await new Promise((res) => setTimeout(res, STOP_GRACE_MS))
    await this.watcher?.close()
    this.watcher = null
  }

  /** Files whose content we hold — used by the git recorder to avoid double-snapshotting. */
  baselineSize(): number {
    return this.known.size
  }

  private onError(err: unknown): void {
    this.opts.context.emit({
      source: 'fs',
      kind: 'agent.output',
      payload: {
        recorderError: err instanceof Error ? err.message : String(err),
        recorder: 'fs',
      },
    })
  }

  private onAdd(path: string): void {
    if (!this.ready) {
      // Baseline pass: record what existed before the agent touched anything.
      if (this.known.size >= this.maxBaselineFiles) {
        this.truncated = true
        return
      }
      const snap = this.opts.snapshots.putFile(path)
      if (snap) this.known.set(path, snap)
      return
    }
    // After ready, an 'add' is a file the agent created.
    this.record(path, 'file.write', true)
  }

  private onChange(path: string): void {
    if (!this.ready) return
    this.record(path, 'file.write', false)
  }

  private onUnlink(path: string): void {
    if (!this.ready) return

    const before = this.known.get(path)
    this.known.delete(path)

    const payload: FileChangePayload = { path }
    if (before) {
      payload.bytesBefore = before.bytes
      payload.binary = before.binary
      if (before.sensitive) payload.contentWithheld = 'sensitive'
      else if (before.oversized) payload.contentWithheld = 'oversized'
    }

    const signals = classifyFileEvent('file.delete', Boolean(before?.ref))
    this.opts.context.emit({
      source: 'fs',
      kind: 'file.delete',
      target: this.opts.context.fileTarget(path),
      payload,
      snapshotRef: before?.ref ? { before: before.ref } : undefined,
      ...signals,
    })
  }

  private record(path: string, kind: 'file.write', created: boolean): void {
    const before = created ? undefined : this.known.get(path)
    const after = this.opts.snapshots.putFile(path)

    if (!after) {
      // We saw a change but could not read the file — a real gap. Say so rather than
      // dropping the event, which would render as "nothing happened".
      this.opts.context.emit({
        source: 'fs',
        kind,
        target: this.opts.context.fileTarget(path),
        payload: {
          path,
          unreadable: true,
          contentWithheld: 'unreadable',
        } satisfies FileChangePayload & { unreadable: true },
      })
      return
    }

    // Content-addressed, so an identical rewrite is detectable and worth ignoring —
    // build tools touch files constantly without changing them.
    //
    // A sensitive file has no ref by construction, so it can never take this branch. That
    // is correct rather than incidental: we have no way to know whether a `.env` rewrite
    // changed anything, and claiming "unchanged" from an absence of evidence would be
    // exactly the inference this product forbids. Every write to it is reported.
    if (before?.ref && after.ref && before.ref === after.ref) return

    this.known.set(path, after)

    const payload: FileChangePayload = { path, bytesAfter: after.bytes, binary: after.binary }
    if (before) payload.bytesBefore = before.bytes
    // When the write actually happened, per the OS — not when chokidar told us. D-044.
    if (after.mtimeMs !== undefined) payload.mtimeMs = after.mtimeMs
    if (after.sensitive) payload.contentWithheld = 'sensitive'
    else if (after.oversized) payload.contentWithheld = 'oversized'

    const snapshotRef: { before?: string; after?: string } = {}
    if (before?.ref) snapshotRef.before = before.ref
    if (after.ref) snapshotRef.after = after.ref

    const signals = classifyFileEvent(kind, Boolean(before?.ref) || created)
    this.opts.context.emit({
      source: 'fs',
      kind,
      target: this.opts.context.fileTarget(path),
      payload,
      snapshotRef: Object.keys(snapshotRef).length ? snapshotRef : undefined,
      ...signals,
    })
  }
}
