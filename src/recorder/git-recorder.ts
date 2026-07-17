/**
 * LODESTAR — git recorder.
 *
 * Captures repository state at session boundaries and detects what the agent did to
 * git: commits created, refs moved, and whether the working tree was left dirty.
 *
 * This is where RF-02 ("session ended with a dirty working tree" — the `"done"` that
 * left half-edited files) and RF-09 (destructive git operation) get their evidence.
 *
 * Boundary snapshots, not polling: git state is cheap to read but not free, and
 * `HEAD` moving mid-session is only interesting in relation to where it started. Two
 * reads bracketing the session answer every V0 question. If the Explain layer later
 * needs finer granularity, it can watch `.git/HEAD` — but it does not today, and a
 * poller we don't need is a poller that burns a developer's battery.
 */

import { simpleGit, type SimpleGit } from 'simple-git'
import type { RecordingContext } from './context.js'
import { isLodestarPath } from './ignore.js'

export interface GitState {
  isRepo: boolean
  head?: string
  branch?: string
  /** Paths relative to the repo root, as git reports them. */
  dirty?: string[]
  ahead?: number
  behind?: number
}

export interface GitDelta {
  commitsCreated: string[]
  headMoved: boolean
  headBefore?: string
  headAfter?: string
  branchChanged: boolean
  /** Left uncommitted at session end — the evidence behind RF-02. */
  dirtyAtEnd: string[]
}

export class GitRecorder {
  private readonly git: SimpleGit
  private before: GitState = { isRepo: false }

  constructor(
    private readonly context: RecordingContext,
    root: string,
  ) {
    this.git = simpleGit(root)
  }

  /**
   * LODESTAR's own record is not the agent's mess.
   *
   * `init` gitignores `.lodestar/`, but a user may not have run it, or may have removed
   * the line. Without this filter, RF-02 ("session ended with a dirty working tree")
   * would fire on our own database and blobs — a false positive on a Reality Fact,
   * caused by the act of observing. The observer must not appear in its own record.
   */
  private static withoutOwnFootprint(paths: string[]): string[] {
    return paths.filter((p) => !isLodestarPath(p))
  }

  private async readState(): Promise<GitState> {
    try {
      if (!(await this.git.checkIsRepo())) return { isRepo: false }
      const status = await this.git.status()
      const head = (await this.git.revparse(['HEAD'])).trim()
      return {
        isRepo: true,
        head,
        branch: status.current ?? undefined,
        dirty: GitRecorder.withoutOwnFootprint([
          ...status.modified,
          ...status.created,
          ...status.deleted,
          ...status.not_added,
        ]),
        ahead: status.ahead,
        behind: status.behind,
      }
    } catch {
      // A repo with no commits yet throws on rev-parse HEAD. That is a normal state,
      // not an error, and it must not take the recorder down.
      try {
        if (await this.git.checkIsRepo()) {
          const status = await this.git.status()
          return {
            isRepo: true,
            branch: status.current ?? undefined,
            dirty: GitRecorder.withoutOwnFootprint([
              ...status.modified,
              ...status.created,
              ...status.not_added,
            ]),
          }
        }
      } catch {
        /* not a repo, or git is unavailable */
      }
      return { isRepo: false }
    }
  }

  /** Read the starting state. Emits nothing — a baseline is context, not an event. */
  async start(): Promise<GitState> {
    this.before = await this.readState()
    return this.before
  }

  /**
   * Read the ending state, emit what changed, and return the delta.
   *
   * Commits are emitted individually so each is addressable in the timeline; the
   * dirty-tree fact is carried on the ref_update event rather than invented as a
   * pseudo-event, because "the tree is dirty" is a state, not an action.
   */
  async finish(): Promise<GitDelta | null> {
    if (!this.before.isRepo) return null
    const after = await this.readState()

    const delta: GitDelta = {
      commitsCreated: [],
      headMoved: Boolean(this.before.head && after.head && this.before.head !== after.head),
      headBefore: this.before.head,
      headAfter: after.head,
      branchChanged: this.before.branch !== after.branch,
      dirtyAtEnd: after.dirty ?? [],
    }

    // ---------------------------------------------------------------------------
    // Working-tree state, emitted UNCONDITIONALLY — D-047
    // ---------------------------------------------------------------------------
    //
    // `dirtyAtEnd` used to ride only on the `git.ref_update` event below, which is inside
    // `if (delta.headMoved)`. RF-02 is "session ended with a dirty working tree" — i.e.
    // the agent changed files and did NOT commit — so HEAD did not move, no event was
    // emitted, and **the evidence was absent in exactly the case the fact exists to
    // detect**. The comment there claimed it was "carried where a reader will find it".
    // A reader would not have found it, because it was not written.
    //
    // This is read from git by the recorder itself, not reported by the agent: ground
    // truth, and the same three-state discipline as everywhere else — `dirty: []` means
    // measured-clean, and no event at all means we could not read git.
    this.context.emit({
      source: 'git',
      kind: 'git.status',
      target: {
        raw: after.branch ?? 'HEAD',
        resolved: after.head ?? 'HEAD',
        kind: 'ref',
        inScope: true,
      },
      payload: {
        dirtyAtEnd: delta.dirtyAtEnd,
        branch: after.branch,
        head: after.head,
        ahead: after.ahead,
        behind: after.behind,
      },
      effectClass: 'read',
      blastRadius: 'repo',
    })

    if (delta.headMoved && this.before.head && after.head) {
      delta.commitsCreated = await this.commitsBetween(this.before.head, after.head)

      for (const sha of delta.commitsCreated) {
        this.context.emit({
          source: 'git',
          kind: 'git.commit',
          target: { raw: sha, resolved: sha, kind: 'ref', inScope: true },
          payload: { sha, branch: after.branch },
          effectClass: 'write',
          blastRadius: 'repo',
          reversible: true,
        })
      }

      this.context.emit({
        source: 'git',
        kind: 'git.ref_update',
        target: {
          raw: after.branch ?? 'HEAD',
          resolved: after.head,
          kind: 'ref',
          inScope: true,
        },
        payload: {
          from: this.before.head,
          to: after.head,
          branch: after.branch,
          branchChanged: delta.branchChanged,
          // Evidence for RF-02, carried where a reader will find it.
          dirtyAtEnd: delta.dirtyAtEnd,
          // HEAD moved but no commits are reachable from the old one: a reset or a
          // force-move happened. Stated as an observation; the Fact engine decides
          // whether it matters.
          historyRewritten: delta.commitsCreated.length === 0,
        },
        effectClass: 'write',
        blastRadius: 'repo',
        reversible: true,
      })
    }

    return delta
  }

  /** Commits reachable from `to` but not from `from`. Empty implies a rewrite, not a no-op. */
  private async commitsBetween(from: string, to: string): Promise<string[]> {
    try {
      const log = await this.git.raw(['rev-list', `${from}..${to}`])
      return log.split('\n').map((l) => l.trim()).filter(Boolean)
    } catch {
      return []
    }
  }
}
