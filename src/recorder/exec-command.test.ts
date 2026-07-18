/**
 * D-072 — the launcher must execute what a shell would execute, on both platforms.
 *
 * The regression pinned here: `lodestar claude` failed with `spawn claude ENOENT` on
 * Windows while `claude --version` worked in the same terminal, because npm installs
 * CLIs as `.cmd` batch shims and CreateProcess resolves `.exe` only. These tests build
 * a real fake `claude.cmd` on a real PATH and launch it through the real recorder —
 * mocks would only prove the mocks agree with each other.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { resolveOnPath, spawnSpec, cmdQuote, isBatchTarget, unsafeBatchArg } from './exec-command.js'
import { Recorder } from './index.js'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { writeConfig } from '../core/config.js'
import { paths } from '../core/project.js'
import { FLOOR_ONLY } from '../adapters/registry.js'
import type { LodestarEvent, ProcessSpawnPayload } from '../types/events.js'

const win = process.platform === 'win32'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-exec-'))
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows sometimes holds a handle a beat longer than the test.
  }
})

/** An env whose PATH contains exactly our fixture directory (plus the real PATH). */
function envWith(binDir: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: binDir + delimiter + (process.env['PATH'] ?? '') }
}

describe('resolveOnPath', () => {
  it('returns null for a command that exists nowhere', () => {
    expect(resolveOnPath('lodestar-no-such-command-ever', { env: envWith(dir) })).toBeNull()
  })

  it('resolves an absolute path to itself', () => {
    expect(resolveOnPath(process.execPath)).toBe(process.execPath)
  })

  it('skips the excluded directory — the fork-bomb guard', () => {
    const name = win ? 'fakecmd.cmd' : 'fakecmd'
    writeFileSync(join(dir, name), win ? '@echo off\r\n' : '#!/bin/sh\n')
    if (!win) chmodSync(join(dir, name), 0o755)
    expect(resolveOnPath('fakecmd', { env: envWith(dir), excludeDir: dir })).toBeNull()
  })

  it.runIf(win)('resolves a bare name to its .cmd shim — the D-072 ENOENT', () => {
    writeFileSync(join(dir, 'claude.cmd'), '@echo off\r\n')
    const resolved = resolveOnPath('claude', { env: envWith(dir) })
    expect(resolved?.toLowerCase()).toBe(join(dir, 'claude.cmd').toLowerCase())
  })

  it.runIf(win)('reads PATH case-insensitively from a plain env object', () => {
    // A copied env is a plain object: `Path` (how Windows often spells it) must still
    // be found. The agent env sets both, but resolution must not depend on that.
    writeFileSync(join(dir, 'claude.cmd'), '@echo off\r\n')
    const env: NodeJS.ProcessEnv = { Path: dir }
    expect(resolveOnPath('claude', { env })).not.toBeNull()
  })

  it.runIf(!win)('refuses a file without the execute bit', () => {
    writeFileSync(join(dir, 'notexec'), '#!/bin/sh\n')
    expect(resolveOnPath('notexec', { env: envWith(dir) })).toBeNull()
  })
})

describe('spawnSpec', () => {
  it('spawns native executables directly — no shell, nothing to get wrong', () => {
    const spec = spawnSpec(process.execPath, ['-e', 'x'])
    expect(spec).toEqual({
      file: process.execPath,
      args: ['-e', 'x'],
      windowsVerbatimArguments: false,
    })
  })

  it.runIf(win)('routes batch targets through cmd.exe with our quoting', () => {
    const spec = spawnSpec('C:\\Program Files\\nodejs\\npm.cmd', ['run', 'my task'])
    expect(spec.file.toLowerCase()).toContain('cmd')
    expect(spec.windowsVerbatimArguments).toBe(true)
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    // The executable path is quoted — the unquoted form was Phase 6 bug 2
    // ('C:\Program' is not recognized…).
    expect(spec.args[3]).toBe('""C:\\Program Files\\nodejs\\npm.cmd" run "my task""')
  })
})

describe('cmd.exe quoting', () => {
  it('escapes a literal quote as "" — the BatBadBut rule', () => {
    expect(cmdQuote('x"&echo PWNED&"y')).toBe('"x""&echo PWNED&""y"')
  })

  it('leaves plain tokens alone and quotes separators', () => {
    expect(cmdQuote('--version')).toBe('--version')
    expect(cmdQuote('a b')).toBe('"a b"')
    expect(cmdQuote('a;b')).toBe('"a;b"')
  })

  it('flags only genuinely unfixable batch arguments', () => {
    expect(unsafeBatchArg(['%PATH%'])).toBe('%PATH%')
    expect(unsafeBatchArg(['a\nb'])).toBe('a\nb')
    expect(unsafeBatchArg(['50% done', '%20', 'trailing%'])).toBeNull()
  })

  it.runIf(win)('classifies batch targets by extension', () => {
    expect(isBatchTarget('C:\\x\\claude.cmd')).toBe(true)
    expect(isBatchTarget('C:\\x\\claude.CMD')).toBe(true)
    expect(isBatchTarget('C:\\x\\claude.exe')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The regression itself: a .cmd agent launches through the real recorder.
// ---------------------------------------------------------------------------

describe.runIf(win)('launching a .cmd agent on Windows (D-072)', () => {
  let root: string

  function initProject(): string {
    const projectDir = mkdtempSync(join(tmpdir(), 'lodestar-launch-'))
    const p = paths(projectDir)
    mkdirSync(p.sessions, { recursive: true })
    writeConfig(p.config)
    openDatabase(p.db).close()
    return projectDir
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
      /* watcher handle lag */
    }
  })

  it('launches, forwards arguments, and returns the real exit code', async () => {
    // The exact shape npm installs: a bare `claude` (sh script, unreachable from
    // CreateProcess) next to a `claude.cmd` batch shim. Before D-072 this spawn died
    // with ENOENT without ever emitting an event.
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 42\n')
    writeFileSync(
      join(dir, 'claude.cmd'),
      '@echo off\r\necho LODESTAR_FAKE_CLAUDE %*\r\nexit /b 42\r\n',
    )

    const r = new Recorder({ root, runtimeId: 'test-runtime', capabilities: FLOOR_ONLY })
    const session = await r.start()
    const result = await r.proc.run('claude', ['hello world', '--print'], {
      captureOutput: true,
      env: envWith(dir),
    })
    await r.stop(result.exitCode)

    expect(result.exitCode).toBe(42)
    expect(result.stdoutTail).toContain('LODESTAR_FAKE_CLAUDE')
    // The quoted argument survived cmd.exe intact.
    expect(result.stdoutTail).toContain('hello world')

    // The record names what PATH resolution actually chose, not just what was typed.
    const spawn = readEvents(session.id).find((e) => e.kind === 'process.spawn')
    expect(spawn).toBeDefined()
    const payload = spawn!.payload as ProcessSpawnPayload
    expect(payload.command).toBe('claude')
    expect(payload.resolvedPath?.toLowerCase()).toBe(join(dir, 'claude.cmd').toLowerCase())
  })

  it('refuses an argument cmd.exe would rewrite, rather than launching a lie', async () => {
    writeFileSync(join(dir, 'claude.cmd'), '@echo off\r\nexit /b 0\r\n')

    const r = new Recorder({ root, runtimeId: 'test-runtime', capabilities: FLOOR_ONLY })
    await r.start()
    await expect(
      r.proc.run('claude', ['%PATH%'], { captureOutput: true, env: envWith(dir) }),
    ).rejects.toThrow(/faithfully/)
    await r.stop(0)
  })
})
