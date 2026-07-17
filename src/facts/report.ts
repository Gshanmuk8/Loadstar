/**
 * LODESTAR — the session report model.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT: THIS FILE COMPUTES, THE RENDERERS DO NOT — D-049
 * ---------------------------------------------------------------------------
 *
 * There are going to be at least three renderers: the terminal report, the local
 * dashboard, and the static HTML export (D-014). If each one reads the event store and
 * decides for itself what "degraded" means, then LODESTAR ships three subtly different
 * answers to the only question it exists to answer, and the one the user believes is
 * whichever they happened to open.
 *
 * So every judgment reaches a renderer through this one model, from one source:
 *
 *   - which facts fired, what could not be determined, where LODESTAR interfered,
 *     whether the record is sound      → read out of the EVIDENCE RECORD (record/build.ts)
 *   - what the evidence pointers resolve to → `evidence`, resolved here
 *   - what to call each event in a timeline → `timeline[].summary`, worded here
 *   - how the verdict is phrased           → `buildVerdict()`, worded here
 *
 * A renderer's entire job is layout: take `SessionReport`, arrange it, add colour. If a
 * renderer ever needs an `if` about *meaning*, that `if` belongs in the model layer —
 * in the record builder when it is a judgment, here when it is wording. The dashboard
 * renders; it must never compute.
 *
 * ---------------------------------------------------------------------------
 * DERIVED FROM THE EVIDENCE RECORD, WHICH IS BUILT FROM THE LEDGER — D-059
 * ---------------------------------------------------------------------------
 *
 * `Recorder.stop()` returns a `SessionSummary` with live coverage and facts in it, and it
 * would have been less code to hand that object to the report. It would also have been a
 * different product: that summary exists only in the memory of the process that recorded
 * the session, so it can say things no later reader can check.
 *
 * So the chain of custody runs one direction, and this file is the second link, not the
 * first:
 *
 *   ledger → buildRecord() → EvidenceRecord → reportFromRecord() → SessionReport → renderers
 *
 * Every judgment (facts, limitations, integrity, coverage) is computed when the RECORD
 * is built (record/build.ts) — this file turns the record into presentation: titles,
 * step chains, display paths, verdict wording, timelines. If a claim cannot be read out
 * of the record, this file must not make it. The practical consequence: a SessionReport
 * rendered from a live ledger and one rendered from an exported `.record.json` cannot
 * disagree, because they are the same function of the same artifact.
 */

import type { CommandCoverage } from '../recorder/shims.js'
import type { SnapshotStore } from '../recorder/snapshots.js'
import type {
  FileChangePayload,
  LodestarEvent,
  ProcessExitPayload,
  Session,
  SignalTier,
} from '../types/events.js'
import type { SqliteEventStore } from '../storage/event-store.js'
import type { RealityFact } from './index.js'
import { buildRecord } from '../record/build.js'
import type {
  EvidenceRecord,
  Integrity,
  IntegrityStatus,
  RecordIdentity,
} from '../record/types.js'

/**
 * Integrity is a property of the EVIDENCE, not of its presentation, so its home moved
 * to the record layer (record/types.ts, D-059). Re-exported here so every existing
 * consumer of the report model keeps one import path.
 */
export type { Integrity, IntegrityStatus } from '../record/types.js'

/**
 * What the report is allowed to say about its own fact list — D-053.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS IN THE MODEL AND NOT AN `if` IN THE RENDERER
 * ---------------------------------------------------------------------------
 *
 * The terminal renderer printed a green **"✓ No divergences observed"** whenever `facts`
 * was empty — including on a `BROKEN` record. That is the exact scenario the chain exists
 * to catch: an attacker rewrites `npm test exit 1` into `exit 0`, the fact disappears, and
 * the first thing the user reads is a green all-clear. The `BROKEN` block several lines
 * later does not undo the first impression.
 *
 * "An empty fact list on a rewritten record must not read as all-clear" is a statement
 * about **meaning**, and D-049 says meaning lives here. So the model tells every renderer
 * which of three things it is looking at, and a renderer that switches on this enum cannot
 * get it wrong — including the dashboard, which does not exist yet and therefore cannot be
 * reviewed for this mistake.
 */
export type FactsVerdict =
  /** Facts fired. Render them. */
  | 'divergences-observed'
  /** The engine looked and found nothing. Still not "all clear" — read the limitations. */
  | 'none-observed'
  /** The chain is broken: the fact list is computed from bytes that were altered. */
  | 'record-untrustworthy'

/**
 * A fact, prepared for a human — D-056.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HEADLINE IS NOT "RF-04"
 * ---------------------------------------------------------------------------
 *
 * `RF-04` is a catalog id. It is precise, it is what the tests and the docs key on, and it
 * means nothing to the person reading the report. Leading with it asks the reader to learn
 * our internal numbering before they can learn what happened.
 *
 * So each fact carries a `title` — a short observational phrase — and the id moves to the
 * details, where the people who want it still find it. Nothing is removed.
 *
 * ---------------------------------------------------------------------------
 * THE TITLES ARE OBSERVATIONS, NOT CONCLUSIONS. THIS IS NOT A STYLE CHOICE.
 * ---------------------------------------------------------------------------
 *
 * The tempting title for RF-04 is **"Untested change"**. It is punchier and it is a claim
 * we cannot carry: we know no test ran after the change *that the boundary could see*. On
 * a machine where a shim is shadowed — which the coverage block says out loud — a test may
 * have run and been invisible to us. "Untested" is a conclusion about coverage; **"Code
 * changed after testing"** is the measurement.
 *
 * The same rule that bans claim-parsing bans the better headline. A title is user-visible
 * text, and every user-visible statement must be derived from measured evidence.
 */
export interface FactView {
  /** The fact itself, unchanged. Nothing here replaces it. */
  fact: RealityFact
  /** Short, human, observational. What happened — not what it means. */
  title: string
  /**
   * The fact as an ordered chain: what was observed, then what follows from it.
   *
   * People read a timeline faster than a sentence. `steps` is that timeline, and every
   * `observed` step is an event in the record — a renderer draws the chain, it does not
   * assemble it.
   */
  steps: FactStep[]
  /**
   * The assumptions this fact rests on — attached to the fact, not floated in a global
   * list (D-058).
   *
   * A caveat is a qualifier on a conclusion, and a qualifier three sections away from the
   * conclusion it qualifies is a qualifier nobody reads. RF-04's "after" rests on
   * filesystem mtime; the assumption that the clock did not move backward belongs ON the
   * RF-04 card, revealed when someone asks "why do you believe this?", not in a
   * session-level limitations block where it reads as unrelated boilerplate (D-057).
   *
   * Empty for facts that rest on nothing beyond the events themselves — RF-01's "the
   * process exited 1" assumes nothing; the exit code is the exit code.
   */
  assumptions: string[]
}

export interface FactStep {
  /**
   * `observed` — this happened, and here is the event.
   * `consequence` — what the observed steps mean TOGETHER. Still no inference beyond the
   *   record: it restates the gap between them, and never a conclusion about the world.
   */
  state: 'observed' | 'consequence'
  text: string
  /**
   * When it happened — **the occurrence time, not the time we noticed**.
   *
   * For a file write this is `mtimeMs`, because that is the number RF-04 actually
   * compared (D-044). Showing the event's `ts` here would draw a timeline out of one clock
   * and compute the fact from another, and the picture could disagree with the fact it
   * illustrates.
   */
  ts?: string
  eventSeq?: number
}

/** An evidence pointer, resolved to the event it points at. */
export interface EvidenceEvent {
  eventId: string
  seq: number
  ts: string
  kind: string
  source: string
  /** `target.resolved` — the real path or command, never what the agent typed. */
  target?: string
  /** One line describing the event, computed here so renderers do not have to. */
  summary: string
}

export interface TimelineEntry {
  eventId: string
  seq: number
  ts: string
  kind: string
  summary: string
  /** True when a Reality Fact cites this event. Lets a renderer link the two. */
  cited: boolean
  /**
   * The tier, so a renderer can label narration AS narration.
   *
   * The timeline is the one place narration appears in a report, and it must be visibly
   * marked. An agent's claim rendered beside an observed exit code, in the same typeface,
   * is the agent-reporting-on-itself problem sneaking back in through the view layer.
   */
  tier: SignalTier
}

/**
 * Why a file's content can or cannot be shown — decided here, never in a renderer.
 *
 * ---------------------------------------------------------------------------
 * SIX STATES, BECAUSE "NO DIFF" WAS SECRETLY SIX THINGS — D-054
 * ---------------------------------------------------------------------------
 *
 * A renderer asking "do I have bytes to show?" gets a yes/no, and every no renders the
 * same: an empty pane. But the reasons are not the same, and the differences are the
 * entire product:
 *
 * - `available`     — we have both sides. Show the diff.
 * - `withheld`      — deliberately not read (`.env`, `id_rsa`). The event is real; the
 *                     bytes were never in our process. D-033.
 * - `oversized`     — larger than the snapshot bound. RF-10's territory.
 * - `binary`        — no readable diff exists. Disclose rather than omit.
 * - `never-captured`— no snapshot ref at all: the fs recorder saw the change and could not
 *                     read the file. **A real gap.**
 * - `blob-missing`  — a ref was recorded and the blob is GONE. Blobs are not hash-chained
 *                     precisely so they CAN be deleted (D-037, the remediation path), so
 *                     this is expected and must never look like "the file did not change".
 *
 * An empty pane for all six would tell the user the one thing that is false in every case:
 * that there was nothing to see.
 */
export type ContentAvailability =
  | 'available'
  | 'withheld'
  | 'oversized'
  | 'binary'
  | 'never-captured'
  | 'blob-missing'

export interface FileChange {
  /** The resolved path — what the system actually touched. Never shortened. */
  path: string
  /**
   * The path as a human reads it: relative to the project when it is inside it, and
   * absolute when it is NOT.
   *
   * A file outside the project keeps its full path, always — RF-07 exists to show blast
   * radius, and `../../.bashrc` shortened into something that looks local would erase the
   * fact. `path` stays exact regardless; this is only what to print.
   */
  display: string
  name: string
  inScope: boolean
  /** True when the last event for this path was a delete. */
  deleted: boolean
  /** How many write events touched it. */
  writes: number
  firstTs: string
  lastTs: string
  content: ContentAvailability
  /** One sentence explaining `content` when it is not `available`. The model's words. */
  contentNote?: string
  beforeRef?: string
  afterRef?: string
  eventIds: string[]
}

/**
 * Git, as observed — with `unknown` kept distinct from `clean` (D-047, D-053).
 *
 * `dirtyAtEnd: undefined` means we never got a readable answer out of git. It must not
 * render as an empty list, because an empty list is a measurement.
 */
export interface GitView {
  /** False when no git event was recorded at all — not a repo, or git was unreadable. */
  observed: boolean
  commits: Array<{ sha: string; branch?: string; ts: string; eventId: string }>
  branch?: string
  head?: string
  /** `undefined` = unknown. `[]` = measured clean. Never conflate them. */
  dirtyAtEnd?: string[]
}

/** One row of the session explorer. Same judgments as the full report, by construction. */
export interface SessionIndexRow {
  session: Session
  status: IntegrityStatus
  factsVerdict: FactsVerdict
  factCount: number
  closed: boolean
  filesChanged: number
  commands: number
}

/**
 * Session identity, read from the `session.start` event rather than the mutable table.
 * Captured when the record is built (record/build.ts); this is the record's field,
 * re-exported under the report model's historical name.
 */
export type ReportIdentity = RecordIdentity

/**
 * The 10-second answer, computed once — D-058.
 *
 * ---------------------------------------------------------------------------
 * TWO AXES, BECAUSE ONE NUMBER HIDES THE THING THAT MATTERS
 * ---------------------------------------------------------------------------
 *
 * A staff engineer opening this mid-incident needs two facts before anything else, and
 * they are independent:
 *
 *   - `finding`  — WHAT was observed to diverge. "2 divergences observed" / "No
 *     divergences observed" / "Record integrity broken".
 *   - `coverage` — HOW COMPLETE the evidence is. "Evidence complete" / "Evidence
 *     incomplete · 1 gap".
 *
 * Collapsing them into one status word ("DEGRADED") is what fails the 10-second test:
 * DEGRADED could mean "we found nothing but couldn't see everything" or "we found problems
 * AND couldn't see everything", and those demand different next moves. Kept apart, the
 * reader gets both in one glance: *what did you find* and *how much did you look at*.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY NEVER SAYS
 * ---------------------------------------------------------------------------
 *
 * Not "safe to merge". Not "looks good". LODESTAR observes what happened; it cannot know a
 * team's merge criteria, which untested refactors are acceptable, or the reviewer's risk
 * tolerance. A verdict that crosses from evidence into recommendation is the hallucinated
 * confidence the whole product exists to refuse (D-057). `finding` reports observation;
 * `coverage` reports completeness; neither reports a decision. The decision is the human's,
 * and this gives them the evidence to make it — nothing more.
 */
export type VerdictTone = 'ok' | 'warn' | 'bad'

export interface Verdict {
  finding: { text: string; tone: VerdictTone }
  /** Null when the record is BROKEN — coverage of an altered record is a meaningless number. */
  coverage: { text: string; tone: Exclude<VerdictTone, 'bad'> } | null
}

export interface SessionReport {
  session: Session
  /**
   * The content address of the Evidence Record this report was derived from — cite it,
   * compare it, verify an export against it. Two reports with one recordId are two
   * layouts of the same evidence (D-059).
   */
  recordId: string
  identity: ReportIdentity
  /** The dominant, two-axis answer. Both renderers show this; neither invents its own. */
  verdict: Verdict
  /**
   * False when no `session.end` event exists — the wrapper died, or the session is still
   * running. A record with no ending is not a record of a finished session, and the
   * difference is not cosmetic: everything after the last event is unobserved.
   */
  closed: boolean
  integrity: Integrity
  /** Empty is a valid answer. It means "no divergence was OBSERVED" — never "all clear". */
  facts: RealityFact[]
  /**
   * The same facts, prepared for a human: a title and an ordered chain of evidence.
   *
   * Renderers use this. `facts` stays for anything that wants the raw catalog form, and
   * the two cannot disagree — `views[i].fact` IS `facts[i]`, not a copy of it.
   */
  views: FactView[]
  /**
   * How a renderer must present `facts`. Switch on this; never on `facts.length` alone.
   *
   * `facts.length === 0` has two completely different meanings — "we looked and found
   * nothing" and "this record was rewritten, so the fact list means nothing" — and a
   * renderer reading the array cannot tell them apart.
   */
  factsVerdict: FactsVerdict
  /** Every event cited by `facts`, keyed by id. Renderers resolve pointers here. */
  evidence: Record<string, EvidenceEvent>
  /** What could not be determined. Read alongside `facts`, never instead of them. */
  limitations: string[]
  /** Where LODESTAR itself changed the outcome. Not the agent's failures (D-039). */
  interference: string[]
  /** Per-command shim coverage as MEASURED at session start. Empty means never probed. */
  coverage: CommandCoverage[]
  /** Recorder failures, from the record itself. Holes we know about. */
  recorderErrors: string[]
  timeline: TimelineEntry[]
  /** Every file the session touched, with the model's verdict on whether a diff exists. */
  changes: FileChange[]
  git: GitView
  counts: {
    events: number
    commands: number
    filesChanged: number
  }
}

function payloadOf<T>(e: LodestarEvent): T {
  return e.payload as T
}

/**
 * A path as a human reads it: relative to the project when it is inside it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS IN THE MODEL AND NOT A CSS `text-overflow`
 * ---------------------------------------------------------------------------
 *
 * Every evidence line rendered the full resolved path, which on a real session is
 * `C:\Users\madara\AppData\Local\Temp\claude\C--Users-…\live-demo\src\payments.mjs` — two
 * wrapped lines of noise around the four characters the reader wants. The signal was
 * `src/payments.mjs`, and it was buried.
 *
 * Truncating it in CSS would have been the wrong fix twice over: the terminal has no CSS,
 * so the two renderers would диverge, and an ellipsis hides which end was cut.
 *
 * **A file OUTSIDE the project keeps its absolute path**, always. That is not a display
 * preference — the whole point of RF-07 is blast radius, and `../../.bashrc` shortened
 * into something that looks local would erase the exact fact the reader needs. The
 * shortening applies only where it cannot mislead.
 */
function displayPath(path: string, cwd: string): string {
  if (!cwd || !path.startsWith(cwd)) return path
  const rel = path.slice(cwd.length).replace(/^[\\/]+/, '')
  // An empty remainder means the path IS the root; show it whole rather than as ''.
  return rel === '' ? path : rel.split('\\').join('/')
}

/**
 * One line for one event, in the neutral voice the Reality Facts Rule requires.
 *
 * Note what these never say: "failed", "broke", "forgot". `npm test exited with code 1`
 * is the same information without the accusation, and the accusation is the part that
 * would be wrong the first time we misread an event.
 */
function summarize(e: LodestarEvent, cwd = ''): string {
  const shown = (): string => displayPath(e.target?.resolved ?? '', cwd)
  switch (e.kind) {
    case 'process.exit': {
      const p = payloadOf<ProcessExitPayload>(e)
      if (p.signal) return `${p.command} was terminated by ${p.signal}`
      return `${p.command} exited with code ${p.exitCode ?? 'unknown'}`
    }
    case 'process.spawn':
      return `ran ${payloadOf<{ command: string }>(e).command}`
    case 'file.write': {
      const p = payloadOf<FileChangePayload>(e)
      const withheld = p.contentWithheld ? ` (content withheld: ${p.contentWithheld})` : ''
      return `wrote ${displayPath(e.target?.resolved ?? p.path, cwd)}${withheld}`
    }
    case 'file.delete':
      return `deleted ${shown()}`
    case 'file.read':
      return `read ${shown()}`
    case 'git.commit':
      return `committed ${payloadOf<{ sha?: string }>(e).sha ?? ''}`.trim()
    case 'git.ref_update':
      return `git HEAD moved`
    case 'git.status': {
      const dirty = payloadOf<{ dirtyAtEnd?: string[] }>(e).dirtyAtEnd ?? []
      return dirty.length
        ? `git working tree had ${dirty.length} uncommitted file(s)`
        : 'git working tree was clean'
    }
    case 'session.start':
      return 'session started'
    case 'session.end': {
      const p = payloadOf<{ exitCode: number | null }>(e)
      return `session ended (exit ${p.exitCode ?? 'unknown — killed by a signal'})`
    }
    case 'mission.stated':
      return 'mission stated'
    case 'net.request':
      return `network request to ${e.target?.resolved ?? 'unknown host'}`
    case 'agent.output':
      return 'agent output'
    default:
      return e.kind
  }
}

/**
 * The human headline for each catalog id.
 *
 * Every one is a description of what was observed. None is a conclusion about what it
 * means — that is the reader's job, and it is the only reason they can trust the rest.
 * See `FactView`.
 */
const FACT_TITLES: Record<RealityFact['id'], string> = {
  'RF-01': 'Command failed',
  'RF-02': 'Uncommitted work left behind',
  'RF-03': 'No test command observed',
  // NOT "Untested change": we know no test ran after it THAT WE COULD SEE. The shorter,
  // stronger word is a claim about coverage we cannot make. See D-056.
  'RF-04': 'Code changed after testing',
  'RF-05': 'File reverted',
  'RF-06': 'Process killed',
  'RF-07': 'Change outside the project',
}

/**
 * The sentence that closes each chain: what the observed steps mean *together*.
 *
 * Every one restates the gap between two observations. None reaches past them — "no test
 * run was observed after this change" is a fact about our record; "this code is untested"
 * would be a fact about the world, and we do not have it.
 */
const FACT_CONSEQUENCES: Partial<Record<RealityFact['id'], string>> = {
  'RF-04': 'No test run was observed after this change.',
  'RF-03': 'Nothing was observed to verify these changes.',
  'RF-06': 'The work may be half-complete.',
}

/**
 * The assumptions each fact rests on, attached to the fact — D-057, D-058.
 *
 * These moved here from `limitations()`, where they read as unrelated session-level
 * boilerplate. A caveat belongs on the conclusion it qualifies, revealed under "why do you
 * believe this?", not in a global list a reader has to connect back themselves.
 *
 * RF-04 is the only fact with a non-trivial trust root: its "after" is a filesystem-mtime
 * comparison. Everything else rests on the events directly — an exit code is an exit code,
 * a signal is a signal, a hash is a hash.
 */
const FACT_ASSUMPTIONS: Partial<Record<RealityFact['id'], string[]>> = {
  'RF-04': [
    'Ordering is by filesystem modification time versus the test run’s exit time. It is ' +
      'wrong if the system clock moved backward during the session, or if the filesystem ' +
      'records only coarse (second-granularity) modification times.',
    'Modification times can be set by any process, so they are evidence, not proof.',
  ],
}

/**
 * Turn a fact into an ordered chain a person can read at a glance.
 *
 * Steps are sorted by **occurrence** time, which for a file write means `mtimeMs` and not
 * the event's `ts` (D-044). RF-04's whole claim is a comparison of those two clocks, so a
 * timeline drawn from any other number could contradict the fact sitting above it.
 */
function viewOf(fact: RealityFact, byId: Map<string, LodestarEvent>, cwd: string): FactView {
  const observed: FactStep[] = []
  for (const ev of fact.evidence) {
    const e = byId.get(ev.eventId)
    if (!e) continue
    const mtime = (e.payload as FileChangePayload | undefined)?.mtimeMs
    const occurred =
      e.kind === 'file.write' && typeof mtime === 'number' ? new Date(mtime).toISOString() : e.ts
    observed.push({ state: 'observed', text: summarize(e, cwd), ts: occurred, eventSeq: e.seq })
  }
  const steps: FactStep[] = observed.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))

  const consequence = FACT_CONSEQUENCES[fact.id]
  if (consequence) steps.push({ state: 'consequence', text: consequence })

  return { fact, title: FACT_TITLES[fact.id], steps, assumptions: FACT_ASSUMPTIONS[fact.id] ?? [] }
}

// Coverage extraction, recorder errors, and the degradation list moved to
// record/build.ts (D-059): what makes evidence incomplete is a property of the
// evidence, computed once when the record is built, and read out of the record here.

/**
 * Every file the session touched, and whether its content can be shown.
 *
 * The availability verdict is computed HERE, once, so the terminal, the dashboard, and the
 * static export cannot disagree about why a diff is missing (D-054). A renderer that had
 * to decide this itself would have to re-implement D-033 (withheld), D-037 (blobs are
 * deletable), and the oversized/binary rules — three times, drifting three ways.
 *
 * `snapshots` is optional: without it we cannot know whether a blob still exists, so
 * `blob-missing` is not reachable and `available` means "a ref was recorded". With it, the
 * check is real. The report says which, rather than implying the stronger claim.
 */
function changesFromRecord(events: LodestarEvent[], cwd: string, snapshots?: SnapshotStore): FileChange[] {
  const byPath = new Map<string, FileChange>()

  for (const e of events) {
    if (e.kind !== 'file.write' && e.kind !== 'file.delete') continue
    const p = e.payload as FileChangePayload | undefined
    const path = e.target?.resolved ?? p?.path
    if (!path) continue

    const existing = byPath.get(path)
    const row: FileChange = existing ?? {
      path,
      // Shortened only when the file is genuinely inside the project. `displayPath`
      // enforces that; an out-of-scope path is returned whole.
      display: displayPath(path, cwd),
      name: path.split(/[\\/]/).pop() ?? path,
      inScope: e.target?.inScope === true,
      deleted: false,
      writes: 0,
      firstTs: e.ts,
      lastTs: e.ts,
      content: 'never-captured',
      eventIds: [],
    }

    row.lastTs = e.ts
    row.deleted = e.kind === 'file.delete'
    if (e.kind === 'file.write') row.writes++
    row.eventIds.push(e.id)

    // The LAST write's snapshot is the one a diff is drawn from — the session's net effect
    // on this file is `first before` → `last after`. `before` therefore comes from the
    // FIRST write we saw, and is not overwritten by later ones.
    if (e.kind === 'file.write') {
      if (!row.beforeRef && e.snapshotRef?.before) row.beforeRef = e.snapshotRef.before
      if (e.snapshotRef?.after) row.afterRef = e.snapshotRef.after

      const withheld = p?.contentWithheld
      if (withheld === 'sensitive') {
        row.content = 'withheld'
        row.contentNote =
          'This path is credential-shaped, so its contents were never read — not by the ' +
          'recorder, and not into the record. The change is real; the bytes are not here.'
      } else if (withheld === 'oversized') {
        row.content = 'oversized'
        row.contentNote =
          'Larger than the snapshot limit, so no content was stored. The change is ' +
          'recorded; the diff is not available.'
      } else if (withheld === 'unreadable') {
        row.content = 'never-captured'
        row.contentNote =
          'LODESTAR saw this file change and could not read it. This is a real gap in the ' +
          'record, not an empty diff.'
      } else if (p?.binary) {
        row.content = 'binary'
        row.contentNote = 'Binary file — there is no readable diff to show.'
      } else if (e.snapshotRef?.after || e.snapshotRef?.before) {
        row.content = 'available'
        delete row.contentNote
      }
    }

    byPath.set(path, row)
  }

  // A recorded ref whose blob is gone is NOT the same as no ref. Blobs are deletable on
  // purpose (D-037) — that is the remediation path when a secret lands in one — so this
  // state is expected, and it must never render as "no changes to show".
  if (snapshots) {
    for (const row of byPath.values()) {
      if (row.content !== 'available') continue
      const missing = [row.beforeRef, row.afterRef].filter(
        (r): r is string => typeof r === 'string' && !snapshots.has(r),
      )
      if (missing.length) {
        row.content = 'blob-missing'
        row.contentNote =
          'The content snapshot for this file is no longer in the blob store. Blobs are ' +
          'deletable by design (they are not hash-chained), so this is expected after a ' +
          'cleanup — but the diff cannot be shown.'
      }
    }
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** Git as observed. `dirtyAtEnd: undefined` is unknown and must survive as unknown. */
function gitFromRecord(events: LodestarEvent[]): GitView {
  const gitEvents = events.filter((e) => e.kind.startsWith('git.'))
  const view: GitView = {
    observed: gitEvents.length > 0,
    commits: events
      .filter((e) => e.kind === 'git.commit')
      .map((e) => {
        const p = payloadOf<{ sha?: string; branch?: string }>(e)
        return {
          sha: typeof p.sha === 'string' ? p.sha : (e.target?.resolved ?? 'unknown'),
          ...(typeof p.branch === 'string' ? { branch: p.branch } : {}),
          ts: e.ts,
          eventId: e.id,
        }
      }),
  }

  const status = [...events].reverse().find((e) => e.kind === 'git.status')
  if (status) {
    const p = payloadOf<{ dirtyAtEnd?: unknown; branch?: unknown; head?: unknown }>(status)
    if (typeof p.branch === 'string') view.branch = p.branch
    if (typeof p.head === 'string') view.head = p.head
    // Same guard as rf02 (D-053): only an ARRAY is a measurement. Anything else stays
    // `undefined`, which means unknown — never an empty list, which means clean.
    if (Array.isArray(p.dirtyAtEnd)) {
      view.dirtyAtEnd = p.dirtyAtEnd.filter((x): x is string => typeof x === 'string')
    }
  }

  return view
}

/**
 * The session explorer's rows.
 *
 * Deliberately built by running `buildReport` per session rather than by a cheaper query.
 * The list and the report must never disagree — a row saying VERIFIED next to a report
 * saying DEGRADED is exactly the two-renderers-two-answers failure D-049 exists to
 * prevent, and it would be a query optimisation that quietly redefines the word.
 *
 * O(n) chain verifications. Measured at 24 ms for a 2,000-event chain, and `limit`
 * defaults to 50, so the explorer is bounded by ~1s in the worst realistic case. If that
 * ever hurts, cache the result — do not recompute the status a second, cheaper way.
 */
export function buildIndex(store: SqliteEventStore, limit = 50): SessionIndexRow[] {
  return store
    .listSessions(limit)
    .map((s) => {
      const r = buildReport(store, s.id)
      if (!r) return null
      return {
        session: s,
        status: r.integrity.status,
        factsVerdict: r.factsVerdict,
        factCount: r.facts.length,
        closed: r.closed,
        filesChanged: r.counts.filesChanged,
        commands: r.counts.commands,
      }
    })
    .filter((x): x is SessionIndexRow => x !== null)
}

/**
 * The two sides of a file's content, for a renderer that wants to show a diff.
 *
 * Separate from `buildReport` because it reads the blob store, and the report must remain
 * buildable without one. The REASON a diff is unavailable is still the model's to state —
 * a renderer never invents that sentence.
 */
export type DiffView =
  | { kind: 'text'; before: string | null; after: string | null }
  | { kind: 'unavailable'; reason: string }

export function resolveDiff(change: FileChange, snapshots: SnapshotStore | null): DiffView {
  if (change.content !== 'available') {
    return {
      kind: 'unavailable',
      reason: change.contentNote ?? 'No content was captured for this file.',
    }
  }
  if (!snapshots) {
    return { kind: 'unavailable', reason: 'The snapshot store was not available to this report.' }
  }

  const read = (ref?: string): string | null => {
    if (!ref) return null
    const buf = snapshots.get(ref)
    return buf ? buf.toString('utf8') : null
  }

  // A ref that resolves to nothing is a missing blob, not an empty file. Returning `''`
  // here would render as "the file was emptied" — inventing a change out of a gap.
  if (change.beforeRef && !snapshots.has(change.beforeRef)) {
    return { kind: 'unavailable', reason: 'The "before" snapshot is no longer in the blob store.' }
  }
  if (change.afterRef && !snapshots.has(change.afterRef)) {
    return { kind: 'unavailable', reason: 'The "after" snapshot is no longer in the blob store.' }
  }

  return { kind: 'text', before: read(change.beforeRef), after: read(change.afterRef) }
}

export interface BuildOptions {
  /**
   * The blob store, when the caller has one.
   *
   * Without it, `blob-missing` cannot be detected, so `available` means "a ref was
   * recorded" rather than "the bytes are there". The weaker claim is the honest one when
   * we have not looked.
   */
  snapshots?: SnapshotStore
}

/**
 * The two-axis verdict, from the same three numbers the status is built from — D-058.
 *
 * `finding` is what diverged; `coverage` is how complete the evidence is. They are kept
 * separate on purpose (see `Verdict`), and neither is ever a recommendation.
 *
 * The finding tone is deliberately `ok` when zero divergences were observed **even if
 * evidence is incomplete** — the finding itself is genuinely clean; it is the coverage axis
 * that carries the incompleteness. Folding the incompleteness into the finding would say
 * "we found something" when we did not.
 */
function buildVerdict(status: IntegrityStatus, factCount: number, gapCount: number): Verdict {
  if (status === 'BROKEN') {
    return {
      finding: { text: 'Record integrity broken', tone: 'bad' },
      // Coverage of a record that was altered after it was written is a meaningless
      // measurement. Suppress it rather than report a number that implies the record is
      // partly trustworthy.
      coverage: null,
    }
  }

  const finding =
    factCount > 0
      ? { text: `${factCount} divergence${factCount === 1 ? '' : 's'} observed`, tone: 'warn' as const }
      : { text: 'No divergences observed', tone: 'ok' as const }

  const coverage =
    gapCount > 0
      ? { text: `Evidence incomplete · ${gapCount} gap${gapCount === 1 ? '' : 's'}`, tone: 'warn' as const }
      : { text: 'Evidence complete', tone: 'ok' as const }

  return { finding, coverage }
}

/**
 * Derive the presentation model from an Evidence Record.
 *
 * ---------------------------------------------------------------------------
 * THE RECORD JUDGES; THIS FILE ARRANGES — D-049 EXTENDED DOWNWARD, D-059
 * ---------------------------------------------------------------------------
 *
 * Every trust-bearing value in the returned report — facts, limitations, coverage,
 * integrity, closed — is read out of `record.evidence`, verbatim. What is computed here
 * is presentation prep only: fact titles and step chains, display paths, evidence
 * resolution, the timeline's one-line summaries, and the verdict's WORDING (the verdict's
 * inputs are the record's). A report derived from a live ledger and one derived from an
 * exported `.record.json` are therefore the same report, byte for byte.
 *
 * Tier note, preserved from the pre-record implementation (D-053): everything
 * trust-bearing was computed from groundTruth at the query. That gate now lives in
 * record/build.ts, once, where the record is built — `changes` and `git` below read the
 * record's events through the same groundTruth filter.
 */
export function reportFromRecord(record: EvidenceRecord, opts: BuildOptions = {}): SessionReport {
  const s = record.subject
  const session: Session = {
    id: s.sessionId,
    number: s.sessionNumber,
    runtimeId: s.runtimeId,
    mission: s.mission,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    exitCode: s.exitCode,
    cwd: s.cwd,
  }

  // The full observation list, every tier — the timeline shows narration too, clearly
  // labelled. The fact list in `record.evidence` was computed from groundTruth only.
  const events = record.observations.events
  const groundTruth = events.filter((e) => e.signalTier === 'groundTruth')

  const { facts, limitations, interference, coverage, recorderErrors, closed, integrity } =
    record.evidence

  const factsVerdict: FactsVerdict =
    integrity.status === 'BROKEN'
      ? 'record-untrustworthy'
      : facts.length
        ? 'divergences-observed'
        : 'none-observed'

  const verdict = buildVerdict(integrity.status, facts.length, integrity.degraded.length)

  const byId = new Map(events.map((e) => [e.id, e]))
  const cited = new Set(facts.flatMap((f) => f.evidence.map((ev) => ev.eventId)))

  const evidence: Record<string, EvidenceEvent> = {}
  for (const id of cited) {
    const e = byId.get(id)
    // A pointer with no event is not evidence. It should be impossible — facts are built
    // from these very events — so if it ever happens, the report must not paper over it.
    if (!e) continue
    evidence[id] = {
      eventId: e.id,
      seq: e.seq,
      ts: e.ts,
      kind: e.kind,
      source: e.source,
      ...(e.target?.resolved ? { target: e.target.resolved } : {}),
      summary: summarize(e, session.cwd),
    }
  }

  return {
    session,
    recordId: record.recordId,
    identity: record.identity,
    verdict,
    closed,
    integrity,
    facts,
    views: facts.map((f) => viewOf(f, byId, session.cwd)),
    factsVerdict,
    evidence,
    limitations,
    interference,
    coverage,
    recorderErrors,
    changes: changesFromRecord(groundTruth, session.cwd, opts.snapshots),
    git: gitFromRecord(groundTruth),
    timeline: events.map((e) => ({
      eventId: e.id,
      seq: e.seq,
      ts: e.ts,
      kind: e.kind,
      summary: summarize(e, session.cwd),
      cited: cited.has(e.id),
      tier: e.signalTier,
    })),
    counts: {
      events: events.length,
      commands: events.filter((e) => e.kind === 'process.exit').length,
      filesChanged: new Set(
        events
          .filter((e) => (e.kind === 'file.write' || e.kind === 'file.delete') && e.target)
          .map((e) => e.target!.resolved),
      ).size,
    },
  }
}

/**
 * Build the whole report for one session: build the Evidence Record from the ledger,
 * then derive the presentation model from it.
 *
 * Returns `null` only when the session does not exist. Every other failure state is a
 * value inside the report, because "we could not tell" is an answer this product owes the
 * user rather than an error it may throw at them.
 */
export function buildReport(
  store: SqliteEventStore,
  sessionId: string,
  opts: BuildOptions = {},
): SessionReport | null {
  const record = buildRecord(store, sessionId)
  return record ? reportFromRecord(record, opts) : null
}
