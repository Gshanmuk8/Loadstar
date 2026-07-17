/**
 * RF-01 under process ancestry — D-025 / D-034.
 *
 * These are written against the *fact engine's* contract, not its implementation: build a
 * real session in a real store, append real events, and ask what a developer would be
 * told. The engine reads only `groundTruth`, so these events are exactly the shape a shim
 * produces.
 *
 * The bar throughout: **never suppress a real failure, and never report the same failure
 * twice.** When those two conflict — which is precisely what unknown ancestry does — the
 * tests pin the direction we resolve it: report.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { evaluate } from './index.js'
import type { ProcessExitPayload } from '../types/events.js'

let dir: string
let db: ReturnType<typeof openDatabase>
let store: SqliteEventStore
let sessionId: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-ancestry-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  store = new SqliteEventStore(db)
  sessionId = store.createSession({ runtimeId: 'test', cwd: dir, mission: null }).id
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

let clock = 0

function exit(p: Partial<ProcessExitPayload> & { command: string; exitCode: number | null }): void {
  const payload: ProcessExitPayload = { durationMs: 1, ...p }
  store.append({
    id: randomUUID(),
    sessionId,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
    monotonicTs: clock * 1000,
    source: 'process',
    signalTier: 'groundTruth',
    kind: 'process.exit',
    actor: { kind: 'agent', runtimeId: 'test' },
    target: { raw: p.command, resolved: p.command, kind: 'process', inScope: true },
    payload,
  })
}

const rf01 = (): string[] =>
  evaluate(store, sessionId)
    .filter((f) => f.id === 'RF-01')
    .map((f) => f.statement)

describe('RF-01 with observed ancestry', () => {
  it('reports one fact when a failure nests inside a failure', () => {
    // The D-025 bug: `npm test` and the `node` it spawned both fired for one cause.
    const npm = 'exec-npm'
    exit({ command: 'node ./test.js', exitCode: 1, execId: 'exec-node', parentExecId: npm })
    exit({ command: 'npm test', exitCode: 1, execId: npm })

    const facts = rf01()
    expect(facts).toHaveLength(1)
    // The outermost command is the one the developer invoked and can act on.
    expect(facts[0]).toBe('npm test exited with code 1')
  })

  it('keeps the nested failure as evidence rather than discarding it', () => {
    // Suppressing the child from the headline must not delete it from the causal chain.
    const npm = 'exec-npm'
    exit({ command: 'node ./test.js', exitCode: 1, execId: 'exec-node', parentExecId: npm })
    exit({ command: 'npm test', exitCode: 1, execId: npm })

    const fact = evaluate(store, sessionId).find((f) => f.id === 'RF-01')!
    expect(fact.evidence.length).toBeGreaterThan(1)
  })

  it('reports both when two sibling commands fail independently', () => {
    const agent = 'exec-agent'
    exit({ command: 'npm test', exitCode: 1, execId: 'exec-a', parentExecId: agent })
    exit({ command: 'npm run lint', exitCode: 2, execId: 'exec-b', parentExecId: agent })

    // Same parent, but neither descends from the other and the parent never failed.
    expect(rf01()).toHaveLength(2)
  })

  it('still reports a failure whose parent SUCCEEDED', () => {
    // `npm test || true`. The test genuinely failed. A parent swallowing the code does
    // not unmake that, and inferring "they meant to ignore it" is inferring intent.
    const sh = 'exec-sh'
    exit({ command: 'node ./test.js', exitCode: 1, execId: 'exec-node', parentExecId: sh })
    exit({ command: 'sh -c npm test || true', exitCode: 0, execId: sh })

    expect(rf01()).toEqual(['node ./test.js exited with code 1'])
  })

  it('reports when ancestry is UNKNOWN rather than guessing', () => {
    // A shadowed shim records no execId. Absence of ancestry is not absence of a parent.
    // Over-reporting is a nuisance; dropping a real failure because we could not see the
    // tree would be a lie.
    exit({ command: 'node ./test.js', exitCode: 1 })
    exit({ command: 'npm test', exitCode: 1 })

    expect(rf01()).toHaveLength(2)
  })

  it('does not suppress across an unobserved gap in the chain', () => {
    // Child names a parent that was never recorded. The link is dangling, so the failure
    // is not attributable to anything and must stand on its own.
    exit({ command: 'node ./test.js', exitCode: 1, execId: 'exec-node', parentExecId: 'never-recorded' })
    exit({ command: 'npm test', exitCode: 1, execId: 'exec-npm' })

    expect(rf01()).toHaveLength(2)
  })
})

describe('RF-01 adversarial ancestry', () => {
  it('a self-parenting event cannot suppress its own failure', () => {
    // Caught a real bug: `execId === parentExecId` matched itself as its own failing
    // ancestor on the first hop, and the fact vanished. One forged field silenced a real
    // failure — the exact thing a record that cannot be trusted to report failures is
    // worthless for.
    exit({ command: 'evil', exitCode: 1, execId: 'a', parentExecId: 'a' })
    expect(rf01()).toEqual(['evil exited with code 1'])
  })

  it('a cyclic chain suppresses nothing', () => {
    // Same bug, one hop further out: with a→b→c→a every node found a failing "ancestor"
    // and ALL THREE facts disappeared. A cycle means ancestry is corrupt, so it is not
    // evidence, so it must not suppress. Unknown reports.
    exit({ command: 'a', exitCode: 1, execId: 'a', parentExecId: 'b' })
    exit({ command: 'b', exitCode: 1, execId: 'b', parentExecId: 'c' })
    exit({ command: 'c', exitCode: 1, execId: 'c', parentExecId: 'a' })

    expect(rf01()).toHaveLength(3)
  })

  it('a deep legitimate chain collapses to the outermost failure', () => {
    // npm run check → npm run stress → npm run build → tsc: the real nesting from this
    // repo's own package.json, which is what blew through the old depth guard (D-031).
    const ids = ['e0', 'e1', 'e2', 'e3']
    exit({ command: 'tsc', exitCode: 2, execId: ids[3], parentExecId: ids[2] })
    exit({ command: 'npm run build', exitCode: 2, execId: ids[2], parentExecId: ids[1] })
    exit({ command: 'npm run stress', exitCode: 2, execId: ids[1], parentExecId: ids[0] })
    exit({ command: 'npm run check', exitCode: 2, execId: ids[0] })

    expect(rf01()).toEqual(['npm run check exited with code 2'])
  })

  it('a later success qualifies an earlier failure — it does not delete it', () => {
    // The old contract was "a later success cancels the earlier failure", and that is
    // exactly what made the C2 forgery work: append a passing run, and the real failure
    // disappears while the chain still verifies. New evidence may add context; it may
    // never remove an observation. See D-045.
    exit({ command: 'npm test', exitCode: 1, execId: 'r1' })
    exit({ command: 'npm test', exitCode: 0, execId: 'r2' })

    expect(rf01()).toEqual(['npm test exited with code 1, then passed on a later run'])
  })

  it('does not let a pass in one directory cancel a failure in another', () => {
    // D-043. In a monorepo an agent runs `npm test` in packages/api (fails) and then in
    // packages/web (passes). Grouping on the command string alone made those one history,
    // and the api failure was silently deleted. Two directories are two histories.
    exit({ command: 'npm test', exitCode: 1, execId: 'a', cwd: '/p/packages/api' })
    exit({ command: 'npm test', exitCode: 0, execId: 'b', cwd: '/p/packages/web' })

    expect(rf01()).toEqual(['npm test exited with code 1'])
  })

  it('never produces a fact from a signal-killed process', () => {
    // exitCode null means "we do not know it failed". Unknown must not collapse to false.
    exit({ command: 'npm test', exitCode: null, signal: 'SIGKILL', execId: 'k' })
    expect(rf01()).toEqual([])
  })
})
