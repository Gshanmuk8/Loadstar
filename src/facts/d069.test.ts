/**
 * D-069 — watch mode, clock regression, and the injective RF-01 key.
 *
 * ---------------------------------------------------------------------------
 * THREE WAYS THE HEADLINE FACTS COULD SAY MORE THAN THE EVIDENCE
 * ---------------------------------------------------------------------------
 *
 * Each test here reproduces, as a minimal record, a failure an external review named:
 *
 *   1. `npm run test:watch` made RF-03 announce "no test command was observed" about a
 *      session in which one visibly was — a false statement on an ordinary command.
 *   2. RF-04 *assumed* the wall clock never moved backward while every event already
 *      carried the two clocks needed to *measure* it.
 *   3. RF-01's group key `cwd + ' ' + command` was not injective, so a real failure in
 *      one directory could be "resolved" by a pass in another.
 *
 * These are mutation tests in the practical sense: revert any one of the three fixes in
 * `index.ts` (use `isTestCommand` in RF-03's guard; delete the `clockRegression` gate;
 * put the space back in the group key) and the corresponding test fails.
 *
 * Everything runs through the PURE entry points (`evaluateEvents`, `limitationsEvents`)
 * over hand-built events, because what is pinned is the engine's *reasoning*, not the
 * boundary — `facts.test.ts` proves the boundary observes reality.
 */

import { describe, expect, it } from 'vitest'
import {
  clockRegression,
  evaluateEvents,
  limitationsEvents,
  isTestCommand,
  isTestShapedCommand,
} from './index.js'
import type { LodestarEvent, ProcessExitPayload } from '../types/events.js'

// ---------------------------------------------------------------------------
// Minimal, clock-consistent event fixtures. Wall and monotonic advance together
// (1 s per event) unless a test explicitly breaks one of them — which is the point.
// ---------------------------------------------------------------------------

const tsAt = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()

function session(...builders: Array<(seq: number) => LodestarEvent>): LodestarEvent[] {
  return builders.map((b, i) => b(i + 1))
}

const exit =
  (p: Partial<ProcessExitPayload> & { command: string; exitCode: number | null }) =>
  (seq: number): LodestarEvent => ({
    id: `e${seq}`,
    seq,
    sessionId: 's1',
    ts: tsAt(seq),
    monotonicTs: seq * 1000,
    // The chain fields are not what is under test — no fact reads them. Real hashing is
    // pinned by the store and vector tests.
    prevHash: `hash-${seq - 1}`,
    hash: `hash-${seq}`,
    source: 'process',
    signalTier: 'groundTruth',
    kind: 'process.exit',
    actor: { kind: 'agent', runtimeId: 'test' },
    payload: { durationMs: 1, ...p },
  })

const write =
  (path: string, opts: { mtimeMs?: number } = {}) =>
  (seq: number): LodestarEvent => ({
    id: `e${seq}`,
    seq,
    sessionId: 's1',
    ts: tsAt(seq),
    monotonicTs: seq * 1000,
    prevHash: `hash-${seq - 1}`,
    hash: `hash-${seq}`,
    source: 'fs',
    signalTier: 'groundTruth',
    kind: 'file.write',
    actor: { kind: 'agent', runtimeId: 'test' },
    target: { raw: path, resolved: path, kind: 'file', inScope: true },
    payload: { path, ...(opts.mtimeMs !== undefined ? { mtimeMs: opts.mtimeMs } : {}) },
  })

const rf = (events: LodestarEvent[], id: string): string[] =>
  evaluateEvents(events)
    .filter((f) => f.id === id)
    .map((f) => f.statement)

// ===========================================================================
// Issue 1 — a watcher is an observed test command with no observable verdict.
// ===========================================================================

describe('D-069 issue 1 — RF-03 must not call an observed watcher "no test command"', () => {
  it('holds the two predicates apart: shape vs completed-run candidate', () => {
    // The old bug in one line: RF-03's statement is about OBSERVATION, and its guard
    // used the completed-run predicate. These two must never merge again.
    expect(isTestShapedCommand('npm run test:watch')).toBe(true)
    expect(isTestCommand('npm run test:watch')).toBe(false)
  })

  it('an observed watcher silences RF-03 — the statement would be false', () => {
    const events = session(
      exit({ command: 'npm run test:watch', exitCode: null }),
      write('src/auth.ts', { mtimeMs: Date.parse(tsAt(2)) }),
    )
    // A test command WAS observed. "No test command was observed" is a false statement,
    // and the engine must be structurally unable to make it here.
    expect(rf(events, 'RF-03')).toEqual([])
  })

  it('states the exact split: a test command WAS observed, no completed run was', () => {
    const events = session(
      exit({ command: 'npm run test:watch', exitCode: null }),
      write('src/auth.ts', { mtimeMs: Date.parse(tsAt(2)) }),
    )
    const notes = limitationsEvents(events)

    const watchNote = notes.find((n) => /watch-mode test command was observed/i.test(n))
    expect(watchNote).toBeDefined()
    expect(watchNote).toMatch(/no\s+completed test run was/i)
    // Both halves of the honesty discipline, in the note itself: absence of a verdict is
    // evidence of neither skipping nor passing.
    expect(watchNote).toMatch(/not evidence that testing was skipped/i)
    expect(watchNote).toMatch(/not\s+evidence that the tests passed/i)

    // And the generic "no test command was recognised" note must NOT appear — one was.
    expect(notes.some((n) => /no test command was recognised/i.test(n))).toBe(false)
  })

  it('a watcher does not anchor RF-04 — there is no completed run to be stale against', () => {
    const events = session(
      exit({ command: 'npm run test:watch', exitCode: 0 }),
      write('src/auth.ts', { mtimeMs: Date.parse(tsAt(2)) }),
    )
    expect(rf(events, 'RF-04')).toEqual([])
  })

  it('a completed run beside a watcher behaves as a completed run', () => {
    const events = session(
      exit({ command: 'npm run test:watch', exitCode: null }),
      exit({ command: 'npm test', exitCode: 0 }),
      write('src/auth.ts', { mtimeMs: Date.parse(tsAt(3)) }),
    )
    // The completed run anchors RF-04; the watcher neither blocks it nor triggers the
    // watch-only disclosure, because a verdict WAS observed.
    expect(rf(events, 'RF-04')).toEqual(['auth.ts modified after the last test run'])
    expect(limitationsEvents(events).some((n) => /watch-mode/i.test(n))).toBe(false)
  })

  it('control: with no test-shaped command at all, RF-03 still fires', () => {
    const events = session(
      exit({ command: 'npm run build', exitCode: 0 }),
      write('src/auth.ts', { mtimeMs: Date.parse(tsAt(2)) }),
    )
    expect(rf(events, 'RF-03')).toEqual([
      '1 file(s) modified; no test command was observed in this session',
    ])
  })
})

// ===========================================================================
// Issue 2 — a backward wall-clock step is measured, and RF-04 sits out.
// ===========================================================================

describe('D-069 issue 2 — the clock is measured before RF-04 trusts it', () => {
  /** A session whose wall clock steps back `stepMs` between the test and the write. */
  function regressed(stepMs: number): LodestarEvent[] {
    const a = exit({ command: 'npm test', exitCode: 0 })(1)
    const b = write('src/auth.ts', { mtimeMs: Date.parse(a.ts) + 60_000 })(2)
    // Monotonic advances 1 s; the wall clock reads `stepMs` earlier than that allows.
    b.ts = new Date(Date.parse(a.ts) + 1000 - stepMs).toISOString()
    return [a, b]
  }

  it('detects a backward step from the two clocks — measured, not assumed', () => {
    const r = clockRegression(regressed(30_000))
    expect(r).not.toBeNull()
    expect(r!.atSeq).toBe(2)
    expect(r!.driftMs).toBe(-30_000)
  })

  it('RF-04 refuses to evaluate over a session with a measured backward step', () => {
    // Without the gate this session yields "auth.ts modified after the last test run" —
    // a wall-derived ordering stated over a wall clock known to be broken.
    expect(rf(regressed(30_000), 'RF-04')).toEqual([])
  })

  it('declares the gap instead of leaving silence', () => {
    const notes = limitationsEvents(regressed(30_000))
    const note = notes.find((n) => /wall clock moved backward/i.test(n))
    expect(note).toBeDefined()
    expect(note).toMatch(/RF-04/)
    expect(note).toMatch(/not\s+evaluated/i)
  })

  it('control: the same session without the step fires RF-04 and no note', () => {
    const a = exit({ command: 'npm test', exitCode: 0 })(1)
    const b = write('src/auth.ts', { mtimeMs: Date.parse(a.ts) + 60_000 })(2)
    expect(rf([a, b], 'RF-04')).toEqual(['auth.ts modified after the last test run'])
    expect(limitationsEvents([a, b]).some((n) => /clock moved backward/i.test(n))).toBe(false)
  })

  it('a step inside the tolerance stays an assumption, not a measurement', () => {
    // Ordinary clock granularity and scheduling noise must not read as an anomaly —
    // RF-04 crying wolf on every session is the other way to spend credibility.
    expect(clockRegression(regressed(1000))).toBeNull()
    expect(rf(regressed(1000), 'RF-04')).toHaveLength(1)
  })

  it('a FORWARD jump is not a regression — only backward breaks the ordering claim', () => {
    // NTP forward resync, laptop suspend: wall leaps ahead of monotonic. RF-04's
    // "write after test" comparison survives that direction.
    const a = exit({ command: 'npm test', exitCode: 0 })(1)
    const b = write('src/auth.ts', { mtimeMs: Date.parse(a.ts) + 3_600_000 + 60_000 })(2)
    b.ts = new Date(Date.parse(a.ts) + 3_600_000).toISOString()
    expect(clockRegression([a, b])).toBeNull()
    expect(rf([a, b], 'RF-04')).toHaveLength(1)
  })
})

// ===========================================================================
// Issue 3 — the RF-01 group key is injective.
// ===========================================================================

describe('D-069 issue 3 — a pass in one directory cannot resolve a failure in another', () => {
  it('cwd "/a b" + command "c" does not collide with cwd "/a" + command "b c"', () => {
    // With the old space-separated key both runs landed in one group, last-run-wins,
    // and the real failure was reported as resolved. The two must stay two histories.
    const events = session(
      exit({ command: 'c', exitCode: 1, cwd: '/a b' }),
      exit({ command: 'b c', exitCode: 0, cwd: '/a' }),
    )
    const facts = rf(events, 'RF-01')
    expect(facts).toEqual(['c exited with code 1'])
    // Not "then passed on a later run" — nothing that happened in /a resolves /a b.
    expect(facts[0]).not.toMatch(/then passed/)
  })

  it('the same command in two directories keeps two histories — D-043 still holds', () => {
    const events = session(
      exit({ command: 'npm test', exitCode: 1, cwd: '/repo/packages/api' }),
      exit({ command: 'npm test', exitCode: 0, cwd: '/repo/packages/web' }),
    )
    expect(rf(events, 'RF-01')).toEqual(['npm test exited with code 1'])
  })

  it('control: a genuine re-run in the SAME directory still resolves', () => {
    const events = session(
      exit({ command: 'npm test', exitCode: 1, cwd: '/repo' }),
      exit({ command: 'npm test', exitCode: 0, cwd: '/repo' }),
    )
    expect(rf(events, 'RF-01')).toEqual([
      'npm test exited with code 1, then passed on a later run',
    ])
  })
})
