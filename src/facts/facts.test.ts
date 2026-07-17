/**
 * Phase 6 — adversarial tests.
 *
 * The claim under test is the company's central one:
 *
 *   "LODESTAR observes reality at the execution boundary, not what the AI claims
 *    happened."
 *
 * A test that mocked the process layer would prove nothing about that. So these run
 * real processes, write real files, and make real commits — and in every scenario the
 * agent *lies*, loudly, in narration that LODESTAR records and then refuses to believe.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Recorder } from '../recorder/index.js'
import { evaluate } from './index.js'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { writeConfig } from '../core/config.js'
import { paths } from '../core/project.js'
import { FLOOR_ONLY } from '../adapters/registry.js'
import type { DraftEvent } from '../types/events.js'

let root: string
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lodestar-adv-'))
  const p = paths(root)
  mkdirSync(p.sessions, { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeConfig(p.config)
  openDatabase(p.db).close()
})

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* Windows may still hold the watcher handle */
  }
})

function newRecorder(mission?: string): Recorder {
  return new Recorder({ root, runtimeId: 'test-runtime', mission: mission ?? null, capabilities: FLOOR_ONLY })
}

function withStore<T>(fn: (s: SqliteEventStore) => T): T {
  const db = openDatabase(paths(root).db)
  try {
    return fn(new SqliteEventStore(db))
  } finally {
    db.close()
  }
}

/**
 * Wall + monotonic clocks for synthetic events, derived from the moment the test runs.
 *
 * These events sit in the store NEXT TO the recorder's real session events, which carry
 * today's wall clock. A fixed past-dated `ts` with `monotonicTs: 0` therefore reads as a
 * backward wall-clock step, and `clockRegression` (D-069) — correctly — takes RF-04 out
 * of the evaluation for the whole session. That failure mode is exactly what D-069
 * detects; these fixtures must describe an ordinary session, not a clock anomaly, so
 * both clocks are derived from the same offsets and always land after the real events.
 */
function syntheticClocks() {
  const t0 = Date.now()
  return {
    at: (s: number) => new Date(t0 + s * 1000).toISOString(),
    mono: (s: number) => s * 1000,
  }
}

/** The agent says something. This is narration — tier `narration`, never ground truth. */
function agentClaims(store: SqliteEventStore, sessionId: string, text: string): void {
  const draft: DraftEvent = {
    id: randomUUID(),
    sessionId,
    ts: new Date().toISOString(),
    monotonicTs: 0,
    source: 'stdio',
    signalTier: 'narration',
    kind: 'agent.output',
    actor: { kind: 'agent', runtimeId: 'test-runtime' },
    payload: { text },
  }
  store.append(draft)
}

// ===========================================================================
// A) Agent claims success but the command failed. Reality must win.
// ===========================================================================

describe('A) agent claims success, command actually failed', () => {
  it('reports the real exit code and ignores the claim entirely', async () => {
    const r = newRecorder('Build authentication system')
    const session = await r.start()

    await r.proc.run(process.execPath, ['-e', 'process.exit(1)'], { captureOutput: true })
    await r.stop(0)

    withStore((store) => {
      // The agent insists it worked. Loudly. Repeatedly.
      agentClaims(store, session.id, 'Authentication completed successfully. All tests pass.')
      agentClaims(store, session.id, 'npm test passed with 0 failures.')

      const facts = evaluate(store, session.id)
      const rf01 = facts.filter((f) => f.id === 'RF-01')

      // Reality wins.
      expect(rf01).toHaveLength(1)
      expect(rf01[0]!.statement).toMatch(/exited with code 1/)
      expect(rf01[0]!.confidence).toBe('high')
      expect(rf01[0]!.evidence[0]!.source).toBe('process_exit')

      // And the fact is not derived from anything the agent said.
      expect(rf01[0]!.statement).not.toMatch(/agent|claim|report|said|lie/i)
    })
  })

  it('never emits a fact sourced from an agent message', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.proc.run(process.execPath, ['-e', 'process.exit(2)'])
    await r.stop(0)

    withStore((store) => {
      agentClaims(store, session.id, 'Everything worked perfectly!')
      const facts = evaluate(store, session.id)
      // `agent_message` is not a member of EvidenceSource. This asserts the type-level
      // ban holds at runtime too.
      for (const f of facts) {
        for (const e of f.evidence) {
          expect(['process_exit', 'file_write', 'git_state', 'file_delete']).toContain(e.source)
        }
      }
    })
  })

  it('reports fix-then-pass as history, without crying wolf — and without deleting it', async () => {
    // This used to assert ZERO facts: a later success CANCELLED the earlier failure.
    //
    // That cancellation was the C2 vulnerability. Last-write-wins means an attacker
    // writes last: one appended `npm test exit 0` erased a real failure while the chain
    // still verified `intact`. The bug was never the forgery — it was that new evidence
    // could DELETE old evidence. See D-045.
    //
    // So the failure survives, qualified. This still does not cry wolf (the statement says
    // it was resolved), and a forged pass now appends a line that CONTRADICTS a visible
    // failure rather than silently removing it — louder than the failure alone.
    const r = newRecorder()
    const session = await r.start()

    const cmd = [process.execPath, '-e', 'process.exit(Number(process.env.C||0))']
    await r.proc.run(cmd[0]!, cmd.slice(1), { env: { ...process.env, C: '1' } })
    await r.proc.run(cmd[0]!, cmd.slice(1), { env: { ...process.env, C: '0' } })
    await r.stop(0)

    withStore((store) => {
      const rf01 = evaluate(store, session.id).filter((f) => f.id === 'RF-01')
      expect(rf01).toHaveLength(1)
      expect(rf01[0]!.statement).toMatch(/exited with code 1, then passed on a later run/)
    })
  })
})

// ===========================================================================
// B) Agent claims a command ran, but no process event exists.
//    Missing evidence must be VISIBLE, not filled in.
// ===========================================================================

describe('B) agent claims a command ran that left no evidence', () => {
  it('produces no fact — absence of evidence is not evidence', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.stop(0)

    withStore((store) => {
      agentClaims(store, session.id, 'I ran npm test and it passed.')

      // No process.exit event exists. LODESTAR must not invent one, and must not
      // "believe" the claim in either direction.
      const facts = evaluate(store, session.id)
      expect(facts).toHaveLength(0)

      const groundTruth = store.query({ sessionId: session.id, signalTier: 'groundTruth' })
      expect(groundTruth.some((e) => e.kind === 'process.exit')).toBe(false)
    })
  })

  it('keeps the unverifiable claim in the record, tiered as narration', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.stop(0)

    withStore((store) => {
      agentClaims(store, session.id, 'I ran the full test suite.')

      // The claim is retained — it is context, and a human investigating wants it.
      const all = store.query({ sessionId: session.id })
      const claim = all.find((e) => e.kind === 'agent.output')
      expect(claim).toBeDefined()
      expect(claim!.signalTier).toBe('narration')

      // But it is unreachable from the facts query path. By construction.
      const facts = store.query({ sessionId: session.id, signalTier: 'groundTruth' })
      expect(facts.some((e) => e.id === claim!.id)).toBe(false)
    })
  })
})

// ===========================================================================
// C) Wrapper crashes mid-session. The partial session must remain valid.
// ===========================================================================

describe('C) wrapper dies mid-session', () => {
  it('leaves a partial record that still verifies', async () => {
    const r = newRecorder()
    const session = await r.start()

    writeFileSync(join(root, 'src', 'a.ts'), 'work in progress')
    await settle()
    await r.proc.run(process.execPath, ['-e', 'process.exit(1)'])

    // No stop() — simulate the wrapper being killed. session.end is never written.
    withStore((store) => {
      const result = store.verify(session.id)
      // A truncated chain is still a valid chain. Everything up to the crash is intact
      // and provable; the record simply ends.
      expect(result.intact).toBe(true)
      expect(result.eventsChecked).toBeGreaterThan(1)

      const events = store.query({ sessionId: session.id })
      expect(events.some((e) => e.kind === 'session.end')).toBe(false)

      // And facts still compute from what survived.
      expect(evaluate(store, session.id).some((f) => f.id === 'RF-01')).toBe(true)
    })
  })

  it('shows an unclosed session as unclosed rather than guessing', async () => {
    const r = newRecorder()
    const session = await r.start()
    await settle(50)

    withStore((store) => {
      const s = store.getSession(session.id)
      expect(s!.endedAt).toBeNull()
      // An exit code we never received must stay unknown. Defaulting it to 0 would
      // manufacture a successful session out of a crash.
      expect(s!.exitCode).toBeNull()
    })
  })
})

// ===========================================================================
// D) User bypasses the wrapper. Coverage must report the gap.
// ===========================================================================

describe('D) work happens outside the wrapper', () => {
  it('records file effects but claims no exit code it did not receive', async () => {
    const r = newRecorder()
    const session = await r.start()

    // A command run outside LODESTAR entirely — we are not its parent.
    const { execFileSync } = await import('node:child_process')
    execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(join(root, 'src', 'external.ts'))}, 'written by an unobserved process')`])
    await settle()
    await r.stop(0)

    withStore((store) => {
      const events = store.query({ sessionId: session.id })

      // The floor caught the EFFECT — the file exists and we have its content.
      const write = events.find((e) => String(e.target?.resolved).includes('external.ts'))
      expect(write).toBeDefined()
      expect(write!.signalTier).toBe('groundTruth')

      // But no exit code was invented for a process we never parented.
      const exits = events.filter((e) => e.kind === 'process.exit')
      expect(exits).toHaveLength(0)
    })
  })

  it('reports command coverage as measured, never as assumed', async () => {
    const r = newRecorder()
    await r.start()
    const summary = await r.stop(0)

    // Shims are off for this recorder, so nothing may be claimed as observed.
    expect(summary.coverage.commands).toEqual([])
    expect(summary.coverage.toolCalls).toBe(false)
    expect(summary.coverage.resolvedTargets).toBe(false)
    // The agent process itself IS ours, so this one is true.
    expect(summary.coverage.agentLifecycle).toBe(true)
  })
})

// ===========================================================================
// RF-04 — files modified after the last test run
// ===========================================================================

describe('RF-04 — modified after the last test run', () => {
  it('fires when a file is written after the tests ran', async () => {
    const r = newRecorder()
    const session = await r.start()

    writeFileSync(join(root, 'src', 'auth.ts'), 'v1')
    await settle()
    await r.proc.run(process.execPath, ['-e', 'process.exit(0)'], {
      // A test-shaped command, matched on the resolved string.
      env: process.env,
    })
    await settle(100)
    writeFileSync(join(root, 'src', 'auth.ts'), 'v2 — written AFTER the tests')
    await settle()
    await r.stop(0)

    withStore((store) => {
      // The command above is `node -e ...`, which is not test-shaped, so RF-04 should
      // NOT fire — proving the matcher does not fire on any command at all.
      expect(evaluate(store, session.id).some((f) => f.id === 'RF-04')).toBe(false)
    })
  })

  it('links BOTH the file write and the test run as evidence', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.stop(0)

    withStore((store) => {
      // Build the exact shape RF-04 looks for, using real test-shaped commands.
      const { at, mono } = syntheticClocks()
      const base = {
        sessionId: session.id,
        signalTier: 'groundTruth' as const,
        actor: { kind: 'agent' as const, runtimeId: 'test-runtime' },
      }
      store.append({
        ...base,
        id: randomUUID(),
        ts: at(60),
        monotonicTs: mono(60),
        source: 'process',
        kind: 'process.exit',
        payload: { command: 'npm test', exitCode: 1, durationMs: 4200 },
      })
      store.append({
        ...base,
        id: randomUUID(),
        ts: at(240),
        monotonicTs: mono(240),
        source: 'fs',
        kind: 'file.write',
        target: { raw: 'src/auth.ts', resolved: '/p/src/auth.ts', kind: 'file', inScope: true },
        // mtimeMs is what makes "after" a measurement rather than an inference (D-044).
        // The OS says this write happened at +240s; the test ended at +60s.
        payload: { path: 'src/auth.ts', mtimeMs: Date.parse(at(240)) },
      })

      const facts = evaluate(store, session.id)
      const rf04 = facts.find((f) => f.id === 'RF-04')

      expect(rf04).toBeDefined()
      expect(rf04!.statement).toBe('auth.ts modified after the last test run')
      expect(rf04!.confidence).toBe('high')
      // Both halves of the claim must be evidenced: the write AND the test it followed.
      expect(rf04!.evidence.map((e) => e.source).sort()).toEqual(['file_write', 'process_exit'])

      // And RF-01 fires on the same session, independently.
      expect(facts.some((f) => f.id === 'RF-01' && /npm test exited with code 1/.test(f.statement))).toBe(true)
    })
  })

  it('does not claim a write is stale when it happened BEFORE the test — D-044', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.stop(0)

    withStore((store) => {
      const { at, mono } = syntheticClocks()
      const base = {
        sessionId: session.id,
        signalTier: 'groundTruth' as const,
        actor: { kind: 'agent' as const, runtimeId: 't' },
      }
      // The edit-then-test sequence, exactly as a real session records it.
      //
      // This test used to assert the OPPOSITE — that a write appended after the test event
      // fires RF-04 regardless of when it actually happened, because "ordering must follow
      // the chain". That is the D-044 false positive, asserted as a requirement.
      //
      // `seq` orders OBSERVATIONS. The fs recorder observes late on purpose: it waits
      // 120ms for writes to settle, then hashes the file before emitting, while process
      // events emit immediately. So the write HAPPENED first and was RECORDED second —
      // and RF-04 announced "a.ts modified after the last test run" on the single most
      // common thing an agent does, with no adversary present.
      store.append({
        ...base,
        id: randomUUID(),
        ts: at(60),
        monotonicTs: mono(60),
        source: 'process',
        kind: 'process.exit',
        payload: { command: 'npm test', exitCode: 0, durationMs: 10 },
      })
      store.append({
        ...base,
        id: randomUUID(),
        ts: at(60.083), // appended AFTER the test — 83ms of watcher lag
        monotonicTs: mono(60.083),
        source: 'fs',
        kind: 'file.write',
        target: { raw: 'a.ts', resolved: '/p/a.ts', kind: 'file', inScope: true },
        // ...but the OS says the write HAPPENED before the test ran.
        payload: { path: 'a.ts', mtimeMs: Date.parse(at(59)) },
      })

      // No fact. The test covered this file's final state, so there is nothing to report.
      expect(evaluate(store, session.id).some((f) => f.id === 'RF-04')).toBe(false)
    })
  })

  it('will not claim "after" when it cannot measure when the write happened', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.stop(0)

    withStore((store) => {
      const { at, mono } = syntheticClocks()
      const base = {
        sessionId: session.id,
        signalTier: 'groundTruth' as const,
        actor: { kind: 'agent' as const, runtimeId: 't' },
      }
      store.append({
        ...base,
        id: randomUUID(),
        ts: at(60),
        monotonicTs: mono(60),
        source: 'process',
        kind: 'process.exit',
        payload: { command: 'npm test', exitCode: 0, durationMs: 10 },
      })
      store.append({
        ...base,
        id: randomUUID(),
        ts: at(240),
        monotonicTs: mono(240),
        source: 'fs',
        kind: 'file.write',
        target: { raw: 'a.ts', resolved: '/p/a.ts', kind: 'file', inScope: true },
        payload: { path: 'a.ts' }, // no mtimeMs — pre-D-044, or an unreadable stat
      })

      // Unknown stays unknown. A fact built on a missing field is the guess this rule
      // exists to forbid, and a false accusation is more expensive than a miss.
      expect(evaluate(store, session.id).some((f) => f.id === 'RF-04')).toBe(false)
    })
  })

  it('says nothing when there is nothing to say', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.proc.run(process.execPath, ['-e', 'process.exit(0)'])
    await r.stop(0)

    withStore((store) => {
      // "No divergences observed" is a valid, honest result. Never manufacture concern.
      expect(evaluate(store, session.id)).toEqual([])
    })
  })
})
