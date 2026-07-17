/**
 * Phase 5 — proving LODESTAR can observe reality.
 *
 * These tests do not mock the filesystem, git, or child processes. Mocking here would
 * prove only that the mocks agree with each other; the claim under test is that real
 * writes, real exit codes, and real commits are captured from outside the actor. So
 * every test writes real files, runs real commands, and makes real commits.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Recorder } from './index.js'
import { SnapshotStore, looksBinary } from './snapshots.js'
import { classifyCommand, classifyFileEvent } from './classify.js'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { writeConfig } from '../core/config.js'
import { paths } from '../core/project.js'
import { FLOOR_ONLY } from '../adapters/registry.js'
import type { LodestarEvent } from '../types/events.js'

let root: string

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

function initProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lodestar-test-'))
  const p = paths(dir)
  mkdirSync(p.sessions, { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeConfig(p.config)
  openDatabase(p.db).close()
  return dir
}

function newRecorder(mission?: string): Recorder {
  return new Recorder({
    root,
    runtimeId: 'test-runtime',
    mission: mission ?? null,
    capabilities: FLOOR_ONLY,
  })
}

function readEvents(sessionId: string): LodestarEvent[] {
  const db = openDatabase(paths(root).db)
  try {
    return new SqliteEventStore(db).query({ sessionId })
  } finally {
    db.close()
  }
}

beforeEach(() => {
  root = initProject()
})

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // Windows sometimes holds the watcher handle a beat longer than the test.
  }
})

// ---------------------------------------------------------------------------

describe('snapshot store', () => {
  it('is content-addressed — identical content, identical ref', () => {
    const s = new SnapshotStore(join(root, '.lodestar', 'sessions'))
    expect(s.putContent(Buffer.from('hello'))).toBe(s.putContent(Buffer.from('hello')))
  })

  it('round-trips content', () => {
    const s = new SnapshotStore(join(root, '.lodestar', 'sessions'))
    const ref = s.putContent(Buffer.from('the record'))
    expect(s.get(ref)?.toString()).toBe('the record')
  })

  it('records oversized files as metadata without content', () => {
    const s = new SnapshotStore(join(root, '.lodestar', 'sessions'), 10)
    const f = join(root, 'big.txt')
    writeFileSync(f, 'x'.repeat(500))
    const snap = s.putFile(f)
    // RF-10: disclose that the diff is unavailable rather than omit the event. The
    // invariant is "metadata kept, content skipped, reason stated" — not the exact object
    // shape, which grew a `sensitive` field when D-033 landed.
    expect(snap).toMatchObject({ bytes: 500, oversized: true, sensitive: false })
    expect(snap?.ref).toBeUndefined()
  })

  it('detects binary content', () => {
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x01]))).toBe(true)
    expect(looksBinary(Buffer.from('plain text'))).toBe(false)
  })

  it('returns null for an unreadable file rather than pretending', () => {
    const s = new SnapshotStore(join(root, '.lodestar', 'sessions'))
    expect(s.putFile(join(root, 'does-not-exist.txt'))).toBeNull()
  })
})

describe('classifier', () => {
  it('flags irreversible commands', () => {
    expect(classifyCommand('rm -rf /tmp/x')).toMatchObject({
      effectClass: 'destroy',
      reversible: false,
    })
    expect(classifyCommand('git push --force origin main')).toMatchObject({ reversible: false })
    expect(classifyCommand('git reset --hard HEAD~3')).toMatchObject({ reversible: false })
  })

  it('leaves reversibility ABSENT when it cannot tell', () => {
    // The load-bearing case. Guessing `true` here would eventually tell V2 that an
    // irreversible action was safe to automate. Absent means "unknown", which is safe.
    expect(classifyCommand('npm install jsonwebtoken').reversible).toBeUndefined()
    expect(classifyCommand('npm test').reversible).toBeUndefined()
  })

  it('classifies read-only commands as reversible', () => {
    expect(classifyCommand('git status')).toMatchObject({ effectClass: 'read', reversible: true })
  })

  it('ties file reversibility to whether we actually hold the prior content', () => {
    expect(classifyFileEvent('file.write', true).reversible).toBe(true)
    expect(classifyFileEvent('file.write', false).reversible).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('process recorder', () => {
  it('captures a REAL non-zero exit code — the evidence behind RF-01', async () => {
    const r = newRecorder()
    const session = await r.start()

    const result = await r.proc.run(process.execPath, ['-e', 'process.exit(1)'], {
      captureOutput: true,
    })
    expect(result.exitCode).toBe(1)

    await r.stop(0)

    const exit = readEvents(session.id).find((e) => e.kind === 'process.exit')
    expect(exit).toBeDefined()
    expect((exit!.payload as { exitCode: number }).exitCode).toBe(1)
    // The whole point: this came from the process, not from anyone's report about it.
    expect(exit!.signalTier).toBe('groundTruth')
    expect(exit!.source).toBe('process')
  })

  it('captures exit code 0 distinctly', async () => {
    const r = newRecorder()
    const session = await r.start()
    const result = await r.proc.run(process.execPath, ['-e', 'process.exit(0)'])
    expect(result.exitCode).toBe(0)
    await r.stop(0)

    const exit = readEvents(session.id).find((e) => e.kind === 'process.exit')
    expect((exit!.payload as { exitCode: number }).exitCode).toBe(0)
  })

  it('emits spawn before exit, and records duration', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.proc.run(process.execPath, ['-e', 'setTimeout(()=>{},50)'])
    await r.stop(0)

    const events = readEvents(session.id)
    const spawn = events.findIndex((e) => e.kind === 'process.spawn')
    const exit = events.findIndex((e) => e.kind === 'process.exit')
    expect(spawn).toBeGreaterThanOrEqual(0)
    expect(exit).toBeGreaterThan(spawn)
    expect((events[exit]!.payload as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0)
  })

  it('captures output tails', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.proc.run(process.execPath, ['-e', 'console.log("hello from the child")'], {
      captureOutput: true,
    })
    await r.stop(0)

    const exit = readEvents(session.id).find((e) => e.kind === 'process.exit')
    expect((exit!.payload as { stdoutTail: string }).stdoutTail).toContain('hello from the child')
  })
})

// ---------------------------------------------------------------------------

describe('filesystem recorder', () => {
  it('captures a file the agent modified, with before AND after content', async () => {
    const file = join(root, 'src', 'auth.ts')
    writeFileSync(file, 'export const before = 1\n')

    const r = newRecorder()
    const session = await r.start() // baseline runs here

    writeFileSync(file, 'export const after = 2\n')
    await settle()
    await r.stop(0)

    const write = readEvents(session.id).find(
      (e) => e.kind === 'file.write' && String(e.target?.resolved).includes('auth.ts'),
    )
    expect(write).toBeDefined()
    expect(write!.signalTier).toBe('groundTruth')
    expect(write!.snapshotRef?.before).toBeDefined()
    expect(write!.snapshotRef?.after).toBeDefined()

    // The before content must be recoverable, or there is no diff and no rollback.
    const snaps = new SnapshotStore(paths(root).sessions)
    expect(snaps.get(write!.snapshotRef!.before!)?.toString()).toBe('export const before = 1\n')
    expect(snaps.get(write!.snapshotRef!.after!)?.toString()).toBe('export const after = 2\n')
  })

  it('resolves the true path and marks it in scope', async () => {
    const r = newRecorder()
    const session = await r.start()
    writeFileSync(join(root, 'src', 'new.ts'), 'x')
    await settle()
    await r.stop(0)

    const write = readEvents(session.id).find((e) => e.kind === 'file.write')
    expect(write!.target!.resolved).toContain('new.ts')
    expect(write!.target!.inScope).toBe(true)
  })

  it('captures file creation', async () => {
    const r = newRecorder()
    const session = await r.start()
    writeFileSync(join(root, 'src', 'created.ts'), 'brand new')
    await settle()
    await r.stop(0)

    const write = readEvents(session.id).find((e) =>
      String(e.target?.resolved).includes('created.ts'),
    )
    expect(write?.kind).toBe('file.write')
    expect(write?.snapshotRef?.after).toBeDefined()
  })

  it('captures deletion and keeps the prior content', async () => {
    const file = join(root, 'src', 'doomed.ts')
    writeFileSync(file, 'delete me')

    const r = newRecorder()
    const session = await r.start()
    rmSync(file)
    await settle()
    await r.stop(0)

    const del = readEvents(session.id).find((e) => e.kind === 'file.delete')
    expect(del).toBeDefined()
    expect(del!.effectClass).toBe('destroy')
    // Recoverable, so reversible is true — a fact about our record, not a guess.
    expect(del!.reversible).toBe(true)
    const snaps = new SnapshotStore(paths(root).sessions)
    expect(snaps.get(del!.snapshotRef!.before!)?.toString()).toBe('delete me')
  })

  it('ignores build output and node_modules', async () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, 'dist'), { recursive: true })

    const r = newRecorder()
    const session = await r.start()
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'noise')
    writeFileSync(join(root, 'dist', 'out.js'), 'noise')
    writeFileSync(join(root, 'src', 'real.ts'), 'signal')
    await settle()
    await r.stop(0)

    const writes = readEvents(session.id).filter((e) => e.kind === 'file.write')
    expect(writes).toHaveLength(1)
    expect(writes[0]!.target!.resolved).toContain('real.ts')
  })

  it('does not record a rewrite with identical content', async () => {
    const file = join(root, 'src', 'same.ts')
    writeFileSync(file, 'unchanged')

    const r = newRecorder()
    const session = await r.start()
    writeFileSync(file, 'unchanged') // touched, not changed
    await settle()
    await r.stop(0)

    expect(readEvents(session.id).filter((e) => e.kind === 'file.write')).toHaveLength(0)
  })

  it('never records the .lodestar directory itself', async () => {
    const r = newRecorder()
    const session = await r.start()
    writeFileSync(join(root, 'src', 'x.ts'), 'trigger some writes')
    await settle()
    await r.stop(0)

    const touched = readEvents(session.id).filter((e) =>
      String(e.target?.resolved ?? '').includes('.lodestar'),
    )
    expect(touched).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe('git recorder', () => {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })

  function initRepo(): void {
    git(['init', '-q'])
    git(['config', 'user.email', 'test@lodestar.dev'])
    git(['config', 'user.name', 'LODESTAR Test'])
    writeFileSync(join(root, 'README.md'), '# test\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'initial'])
  }

  it('detects a commit the agent created', async () => {
    initRepo()
    const r = newRecorder()
    const session = await r.start()

    writeFileSync(join(root, 'src', 'feature.ts'), 'export const f = 1\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'add feature'])
    await settle()
    const summary = await r.stop(0)

    expect(summary.git?.commitsCreated).toHaveLength(1)
    expect(summary.git?.headMoved).toBe(true)

    const commit = readEvents(session.id).find((e) => e.kind === 'git.commit')
    expect(commit).toBeDefined()
    expect(commit!.signalTier).toBe('groundTruth')
  })

  it('reports a dirty working tree at session end — the evidence for RF-02', async () => {
    initRepo()
    const r = newRecorder()
    await r.start()

    // The "done" that left half-edited files.
    writeFileSync(join(root, 'src', 'half-done.ts'), 'unfinished')
    await settle()
    const summary = await r.stop(0)

    expect(summary.git?.dirtyAtEnd.length).toBeGreaterThan(0)
  })

  it('reports a clean tree as clean', async () => {
    initRepo()
    const r = newRecorder()
    await r.start()
    await settle(150)
    const summary = await r.stop(0)
    expect(summary.git?.dirtyAtEnd).toEqual([])
  })

  it('works in a non-git directory without failing', async () => {
    const r = newRecorder()
    await r.start()
    const summary = await r.stop(0)
    expect(summary.git).toBeNull()
    expect(summary.coverage.git).toBe(false)
    // Not a repo is a normal state, not an error.
    expect(summary.coverage.errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('session integrity and coverage', () => {
  it('produces a verifiable chain across all three recorders', async () => {
    const file = join(root, 'src', 'auth.ts')
    writeFileSync(file, 'before')

    const r = newRecorder('Build authentication system')
    await r.start()
    writeFileSync(file, 'after')
    await r.proc.run(process.execPath, ['-e', 'process.exit(1)'])
    await settle()
    const summary = await r.stop(0)

    // The record of a real, mixed session must verify end to end.
    expect(summary.integrityIntact).toBe(true)
    expect(summary.events).toBeGreaterThan(3)
  })

  it('reports coverage honestly', async () => {
    const r = newRecorder()
    await r.start()
    const summary = await r.stop(0)

    expect(summary.coverage.filesystem).toBe(true)
    // FLOOR_ONLY has no adapter, so these must be false rather than optimistic.
    expect(summary.coverage.toolCalls).toBe(false)
    expect(summary.coverage.resolvedTargets).toBe(false)
  })

  it('records the mission as intent, never as ground truth', async () => {
    const r = newRecorder('Build authentication system')
    const session = await r.start()
    await r.stop(0)

    const mission = readEvents(session.id).find((e) => e.kind === 'mission.stated')
    // The mission is what the human asked for, relayed by the runtime. Facts must not
    // be computable from it.
    expect(mission!.signalTier).toBe('intent')
  })

  it('keeps narration out of the ground-truth query path', async () => {
    const r = newRecorder('a mission')
    const session = await r.start()
    writeFileSync(join(root, 'src', 'a.ts'), 'x')
    await settle()
    await r.stop(0)

    const db = openDatabase(paths(root).db)
    try {
      const facts = new SqliteEventStore(db).query({ sessionId: session.id, signalTier: 'groundTruth' })
      expect(facts.length).toBeGreaterThan(0)
      expect(facts.every((e) => e.signalTier === 'groundTruth')).toBe(true)
      expect(facts.some((e) => e.kind === 'mission.stated')).toBe(false)
    } finally {
      db.close()
    }
  })

  it('opens and closes the session', async () => {
    const r = newRecorder()
    const session = await r.start()
    await r.stop(3)

    const events = readEvents(session.id)
    expect(events[0]!.kind).toBe('session.start')
    expect(events.at(-1)!.kind).toBe('session.end')
    expect((events.at(-1)!.payload as { exitCode: number }).exitCode).toBe(3)
  })

  it('numbers events gaplessly under concurrent recorders', async () => {
    const r = newRecorder()
    const session = await r.start()

    // Filesystem and process events interleave; the chain must stay total-ordered.
    writeFileSync(join(root, 'src', 'a.ts'), '1')
    await r.proc.run(process.execPath, ['-e', ''])
    writeFileSync(join(root, 'src', 'b.ts'), '2')
    await settle()
    await r.stop(0)

    const events = readEvents(session.id)
    events.forEach((e, i) => expect(e.seq).toBe(i + 1))
  })
})

// ---------------------------------------------------------------------------

describe('the scenario from USER-FLOW.md §5', () => {
  it('observes what actually happened while the agent claims success', async () => {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@l.dev'])
    git(['config', 'user.name', 'T'])
    writeFileSync(join(root, 'README.md'), '# x\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'init'])

    const users = join(root, 'src', 'users.ts')
    const auth = join(root, 'src', 'auth.ts')
    writeFileSync(users, 'export const users = []\n')
    writeFileSync(auth, 'export const auth = null\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'base'])

    const r = newRecorder('Build authentication system')
    const session = await r.start()

    // The agent edits auth.ts...
    readFileSync(users, 'utf8')
    writeFileSync(auth, 'export const auth = jwt()\n')
    await settle()

    // ...runs the tests, which FAIL...
    const test = await r.proc.run(process.execPath, ['-e', 'process.exit(1)'], {
      captureOutput: true,
    })

    // ...then edits auth.ts AGAIN, after the failing test run (RF-04).
    writeFileSync(auth, 'export const auth = jwt2()\n')
    await settle()

    const summary = await r.stop(0)
    const events = readEvents(session.id)

    // "Authentication completed successfully," says the agent. Reality:
    expect(test.exitCode).toBe(1) // the test really failed
    expect(summary.git?.dirtyAtEnd.length).toBeGreaterThan(0) // left uncommitted

    const authWrites = events.filter(
      (e) => e.kind === 'file.write' && String(e.target?.resolved).includes('auth.ts'),
    )
    const testExit = events.find(
      (e) => e.kind === 'process.exit' && (e.payload as { exitCode: number }).exitCode === 1,
    )
    expect(authWrites.length).toBe(2)
    expect(testExit).toBeDefined()

    // RF-04's raw material: a write ordered AFTER the failing test, provable from the
    // monotonic sequence rather than from wall clocks.
    expect(authWrites.at(-1)!.seq).toBeGreaterThan(testExit!.seq)

    // And none of it came from anything the agent said.
    expect(
      [...authWrites, testExit!].every((e) => e.signalTier === 'groundTruth'),
    ).toBe(true)
  })
})
