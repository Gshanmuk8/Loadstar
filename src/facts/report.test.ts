/**
 * The session report model — D-049.
 *
 * ---------------------------------------------------------------------------
 * THE ONE CLAIM THESE TESTS DEFEND
 * ---------------------------------------------------------------------------
 *
 * **An empty report must never imply success.**
 *
 * Everything else here is detail. `lodestar report` is the magic moment (USER-FLOW §1),
 * which means it is also the moment where a wrong impression does the most damage — a
 * developer reads it in thirty seconds and decides whether to look further. If a session
 * where LODESTAR saw nothing renders the same as a session where LODESTAR saw everything
 * and found nothing wrong, the product has told its user a lie in the one place they were
 * paying attention.
 *
 * So `VERIFIED` is treated as a claim that must be earned, and every one of these tests is
 * an attempt to obtain it without earning it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { buildIndex, buildReport, resolveDiff } from './report.js'
import type { CommandCoverage } from '../recorder/shims.js'
import { SnapshotStore } from '../recorder/snapshots.js'
import type { EventKind, EventTarget } from '../types/events.js'

let dir: string
let db: ReturnType<typeof openDatabase>
let store: SqliteEventStore
let sessionId: string
let clock = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-report-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  store = new SqliteEventStore(db)
  sessionId = store.createSession({ runtimeId: 'claude-code', cwd: dir, mission: null }).id
  clock = 0
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function append(kind: EventKind, payload: unknown, target?: EventTarget): string {
  const id = randomUUID()
  store.append({
    id,
    sessionId,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
    monotonicTs: clock * 1000,
    source: 'process',
    signalTier: 'groundTruth',
    kind,
    actor: { kind: 'agent', runtimeId: 'claude-code' },
    payload,
    ...(target ? { target } : {}),
  })
  return id
}

const observed = (cmd: string): CommandCoverage => ({ command: cmd, status: 'observed', resolvedTo: `/shims/${cmd}` })

/** The shape of a well-recorded, complete session: start, probe, work, end. */
function wellFormedSession(): void {
  append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [], model: 'claude-opus-4-8', machineId: 'm1', gitCommit: 'abc123' })
  append('agent.output', { coverageProbe: { shell: 'bash -lc', shimDir: '/shims', commands: [observed('npm'), observed('git')] } })
}

const endSession = () => append('session.end', { exitCode: 0, durationMs: 1000 })

// ===========================================================================
// The headline: what an empty report is allowed to say.
// ===========================================================================

describe('an empty report never implies success', () => {
  it('VERIFIED requires a probe, an ending, and no gaps — all of them', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.facts).toEqual([])
    expect(r.integrity.status).toBe('VERIFIED')
    expect(r.integrity.degraded).toEqual([])
  })

  /**
   * The default case, and the one that must not be green.
   *
   * A session with nothing in it is not a clean session — it is a session we know nothing
   * about. Before this model existed, `lodestar report` had no way to express that, and
   * the honest rendering of "no facts" was indistinguishable from "no problems".
   */
  it('a session with no evidence at all is DEGRADED, not VERIFIED', () => {
    const r = buildReport(store, sessionId)!
    expect(r.facts).toEqual([])
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.integrity.chain.intact).toBe(true) // the CHAIN is fine. The RECORD is not complete.
  })

  it('DEGRADED always states its reasons — a degraded state with no reason is a shrug', () => {
    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.integrity.degraded.length).toBeGreaterThan(0)
    for (const note of r.integrity.degraded) expect(note.length).toBeGreaterThan(20)
  })
})

// ===========================================================================
// D-058 — the two-axis verdict, and per-fact assumptions.
// ===========================================================================

describe('D-058 — the verdict is two independent axes', () => {
  const t = (p: string): EventTarget => ({ raw: p, resolved: join(dir, p), kind: 'file', inScope: true })

  it('a clean, complete session: no divergences · evidence complete, both green', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.verdict.finding).toEqual({ text: 'No divergences observed', tone: 'ok' })
    expect(r.verdict.coverage).toEqual({ text: 'Evidence complete', tone: 'ok' })
  })

  it('divergences found, evidence complete: finding warns, coverage stays green', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.verdict.finding).toEqual({ text: '1 divergence observed', tone: 'warn' })
    expect(r.verdict.coverage!.tone).toBe('ok')
  })

  /**
   * The two axes are genuinely independent — this is the whole reason for splitting them.
   *
   * A session can have NO divergences and STILL be untrustworthy-incomplete. Collapsing to
   * one word ("DEGRADED") hides which of those it is; two axes show "No divergences
   * observed" (green) sitting above "Evidence incomplete" (amber). Neither is a lie.
   */
  it('no divergences but incomplete evidence: finding green, coverage amber', () => {
    // No probe, no session end → degraded on coverage, but zero facts.
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    append('file.write', { path: 'a.ts', mtimeMs: 1 }, t('a.ts'))

    const r = buildReport(store, sessionId)!
    expect(r.facts).toEqual([])
    expect(r.verdict.finding.tone).toBe('ok') // the finding IS clean
    expect(r.verdict.coverage!.tone).toBe('warn') // but we did not see everything
    expect(r.verdict.coverage!.text).toMatch(/Evidence incomplete · \d+ gaps?/)
  })

  it('a broken record: finding is the integrity failure, coverage suppressed', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()
    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE kind = 'process.exit'").run(JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 10 }))

    const r = buildReport(store, sessionId)!
    expect(r.verdict.finding).toEqual({ text: 'Record integrity broken', tone: 'bad' })
    // Coverage of an altered record is a meaningless number, so it is not shown.
    expect(r.verdict.coverage).toBeNull()
  })

  /**
   * NEVER a recommendation. The verdict reports observation and completeness, never a
   * decision. This is the line D-057 drew and this test defends: no phrasing that crosses
   * into "you may/should merge/ship/deploy".
   */
  it('never renders a merge or safety recommendation', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    const words = `${r.verdict.finding.text} ${r.verdict.coverage?.text ?? ''}`.toLowerCase()
    for (const banned of ['safe', 'merge', 'ship', 'deploy', 'looks good', 'approved', 'passing']) {
      expect(words).not.toContain(banned)
    }
  })
})

describe('D-058 — assumptions travel with the fact', () => {
  const t = (p: string): EventTarget => ({ raw: p, resolved: join(dir, p), kind: 'file', inScope: true })

  it('attaches RF-04’s mtime trust root to the RF-04 fact, not a global list', () => {
    wellFormedSession()
    const testTime = Date.UTC(2026, 0, 1, 12, 0, 0)
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    append('file.write', { path: 'src/payments.mjs', mtimeMs: testTime + 60_000 }, t('src/payments.mjs'))
    endSession()

    const r = buildReport(store, sessionId)!
    const v = r.views.find((x) => x.fact.id === 'RF-04')!
    expect(v.assumptions.length).toBeGreaterThan(0)
    expect(v.assumptions.some((a) => /clock moved backward|modification time/i.test(a))).toBe(true)
    expect(v.assumptions.some((a) => /evidence, not proof/i.test(a))).toBe(true)

    // And it is NOT duplicated in the session-level limitations.
    expect(r.limitations.some((n) => /clock moved backward/i.test(n))).toBe(false)
  })

  it('a fact that rests only on its events carries no assumptions', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const v = buildReport(store, sessionId)!.views.find((x) => x.fact.id === 'RF-01')!
    // An exit code is an exit code — it assumes nothing about a clock or a filesystem.
    expect(v.assumptions).toEqual([])
  })
})

// ===========================================================================
// Each demotion, one at a time.
// ===========================================================================

describe('every known gap demotes VERIFIED', () => {
  it('demotes when a shim was shadowed — the command ran where we could not watch', () => {
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    append('agent.output', {
      coverageProbe: { shell: 'bash -lc', shimDir: '/shims', commands: [observed('git'), { command: 'npm', status: 'shadowed', resolvedTo: '/usr/bin/npm' }] },
    })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.integrity.degraded.some((n) => /shadowed/i.test(n) && /npm/.test(n))).toBe(true)
    // "proves nothing" — the wording is the point. A shadowed npm means npm's absence from
    // this report is not evidence that npm never ran.
    expect(r.integrity.degraded.some((n) => /proves nothing/i.test(n))).toBe(true)
  })

  it('demotes when coverage could not be measured, and says so about ITSELF not the command', () => {
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    append('agent.output', {
      coverageProbe: { shell: null, shimDir: '/shims', commands: [{ command: 'npm', status: 'unknown', reason: 'probe shell not found' }] },
    })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('DEGRADED')
    // D-040: unknown and absent are opposite claims. This note must be about LODESTAR.
    expect(r.integrity.degraded.some((n) => /statement about LODESTAR/i.test(n))).toBe(true)
  })

  it('does NOT demote for a command that is merely not installed — that is measured', () => {
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    append('agent.output', {
      coverageProbe: { shell: 'bash -lc', shimDir: '/shims', commands: [observed('npm'), { command: 'cargo', status: 'absent' }] },
    })
    endSession()

    // `absent` is a measurement: cargo is not on this machine, so there is nothing to
    // observe and no hole in the record. Demoting here would make VERIFIED unreachable on
    // any machine that lacks one of eighteen shimmed tools — i.e. every machine — and a
    // status that is always yellow is a status nobody reads.
    expect(buildReport(store, sessionId)!.integrity.status).toBe('VERIFIED')
  })

  it('demotes when the session never closed', () => {
    wellFormedSession()
    // No session.end: the wrapper died, or it is still running.
    const r = buildReport(store, sessionId)!
    expect(r.closed).toBe(false)
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.integrity.degraded.some((n) => /no end event/i.test(n))).toBe(true)
  })

  it('demotes when a recorder failed, and surfaces which one', () => {
    wellFormedSession()
    append('agent.output', { recorderError: 'ENOSPC: no space left on device', recorder: 'filesystem' })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.recorderErrors).toEqual(['filesystem: ENOSPC: no space left on device'])
    expect(r.integrity.degraded.some((n) => /filesystem/.test(n) && /missing/i.test(n))).toBe(true)
  })

  /**
   * Withholding a secret is correct. Pretending we looked at it is not.
   *
   * `.env` is never read (D-033), so RF-05 is blind to it — and a report that says "no
   * divergences observed" without mentioning that it could not see the file's content has
   * overstated what it checked.
   */
  it('demotes when content was withheld — correct behaviour is still a hole in the evidence', () => {
    wellFormedSession()
    append('file.write', { path: '.env', contentWithheld: 'sensitive' }, { raw: '.env', resolved: join(dir, '.env'), kind: 'file', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.integrity.degraded.some((n) => /content/i.test(n) && /sensitive/.test(n))).toBe(true)
  })

  it('demotes when coverage was never probed at all', () => {
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.coverage).toEqual([])
    expect(r.integrity.status).toBe('DEGRADED')
    expect(r.integrity.degraded.some((n) => /never probed/i.test(n))).toBe(true)
  })
})

// ===========================================================================
// BROKEN — the chain does not recompute.
// ===========================================================================

describe('BROKEN', () => {
  it('reports BROKEN when the record was altered after the fact', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    expect(buildReport(store, sessionId)!.integrity.status).not.toBe('BROKEN')

    // Triggers block UPDATE, so simulate an attacker editing the database out of band —
    // which is precisely the T2 case the hash chain exists for.
    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE kind = 'process.exit'").run(
      JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 10 }),
    )

    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('BROKEN')
    expect(r.integrity.chain.intact).toBe(false)
    expect(r.integrity.chain.reason).toBeTruthy()
  })

  /**
   * BROKEN outranks DEGRADED, and the ordering is not cosmetic.
   *
   * A tampered record with a shadowed shim is not "partly missing evidence". It is a
   * record that was rewritten, and every other word in the report is downstream of that.
   */
  it('outranks DEGRADED when both apply', () => {
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    // No probe, no end: degraded on two counts.

    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE kind = 'process.exit'").run(JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 10 }))

    const r = buildReport(store, sessionId)!
    expect(r.integrity.status).toBe('BROKEN')
    expect(r.integrity.degraded.length).toBeGreaterThan(0) // still listed, not swallowed
  })
})

// ===========================================================================
// D-053 — the audit's findings against the report layer.
// ===========================================================================

describe('D-053 — a broken record cannot report "no divergences"', () => {
  /**
   * The successful forgery, end to end.
   *
   * An attacker rewrites `npm test exit 1` into `exit 0`. RF-01 correctly stops firing —
   * the payload now says the command passed. So `facts` is empty, `degraded` is empty (the
   * session is well-formed), and the renderer's rule was `if (!facts.length)` → a green
   * **"✓ No divergences observed"** as the first thing the user reads.
   *
   * The chain caught the tamper and said BROKEN eight lines further down. The first
   * impression was still a tick. `factsVerdict` exists so no renderer can make that
   * mistake again — including the dashboard, which cannot be reviewed for it yet because
   * it does not exist.
   */
  it('reports record-untrustworthy, not none-observed, when the chain is broken', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    expect(buildReport(store, sessionId)!.factsVerdict).toBe('divergences-observed')

    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE kind = 'process.exit'").run(
      JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 10 }),
    )

    const r = buildReport(store, sessionId)!
    expect(r.facts).toEqual([]) // the forgery worked on the FACT...
    expect(r.integrity.status).toBe('BROKEN') // ...and the chain caught it...
    expect(r.factsVerdict).toBe('record-untrustworthy') // ...so the report must not say "clean".
  })

  it('distinguishes an honest empty result from a broken one', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.facts).toEqual([])
    // Same empty array, completely different meaning. This is why renderers must not
    // switch on `facts.length`.
    expect(r.factsVerdict).toBe('none-observed')
  })
})

describe('D-053 — narration cannot upgrade the status', () => {
  /**
   * The tier leak, closed before it was reachable.
   *
   * `evaluate()` filters to groundTruth at the query so narration can never become a
   * fact. The code deciding VERIFIED vs DEGRADED had no such filter — and it is exactly
   * as trust-bearing.
   *
   * `coverageFromRecord` takes the FIRST match, so a forged probe appended before the
   * real one wins. Here the real probe says `npm` is shadowed (→ DEGRADED); the narration
   * claims everything is observed. If narration were read, the report would say VERIFIED
   * on a value the agent supplied.
   *
   * No shipping adapter emits narration `agent.output` today. The `stdio` EventSource
   * exists precisely so one will.
   */
  it('ignores a coverage probe forged in the narration tier', () => {
    append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
    // The agent gets its story in first.
    store.append({
      id: randomUUID(),
      sessionId,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
      monotonicTs: clock * 1000,
      source: 'stdio',
      signalTier: 'narration',
      kind: 'agent.output',
      actor: { kind: 'agent', runtimeId: 'claude-code' },
      payload: { coverageProbe: { shell: 'bash -lc', shimDir: '/shims', commands: [observed('npm'), observed('git')] } },
    })
    // The truth, recorded second.
    append('agent.output', {
      coverageProbe: { shell: 'bash -lc', shimDir: '/shims', commands: [{ command: 'npm', status: 'shadowed', resolvedTo: '/usr/bin/npm' }] },
    })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.coverage.map((c) => c.status)).toEqual(['shadowed'])
    expect(r.integrity.status).toBe('DEGRADED')
  })

  it('ignores a session.end forged in the narration tier', () => {
    wellFormedSession()
    store.append({
      id: randomUUID(),
      sessionId,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
      monotonicTs: clock * 1000,
      source: 'stdio',
      signalTier: 'narration',
      kind: 'session.end',
      actor: { kind: 'agent', runtimeId: 'claude-code' },
      payload: { exitCode: 0, durationMs: 1 },
    })

    // The wrapper never closed this session. The agent saying so does not close it.
    const r = buildReport(store, sessionId)!
    expect(r.closed).toBe(false)
    expect(r.integrity.status).toBe('DEGRADED')
  })
})

// ===========================================================================
// D-054 — the views the dashboard consumes.
// ===========================================================================

describe('D-054 — file changes and their content', () => {
  const t = (p: string): EventTarget => ({ raw: p, resolved: join(dir, p), kind: 'file', inScope: true })

  function writeWithSnap(path: string, payload: Record<string, unknown>, snap?: { before?: string; after?: string }): void {
    store.append({
      id: randomUUID(),
      sessionId,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
      monotonicTs: clock * 1000,
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      actor: { kind: 'agent', runtimeId: 'claude-code' },
      payload: { path, mtimeMs: 1, ...payload },
      target: t(path),
      ...(snap ? { snapshotRef: snap } : {}),
    })
  }

  /**
   * A recorded ref whose blob is gone.
   *
   * Found by mutation testing: nothing checked this at all. Blobs are deliberately NOT
   * hash-chained (D-037) precisely so they CAN be deleted — that is the remediation path
   * when a secret lands in one. So a missing blob is an expected, ordinary state, and if
   * it renders as an empty diff the user reads "this file did not really change" about a
   * file that did.
   */
  it('detects a recorded ref whose blob is gone, and does not call it available', () => {
    const snapshots = new SnapshotStore(join(dir, 'snap'))
    const realRef = snapshots.putContent(Buffer.from('actual content'))

    wellFormedSession()
    writeWithSnap('a.ts', {}, { before: realRef, after: 'deadbeefdeadbeef' }) // after was purged
    endSession()

    const r = buildReport(store, sessionId, { snapshots })!
    const change = r.changes.find((c) => c.name === 'a.ts')!
    expect(change.content).toBe('blob-missing')
    expect(change.contentNote).toMatch(/no longer in the blob store/)
    expect(change.contentNote).toMatch(/deletable by design/)
  })

  it('does not claim blob-missing when it has no blob store to check', () => {
    // Without a snapshot store we have not looked, so `available` means "a ref was
    // recorded" — the weaker, honest claim. Asserting the stronger one would be inventing
    // a check we did not run.
    wellFormedSession()
    writeWithSnap('a.ts', {}, { before: 'x', after: 'y' })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.changes[0]!.content).toBe('available')
  })

  it('resolveDiff refuses to render a missing blob as an empty file', () => {
    // Found by mutation testing. Returning `''` for a missing blob renders as "the file
    // was emptied" — a change invented out of a gap, which is the exact failure class this
    // product exists to prevent.
    const snapshots = new SnapshotStore(join(dir, 'snap'))
    wellFormedSession()
    writeWithSnap('a.ts', {}, { before: 'missingref00', after: 'missingref11' })
    endSession()

    const r = buildReport(store, sessionId, { snapshots })!
    const view = resolveDiff(r.changes[0]!, snapshots)
    expect(view.kind).toBe('unavailable')
    if (view.kind === 'unavailable') expect(view.reason).toMatch(/blob store/)
  })

  /**
   * The same guard, on the path that actually reaches it.
   *
   * The test above does not exercise `resolveDiff`'s own blob check at all: `buildReport`
   * already marked the change `blob-missing`, so `resolveDiff` returns on its first line.
   * Mutation testing caught that — breaking the check inside `resolveDiff` changed nothing
   * observable, which means nothing was testing it.
   *
   * It is reachable when a caller builds the report WITHOUT a store (so `content` stays
   * `available` — the honest weaker claim, since we did not look) and resolves diffs WITH
   * one. That mix is legal and the guard is the only thing standing between it and an
   * invented "the file was emptied" diff. Defense in depth is only depth if both layers
   * are checked.
   */
  it('resolveDiff checks the blobs itself, even when the report never looked', () => {
    const snapshots = new SnapshotStore(join(dir, 'snap'))
    wellFormedSession()
    writeWithSnap('a.ts', {}, { before: 'missingref00', after: 'missingref11' })
    endSession()

    const r = buildReport(store, sessionId)! // no snapshots: content === 'available'
    expect(r.changes[0]!.content).toBe('available')

    const view = resolveDiff(r.changes[0]!, snapshots)
    expect(view.kind).toBe('unavailable')
    if (view.kind === 'unavailable') expect(view.reason).toMatch(/"before" snapshot is no longer/)
  })

  it('resolveDiff distinguishes a missing "after" from a missing "before"', () => {
    const snapshots = new SnapshotStore(join(dir, 'snap'))
    const before = snapshots.putContent(Buffer.from('real\n'))

    wellFormedSession()
    writeWithSnap('a.ts', {}, { before, after: 'missingref11' })
    endSession()

    const r = buildReport(store, sessionId)!
    const view = resolveDiff(r.changes[0]!, snapshots)
    expect(view.kind).toBe('unavailable')
    if (view.kind === 'unavailable') expect(view.reason).toMatch(/"after" snapshot is no longer/)
  })

  it('resolveDiff returns both sides when the blobs are really there', () => {
    const snapshots = new SnapshotStore(join(dir, 'snap'))
    const before = snapshots.putContent(Buffer.from('old line\n'))
    const after = snapshots.putContent(Buffer.from('new line\n'))

    wellFormedSession()
    writeWithSnap('a.ts', {}, { before, after })
    endSession()

    const r = buildReport(store, sessionId, { snapshots })!
    const view = resolveDiff(r.changes[0]!, snapshots)
    expect(view).toEqual({ kind: 'text', before: 'old line\n', after: 'new line\n' })
  })

  it('keeps the FIRST before and the LAST after across many writes', () => {
    // The session's net effect on a file is first-before → last-after. Taking the last
    // write's `before` would show only the final edit and hide everything the session did
    // to the file before it.
    wellFormedSession()
    writeWithSnap('a.ts', {}, { before: 'v1', after: 'v2' })
    writeWithSnap('a.ts', {}, { before: 'v2', after: 'v3' })
    endSession()

    const c = buildReport(store, sessionId)!.changes[0]!
    expect(c.beforeRef).toBe('v1')
    expect(c.afterRef).toBe('v3')
    expect(c.writes).toBe(2)
  })

  /**
   * Readable paths, with the one exception that is not cosmetic.
   *
   * Evidence lines rendered the full resolved path — on a real session, two wrapped lines
   * of `C:\Users\…\AppData\Local\Temp\…\live-demo\src\payments.mjs` around the four
   * characters the reader wants. Shortening it is presentation, so it happens once, in the
   * model, where the terminal and the browser both get it.
   *
   * **Except outside the project.** RF-07 is about blast radius; a home-directory path
   * shortened into something that looks local would erase the fact. `path` stays exact
   * either way — `display` is only what to print.
   */
  it('shortens an in-scope path for reading and keeps the exact one', () => {
    wellFormedSession()
    writeWithSnap('src/payments.mjs', {}, { before: 'v1', after: 'v2' })
    endSession()

    const c = buildReport(store, sessionId)!.changes[0]!
    expect(c.display).toBe('src/payments.mjs')
    expect(c.path).toBe(join(dir, 'src/payments.mjs')) // the record is untouched
  })

  it('NEVER shortens a path outside the project', () => {
    wellFormedSession()
    const outside = '/home/dev/.bashrc'
    store.append({
      id: randomUUID(),
      sessionId,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
      monotonicTs: clock * 1000,
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      actor: { kind: 'agent', runtimeId: 'claude-code' },
      payload: { path: outside, mtimeMs: 1 },
      target: { raw: outside, resolved: outside, kind: 'file', inScope: false },
    })
    endSession()

    const c = buildReport(store, sessionId)!.changes.find((x) => x.name === '.bashrc')!
    expect(c.display).toBe(outside)
    expect(c.inScope).toBe(false)
  })

  it('shortens the path in evidence summaries too, so both renderers agree', () => {
    wellFormedSession()
    writeWithSnap('src/payments.mjs', {}, { before: 'v1', after: 'v2' })
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    const wrote = r.timeline.find((t) => t.kind === 'file.write')!
    expect(wrote.summary).toBe('wrote src/payments.mjs')
    expect(wrote.summary).not.toContain(dir)
  })

  it('marks a deleted file as deleted rather than dropping it', () => {
    wellFormedSession()
    writeWithSnap('gone.ts', {}, { before: 'v1', after: 'v2' })
    store.append({
      id: randomUUID(),
      sessionId,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
      monotonicTs: clock * 1000,
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.delete',
      actor: { kind: 'agent', runtimeId: 'claude-code' },
      payload: { path: 'gone.ts' },
      target: t('gone.ts'),
    })
    endSession()

    const c = buildReport(store, sessionId)!.changes.find((x) => x.name === 'gone.ts')!
    expect(c.deleted).toBe(true)
  })
})

describe('D-054 — the session index cannot disagree with the report', () => {
  /**
   * The single-source-of-truth claim, asserted rather than promised.
   *
   * Found by mutation testing: hardcoding the index status to VERIFIED passed every test
   * in the suite. A list showing VERIFIED beside a report saying BROKEN is precisely the
   * two-renderers-two-answers failure D-049 exists to prevent — and it is the most
   * tempting bug in the codebase, because building the index the cheap way (a COUNT query)
   * would quietly redefine the word.
   */
  it('gives every row the same status the full report gives', () => {
    // Session 1: clean and well-formed.
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    // Session 2: degraded (no probe, never closed).
    const s2 = store.createSession({ runtimeId: 'claude-code', cwd: dir, mission: null })
    store.append({
      id: randomUUID(),
      sessionId: s2.id,
      ts: new Date(Date.UTC(2026, 0, 2)).toISOString(),
      monotonicTs: 1,
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.exit',
      actor: { kind: 'agent', runtimeId: 'claude-code' },
      payload: { command: 'npm test', exitCode: 1, durationMs: 1 },
      target: { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true },
    })

    const index = buildIndex(store)
    expect(index.length).toBe(2)

    for (const row of index) {
      const full = buildReport(store, row.session.id)!
      expect(row.status).toBe(full.integrity.status)
      expect(row.factsVerdict).toBe(full.factsVerdict)
      expect(row.factCount).toBe(full.facts.length)
      expect(row.closed).toBe(full.closed)
      expect(row.filesChanged).toBe(full.counts.filesChanged)
      expect(row.commands).toBe(full.counts.commands)
    }

    // And the statuses genuinely differ, so the assertion above is not vacuously true on
    // two identical rows.
    expect(new Set(index.map((r) => r.status)).size).toBeGreaterThan(1)
  })

  it('marks a tampered session BROKEN in the list, not just in the report', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE kind = 'process.exit'").run(JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 1 }))

    const row = buildIndex(store)[0]!
    expect(row.status).toBe('BROKEN')
    // The fact count is meaningless on a rewritten record; the row must not present "0
    // facts" as though the engine looked and found nothing.
    expect(row.factsVerdict).toBe('record-untrustworthy')
  })
})

// ===========================================================================
// D-056 — a fact, prepared for a human.
// ===========================================================================

describe('D-056 — fact titles and the evidence chain', () => {
  const t = (p: string): EventTarget => ({ raw: p, resolved: join(dir, p), kind: 'file', inScope: true })

  it('leads with a human title and keeps the catalog id available', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const v = buildReport(store, sessionId)!.views[0]!
    expect(v.title).toBe('Command failed')
    // Nothing is removed. `RF-01` is still there, on the fact itself, for the docs, the
    // tests, and the people who key on it.
    expect(v.fact.id).toBe('RF-01')
    expect(v.fact.statement).toBe('npm test exited with code 1')
  })

  /**
   * The title we did NOT use, and why this is a test rather than a comment.
   *
   * "Untested change" is the better headline and a claim we cannot carry: we know no test
   * ran after the change **that the boundary could observe**. On a machine with a shadowed
   * shim — which the coverage block reports — a test may have run and been invisible.
   *
   * The rule that bans claim-parsing bans the punchier title. This test is what stops it
   * from coming back when someone is writing marketing copy at speed.
   */
  it('never claims code is untested — only that a change came after the last test', () => {
    wellFormedSession()
    const testTime = Date.UTC(2026, 0, 1, 0, 0, 0)
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    append('file.write', { path: 'src/payments.mjs', mtimeMs: testTime + 60_000 }, t('src/payments.mjs'))
    endSession()

    const v = buildReport(store, sessionId)!.views.find((x) => x.fact.id === 'RF-04')!
    expect(v.title).toBe('Code changed after testing')

    const words = (v.title + ' ' + v.steps.map((s) => s.text).join(' ')).toLowerCase()
    expect(words).not.toContain('untested')
    expect(words).not.toContain('never tested')
    expect(words).not.toContain('not tested')
    // What it says instead: a statement about our record, which is all we have.
    expect(v.steps.at(-1)!.text).toBe('No test run was observed after this change.')
    expect(v.steps.at(-1)!.state).toBe('consequence')
  })

  /**
   * The chain reads as a story: test, then edit, then the gap.
   *
   * The order is the entire point — a developer sees "passed at 9:55:55, file changed at
   * 9:55:57" and understands instantly what a sentence takes ten seconds to convey.
   */
  it('orders the chain by when things HAPPENED, not when we noticed', () => {
    wellFormedSession()
    const testTime = Date.UTC(2026, 0, 1, 12, 0, 0)
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    // The fs recorder emits ~120ms late by design, so this event's `ts` is later than its
    // mtime. RF-04 compares mtimes (D-044) — so the chain must show mtimes too, or the
    // picture would be drawn from a different clock than the fact it illustrates.
    append('file.write', { path: 'src/payments.mjs', mtimeMs: testTime + 2_000 }, t('src/payments.mjs'))
    endSession()

    const v = buildReport(store, sessionId)!.views.find((x) => x.fact.id === 'RF-04')!
    const observed = v.steps.filter((s) => s.state === 'observed')

    expect(observed[0]!.text).toBe('npm test exited with code 0')
    expect(observed[1]!.text).toBe('wrote src/payments.mjs')
    // The write's step time is its mtime — the number the fact was computed from — not the
    // event's ts.
    expect(observed[1]!.ts).toBe(new Date(testTime + 2_000).toISOString())
    expect(observed[0]!.ts! < observed[1]!.ts!).toBe(true)
    // And the gap is stated last, after the two observations that create it.
    expect(v.steps.at(-1)!.state).toBe('consequence')
  })

  /**
   * The ordering property, on a chain long enough to prove it.
   *
   * Found by mutation testing: replacing the sort with `reverse()` passed every test
   * above. Every fact we build today carries exactly two evidence items in
   * newest-first order, so reversing them *happens* to produce the right answer — the
   * tests were pinning a coincidence, not the property.
   *
   * A failure with two failing descendants (`npm test` → `node` → `node`) gives three
   * steps, where sorted and reversed differ. The chain is the story, and a story out of
   * order is not a smaller version of the truth.
   */
  it('sorts a three-step chain ascending, where reversing would not', () => {
    wellFormedSession()
    const exec = (command: string, execId: string, parentExecId: string | undefined, at: number) =>
      store.append({
        id: randomUUID(),
        sessionId,
        ts: new Date(Date.UTC(2026, 0, 1, 12, 0, at)).toISOString(),
        monotonicTs: at * 1000,
        source: 'process',
        signalTier: 'groundTruth',
        kind: 'process.exit',
        actor: { kind: 'agent', runtimeId: 'claude-code' },
        payload: { command, exitCode: 1, durationMs: 1, execId, ...(parentExecId ? { parentExecId } : {}) },
        target: { raw: command, resolved: command, kind: 'process', inScope: true },
      })

    // Two children fail underneath one parent. The parent exits last.
    exec('node a.test.js', 'child-1', 'parent-1', 1)
    exec('node b.test.js', 'child-2', 'parent-1', 2)
    exec('npm test', 'parent-1', undefined, 3)
    endSession()

    const v = buildReport(store, sessionId)!.views.find((x) => x.fact.id === 'RF-01')!
    const observed = v.steps.filter((s) => s.state === 'observed')
    expect(observed.length).toBe(3)

    const times = observed.map((s) => s.ts!)
    expect([...times].sort()).toEqual(times)
    // The causal chain reads downward: the children that failed, then the command that
    // reported it.
    expect(observed.at(-1)!.text).toBe('npm test exited with code 1')
  })

  it('gives every fact in the catalog a title', () => {
    // A missing title renders as `undefined` in the headline — the loudest possible way to
    // learn a fact was added without one.
    const proc = (command: string, payload: Record<string, unknown>) =>
      append('process.exit', { command, durationMs: 1, ...payload }, { raw: command, resolved: command, kind: 'process', inScope: true })
    const snap = (path: string, before: string, after: string, inScope = true) =>
      store.append({
        id: randomUUID(),
        sessionId,
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
        monotonicTs: clock * 1000,
        source: 'fs',
        signalTier: 'groundTruth',
        kind: 'file.write',
        actor: { kind: 'agent', runtimeId: 'claude-code' },
        payload: { path, mtimeMs: 1 },
        target: { raw: path, resolved: inScope ? join(dir, path) : path, kind: 'file', inScope },
        snapshotRef: { before, after },
      })

    wellFormedSession()
    proc('npm run build', { exitCode: 1 }) // RF-01
    snap('src/a.ts', 'h1', 'h2')
    snap('src/a.ts', 'h2', 'h1') // RF-05
    snap('/home/dev/.bashrc', 'x', 'y', false) // RF-07
    proc('docker build .', { exitCode: null, signal: 'SIGKILL' }) // RF-06
    append('git.status', { dirtyAtEnd: ['src/a.ts'], branch: 'main' }) // RF-02
    endSession()

    const views = buildReport(store, sessionId)!.views
    expect(views.length).toBeGreaterThan(3)
    for (const v of views) {
      expect(v.title).toBeTruthy()
      expect(v.title).not.toMatch(/undefined/)
      // The title is a headline, not a sentence, and never an accusation.
      expect(v.title.length).toBeLessThan(40)
      expect(v.title.toLowerCase()).not.toMatch(/\b(lied|failed to|should|forgot|careless)\b/)
    }
  })

  it('every observed step names a real event in the record', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    const seqs = new Set(r.timeline.map((t2) => t2.seq))
    for (const v of r.views) {
      for (const s of v.steps.filter((x) => x.state === 'observed')) {
        expect(seqs.has(s.eventSeq!)).toBe(true)
      }
    }
  })

  it('views and facts are the same objects, so they cannot drift', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.views.length).toBe(r.facts.length)
    r.views.forEach((v, i) => expect(v.fact).toBe(r.facts[i]))
  })
})

// ===========================================================================
// Composition: the model is what the dashboard will render.
// ===========================================================================

describe('the model the dashboard consumes', () => {
  it('resolves every fact evidence pointer to a real event', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.facts.length).toBeGreaterThan(0)
    // The dashboard renders `evidence[pointer.eventId]` and must never have to go looking.
    for (const f of r.facts) {
      for (const ev of f.evidence) {
        expect(r.evidence[ev.eventId]).toBeDefined()
        expect(r.evidence[ev.eventId]!.summary).toBeTruthy()
      }
    }
  })

  it('marks cited events in the timeline so a renderer can link fact to evidence', () => {
    wellFormedSession()
    const exitId = append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.timeline.find((t) => t.eventId === exitId)!.cited).toBe(true)
    expect(r.timeline.find((t) => t.kind === 'session.start')!.cited).toBe(false)
  })

  it('summarises events in the neutral voice, never as a judgment', () => {
    wellFormedSession()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 10 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    append('process.exit', { command: 'cargo test', exitCode: null, signal: 'SIGKILL', durationMs: 10 }, { raw: 'cargo test', resolved: 'cargo test', kind: 'process', inScope: true })
    endSession()

    const r = buildReport(store, sessionId)!
    const summaries = r.timeline.map((t) => t.summary)
    expect(summaries).toContain('npm test exited with code 1')
    expect(summaries).toContain('cargo test was terminated by SIGKILL')
    // The Reality Facts Rule, applied to the timeline: report state, never characterise.
    for (const s of summaries) expect(s).not.toMatch(/\b(failed|lied|forgot|broke|should have)\b/i)
  })

  it('reads identity from the session.start EVENT, not the mutable sessions table', () => {
    // D-035: the sessions table has no triggers and can be UPDATEd freely. Identity that
    // can be silently rewritten is not identity, so the report reads the chained event.
    wellFormedSession()
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.identity.model).toBe('claude-opus-4-8')
    expect(r.identity.machineId).toBe('m1')
    expect(r.identity.gitCommit).toBe('abc123')
  })

  it('counts distinct files changed, not write events', () => {
    wellFormedSession()
    const t = (p: string): EventTarget => ({ raw: p, resolved: join(dir, p), kind: 'file', inScope: true })
    append('file.write', { path: 'a.ts' }, t('a.ts'))
    append('file.write', { path: 'a.ts' }, t('a.ts'))
    append('file.write', { path: 'b.ts' }, t('b.ts'))
    endSession()

    expect(buildReport(store, sessionId)!.counts.filesChanged).toBe(2)
  })

  it('surfaces LODESTAR interference separately from the facts — D-039', () => {
    wellFormedSession()
    append('agent.output', { lodestarInterference: true, command: 'npm run check', reason: 'refused: unsafe argument' })
    endSession()

    const r = buildReport(store, sessionId)!
    expect(r.interference).toHaveLength(1)
    expect(r.interference[0]).toMatch(/not the agent's failure/)
    // Interference is reported ALONGSIDE facts and never subtracts from them (D-041).
    expect(r.facts.every((f) => !/LODESTAR refused/.test(f.statement))).toBe(true)
  })

  it('returns null for a session that does not exist, and never a fake empty report', () => {
    expect(buildReport(store, randomUUID())).toBeNull()
  })

  it('carries limitations through from the fact engine', () => {
    wellFormedSession()
    append('file.write', { path: 'a.ts', mtimeMs: 1 }, { raw: 'a.ts', resolved: join(dir, 'a.ts'), kind: 'file', inScope: true })
    endSession()

    // No commands observed + files changed → the fact engine declares the gap, and the
    // report must carry it rather than deciding for itself what to show.
    const r = buildReport(store, sessionId)!
    expect(r.limitations.some((n) => /No commands were observed/i.test(n))).toBe(true)
  })
})
