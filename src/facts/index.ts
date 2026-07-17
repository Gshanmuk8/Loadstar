/**
 * LODESTAR — the Reality Facts engine.
 *
 * Implements RF-01 through RF-07 of the catalog in PRODUCT-SPEC.md §4.
 *
 * **RF-08, RF-09 and RF-10 are catalogued and NOT implemented** — network egress,
 * destructive git operations, and binary/oversized files. The `RealityFact['id']` union
 * stops at RF-07 deliberately, so a fact cannot claim an id this engine does not compute.
 * The evidence for RF-08 (`net.request`) and RF-10 (`contentWithheld: 'oversized'`) is
 * already being recorded; the facts over them are not written. See D-051 — that gap is a
 * decision, not an oversight, and the docs must not imply otherwise.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, ENFORCED HERE IN CODE
 * ---------------------------------------------------------------------------
 *
 * Facts are computed from `signalTier: 'groundTruth'` ONLY. `factInputs()` is the sole
 * entry point and it filters at the query, so narration is not reachable from this
 * module — a contributor cannot accidentally build a claim-parsing fact, because the
 * data is not here to parse. See DECISIONS.md D-009.
 *
 *   GOOD:  "npm test exited with code 1"     source: process_exit    confidence: high
 *   BAD:   "Agent reported tests failed"     source: agent_message   confidence: low
 *
 * The second form is not "lower quality". It is banned. This module cannot produce it.
 */

import type { FileChangePayload, LodestarEvent, ProcessExitPayload } from '../types/events.js'
import type { SqliteEventStore } from '../storage/event-store.js'

/** Where a fact's evidence came from. There is no `agent_message` member, by design. */
export type EvidenceSource = 'process_exit' | 'file_write' | 'git_state' | 'file_delete'

/**
 * Confidence in a fact.
 *
 * `high` is the only level this engine currently emits, because every fact it produces
 * is a deterministic reading of an observed event. The type admits lower levels so that
 * a future fact resting on inference must *declare* that it does — not so that weak
 * facts can be smuggled in beside strong ones.
 */
export type Confidence = 'high' | 'medium' | 'low'

export interface Evidence {
  source: EvidenceSource
  /** The event this fact is derived from. A fact with no event is not a fact. */
  eventId: string
  eventSeq: number
  ts: string
}

export interface RealityFact {
  /** Catalog id — PRODUCT-SPEC.md §4. */
  id: 'RF-01' | 'RF-02' | 'RF-03' | 'RF-04' | 'RF-05' | 'RF-06' | 'RF-07'
  /** Neutral statement of observed state. Never a characterization of the agent. */
  statement: string
  confidence: Confidence
  ts: string
  evidence: Evidence[]
}

/**
 * Every fact id this engine evaluates — the engine's declared coverage.
 *
 * The Evidence Record carries this list (`evidence.catalog`) so that an empty fact
 * list is interpretable years later: "RF-01 through RF-07 were evaluated and none
 * fired" is a measurement; an empty array with no catalog is a shrug. RF-08/09/10 are
 * catalogued in PRODUCT-SPEC.md and deliberately NOT here (D-051) — a record must not
 * imply they were checked.
 */
export const FACT_CATALOG: readonly RealityFact['id'][] = [
  'RF-01',
  'RF-02',
  'RF-03',
  'RF-04',
  'RF-05',
  'RF-06',
  'RF-07',
]

/**
 * The only way facts read the record.
 *
 * Narration is unreachable from here. This is the Reality Facts Rule as an interface,
 * not a comment.
 */
function factInputs(store: SqliteEventStore, sessionId: string): LodestarEvent[] {
  return store.query({ sessionId, signalTier: 'groundTruth' })
}

/**
 * The same gate, for callers that hold events instead of a store.
 *
 * The Evidence Record builder computes facts from an event array (D-059), and the rule
 * must hold there identically: this filters to `groundTruth` at the entry, so the pure
 * path is exactly as narration-proof as the store path. Every `...Events` entry point
 * below goes through here — a fact function never receives an unfiltered array.
 */
function factInputsOf(events: LodestarEvent[]): LodestarEvent[] {
  return events.filter((e) => e.signalTier === 'groundTruth')
}

function evidenceOf(e: LodestarEvent, source: EvidenceSource): Evidence {
  return { source, eventId: e.id, eventSeq: e.seq, ts: e.ts }
}

/**
 * Test-shaped commands, matched on the resolved command string — not on intent.
 *
 * ---------------------------------------------------------------------------
 * ANCHORED, BROADER, AND HONEST ABOUT WHAT IT CANNOT SEE — D-048
 * ---------------------------------------------------------------------------
 *
 * The old pattern was unanchored (`\b(npm|...)\s+test\b`), so **`echo npm test` and
 * `cat npm test.log` matched** — and `make test`, `tox`, `gradle test`, `dotnet test`
 * and `mvn test` did not. A miss produced NO FACT, SILENTLY: a Python shop on `tox` got
 * zero RF-03/RF-04 coverage and was never told.
 *
 * Two fixes, and the second matters more than the first:
 *
 * 1. **Anchored at the start** of the command, so a test runner has to *be* the command
 *    rather than appear inside one. Broadened to the runners people actually use.
 * 2. **A miss is now declared, not silent.** `limitations()` reports when no test command
 *    was observed, so "no fact" stops being ambiguous between "the tests were fine" and
 *    "we never saw a test".
 *
 * ---------------------------------------------------------------------------
 * WHY EACH MATCHER NAMES ITS RUNNERS — D-050
 * ---------------------------------------------------------------------------
 *
 * D-048 left this as a bare list of regexes and a comment promising the runners were
 * "reconciled" with `SHIMMED_COMMANDS`. They were not: `bun`, `nox`, and `ctest` were
 * matched here and shimmed nowhere, so those three branches were exactly the dead code
 * D-048 was written to delete — a matcher recognising commands the boundary cannot see.
 *
 * The list could not hold the invariant because nothing checked it. So the binaries are
 * now *data* rather than an implementation detail buried in an alternation, and
 * `shims.test.ts` asserts `TEST_RUNNERS ⊆ SHIMMED_COMMANDS`. Adding a runner to a pattern
 * without making it observable now fails the build instead of quietly producing silence.
 *
 * **Known limit, stated rather than fixed:** `python[0-9.]*` matches `python3.11 -m
 * pytest`, but only `python` and `python3` are shimmed — a versioned interpreter runs
 * unobserved. The pattern is harmless (it only ever sees commands we already recorded)
 * and shimming every possible `pythonX.Y` is guesswork. This is a coverage gap, and the
 * probe reports it as one.
 */
interface TestMatcher {
  /** The binaries this pattern needs observable. Must all be in `SHIMMED_COMMANDS`. */
  readonly runners: readonly string[]
  readonly pattern: RegExp
}

const TEST_MATCHERS: readonly TestMatcher[] = [
  { runners: ['npm', 'pnpm', 'yarn', 'bun'], pattern: /^(npm|pnpm|yarn|bun)\s+(run\s+)?test(:\S+)?\b/i },
  { runners: ['pytest', 'tox', 'nox'], pattern: /^(pytest|tox|nox)\b/i },
  { runners: ['python', 'python3'], pattern: /^python[0-9.]*\s+-m\s+(pytest|unittest|tox)\b/i },
  { runners: ['go'], pattern: /^go\s+test\b/i },
  { runners: ['cargo'], pattern: /^cargo\s+test\b/i },
  { runners: ['gradle', 'gradlew'], pattern: /^(\.\/)?(gradle|gradlew)(\.bat)?\s+.*\btest\b/i },
  { runners: ['mvn'], pattern: /^mvn\s+.*\b(test|verify)\b/i },
  { runners: ['make'], pattern: /^make\s+.*\btest\b/i },
  { runners: ['dotnet'], pattern: /^dotnet\s+test\b/i },
  { runners: ['ctest'], pattern: /^ctest\b/i },
]

/**
 * Every binary the test matcher can recognise.
 *
 * Exported so the invariant is testable from `shims.ts`'s side: what this engine claims to
 * recognise, the recorder must be able to observe.
 */
export const TEST_RUNNERS: readonly string[] = [
  ...new Set(TEST_MATCHERS.flatMap((m) => m.runners)),
]

/**
 * A watcher is not a completed test run.
 *
 * `npm run test:watch` matches the shape above and never terminates with a verdict, so
 * treating it as "the last test run" would date RF-04 against a run that never finished.
 */
const WATCH_MODE = /(--watch\b|:watch\b|\bwatch:|--ui\b)/i

/**
 * Was a test-SHAPED command observed at all — watch mode included?
 *
 * ---------------------------------------------------------------------------
 * TWO QUESTIONS THAT MUST NEVER MERGE — D-069
 * ---------------------------------------------------------------------------
 *
 * "Was a test command observed?" and "Was a COMPLETED test run observed?" are
 * different questions, and RF-03 conflated them: `npm run test:watch` failed the
 * completed-run predicate below, so RF-03 announced "no test command was observed"
 * about a session in which one visibly was. A false statement, produced by the
 * evidence engine, on an ordinary command.
 *
 * This predicate answers the first question (shape only); `isTestCommand` answers
 * the second (shape minus watchers). RF-03's guard uses THIS one — an observed
 * watcher silences the fact, and `limitations()` states exactly what remains
 * unknown: a test command was observed; no completed verdict was.
 */
export function isTestShapedCommand(command: string): boolean {
  return TEST_MATCHERS.some((m) => m.pattern.test(command.trim()))
}

/**
 * Is this command a completed-test-run CANDIDATE (test-shaped and not a watcher)?
 *
 * Exported for the matcher tests. A missed match must never render as "no failure" — see
 * `limitations()`, which is what makes a miss visible instead of silent.
 */
export function isTestCommand(command: string): boolean {
  const c = command.trim()
  if (WATCH_MODE.test(c)) return false
  return isTestShapedCommand(c)
}

/**
 * Detectable backward wall-clock movement — the RF-04 assumption turned into a
 * measurement where the record permits it (D-069, Issue 2).
 *
 * Every event carries BOTH clocks: `ts` (wall) and `monotonicTs` (milliseconds
 * since session start, immune to NTP). Between adjacent events, wall-elapsed minus
 * monotonic-elapsed is the wall clock's drift over that span; a large negative
 * value is a backward step — measured, not assumed. RF-04 refuses to run over a
 * session where one was detected (its entire claim is a wall-derived ordering),
 * and `limitations()` says so.
 *
 * The tolerance bounds what stays an assumption: steps smaller than this hide
 * inside ordinary clock granularity and scheduling noise, and the RF-04 assumption
 * text says exactly that. Bigger claims than the measurement supports are not made.
 */
const CLOCK_REGRESSION_TOLERANCE_MS = 1500

export interface ClockRegression {
  /** The event whose wall clock is impossibly earlier than its predecessor's. */
  atSeq: number
  /** Negative: how far the wall clock stepped back relative to the monotonic clock. */
  driftMs: number
}

export function clockRegression(events: LodestarEvent[]): ClockRegression | null {
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1]!
    const b = events[i]!
    const wall = Date.parse(b.ts) - Date.parse(a.ts)
    if (!Number.isFinite(wall)) continue
    const drift = wall - (b.monotonicTs - a.monotonicTs)
    if (drift < -CLOCK_REGRESSION_TOLERANCE_MS) return { atSeq: b.seq, driftMs: drift }
  }
  return null
}

/**
 * A `process.exit` payload this engine can actually reason about.
 *
 * ---------------------------------------------------------------------------
 * THE TYPE IS A CLAIM ABOUT THE COMPILER, NOT ABOUT THE BYTES — D-053
 * ---------------------------------------------------------------------------
 *
 * This used to be a bare `as ProcessExitPayload` cast. Payloads round-trip through JSON
 * in SQLite, so the cast asserts a shape that nothing has checked — and the facts built on
 * it inherited that fiction. Measured, on a real store, before this guard existed:
 *
 *   payload { command: 'npm test', durationMs: 1 }   →  "npm test exited with code undefined"
 *   payload { command: 'npm test', exitCode: '0' }   →  "npm test exited with code 0"   (!)
 *   payload { exitCode: 1, durationMs: 1 }           →  THREW, killing the whole report
 *
 * The second line is the one to look at: a **successful** run, reported as a divergence,
 * because `'0' !== 0`. The first invents a failure out of a missing field. Both are the
 * unknown-collapsing-into-a-claim failure this product exists to prevent, committed by the
 * headline fact.
 *
 * RF-04 already had this guard (`typeof mtime !== 'number'`) and RF-06 already had it
 * (`p.signal` must be present). RF-01 and RF-02 never got it. That asymmetry is the whole
 * bug: the discipline was applied where someone happened to think of it.
 *
 * A payload that fails this check is **not evidence** — but it is also not nothing. It is
 * declared by `limitations()` rather than silently skipped, because a record we cannot
 * parse is a hole, and holes get stated.
 */
function exitPayload(e: LodestarEvent): ProcessExitPayload | null {
  if (e.kind !== 'process.exit') return null
  const p = e.payload as ProcessExitPayload | null | undefined
  if (!p || typeof p !== 'object') return null
  // `command` is the only field every downstream fact reads unconditionally. Without a
  // string here, `command.trim()` throws and takes the entire report with it.
  if (typeof p.command !== 'string') return null
  return p
}

/** True for a `process.exit` event whose payload cannot be read. A hole, not an absence. */
function isMalformedExit(e: LodestarEvent): boolean {
  return e.kind === 'process.exit' && exitPayload(e) === null
}

/**
 * Did this execution reach a verdict, and what was it?
 *
 * Three states, and the third is the point. `exitCode` is `number | null` in the schema:
 * a number is the OS's verdict, and anything else — `null` from a signal kill, a missing
 * field, a JSON string — is **no verdict at all**.
 *
 * Collapsing `none` into either `pass` or `fail` is how a killed test became "the tests
 * ran" and a missing field became "exited with code undefined". Every caller here must
 * handle all three.
 */
type Verdict = 'pass' | 'fail' | 'none'

function verdictOf(p: ProcessExitPayload): Verdict {
  if (typeof p.exitCode !== 'number') return 'none'
  return p.exitCode === 0 ? 'pass' : 'fail'
}

/**
 * A test run that finished and produced a verdict.
 *
 * `isTestCommand()` matches the command STRING. It says nothing about whether the run
 * completed — so a `npm test` killed by SIGKILL counted as "the tests ran", which
 * suppressed RF-03 and made RF-04 anchor "the last test run" to a run that never
 * finished. An agent could buy silence on RF-03 by starting a test and killing it.
 *
 * This is exactly the reasoning behind `WATCH_MODE` above — *"a watcher never terminates
 * with a verdict, so it is not a completed test run"* — applied to the case that reaches
 * the same end by a different route. A test that did not finish is not a test that ran.
 */
function isCompletedTestRun(e: LodestarEvent): boolean {
  const p = exitPayload(e)
  if (!p || !isTestCommand(p.command)) return false
  return verdictOf(p) !== 'none'
}

/**
 * RF-01 — a command exited non-zero and was not subsequently re-run successfully.
 *
 * The headline fact. Note what it does NOT do: it never claims the agent said anything
 * about tests. It reports that a process exited 1. The developer draws the conclusion.
 * That inversion is what makes the fact unfalsifiable and free of claim-parsing.
 *
 * The "not re-run successfully" clause matters — an agent that fails a test, fixes it,
 * and passes has not left a failure behind, and reporting one would be crying wolf.
 */
function rf01(events: LodestarEvent[]): RealityFact[] {
  const facts: RealityFact[] = []

  const exits = events
    .map((e) => ({ e, p: exitPayload(e) }))
    .filter((x): x is { e: LodestarEvent; p: ProcessExitPayload } => x.p !== null)

  // ---------------------------------------------------------------------------
  // GROUPED BY COMMAND *AND CWD* — D-043
  // ---------------------------------------------------------------------------
  //
  // The key was `command.trim()` alone. In a monorepo an agent runs `npm test` in
  // `packages/api` (exit 1) and then in `packages/web` (exit 0) — one group, last run
  // wins, and the api failure was silently deleted. Two directories are two histories.
  //
  // cwd was observed at spawn all along and thrown away before exit. We could see it; the
  // schema dropped it.
  const byCommand = new Map<string, Array<{ e: LodestarEvent; p: ProcessExitPayload }>>()
  for (const x of exits) {
    // NUL-separated (D-069, Issue 3): a space separator made cwd "/a b" + command "c"
    // collide with cwd "/a" + command "b c" - one group, last-run-wins, and a real
    // failure in one directory resolvable by a pass in another. NUL cannot appear in
    // either field, so the key is injective.
    const key = `${x.p.cwd ?? ''}\u0000${x.p.command.trim()}`
    const list = byCommand.get(key) ?? []
    list.push(x)
    byCommand.set(key, list)
  }

  // ---------------------------------------------------------------------------
  // A LATER SUCCESS NO LONGER DELETES AN EARLIER FAILURE — D-045
  // ---------------------------------------------------------------------------
  //
  // The rule used to be "take the last run; if it passed, report nothing". That is what
  // made the C2 forgery work: last-write-wins, and an attacker writes last. One appended
  // `npm test exit 0` erased a real failure while the chain still verified.
  //
  // The vulnerability was never the forgery — it was the CANCELLATION. So evidence is no
  // longer removed by later evidence; it is contextualised by it. A run that failed and
  // was later fixed is reported as exactly that: `failed, then passed on re-run`.
  //
  // This inverts the attack. A forged pass now appends a line that *contradicts a visible
  // failure*, which is louder than the failure alone — instead of silently deleting it.
  //
  // It also keeps D-025 honest: fix-then-pass no longer cries wolf, because the statement
  // says it was resolved rather than raising an unqualified alarm.
  const failures = [...byCommand.values()]
    .map((runs) => {
      // `verdictOf`, not `exitCode !== null && exitCode !== 0` (D-053). The old test let
      // a MISSING exitCode through — `undefined !== null` — and reported "exited with code
      // undefined": a failure invented out of an absent field.
      const failed = runs.filter((r) => verdictOf(r.p) === 'fail')
      if (!failed.length) return null
      const last = runs[runs.length - 1]!
      // Only a real `pass` resolves a failure. A last run with no verdict — killed, or
      // unreadable — leaves the earlier failure standing, because we did not observe it
      // being fixed. Unknown must not resolve anything.
      const resolved = verdictOf(last.p) === 'pass'
      // Anchor on the LAST failure: it is the most recent divergence, and its evidence is
      // what a developer would open first.
      return { ...failed[failed.length - 1]!, resolved, runs: runs.length }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const failedExecIds = new Set(
    failures.map((f) => f.p.execId).filter((id): id is string => Boolean(id)),
  )

  // Ancestry index, built only from what was observed.
  const parentOf = new Map<string, string>()
  for (const x of exits) {
    if (x.p.execId && x.p.parentExecId) parentOf.set(x.p.execId, x.p.parentExecId)
  }

  for (const last of failures) {
    const subsumedBy = failingAncestor(last.p, parentOf, failedExecIds)
    if (subsumedBy) continue

    facts.push({
      id: 'RF-01',
      statement: last.resolved
        ? `${last.p.command} exited with code ${last.p.exitCode}, then passed on a later run`
        : `${last.p.command} exited with code ${last.p.exitCode}`,
      confidence: 'high',
      ts: last.e.ts,
      evidence: [
        evidenceOf(last.e, 'process_exit'),
        // Descendants that failed underneath this command corroborate it rather than
        // competing with it. Attaching them keeps the causal chain in the record.
        ...failingDescendants(last.p, failures, parentOf).map((d) =>
          evidenceOf(d.e, 'process_exit'),
        ),
      ],
    })
  }

  return facts
}

/**
 * The nearest ancestor of this execution that also failed, if any.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ANCESTRY AND NOT DEDUPLICATION — D-025, D-034
 * ---------------------------------------------------------------------------
 *
 * `npm test` running `node` produces two true, independently-observed failures for one
 * cause, and reporting both is crying wolf. The tempting fix is to dedupe by timestamp
 * proximity or command similarity — and that is guessing. A fact built on a guess is
 * precisely what the Reality Facts Rule bans, so the noise had to be fixed with evidence
 * instead.
 *
 * `parentExecId` is not inferred: the parent shim minted its own id and published it into
 * the environment before exec'ing, so the child recorded its parent **as observed at the
 * moment of the spawn, by the party that performed it**. Walking that chain is reading
 * the record, not interpreting it.
 *
 * The rule: a failure with a failing ancestor is *subsumed* by it. `npm test exited 1`
 * is the fact a developer can act on; the `node` beneath it is how npm arrived there, and
 * it is attached as evidence rather than raised as a second alarm.
 *
 * **A failure whose ancestor SUCCEEDED still stands on its own.** `npm test || true`
 * genuinely failed, and the parent swallowing it does not unmake that. Suppressing it
 * would be inferring intent from an exit code.
 *
 * **Unknown ancestry means no suppression.** A shadowed shim records no `parentExecId`,
 * and absence must never be read as "no parent" — so the fact reports. Over-reporting is
 * a nuisance; silently dropping a real failure because we could not see the tree is a
 * lie. The asymmetry decides it.
 *
 * ---------------------------------------------------------------------------
 * A CYCLE MUST NOT SUPPRESS ANYTHING — found by the adversarial tests
 * ---------------------------------------------------------------------------
 *
 * The first version searched for a failing ancestor *while* walking. Two ways to hide a
 * real failure fell out of that, both reachable from a record an agent partly influences:
 *
 *   - **Self-parent.** An event with `execId === parentExecId` matched itself on the very
 *     first hop and suppressed its own fact. One forged field, one silenced failure.
 *   - **Cycle.** With `a→b→c→a`, every node found a failing "ancestor" and *all three*
 *     facts disappeared.
 *
 * So the chain is now walked to its root **before** any suppression is considered, and a
 * cycle anywhere in it means ancestry is not evidence — we fall back to unknown, and
 * unknown reports. That is the same asymmetry as everywhere else here: a corrupted record
 * may cost us a duplicate, and must never cost us a failure.
 *
 * The walk terminates because `seen` grows on every hop over a finite graph.
 */
function failingAncestor(
  p: ProcessExitPayload,
  parentOf: Map<string, string>,
  failedExecIds: Set<string>,
): string | null {
  // Seeding `seen` with self is what makes a self-parent a cycle rather than a match.
  const seen = new Set<string>(p.execId ? [p.execId] : [])
  const chain: string[] = []

  let cursor = p.parentExecId
  while (cursor) {
    if (seen.has(cursor)) return null // cycle: forged or corrupted, not evidence
    seen.add(cursor)
    chain.push(cursor)
    cursor = parentOf.get(cursor)
  }

  // Nearest first: the innermost failing ancestor is the one that subsumes this failure.
  for (const id of chain) if (failedExecIds.has(id)) return id
  return null
}

/** Failures that descend from this execution — the causal chain beneath a reported fact. */
function failingDescendants(
  p: ProcessExitPayload,
  failures: Array<{ e: LodestarEvent; p: ProcessExitPayload }>,
  parentOf: Map<string, string>,
): Array<{ e: LodestarEvent; p: ProcessExitPayload }> {
  if (!p.execId) return []
  const rootId = p.execId

  return failures.filter((f) => {
    if (!f.p.execId || f.p.execId === rootId) return false
    let cursor = f.p.parentExecId
    const seen = new Set<string>()
    let hops = 0
    while (cursor && hops++ <= parentOf.size) {
      if (seen.has(cursor)) return false
      seen.add(cursor)
      if (cursor === rootId) return true
      cursor = parentOf.get(cursor)
    }
    return false
  })
}

/**
 * RF-04 — files modified after the last test run.
 *
 * Deterministic, needs no claim-parsing, and a stronger signal than most claim-based
 * checks: the tests genuinely did not cover the final state of these files.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST ROOT IS FILESYSTEM mtime, AND ITS ASSUMPTIONS ARE STATED — D-057
 * ---------------------------------------------------------------------------
 *
 * "After" is `write.mtimeMs > testExit.ts`, both wall-clock on this machine (D-044). This
 * comment used to claim the opposite — *"ordering comes from `seq`, never from wall
 * clocks"* — which was true of the ORIGINAL implementation and false of this one. A
 * function whose header contradicts its body is how a reviewer reasons wrongly with full
 * confidence, so the header now describes the code that actually runs.
 *
 * The measurement rests on three assumptions, none of which RF-04 can verify, all of which
 * `limitations()` now discloses whenever this fact fires:
 *
 *   1. The wall clock did not move BACKWARD between the test exit and the write. An NTP
 *      resync mid-session breaks this with no adversary present — `mtimeMs` is real time,
 *      `testEvent.ts` is the clock reading we captured at exit, and if the clock jumped
 *      back between them the comparison inverts.
 *   2. mtime resolution is fine-grained. On coarse-mtime filesystems (some network mounts,
 *      FAT) a write a fraction of a second BEFORE the test can round up to after it.
 *   3. Nobody called `utimes()`/`touch` to backdate the file. That one is T3 (a hostile
 *      same-user actor), out of scope per THREAT-MODEL — but the honest framing is that
 *      RF-04 trusts mtime, and mtime is forgeable by the party it observes.
 *
 * These do not make RF-04 wrong; they make it a measurement with a stated domain. A trust
 * product that hides the domain of its measurement is giving false confidence politely.
 */
function rf04(events: LodestarEvent[]): RealityFact[] {
  // The clock this fact reasons with is MEASURED before it is trusted (D-069): a
  // detected backward wall-clock step makes every wall-derived ordering in this
  // session unreliable, so RF-04 is not evaluated — the gap is declared by
  // `limitations()`, and unknown stays unknown rather than becoming a fact.
  if (clockRegression(events)) return []

  // A COMPLETED run, not merely a test-shaped command (D-053). Anchoring on a test that
  // was killed dates every subsequent write against a run that never produced a verdict —
  // "modified after the last test run" implies there was a test result to be stale
  // against, and there was not.
  const lastTestIdx = findLastIndex(events, isCompletedTestRun)
  if (lastTestIdx === -1) return []

  const testEvent = events[lastTestIdx]!
  const testEndedMs = Date.parse(testEvent.ts)

  // ---------------------------------------------------------------------------
  // "AFTER" IS MEASURED, NOT INFERRED FROM APPEND ORDER — D-044
  // ---------------------------------------------------------------------------
  //
  // This used to be `events.slice(lastTestIdx + 1)` — everything appended after the test
  // event. `seq` orders OBSERVATIONS, and the fs recorder observes late on purpose: it
  // waits 120 ms for writes to settle (`awaitWriteFinish`) and then hashes the file
  // before emitting, while process events emit immediately.
  //
  // So fs events are systematically back-dated in `seq`, and the single most common thing
  // an agent does — edit a file, then run the tests — produced:
  //
  //   seq=3  process.exit  node -e ...     ← recorded first
  //   seq=4  file.write    auth.ts         ← HAPPENED first, recorded 83ms later
  //
  // and RF-04 announced "auth.ts modified after the last test run". False, on the most
  // ordinary sequence there is, with no adversary present. The comment above this function
  // said ordering "comes from seq, never from wall clocks" — technically true and
  // substantively wrong, because seq was never the clock that mattered.
  //
  // `mtimeMs` is when the OS says the write happened. Both it and `testEvent.ts` come from
  // the same wall clock on the same machine, so comparing them is a measurement rather
  // than an inference.
  //
  // A write with NO mtime is not assumed to be after — unknown stays unknown, and a fact
  // built on a missing field would be exactly the guess this rule exists to forbid.
  const written = events.filter((e) => {
    if (e.kind !== 'file.write' || !e.target?.inScope) return false
    const mtime = (e.payload as FileChangePayload | undefined)?.mtimeMs
    if (typeof mtime !== 'number' || !Number.isFinite(testEndedMs)) return false
    return mtime > testEndedMs
  })

  if (!written.length) return []

  // One fact per file: a developer acts on files, not on counts.
  const byPath = new Map<string, LodestarEvent>()
  for (const e of written) {
    const p = e.target!.resolved
    if (!byPath.has(p)) byPath.set(p, e)
  }

  return [...byPath.entries()].map(([path, e]) => ({
    id: 'RF-04' as const,
    statement: `${basename(path)} modified after the last test run`,
    confidence: 'high' as const,
    ts: e.ts,
    evidence: [evidenceOf(e, 'file_write'), evidenceOf(testEvent, 'process_exit')],
  }))
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i
  return -1
}

/**
 * Commands LODESTAR itself refused to run, in this session.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS REPORTED AND NOT USED TO SUPPRESS — D-039, D-041
 * ---------------------------------------------------------------------------
 *
 * When LODESTAR refuses a command it exits 126. The parent (`npm run check`) inherits
 * that, exits non-zero, and RF-01 reports the parent as the agent's failure — satisfying
 * all four Reality Facts rules while being a false accusation.
 *
 * The tempting fix is to walk the ancestry and suppress the parent's fact. **We
 * deliberately do not.** `parentExecId` comes from `LODESTAR_EXEC_ID`, an environment
 * variable the agent controls (D-041). Suppression driven by an agent-controlled value is
 * a mechanism for hiding failures: an agent can *trigger* a refusal on purpose (any
 * `%VAR%` argument will do), then forge `parentExecId` on its real failing command and
 * make the fact vanish. That is the same mistake D-034 made, and it is worse than the
 * problem it solves.
 *
 * So interference is surfaced *alongside* the facts, never subtracted from them. The
 * developer sees both the failure and the reason it may not be theirs, and no
 * agent-controlled value can remove anything from the record.
 */
export function interference(store: SqliteEventStore, sessionId: string): string[] {
  return interferenceEvents(factInputs(store, sessionId))
}

/** Pure form of `interference`, for callers holding events (the record builder). */
export function interferenceEvents(events: LodestarEvent[]): string[] {
  return factInputsOf(events)
    .filter((e) => e.kind === 'agent.output')
    .map((e) => e.payload as { lodestarInterference?: boolean; command?: string; reason?: string })
    .filter((p) => p?.lodestarInterference === true)
    .map((p) => `LODESTAR refused to run '${p.command}' (${p.reason}). ` +
      `A parent command failing because of this is not the agent's failure.`)
}

/**
 * RF-02 — the session ended with an uncommitted working tree.
 *
 * Evidence: `git.status`, read from git by the recorder at session end. Not the agent's
 * report, and not inferred from file events — git itself is asked (D-047).
 *
 * Stated as state, never as judgment. Uncommitted work is completely normal; the fact is
 * useful because "done" plus a dirty tree is worth a human glance, and only the human can
 * say whether it matters.
 */
function rf02(events: LodestarEvent[]): RealityFact[] {
  const status = findLast(events, (e) => e.kind === 'git.status')
  if (!status) return [] // git unreadable or not a repo — no claim either way

  // ---------------------------------------------------------------------------
  // `?? []` TURNED AN UNKNOWN INTO A MEASURED-CLEAN TREE — D-053
  // ---------------------------------------------------------------------------
  //
  // This was `(status.payload as { dirtyAtEnd?: string[] })?.dirtyAtEnd ?? []`, and two
  // things went wrong in one line.
  //
  // 1. **No `Array.isArray`.** Measured, on a real store: a payload of
  //    `{ dirtyAtEnd: 'src/auth.ts' }` produced **"11 files were left uncommitted"** —
  //    the count was `String.length`. A fabricated number, stated with high confidence.
  //
  // 2. **`?? []` collapsed missing into empty.** A `git.status` event whose `dirtyAtEnd`
  //    is absent is *unknown*, and it rendered byte-identically to `dirtyAtEnd: []`,
  //    which this fact treats as **measured clean**. The comment above claimed the three
  //    states were held apart; they were held apart only for a missing EVENT, not a
  //    missing FIELD.
  //
  // The three states, restored:
  //   no event          → unknown  → no claim (above)
  //   unusable field    → unknown  → no claim (here), declared by limitations()
  //   array, empty      → measured clean → no claim
  //   array, non-empty  → measured dirty → the fact
  const raw = (status.payload as { dirtyAtEnd?: unknown })?.dirtyAtEnd
  if (!Array.isArray(raw)) return []

  const dirty = raw.filter((x): x is string => typeof x === 'string')
  if (!dirty.length) return [] // measured clean

  return [
    {
      id: 'RF-02',
      statement:
        dirty.length === 1
          ? `1 file was left uncommitted: ${dirty[0]}`
          : `${dirty.length} files were left uncommitted`,
      confidence: 'high',
      ts: status.ts,
      evidence: [evidenceOf(status, 'git_state')],
    },
  ]
}

/**
 * RF-03 — source files were modified and no test process ran.
 *
 * ---------------------------------------------------------------------------
 * THE FACT MOST AT RISK OF BEING A FALSE ACCUSATION
 * ---------------------------------------------------------------------------
 *
 * "No test ran" is a claim about ABSENCE, and absence has two causes: none ran, or one
 * ran where we could not see it. Those are opposite conclusions and the record must not
 * merge them.
 *
 * So this fires ONLY when the boundary could actually have seen a test run — i.e. some
 * process exit was observed. In a session where the shims were shadowed, no process
 * events exist at all, and asserting "no test ran" from that silence would be exactly the
 * inference this product forbids. That case produces no fact and a declared limitation
 * instead (`limitations()`).
 *
 * The guard below is the whole fact. Deleting it passes every other test in this repo and
 * turns the quietest session — one where LODESTAR saw nothing at all — into a confident
 * accusation that the agent never tested. `rf-catalog.test.ts` pins it.
 */
function rf03(events: LodestarEvent[]): RealityFact[] {
  // Readable exits only. A malformed payload is not a command we observed — it is a hole,
  // and `limitations()` declares it. Counting it here would let a corrupt event satisfy
  // the guard below and unlock an accusation (D-053).
  const exits = events.filter((e) => e.kind === 'process.exit' && exitPayload(e) !== null)
  if (!exits.length) return [] // we saw no commands at all: silence is not evidence

  // Any test-SHAPED command blocks this fact, completed or not — including one that
  // was killed AND including a watcher (D-069). The statement is "no test command was
  // observed", and if a test was observed and merely did not finish — or runs forever
  // by design — that statement is simply false. What remains unknown (no completed
  // verdict) is disclosed by `limitations()`, never converted into this accusation.
  if (exits.some((e) => isTestShapedCommand(exitPayload(e)!.command))) return []

  const written = events.filter((e) => e.kind === 'file.write' && e.target?.inScope)
  if (!written.length) return []

  const paths = new Set(written.map((e) => e.target!.resolved))
  return [
    {
      id: 'RF-03',
      statement: `${paths.size} file(s) modified; no test command was observed in this session`,
      confidence: 'high',
      ts: written[written.length - 1]!.ts,
      evidence: [
        evidenceOf(written[written.length - 1]!, 'file_write'),
        evidenceOf(exits[exits.length - 1]!, 'process_exit'),
      ],
    },
  ]
}

/**
 * RF-05 — a file was written and later reverted to content it already had.
 *
 * Evidence: content hashes. `snapshotRef.after` returning to an earlier `before` is
 * churn — the agent changed its mind — and it is provable from hashes alone, with no
 * inference about why.
 *
 * Deliberately narrow: only a genuine *revert* (the content came back to a value it held
 * earlier in this session) counts. "Written more than once" is normal work, not a
 * divergence, and reporting it would be crying wolf on every session.
 */
function rf05(events: LodestarEvent[]): RealityFact[] {
  const facts: RealityFact[] = []
  const seen = new Map<string, Set<string>>() // path -> content hashes it has held

  for (const e of events) {
    if (e.kind !== 'file.write' || !e.target?.inScope) continue
    const path = e.target.resolved
    const before = e.snapshotRef?.before
    const after = e.snapshotRef?.after
    if (!after) continue // withheld or oversized: unknown, and unknown stays unknown

    const history = seen.get(path) ?? new Set<string>()
    if (before) history.add(before)

    if (history.has(after) && before !== after) {
      facts.push({
        id: 'RF-05',
        statement: `${basename(path)} was changed and then reverted to earlier content`,
        confidence: 'high',
        ts: e.ts,
        evidence: [evidenceOf(e, 'file_write')],
      })
    }
    history.add(after)
    seen.set(path, history)
  }

  return facts
}

/**
 * RF-06 — a process was killed by a signal.
 *
 * Evidence: the signal name, from the OS via the real parent. `exitCode: null` plus a
 * signal is not a failure and must never be reported as one — RF-01 correctly ignores it.
 * This is the other half: the work may be half-complete, which is a different thing from
 * failing, and the record should say which.
 */
function rf06(events: LodestarEvent[]): RealityFact[] {
  return events
    .map((e) => ({ e, p: exitPayload(e) }))
    // `exitPayload(e)!` here would throw on a null payload and take the whole report with
    // it (D-053). An unreadable event is not a kill.
    .filter((x): x is { e: LodestarEvent; p: ProcessExitPayload } => x.p !== null)
    // A signal NAME, not a truthy field: `signal: true` names no signal, and the
    // statement below would render "terminated by true".
    .filter((x) => typeof x.p.signal === 'string' && x.p.signal.length > 0)
    .map(({ e, p }) => ({
      id: 'RF-06' as const,
      statement: `${p.command} was terminated by ${p.signal}`,
      confidence: 'high' as const,
      ts: e.ts,
      evidence: [evidenceOf(e, 'process_exit')],
    }))
}

/**
 * RF-07 — files outside the project scope were modified.
 *
 * Evidence: `target.inScope`, computed at capture from the RESOLVED path (context.ts),
 * never from what the command looked like. A blast-radius signal, stated plainly — an
 * agent writing to the home directory may be perfectly correct, and the human decides.
 */
function rf07(events: LodestarEvent[]): RealityFact[] {
  const out = events.filter(
    (e) => (e.kind === 'file.write' || e.kind === 'file.delete') && e.target?.inScope === false,
  )
  if (!out.length) return []

  const byPath = new Map<string, LodestarEvent>()
  for (const e of out) if (!byPath.has(e.target!.resolved)) byPath.set(e.target!.resolved, e)

  return [...byPath.entries()].map(([path, e]) => ({
    id: 'RF-07' as const,
    statement: `${path} was modified, outside the project directory`,
    confidence: 'high' as const,
    ts: e.ts,
    evidence: [evidenceOf(e, e.kind === 'file.delete' ? 'file_delete' : 'file_write')],
  }))
}

/**
 * What the fact engine could NOT determine, stated plainly.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL — D-048
 * ---------------------------------------------------------------------------
 *
 * RF-03 and RF-04 both key off "was a test observed?". When the answer is no, they return
 * `[]` — and an empty result is indistinguishable from "we looked and everything was
 * fine". That ambiguity is the D-022/D-040 failure again: silence rendering as all-clear.
 *
 * A missed matcher must never silently appear as "no failure". So the absence is
 * reported as a limitation rather than left to be inferred from nothing.
 */
export function limitations(store: SqliteEventStore, sessionId: string): string[] {
  return limitationsEvents(factInputs(store, sessionId))
}

/** Pure form of `limitations`, for callers holding events (the record builder). */
export function limitationsEvents(rawEvents: LodestarEvent[]): string[] {
  const events = factInputsOf(rawEvents)
  const notes: string[] = []

  const exits = events.filter((e) => e.kind === 'process.exit' && exitPayload(e) !== null)
  const wrote = events.some((e) => e.kind === 'file.write' && e.target?.inScope)
  const testShaped = exits.filter((e) => isTestShapedCommand(exitPayload(e)!.command))
  const testRuns = exits.filter((e) => isTestCommand(exitPayload(e)!.command))
  const watchRuns = testShaped.filter((e) => !isTestCommand(exitPayload(e)!.command))

  if (!exits.length && wrote) {
    notes.push(
      'No commands were observed in this session, so nothing can be said about whether ' +
        'tests ran. Files did change. Check the coverage report — a shadowed shim records ' +
        'nothing, and that silence is not evidence.',
    )
  } else if (exits.length && !testShaped.length) {
    // Test-SHAPED, not completed-run (D-069): a watch-mode command IS a recognised
    // test command, and this note claiming otherwise would be false about it. The
    // watch case gets its own precise disclosure below.
    notes.push(
      'No test command was recognised in this session. If tests did run, LODESTAR did not ' +
        'recognise the command — RF-03 and RF-04 are therefore not evidence that testing ' +
        'was skipped.',
    )
  }

  // ---------------------------------------------------------------------------
  // A WATCHER IS AN OBSERVED TEST COMMAND WITH NO OBSERVABLE VERDICT — D-069
  // ---------------------------------------------------------------------------
  //
  // "Was a test command observed?" — yes. "Was a completed test run observed?" — no.
  // RF-03 stays silent (its statement would be false) and RF-04 has no run to anchor
  // to; this note states exactly that split instead of letting the silence read as
  // either "tests were fine" or "testing was skipped".
  const completedRuns = testRuns.filter((e) => verdictOf(exitPayload(e)!) !== 'none')
  if (watchRuns.length && !completedRuns.length) {
    const cmds = [...new Set(watchRuns.map((e) => exitPayload(e)!.command))].join(', ')
    notes.push(
      `A watch-mode test command was observed: ${cmds}. A watcher runs continuously and ` +
        'does not terminate with a verdict, so a test command WAS observed but no ' +
        'completed test run was. This is not evidence that testing was skipped, and not ' +
        'evidence that the tests passed.',
    )
  }

  // ---------------------------------------------------------------------------
  // A BACKWARD WALL-CLOCK STEP IS MEASURED, AND RF-04 SITS OUT WHEN FOUND — D-069
  // ---------------------------------------------------------------------------
  const regression = clockRegression(events)
  if (regression) {
    notes.push(
      `The wall clock moved backward during this session — event #${regression.atSeq} is ` +
        `${(-regression.driftMs / 1000).toFixed(1)}s earlier than the monotonic clock allows. ` +
        'RF-04 orders file writes against test runs by wall-derived times, so it was not ' +
        'evaluated; treat any timestamp-based ordering in this record as unreliable.',
    )
  }

  // ---------------------------------------------------------------------------
  // A TEST THAT NEVER FINISHED WAS TOTAL SILENCE — D-053
  // ---------------------------------------------------------------------------
  //
  // A test-shaped command with no verdict (`exitCode: null`) blocks RF-03 — correctly,
  // since a test WAS observed — and now no longer anchors RF-04. Measured before this
  // note existed, on a session with `npm test` (exitCode null, no signal) plus a file
  // write: **zero facts and zero limitations.** RF-01 skipped it (not a number), RF-06
  // skipped it (no signal), RF-03 treated it as "a test ran", and the report rendered a
  // clean session.
  //
  // Worse, it was agent-reachable without any forgery: start a test, kill it, and RF-03
  // goes quiet. The fact engine must never be silenceable by an action the agent can
  // simply take.
  const unfinished = testRuns.filter((e) => verdictOf(exitPayload(e)!) === 'none')
  if (unfinished.length && unfinished.length === testRuns.length) {
    const cmds = [...new Set(unfinished.map((e) => exitPayload(e)!.command))].join(', ')
    notes.push(
      `A test command was observed but produced no exit code, so it reached no verdict: ` +
        `${cmds}. LODESTAR cannot say whether the tests passed, failed, or ran at all — ` +
        'and this is not evidence that testing was skipped.',
    )
  }

  const unknownMtime = events.some(
    (e) =>
      e.kind === 'file.write' &&
      e.target?.inScope &&
      typeof (e.payload as FileChangePayload | undefined)?.mtimeMs !== 'number',
  )
  if (unknownMtime) {
    notes.push(
      'Some file writes have no modification time, so RF-04 could not determine whether ' +
        'they happened before or after the last test run. They are excluded, not assumed.',
    )
  }

  // NOTE — RF-04's mtime trust root used to be disclosed here, in this session-level list
  // (D-057). It moved onto the RF-04 fact itself as an `assumption` (D-058): a caveat three
  // sections away from the conclusion it qualifies reads as unrelated boilerplate, so it now
  // travels with the fact, revealed under "why do you believe this?". `limitations()` keeps
  // only what is genuinely session-level — gaps not tied to one specific fact.

  // An event we cannot parse is a hole in the record, and a hole gets stated. It is not
  // an absence, and it must not be quietly dropped just because the fact engine skipped
  // it — the whole point of skipping it was that we do not know what it says.
  const malformed = events.filter(isMalformedExit).length
  if (malformed) {
    notes.push(
      `${malformed} command event(s) could not be read — the payload is missing or ` +
        'malformed. They are excluded from every fact, so anything those commands did is ' +
        'unknown rather than absent.',
    )
  }

  // `git.status` present but unusable: unknown, and it must not pass as a measured-clean
  // tree. See rf02 — this is the field-level twin of the missing-event case.
  const status = findLast(events, (e) => e.kind === 'git.status')
  if (status && !Array.isArray((status.payload as { dirtyAtEnd?: unknown })?.dirtyAtEnd)) {
    notes.push(
      'Git working-tree state was recorded but could not be read, so RF-02 could not ' +
        'determine whether anything was left uncommitted. This is not a clean tree.',
    )
  }

  return notes
}

/**
 * Evaluate the catalog against a session.
 *
 * An empty result is a real, valid answer — "No divergences observed". Never
 * manufacture concern to look useful; a trust product that cries wolf is finished.
 *
 * Read `limitations()` alongside this. An empty fact list means "nothing was observed to
 * diverge", which is NOT the same as "nothing diverged" — and only the limitations can
 * tell the two apart.
 */
export function evaluate(store: SqliteEventStore, sessionId: string): RealityFact[] {
  return evaluateEvents(factInputs(store, sessionId))
}

/**
 * Pure form of `evaluate`, for callers holding events (the record builder).
 *
 * Filters to groundTruth itself — handing this function a full-tier array cannot leak
 * narration into a fact, for the same reason the store path cannot (D-009).
 */
export function evaluateEvents(rawEvents: LodestarEvent[]): RealityFact[] {
  const events = factInputsOf(rawEvents)
  return [
    ...rf01(events),
    ...rf02(events),
    ...rf03(events),
    ...rf04(events),
    ...rf05(events),
    ...rf06(events),
    ...rf07(events),
  ].sort((a, b) => a.ts.localeCompare(b.ts))
}

function findLast(arr: LodestarEvent[], pred: (e: LodestarEvent) => boolean): LodestarEvent | null {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return arr[i]!
  return null
}
