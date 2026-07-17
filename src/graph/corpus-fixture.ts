/**
 * LODESTAR — the multi-developer corpus (M3 §2.2).
 *
 * Three simulated weeks of engineering across 3 repositories, 4 developers, 5
 * machines, and 3 agents — built through the REAL machinery (real append chains,
 * real buildRecord), with scripted drafts and fixed timestamps, because that is the
 * one thing genuine recorder runs cannot give a test: five machines and three weeks
 * inside one process. Every value is a constant; the corpus is byte-deterministic.
 *
 * What it deliberately contains, so investigations have something worth asking about:
 *   - a file three developers churn in one week (contention)
 *   - the incident arc: charge.mjs modified AFTER its last observed test run
 *     on July 10, and the hotfix session that evening
 *   - a contractor fork of acme/web (same root, different origin)
 *   - acme/infra renamed to acme/platform mid-corpus (split + lineage candidate,
 *     per F2: indistinguishable from a fork, one link away from merged)
 *   - a foreign-generator re-analysis with a partial catalog
 *   - one session that never ended (DEGRADED, honestly)
 *   - one machine that goes silent in week 3 (coverage shows it; nothing judges it)
 *   - an out-of-scope write (/etc/hosts) in an infra session
 *
 * This corpus SIMULATES developers; it cannot validate that real ones will share
 * evidence. That boundary is stated in M3's stop-report, not blurred here.
 */

import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { buildRecord, computeRecordId } from '../record/build.js'
import type { EvidenceRecord } from '../record/types.js'
import type { DraftEvent } from '../types/events.js'
import { addRecordValue, initGraph, type Graph } from './store.js'

const ROOT_PAY = 'aaaa000000000000000000000000000000000001'
const ROOT_WEB = 'bbbb000000000000000000000000000000000002'
const ROOT_INF = 'cccc000000000000000000000000000000000003'

interface Repo {
  origin: string
  root: string
}
const PAYMENTS: Repo = { origin: 'https://github.com/acme/payments', root: ROOT_PAY }
const WEB: Repo = { origin: 'https://github.com/acme/web', root: ROOT_WEB }
const WEB_FORK: Repo = { origin: 'https://github.com/contractor/web', root: ROOT_WEB }
const INFRA: Repo = { origin: 'https://github.com/acme/infra', root: ROOT_INF }
const PLATFORM: Repo = { origin: 'https://github.com/acme/platform', root: ROOT_INF }

interface SessionSpec {
  key: string
  start: string
  repo: Repo
  cwd: string
  machine: string
  agent: string
  /** [relPath, minuteOffset] file writes, mtime = start + offset. */
  writes: Array<[string, number]>
  /** [command, exitCode|'SIGKILL', minuteOffset] process exits. */
  commands: Array<[string, number | 'SIGKILL', number]>
  dirty?: string[]
  /** Write outside the project (absolute path), minuteOffset. */
  outOfScope?: [string, number]
  open?: boolean
  gitShadowed?: boolean
}

const min = (iso: string, m: number): string =>
  new Date(Date.parse(iso) + m * 60_000).toISOString()

function draftsOf(s: SessionSpec): DraftEvent[] {
  const drafts: DraftEvent[] = []
  let n = 0
  const e = (
    tsOffsetMin: number,
    rest: Omit<DraftEvent, 'id' | 'sessionId' | 'ts' | 'monotonicTs' | 'actor'>,
  ): void => {
    n++
    drafts.push({
      id: `${s.key}-e${String(n).padStart(3, '0')}`,
      sessionId: `corpus-${s.key}`,
      ts: min(s.start, tsOffsetMin),
      // Anchored to the same wall offset as `ts`, plus a per-event tiebreaker. The two
      // clocks must agree: `n * 1000` here made wall time step BACK minutes between
      // adjacent drafts (commands and writes interleave by offset) while the monotonic
      // clock advanced, which reads as a backward wall-clock step — and clockRegression
      // (D-069) then correctly refuses to evaluate RF-04 over every corpus session.
      monotonicTs: tsOffsetMin * 60_000 + n,
      actor: { kind: 'agent', runtimeId: s.agent },
      ...rest,
    })
  }

  e(0, {
    source: 'process',
    signalTier: 'groundTruth',
    kind: 'session.start',
    payload: {
      runtimeId: s.agent,
      cwd: s.cwd,
      argv: [s.agent],
      machineId: s.machine,
      gitCommit: `${s.repo.root.slice(0, 8)}00${s.key.length.toString(16)}`,
      gitRemotes: [{ name: 'origin', url: s.repo.origin }],
      gitRootCommits: [s.repo.root],
    },
  })
  e(0, {
    source: 'process',
    signalTier: 'groundTruth',
    kind: 'agent.output',
    payload: {
      coverageProbe: {
        commands: [
          { command: 'npm', status: 'observed', resolvedTo: '/shims/npm' },
          { command: 'node', status: 'observed', resolvedTo: '/shims/node' },
          { command: 'git', status: s.gitShadowed ? 'shadowed' : 'observed', resolvedTo: '/bin/git' },
        ],
      },
    },
  })

  for (const [cmd, exit, offset] of s.commands) {
    e(offset, {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'process.exit',
      payload:
        exit === 'SIGKILL'
          ? { command: cmd, exitCode: null, signal: 'SIGKILL', durationMs: 5000, cwd: s.cwd }
          : { command: cmd, exitCode: exit, durationMs: 1200, cwd: s.cwd },
    })
  }

  for (const [rel, offset] of s.writes) {
    const abs = `${s.cwd}/${rel}`
    e(offset, {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: { raw: abs, resolved: abs, kind: 'file', inScope: true },
      payload: { path: abs, bytesBefore: 100, bytesAfter: 140, mtimeMs: Date.parse(min(s.start, offset)) },
    })
  }

  if (s.outOfScope) {
    const [abs, offset] = s.outOfScope
    e(offset, {
      source: 'fs',
      signalTier: 'groundTruth',
      kind: 'file.write',
      target: { raw: abs, resolved: abs, kind: 'file', inScope: false },
      payload: { path: abs, bytesBefore: 40, bytesAfter: 60, mtimeMs: Date.parse(min(s.start, offset)) },
    })
  }

  if (s.dirty) {
    e(58, {
      source: 'git',
      signalTier: 'groundTruth',
      kind: 'git.status',
      payload: { dirtyAtEnd: s.dirty, branch: 'main', head: `${s.repo.root.slice(0, 8)}ff` },
    })
  }

  if (!s.open) {
    e(60, {
      source: 'process',
      signalTier: 'groundTruth',
      kind: 'session.end',
      payload: { exitCode: 0, durationMs: 3_600_000 },
    })
  }

  return drafts
}

function recordOf(s: SessionSpec): EvidenceRecord {
  const db = openDatabase(':memory:')
  try {
    const store = new SqliteEventStore(db)
    db.prepare(
      `INSERT INTO sessions (id, number, runtime_id, mission, started_at, ended_at, exit_code, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `corpus-${s.key}`,
      1,
      s.agent,
      null,
      s.start,
      s.open ? null : min(s.start, 60),
      s.open ? null : 0,
      s.cwd,
    )
    for (const d of draftsOf(s)) store.append(d)
    const record = buildRecord(store, `corpus-${s.key}`)
    if (!record) throw new Error(`corpus session ${s.key} did not build`)
    return record
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// The three weeks. Times UTC; keys are stable identifiers used in test assertions.
// ---------------------------------------------------------------------------

const ALICE_PAY = { cwd: '/home/alice/payments', machine: 'm-alice' }
const ALICE_LAP = { cwd: '/home/alice/work/payments', machine: 'm-alice-laptop' }
const BOB_PAY = { cwd: 'C:\\dev\\payments', machine: 'm-bob' }
const CAROL_PAY = { cwd: '/Users/carol/payments', machine: 'm-carol' }
const DANA_WEB = { cwd: '/home/dana/web', machine: 'm-dana' }

const TEST_PASS: Array<[string, number | 'SIGKILL', number]> = [['npm test', 0, 30]]
const TEST_FAIL_FIX: Array<[string, number | 'SIGKILL', number]> = [
  ['npm test', 1, 20],
  ['npm test', 0, 45],
]

export function corpusSpecs(): SessionSpec[] {
  const specs: SessionSpec[] = []
  const add = (s: SessionSpec): void => {
    specs.push(s)
  }

  // ---- Week 1 (Jun 29 – Jul 3): steady feature work --------------------------------
  add({ key: 'w1-alice-1', start: '2026-06-29T09:00:00.000Z', repo: PAYMENTS, ...ALICE_PAY, agent: 'claude-code', writes: [['src/ledger.mjs', 10], ['src/ledger.test.mjs', 15]], commands: TEST_PASS })
  add({ key: 'w1-bob-1', start: '2026-06-29T13:00:00.000Z', repo: PAYMENTS, ...BOB_PAY, agent: 'codex', writes: [['src/refund.mjs', 12]], commands: TEST_FAIL_FIX, gitShadowed: true })
  add({ key: 'w1-carol-1', start: '2026-06-30T10:00:00.000Z', repo: PAYMENTS, ...CAROL_PAY, agent: 'claude-code', writes: [['src/charge.mjs', 8]], commands: TEST_PASS })
  add({ key: 'w1-dana-1', start: '2026-06-30T11:00:00.000Z', repo: WEB_FORK, ...DANA_WEB, agent: 'aider', writes: [['src/App.jsx', 9], ['src/api.js', 22]], commands: TEST_PASS })
  add({ key: 'w1-alice-2', start: '2026-07-01T09:30:00.000Z', repo: WEB, cwd: '/home/alice/web', machine: 'm-alice', agent: 'claude-code', writes: [['src/api.js', 7]], commands: TEST_PASS })
  add({ key: 'w1-infra-1', start: '2026-07-01T15:00:00.000Z', repo: INFRA, cwd: '/home/alice/infra', machine: 'm-alice', agent: 'claude-code', writes: [['deploy/main.tf', 11]], commands: [['make test', 0, 25]], outOfScope: ['/etc/hosts', 14] })
  add({ key: 'w1-bob-2', start: '2026-07-02T10:00:00.000Z', repo: PAYMENTS, ...BOB_PAY, agent: 'codex', writes: [['src/charge.mjs', 18]], commands: TEST_PASS, gitShadowed: true })
  add({ key: 'w1-carol-2', start: '2026-07-02T14:00:00.000Z', repo: PAYMENTS, ...CAROL_PAY, agent: 'claude-code', writes: [['src/charge.test.mjs', 10]], commands: TEST_PASS })
  add({ key: 'w1-dana-2', start: '2026-07-03T09:00:00.000Z', repo: WEB_FORK, ...DANA_WEB, agent: 'aider', writes: [['src/App.jsx', 13]], commands: [['npm test', 'SIGKILL', 21]] })

  // ---- Week 2 (Jul 6 – Jul 10): contention on charge.mjs, then the incident --------
  add({ key: 'w2-alice-1', start: '2026-07-06T09:00:00.000Z', repo: PAYMENTS, ...ALICE_PAY, agent: 'claude-code', writes: [['src/charge.mjs', 12], ['src/ledger.mjs', 25]], commands: TEST_PASS })
  add({ key: 'w2-bob-1', start: '2026-07-07T11:00:00.000Z', repo: PAYMENTS, ...BOB_PAY, agent: 'codex', writes: [['src/charge.mjs', 9]], commands: TEST_FAIL_FIX, gitShadowed: true })
  add({ key: 'w2-carol-1', start: '2026-07-08T10:00:00.000Z', repo: PAYMENTS, ...CAROL_PAY, agent: 'claude-code', writes: [['src/charge.mjs', 15]], commands: TEST_PASS, dirty: ['src/charge.mjs'] })
  add({ key: 'w2-alice-lap', start: '2026-07-08T20:00:00.000Z', repo: PAYMENTS, ...ALICE_LAP, agent: 'claude-code', writes: [['src/ledger.mjs', 6]], commands: TEST_PASS })
  add({ key: 'w2-infra-1', start: '2026-07-09T09:00:00.000Z', repo: INFRA, cwd: '/home/alice/infra', machine: 'm-alice', agent: 'claude-code', writes: [['deploy/main.tf', 8]], commands: [['make test', 0, 20]] })
  // THE INCIDENT, July 10: bob's tests pass at 14:28... then one more edit at 14:41.
  add({ key: 'incident', start: '2026-07-10T14:00:00.000Z', repo: PAYMENTS, ...BOB_PAY, agent: 'codex', writes: [['src/charge.mjs', 20], ['src/charge.mjs', 41]], commands: [['npm test', 0, 28]], dirty: ['src/charge.mjs'], gitShadowed: true })
  add({ key: 'hotfix', start: '2026-07-10T19:00:00.000Z', repo: PAYMENTS, ...CAROL_PAY, agent: 'claude-code', writes: [['src/charge.mjs', 15]], commands: TEST_FAIL_FIX })

  // ---- Week 3 (Jul 13 – 17): rename, quiet carol, an unclosed session --------------
  add({ key: 'w3-plat-1', start: '2026-07-13T10:00:00.000Z', repo: PLATFORM, cwd: '/home/alice/infra', machine: 'm-alice', agent: 'claude-code', writes: [['deploy/main.tf', 9]], commands: [['make test', 0, 18]] })
  add({ key: 'w3-bob-1', start: '2026-07-14T09:00:00.000Z', repo: PAYMENTS, ...BOB_PAY, agent: 'codex', writes: [['src/refund.mjs', 14]], commands: TEST_PASS, gitShadowed: true })
  add({ key: 'w3-dana-open', start: '2026-07-15T16:00:00.000Z', repo: WEB_FORK, ...DANA_WEB, agent: 'aider', writes: [['src/api.js', 5]], commands: [], open: true })
  add({ key: 'w3-alice-1', start: '2026-07-16T09:00:00.000Z', repo: PAYMENTS, ...ALICE_PAY, agent: 'claude-code', writes: [['src/ledger.mjs', 11]], commands: TEST_PASS })
  add({ key: 'w3-plat-2', start: '2026-07-16T15:00:00.000Z', repo: PLATFORM, cwd: '/home/alice/infra', machine: 'm-alice', agent: 'claude-code', writes: [['deploy/roles.tf', 7]], commands: [['make test', 1, 16]] })

  return specs
}

/** Every corpus record, plus one foreign-generator re-analysis of the incident. */
export function corpusRecords(): EvidenceRecord[] {
  const records = corpusSpecs().map(recordOf)

  const incident = records.find((r) => r.subject.sessionId === 'corpus-incident')!
  const reanalysis = structuredClone(incident)
  reanalysis.generator = { name: 'aider-emit', version: '0.3' }
  reanalysis.evidence.catalog = ['RF-01', 'RF-02']
  // A coherent foreign generator reports only what its catalog evaluates — the
  // whole point of catalog conditioning is that its RF-04 silence means "never
  // looked", and the graph must say so rather than read it as clean.
  reanalysis.evidence.facts = reanalysis.evidence.facts.filter((f) =>
    (['RF-01', 'RF-02'] as string[]).includes(f.id),
  )
  reanalysis.recordId = computeRecordId(reanalysis)
  records.push(reanalysis)

  // And one session whose PRIMARY record is foreign (election is lexicographic —
  // 'nova-emit' > 'lodestar'), with a catalog that never evaluates RF-04: the case
  // where an entire session's RF-04 silence must read as "never looked", not clean.
  const dana = records.find((r) => r.subject.sessionId === 'corpus-w1-dana-1')!
  const foreignPrimary = structuredClone(dana)
  foreignPrimary.generator = { name: 'nova-emit', version: '1.0' }
  foreignPrimary.evidence.catalog = ['RF-01']
  foreignPrimary.evidence.facts = foreignPrimary.evidence.facts.filter((f) => f.id === 'RF-01')
  foreignPrimary.recordId = computeRecordId(foreignPrimary)
  records.push(foreignPrimary)

  return records
}

/** A graph seeded with the full corpus. */
export function seedCorpusGraph(dir: string): Graph {
  const graph = initGraph(dir)
  for (const record of corpusRecords()) {
    const result = addRecordValue(graph, record, record.subject.sessionId)
    if (result.status === 'refused') {
      throw new Error(`corpus record refused: ${result.errors?.join('; ')}`)
    }
  }
  return graph
}
