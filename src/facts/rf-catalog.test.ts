/**
 * RF-02, RF-03, RF-05, RF-06, RF-07 — the catalog that shipped without tests.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE FOR
 * ---------------------------------------------------------------------------
 *
 * These five facts were implemented and never tested. That is a worse position than
 * unimplemented: the code claims a capability, the report will print its output, and
 * nothing has ever checked that the output is true. RF-01 and RF-04 each earned their
 * tests by producing a live false positive first (D-043, D-044, D-045). The other five
 * have simply never been asked.
 *
 * Every fact here is tested from three directions, because a Reality Fact can fail in
 * three ways and only one of them is loud:
 *
 *   1. **Positive** — it fires when the evidence is there. (Loud when broken.)
 *   2. **Negative** — it stays silent when the evidence is not there. (A false positive:
 *      this is the failure that spends the company's credibility, per PRODUCT-SPEC §8 —
 *      "Target: zero. Any false positive is a bug, not a tuning problem.")
 *   3. **Unknown** — it stays silent when the evidence is MISSING rather than negative.
 *      (The quietest failure: "we could not see" rendered as "there was nothing to see".)
 *
 * The third is the one this product is actually about, so it gets the most tests.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE APPEND EVENTS DIRECTLY
 * ---------------------------------------------------------------------------
 *
 * `facts.test.ts` runs real processes and writes real files, and it should: it proves the
 * boundary observes reality. These are different — they pin the fact engine's reasoning
 * over a record, including records a real recorder would struggle to produce on demand (a
 * signal kill on Windows, a hash that returns to an earlier value, a write with no mtime).
 * The events are exactly the shape the recorders emit; `recorder.test.ts` is what proves
 * that shape is real.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { evaluate, limitations } from './index.js'
import type {
  EventKind,
  EventTarget,
  FileChangePayload,
  ProcessExitPayload,
  SnapshotRef,
} from '../types/events.js'

let dir: string
let db: ReturnType<typeof openDatabase>
let store: SqliteEventStore
let sessionId: string
let clock = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-rf-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  store = new SqliteEventStore(db)
  sessionId = store.createSession({ runtimeId: 'test', cwd: dir, mission: null }).id
  clock = 0
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Wall-clock for event N. Ordered, spaced a second apart, deterministic. */
const tsAt = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()

function append(input: {
  kind: EventKind
  payload: unknown
  target?: EventTarget
  snapshotRef?: SnapshotRef
  tier?: 'groundTruth' | 'narration'
}): string {
  const id = randomUUID()
  const draft = {
    id,
    sessionId,
    ts: tsAt(clock++),
    monotonicTs: clock * 1000,
    source: 'process' as const,
    signalTier: input.tier ?? ('groundTruth' as const),
    kind: input.kind,
    actor: { kind: 'agent' as const, runtimeId: 'test' },
    payload: input.payload,
    ...(input.target ? { target: input.target } : {}),
    ...(input.snapshotRef ? { snapshotRef: input.snapshotRef } : {}),
  }
  store.append(draft)
  return id
}

function exit(p: Partial<ProcessExitPayload> & { command: string; exitCode: number | null }): void {
  append({
    kind: 'process.exit',
    payload: { durationMs: 1, ...p } satisfies ProcessExitPayload,
    target: { raw: p.command, resolved: p.command, kind: 'process', inScope: true },
  })
}

function write(
  path: string,
  opts: { inScope?: boolean; mtimeMs?: number; before?: string; after?: string; withheld?: FileChangePayload['contentWithheld'] } = {},
): void {
  const payload: FileChangePayload = { path }
  if (opts.mtimeMs !== undefined) payload.mtimeMs = opts.mtimeMs
  if (opts.withheld) payload.contentWithheld = opts.withheld

  const snapshotRef: SnapshotRef = {}
  if (opts.before) snapshotRef.before = opts.before
  if (opts.after) snapshotRef.after = opts.after

  append({
    kind: 'file.write',
    payload,
    target: { raw: path, resolved: path, kind: 'file', inScope: opts.inScope ?? true },
    ...(opts.before || opts.after ? { snapshotRef } : {}),
  })
}

function gitStatus(dirtyAtEnd: string[]): void {
  append({
    kind: 'git.status',
    payload: { dirtyAtEnd, branch: 'main', head: 'abc123' },
    target: { raw: 'main', resolved: 'abc123', kind: 'ref', inScope: true },
  })
}

const factsOf = (id: string): string[] =>
  evaluate(store, sessionId)
    .filter((f) => f.id === id)
    .map((f) => f.statement)

// ===========================================================================
// RF-02 — session ended with an uncommitted working tree.
// ===========================================================================

describe('RF-02 — uncommitted working tree', () => {
  it('fires when git reports a dirty tree at session end', () => {
    gitStatus(['src/auth.ts', 'src/db.ts'])
    expect(factsOf('RF-02')).toEqual(['2 files were left uncommitted'])
  })

  it('names the file when exactly one is uncommitted', () => {
    gitStatus(['src/auth.ts'])
    // The singular case is worth a distinct sentence: with one file, the developer can act
    // on the name, and a bare count would make them go look it up.
    expect(factsOf('RF-02')).toEqual(['1 file was left uncommitted: src/auth.ts'])
  })

  it('stays silent on a MEASURED clean tree', () => {
    // `dirty: []` is a measurement: git was asked and said nothing is uncommitted.
    gitStatus([])
    expect(factsOf('RF-02')).toEqual([])
  })

  /**
   * The load-bearing distinction, and the reason `git.status` exists at all (D-047).
   *
   * No event means git was unreadable or this is not a repo. That is *unknown*, and it
   * must not become "clean" — a report saying "no uncommitted files" for a session where
   * we never read git is a lie told confidently.
   */
  it('claims nothing when git was never read — unknown is not clean', () => {
    write('src/auth.ts')
    exit({ command: 'npm test', exitCode: 0 })
    expect(factsOf('RF-02')).toEqual([])
  })

  it('reads the LAST status when several were recorded', () => {
    // A session that committed mid-way and then dirtied the tree again ends dirty. The
    // fact is about the state at the end, so the last measurement is the one that counts.
    gitStatus(['a.ts'])
    gitStatus([])
    expect(factsOf('RF-02')).toEqual([])

    gitStatus(['b.ts', 'c.ts'])
    expect(factsOf('RF-02')).toEqual(['2 files were left uncommitted'])
  })

  it('cites the git event as evidence', () => {
    gitStatus(['src/auth.ts'])
    const fact = evaluate(store, sessionId).find((f) => f.id === 'RF-02')!
    expect(fact.evidence).toHaveLength(1)
    expect(fact.evidence[0]!.source).toBe('git_state')
    expect(fact.evidence[0]!.eventId).toBeTruthy()
  })

  /**
   * Adversarial: narration cannot manufacture this fact.
   *
   * An agent that writes "dirtyAtEnd" into its own output must not be able to produce a
   * git fact. The tier filter is what stops it, and this proves the filter is load-bearing
   * rather than decorative.
   */
  it('ignores a git.status forged in the narration tier', () => {
    append({
      kind: 'git.status',
      payload: { dirtyAtEnd: ['forged.ts', 'also-forged.ts'] },
      tier: 'narration',
    })
    expect(factsOf('RF-02')).toEqual([])
  })
})

// ===========================================================================
// RF-03 — files modified, no test command observed.
// ===========================================================================

describe('RF-03 — no test command observed', () => {
  it('fires when files changed and the observed commands include no test', () => {
    exit({ command: 'npm install', exitCode: 0 })
    write('src/auth.ts')
    expect(factsOf('RF-03')).toEqual([
      '1 file(s) modified; no test command was observed in this session',
    ])
  })

  it('stays silent when a test command DID run', () => {
    exit({ command: 'npm test', exitCode: 0 })
    write('src/auth.ts')
    expect(factsOf('RF-03')).toEqual([])
  })

  it('stays silent when a test ran and failed — RF-01 owns that, not RF-03', () => {
    exit({ command: 'pytest', exitCode: 1 })
    write('src/auth.ts')
    // A test that ran and failed is not "no test ran". Firing here would report the same
    // session twice under two different claims, one of which is false.
    expect(factsOf('RF-03')).toEqual([])
  })

  it('stays silent when no files changed', () => {
    exit({ command: 'npm install', exitCode: 0 })
    expect(factsOf('RF-03')).toEqual([])
  })

  /**
   * THE GUARD. This is the most important test in the file.
   *
   * With zero process exits, LODESTAR saw no commands at all — a shadowed shim, or an
   * agent working outside the boundary. "No test ran" and "we could not see whether a
   * test ran" are opposite conclusions from identical silence, and merging them is exactly
   * the inference the Reality Facts Rule forbids.
   *
   * Deleting the guard at the top of `rf03()` passes every other test in this repo. It
   * fails this one.
   */
  it('claims NOTHING when no commands were observed at all — silence is not evidence', () => {
    write('src/auth.ts')
    write('src/db.ts')
    expect(factsOf('RF-03')).toEqual([])
  })

  it('declares the gap as a limitation instead of a fact when nothing was observed', () => {
    write('src/auth.ts')
    // The fact is withheld, so the ambiguity has to surface somewhere or it reads as
    // all-clear. This is the D-048 contract: a miss is declared, never silent.
    const notes = limitations(store, sessionId)
    expect(notes.some((n) => /No commands were observed/i.test(n))).toBe(true)
  })

  it('declares a limitation when commands ran but none looked like a test', () => {
    exit({ command: 'npm install', exitCode: 0 })
    write('src/auth.ts')
    const notes = limitations(store, sessionId)
    expect(
      notes.some((n) => /No test command was recognised/i.test(n) && /not evidence/i.test(n)),
    ).toBe(true)
  })

  it('ignores out-of-scope writes — RF-07 owns those', () => {
    exit({ command: 'npm install', exitCode: 0 })
    write('/tmp/scratch.ts', { inScope: false })
    expect(factsOf('RF-03')).toEqual([])
  })

  it('counts distinct files, not write events', () => {
    exit({ command: 'npm install', exitCode: 0 })
    write('src/auth.ts')
    write('src/auth.ts')
    write('src/db.ts')
    expect(factsOf('RF-03')).toEqual([
      '2 file(s) modified; no test command was observed in this session',
    ])
  })
})

// ===========================================================================
// RF-05 — a file was reverted to content it already had.
// ===========================================================================

describe('RF-05 — reverted content', () => {
  it('fires when content returns to a value it held earlier', () => {
    // A → B, then B → A. The second write's `after` is a hash this path already held.
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { before: 'hashB', after: 'hashA' })
    expect(factsOf('RF-05')).toEqual(['auth.ts was changed and then reverted to earlier content'])
  })

  it('does not fire on ordinary repeated edits — that is work, not churn', () => {
    // A → B → C → D. Every write is new content. Reporting this would cry wolf on every
    // session that edits a file more than once, which is every session.
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { before: 'hashB', after: 'hashC' })
    write('src/auth.ts', { before: 'hashC', after: 'hashD' })
    expect(factsOf('RF-05')).toEqual([])
  })

  it('does not fire on a no-op write where before equals after', () => {
    // Touching a file without changing it is not a revert. `before !== after` is the guard.
    write('src/auth.ts', { before: 'hashA', after: 'hashA' })
    expect(factsOf('RF-05')).toEqual([])
  })

  it('does not confuse two different files with the same history', () => {
    // Per-path history. A revert in auth.ts must not be attributed to db.ts, and identical
    // content in two files (a common template) must not read as a revert.
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/db.ts', { before: 'hashA', after: 'hashB' })
    expect(factsOf('RF-05')).toEqual([])
  })

  /**
   * Unknown stays unknown: a withheld snapshot cannot produce a fact.
   *
   * `.env` is never read (D-033), so its writes carry no `after` hash. RF-05 must not
   * treat a missing hash as a matching one — and must not treat it as a non-match it can
   * reason about either. It simply cannot see, and says nothing.
   */
  it('says nothing about a file whose content was withheld', () => {
    write('.env', { withheld: 'sensitive' })
    write('.env', { withheld: 'sensitive' })
    expect(factsOf('RF-05')).toEqual([])
  })

  it('says nothing about an oversized file it could not hash', () => {
    write('dump.sql', { before: 'hashA', withheld: 'oversized' })
    write('dump.sql', { withheld: 'oversized' })
    expect(factsOf('RF-05')).toEqual([])
  })

  /**
   * The false positive the `!after` guard actually prevents — found by mutation testing.
   *
   * Every other test here passes with `if (!after) continue` deleted, because the
   * `before !== after` check happens to absorb the common cases. This one does not, and it
   * is not exotic: a file with no baseline snapshot (unreadable) followed by a write whose
   * content is withheld (it grew oversized) is an ordinary Tuesday.
   *
   * Without the guard, the first write puts `undefined` into the path's history, the
   * second write finds `history.has(undefined)` true with a `before` of `hashA`, and
   * LODESTAR reports **"reverted to earlier content" for a file whose content it has never
   * read**. A fact fabricated entirely out of two absences.
   *
   * That is the exact failure this product exists to not commit, so it gets its own test
   * rather than relying on a neighbouring guard to catch it by accident.
   */
  it('never builds a revert out of two unknowns', () => {
    write('src/big.sql', { withheld: 'unreadable' }) // no hashes at all
    write('src/big.sql', { before: 'hashA', withheld: 'oversized' }) // before known, after not
    expect(factsOf('RF-05')).toEqual([])
  })

  it('does not fire when only the FIRST write is visible', () => {
    // Half a history is not a revert. Without the second `after`, there is nothing to
    // compare, and a fact built on the gap would be a guess.
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { withheld: 'unreadable' })
    expect(factsOf('RF-05')).toEqual([])
  })

  it('fires once per revert, not once per subsequent write', () => {
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { before: 'hashB', after: 'hashA' }) // revert
    write('src/auth.ts', { before: 'hashA', after: 'hashC' }) // moving on: not a revert
    expect(factsOf('RF-05')).toHaveLength(1)
  })

  it('ignores out-of-scope files', () => {
    write('/tmp/x.ts', { inScope: false, before: 'hashA', after: 'hashB' })
    write('/tmp/x.ts', { inScope: false, before: 'hashB', after: 'hashA' })
    expect(factsOf('RF-05')).toEqual([])
  })

  it('cites the write as evidence', () => {
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { before: 'hashB', after: 'hashA' })
    const fact = evaluate(store, sessionId).find((f) => f.id === 'RF-05')!
    expect(fact.evidence[0]!.source).toBe('file_write')
  })
})

// ===========================================================================
// RF-04 — the guard `facts.test.ts` does not reach.
//
// The timing behaviour is covered there (D-044). This is the adversarial edge: an
// `mtimeMs` that is not a number. The payload round-trips through JSON in SQLite, so
// "it is typed `number?`" is a statement about the compiler, not about the bytes.
// ===========================================================================

describe('RF-04 — a non-numeric mtime is not a measurement', () => {
  it('will not compare a string mtime, however convincing it looks', () => {
    exit({ command: 'npm test', exitCode: 0 })
    // `'99999999999999' > testEndedMs` coerces and evaluates TRUE in JavaScript. The
    // `typeof mtime !== 'number'` check is the only thing between that coercion and a
    // fabricated "modified after the last test run". A forged or corrupted event must
    // produce unknown, not a fact.
    append({
      kind: 'file.write',
      payload: { path: 'src/auth.ts', mtimeMs: '99999999999999' } as unknown as FileChangePayload,
      target: { raw: 'src/auth.ts', resolved: 'src/auth.ts', kind: 'file', inScope: true },
    })
    expect(factsOf('RF-04')).toEqual([])
  })

  it('declares the missing measurement as a limitation rather than dropping it silently', () => {
    exit({ command: 'npm test', exitCode: 0 })
    append({
      kind: 'file.write',
      payload: { path: 'src/auth.ts' } satisfies FileChangePayload,
      target: { raw: 'src/auth.ts', resolved: 'src/auth.ts', kind: 'file', inScope: true },
    })
    expect(factsOf('RF-04')).toEqual([])
    // Excluded, not assumed — and the exclusion is stated, or the silence reads as
    // "we checked and the file was not modified after the tests".
    expect(limitations(store, sessionId).some((n) => /no modification time/i.test(n))).toBe(true)
  })

  /**
   * D-057/D-058 — RF-04's trust root is disclosed, and it now lives ON the fact.
   *
   * The angry-customer question is "are your timestamps trustworthy?". The honest answer
   * is "yes, if the clock did not move backward and the filesystem is fine-grained" — and
   * that qualifier travels WITH the conclusion (as a fact-view assumption), not in a
   * distant session-level list where it reads as unrelated boilerplate. The assumptions
   * live on the report model, so this assertion moved to `report.test.ts`; the fact-engine
   * side simply must NOT emit the note into `limitations()` any more.
   */
  it('no longer floats the mtime caveat in the session-level limitations list', () => {
    const testTime = Date.UTC(2026, 0, 1, 12, 0, 0)
    exit({ command: 'npm test', exitCode: 0 })
    write('src/auth.ts', { mtimeMs: testTime + 60_000 })

    expect(factsOf('RF-04')).toEqual(['auth.ts modified after the last test run'])
    // The caveat is on the fact now (D-058), not here. `limitations()` keeps only
    // genuinely session-level gaps.
    expect(limitations(store, sessionId).some((n) => /clock did not move backward/i.test(n))).toBe(false)
  })
})

// ===========================================================================
// RF-06 — a process was killed by a signal.
// ===========================================================================

describe('RF-06 — terminated by a signal', () => {
  it('fires when a process was killed', () => {
    exit({ command: 'npm test', exitCode: null, signal: 'SIGKILL' })
    expect(factsOf('RF-06')).toEqual(['npm test was terminated by SIGKILL'])
  })

  it('does not fire on a clean exit', () => {
    exit({ command: 'npm test', exitCode: 0 })
    expect(factsOf('RF-06')).toEqual([])
  })

  it('does not fire on an ordinary failure', () => {
    // Exit 1 is a failure, not a kill. RF-01 owns it. Reporting both would describe one
    // event as two different things.
    exit({ command: 'npm test', exitCode: 1 })
    expect(factsOf('RF-06')).toEqual([])
  })

  /**
   * The RF-01/RF-06 split, asserted from both sides in one session.
   *
   * A signal kill is `exitCode: null` — NOT a non-zero exit. RF-01 must ignore it (a kill
   * is not a failure; the work is half-done, which is a different claim) and RF-06 must
   * report it. Neither may cover for the other.
   */
  it('is the ONLY fact a signal kill produces — RF-01 stays out of it', () => {
    exit({ command: 'npm test', exitCode: null, signal: 'SIGTERM' })
    const facts = evaluate(store, sessionId)
    expect(facts.map((f) => f.id)).toEqual(['RF-06'])
  })

  it('reports each killed process separately', () => {
    exit({ command: 'npm test', exitCode: null, signal: 'SIGTERM' })
    exit({ command: 'cargo test', exitCode: null, signal: 'SIGKILL' })
    expect(factsOf('RF-06')).toEqual([
      'npm test was terminated by SIGTERM',
      'cargo test was terminated by SIGKILL',
    ])
  })

  it('fires for a non-test command too — this is not about tests', () => {
    exit({ command: 'docker build .', exitCode: null, signal: 'SIGKILL' })
    expect(factsOf('RF-06')).toEqual(['docker build . was terminated by SIGKILL'])
  })

  it('does not fire when the signal field is absent', () => {
    // exitCode null with no signal: we know the process ended and not why. Naming a
    // signal we never observed would be inventing evidence.
    exit({ command: 'npm test', exitCode: null })
    expect(factsOf('RF-06')).toEqual([])
  })
})

// ===========================================================================
// RF-07 — modifications outside the project scope.
// ===========================================================================

describe('RF-07 — out-of-scope modification', () => {
  it('fires when a file outside the project is written', () => {
    write('/home/dev/.bashrc', { inScope: false })
    expect(factsOf('RF-07')).toEqual(['/home/dev/.bashrc was modified, outside the project directory'])
  })

  it('does not fire for in-scope writes', () => {
    write('src/auth.ts', { inScope: true })
    expect(factsOf('RF-07')).toEqual([])
  })

  it('fires on an out-of-scope DELETE and cites it as a delete', () => {
    append({
      kind: 'file.delete',
      payload: { path: '/home/dev/notes.md' } satisfies FileChangePayload,
      target: { raw: '/home/dev/notes.md', resolved: '/home/dev/notes.md', kind: 'file', inScope: false },
    })
    const fact = evaluate(store, sessionId).find((f) => f.id === 'RF-07')!
    expect(fact.statement).toBe('/home/dev/notes.md was modified, outside the project directory')
    expect(fact.evidence[0]!.source).toBe('file_delete')
  })

  it('reports one fact per path, not per write', () => {
    write('/home/dev/.bashrc', { inScope: false })
    write('/home/dev/.bashrc', { inScope: false })
    write('/home/dev/.zshrc', { inScope: false })
    expect(factsOf('RF-07')).toHaveLength(2)
  })

  /**
   * Unknown scope is not out-of-scope.
   *
   * `inScope` is computed at capture from the resolved path (context.ts). An event with no
   * target has no scope determination at all — and `undefined` must not read as `false`.
   * The check is `=== false` for exactly this reason; `!e.target?.inScope` would accuse
   * the agent of a blast-radius breach on an event we never scoped.
   */
  it('says nothing about an event whose scope was never determined', () => {
    append({ kind: 'file.write', payload: { path: 'mystery.ts' } satisfies FileChangePayload })
    expect(factsOf('RF-07')).toEqual([])
  })

  it('reports the resolved path, never the raw one', () => {
    // The whole product is "what the system actually touched", not what the agent typed.
    append({
      kind: 'file.write',
      payload: { path: '~/.bashrc' } satisfies FileChangePayload,
      target: { raw: '~/.bashrc', resolved: '/home/dev/.bashrc', kind: 'file', inScope: false },
    })
    expect(factsOf('RF-07')).toEqual(['/home/dev/.bashrc was modified, outside the project directory'])
  })

  it('ignores an out-of-scope READ — reading is not modifying', () => {
    append({
      kind: 'file.read',
      payload: { path: '/etc/hosts' } satisfies FileChangePayload,
      target: { raw: '/etc/hosts', resolved: '/etc/hosts', kind: 'file', inScope: false },
    })
    expect(factsOf('RF-07')).toEqual([])
  })
})

// ===========================================================================
// D-053 — the adversarial audit's findings, each pinned.
//
// Every case below was CONFIRMED against a real store before the guard existed. These
// are not hypotheticals: the comments quote the measured output.
//
// The theme: `payload` round-trips through JSON in SQLite, so a TypeScript type is a
// claim about the compiler, not about the bytes. RF-04 and RF-06 had the check. RF-01
// and RF-02 — the two facts a user reads first — did not.
// ===========================================================================

describe('D-053 — a payload type is not a measurement', () => {
  describe('RF-01', () => {
    /**
     * Measured before the fix: `"npm test exited with code undefined"`.
     *
     * The old test was `exitCode !== null && exitCode !== 0`, and `undefined` passes both.
     * A failure invented out of a field that was never recorded — unknown collapsing into
     * a claim, on the headline fact.
     */
    it('does not invent a failure from a MISSING exit code', () => {
      append({
        kind: 'process.exit',
        payload: { command: 'npm test', durationMs: 1 } as unknown as ProcessExitPayload,
        target: { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true },
      })
      expect(factsOf('RF-01')).toEqual([])
    })

    /**
     * Measured before the fix: `"npm test exited with code 0"` — reported as a DIVERGENCE.
     *
     * A successful run, rendered as a failure, in a self-contradicting sentence. `'0'` is
     * not `0`, so the old check saw a non-zero exit code.
     */
    it('does not report a successful run as a divergence because the code was a string', () => {
      append({
        kind: 'process.exit',
        payload: { command: 'npm test', exitCode: '0', durationMs: 1 } as unknown as ProcessExitPayload,
        target: { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true },
      })
      expect(factsOf('RF-01')).toEqual([])
    })

    it('does not treat a boolean exit code as a verdict', () => {
      append({
        kind: 'process.exit',
        payload: { command: 'npm test', exitCode: false, durationMs: 1 } as unknown as ProcessExitPayload,
        target: { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true },
      })
      expect(factsOf('RF-01')).toEqual([])
    })

    /**
     * A verdict-less last run does not resolve an earlier, real failure.
     *
     * `resolved` was `last.p.exitCode === 0`. A last run that was KILLED is not a pass —
     * we never saw the command succeed — so the earlier failure must still stand,
     * unqualified. Anything else lets "unknown" cancel observed evidence (D-045).
     */
    it('a killed re-run does not resolve an earlier failure', () => {
      exit({ command: 'npm test', exitCode: 1 })
      exit({ command: 'npm test', exitCode: null, signal: 'SIGKILL' })
      expect(factsOf('RF-01')).toEqual(['npm test exited with code 1'])
    })
  })

  describe('RF-02', () => {
    /**
     * Measured before the fix: `"11 files were left uncommitted"`.
     *
     * `dirtyAtEnd: 'src/auth.ts'` is 11 characters long, and nothing checked
     * `Array.isArray`. A fabricated number, stated with high confidence.
     */
    it('does not count the characters of a string as files', () => {
      append({ kind: 'git.status', payload: { dirtyAtEnd: 'src/auth.ts', branch: 'main' } })
      expect(factsOf('RF-02')).toEqual([])
    })

    /**
     * Measured before the fix: no fact, no limitation — byte-identical to a clean tree.
     *
     * `?? []` turned a MISSING field into an empty array, which this fact treats as
     * "measured clean". The three states were held apart for a missing EVENT and quietly
     * merged for a missing FIELD.
     */
    it('does not read a git.status with no dirtyAtEnd as a clean tree', () => {
      append({ kind: 'git.status', payload: { branch: 'main', head: 'abc123' } })
      expect(factsOf('RF-02')).toEqual([])
      // Silence is not enough: the ambiguity has to surface, or it reads as all-clear.
      expect(limitations(store, sessionId).some((n) => /could not be read/i.test(n) && /not a clean tree/i.test(n))).toBe(true)
    })

    it('ignores non-string entries rather than counting them', () => {
      append({ kind: 'git.status', payload: { dirtyAtEnd: ['a.ts', 42, null, 'b.ts'], branch: 'main' } })
      expect(factsOf('RF-02')).toEqual(['2 files were left uncommitted'])
    })
  })

  describe('a test that reached no verdict', () => {
    /**
     * THE WORST ONE. Measured before the fix: **zero facts and zero limitations.**
     *
     * `npm test` with `exitCode: null` and no signal: RF-01 skips it (not a number),
     * RF-06 skips it (no signal), RF-03 treats it as "a test ran" and stays quiet, and
     * `limitations()` took the `else if` branch and said nothing. A completely silent,
     * clean-looking report for a session whose only test produced no result.
     *
     * And it was agent-reachable with no forgery at all: start a test, kill it.
     */
    it('is declared, not silently treated as a test that ran', () => {
      exit({ command: 'npm test', exitCode: null })
      write('src/auth.ts', { mtimeMs: 5000 })

      // RF-03 must not fire: a test command WAS observed, so "no test command was
      // observed" would be a false statement.
      expect(factsOf('RF-03')).toEqual([])
      // But the session must not be silent about it.
      const notes = limitations(store, sessionId)
      expect(notes.some((n) => /no exit code/i.test(n) && /no verdict/i.test(n))).toBe(true)
    })

    it('does not anchor RF-04 to a test run that never finished', () => {
      // A killed test is not a test result, so a later write cannot be "stale relative to"
      // it — there is nothing to be stale against. Same reasoning as WATCH_MODE.
      exit({ command: 'npm test', exitCode: null, signal: 'SIGKILL' })
      write('src/auth.ts', { mtimeMs: Date.UTC(2030, 0, 1) })
      expect(factsOf('RF-04')).toEqual([])
    })

    it('still anchors RF-04 to the last COMPLETED test when a later one was killed', () => {
      // The completed run at t=0 is a real verdict. The kill afterwards does not erase it,
      // and the write after both is genuinely untested. Evidence is not deleted by later
      // unknowns (D-045).
      const testTime = Date.UTC(2026, 0, 1, 0, 0, 0)
      exit({ command: 'npm test', exitCode: 0 })
      exit({ command: 'npm test', exitCode: null, signal: 'SIGKILL' })
      write('src/auth.ts', { mtimeMs: testTime + 60_000 })
      expect(factsOf('RF-04')).toEqual(['auth.ts modified after the last test run'])
    })

    it('a killed test still produces RF-06 — the kill itself is observed', () => {
      exit({ command: 'npm test', exitCode: null, signal: 'SIGKILL' })
      expect(factsOf('RF-06')).toEqual(['npm test was terminated by SIGKILL'])
    })
  })

  describe('an unreadable event', () => {
    /**
     * Measured before the fix: `THREW: Cannot read properties of undefined (reading 'trim')`
     *
     * One malformed `process.exit` took down `evaluate()`, which took down the entire
     * report — every unrelated fact in the session lost. That inverts the contract stated
     * in `run.ts`: LODESTAR degrades loudly, it does not fail closed and silent.
     */
    it('does not throw and take the whole report with it', () => {
      append({ kind: 'process.exit', payload: { exitCode: 1, durationMs: 1 } }) // no command
      append({ kind: 'process.exit', payload: null })
      exit({ command: 'npm run build', exitCode: 1 })

      // The readable failure still reports. The unreadable events do not stop it.
      expect(factsOf('RF-01')).toEqual(['npm run build exited with code 1'])
    })

    it('is declared as a hole rather than dropped in silence', () => {
      append({ kind: 'process.exit', payload: { exitCode: 1, durationMs: 1 } })
      expect(limitations(store, sessionId).some((n) => /could not be read/i.test(n) && /unknown rather than absent/i.test(n))).toBe(true)
    })

    /**
     * A corrupt event must not satisfy RF-03's "we saw some commands" guard.
     *
     * If it did, an unreadable payload would be enough to unlock the accusation "files
     * modified; no test command was observed" in a session where we in fact observed
     * nothing we could read.
     */
    it('does not unlock RF-03 by counting as an observed command', () => {
      append({ kind: 'process.exit', payload: { exitCode: 1, durationMs: 1 } })
      write('src/auth.ts')
      expect(factsOf('RF-03')).toEqual([])
    })

    it('does not let a truthy non-signal produce RF-06', () => {
      append({
        kind: 'process.exit',
        payload: { command: 'npm test', exitCode: null, signal: true, durationMs: 1 } as unknown as ProcessExitPayload,
        target: { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true },
      })
      // Would have rendered "npm test was terminated by true".
      expect(factsOf('RF-06')).toEqual([])
    })
  })
})

// ===========================================================================
// Cross-fact: the facts must not interfere with each other.
// ===========================================================================

describe('the catalog as a whole', () => {
  it('produces every applicable fact for one session, ordered by time', () => {
    exit({ command: 'npm install', exitCode: 0 })
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { before: 'hashB', after: 'hashA' }) // RF-05
    write('/home/dev/.bashrc', { inScope: false }) // RF-07
    exit({ command: 'docker build .', exitCode: null, signal: 'SIGKILL' }) // RF-06
    exit({ command: 'npm run build', exitCode: 1 }) // RF-01
    gitStatus(['src/auth.ts']) // RF-02

    const ids = evaluate(store, sessionId).map((f) => f.id)
    // RF-03 must NOT be here: a test never ran, but RF-03 is about a session with no test
    // command — and it fires only when files changed, which they did. It should fire.
    expect(new Set(ids)).toEqual(new Set(['RF-01', 'RF-02', 'RF-03', 'RF-05', 'RF-06', 'RF-07']))

    // Sorted by timestamp: the report reads as a story, not a shuffled list.
    const timestamps = evaluate(store, sessionId).map((f) => f.ts)
    expect([...timestamps].sort()).toEqual(timestamps)
  })

  it('an empty session produces no facts and no false comfort', () => {
    expect(evaluate(store, sessionId)).toEqual([])
    // Nothing observed, nothing written: there is genuinely nothing to disclose.
    expect(limitations(store, sessionId)).toEqual([])
  })

  it('every fact carries at least one evidence pointer', () => {
    exit({ command: 'npm run build', exitCode: 1 })
    write('src/auth.ts', { before: 'hashA', after: 'hashB' })
    write('src/auth.ts', { before: 'hashB', after: 'hashA' })
    write('/home/dev/.bashrc', { inScope: false })
    exit({ command: 'docker build .', exitCode: null, signal: 'SIGKILL' })
    gitStatus(['src/auth.ts'])

    const facts = evaluate(store, sessionId)
    expect(facts.length).toBeGreaterThan(0)
    // PRODUCT-SPEC §4, bar 4: evidence-linked, no exceptions. A fact without a pointer is
    // an assertion, and this product does not make assertions.
    for (const f of facts) expect(f.evidence.length).toBeGreaterThan(0)
  })

  it('narration cannot produce a single fact, no matter how it is shaped', () => {
    // Every fact-bearing event kind, forged in the narration tier by an agent trying to
    // write its own report. The tier filter in `factInputs()` is the only thing standing
    // here, and it must hold for all of them.
    append({ kind: 'process.exit', payload: { command: 'npm test', exitCode: 1, durationMs: 1 }, tier: 'narration' })
    append({ kind: 'git.status', payload: { dirtyAtEnd: ['x.ts'] }, tier: 'narration' })
    append({
      kind: 'file.write',
      payload: { path: '/etc/passwd' },
      target: { raw: '/etc/passwd', resolved: '/etc/passwd', kind: 'file', inScope: false },
      tier: 'narration',
    })
    expect(evaluate(store, sessionId)).toEqual([])
  })
})
