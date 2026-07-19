/**
 * Two capture bugs found by running the recorder against itself (D-075, D-076):
 * nested sessions ping-ponging between each other's shim dirs, and final-moment
 * file writes lost inside the watcher's stability window.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { resolveOnPath } from './exec-command.js'
import { RecordingContext } from './context.js'
import { FsRecorder } from './fs-recorder.js'
import { SnapshotStore } from './snapshots.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-recfix-'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

const EXT = process.platform === 'win32' ? '.cmd' : ''

function makeExecutable(dirPath: string, name: string): string {
  mkdirSync(dirPath, { recursive: true })
  const p = join(dirPath, name + EXT)
  writeFileSync(p, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', {
    mode: 0o755,
  })
  return p
}

describe('resolveOnPath never resolves into ANY shim dir (D-075)', () => {
  it('skips another session’s shim dir, not only the excluded one', () => {
    // The nested-session shape: two projects, each with <project>/.lodestar/shims on
    // PATH, and the real binary behind both. Excluding only one's own dir made the
    // two shims resolve each other in a loop.
    const innerShims = join(dir, 'inner', '.lodestar', 'shims')
    const outerShims = join(dir, 'outer', '.lodestar', 'shims')
    const realDir = join(dir, 'real')
    makeExecutable(innerShims, 'npm')
    makeExecutable(outerShims, 'npm')
    const real = makeExecutable(realDir, 'npm')

    const env: NodeJS.ProcessEnv = {
      PATH: [innerShims, outerShims, realDir].join(delimiter),
      ...(process.platform === 'win32' ? { PATHEXT: '.COM;.EXE;.BAT;.CMD' } : {}),
    }
    const resolved = resolveOnPath('npm', { env, excludeDir: innerShims })
    expect(resolved).toBe(real)
  })

  it('still honors excludeDir for shim dirs that do not match the shape (tests do this)', () => {
    const oddShims = join(dir, 'custom-shim-location')
    const realDir = join(dir, 'real2')
    makeExecutable(oddShims, 'git')
    const real = makeExecutable(realDir, 'git')
    const env: NodeJS.ProcessEnv = {
      PATH: [oddShims, realDir].join(delimiter),
      ...(process.platform === 'win32' ? { PATHEXT: '.COM;.EXE;.BAT;.CMD' } : {}),
    }
    expect(resolveOnPath('git', { env, excludeDir: oddShims })).toBe(real)
  })
})

describe('FsRecorder.stop() drains the stability window (D-076)', () => {
  it('captures a file written immediately before stop', async () => {
    const root = join(dir, 'proj')
    mkdirSync(root, { recursive: true })
    const db = openDatabase(':memory:')
    try {
      const store = new SqliteEventStore(db)
      const session = store.createSession({ runtimeId: 'test', cwd: root })
      const context = new RecordingContext(store, session.id, root, {
        kind: 'agent',
        runtimeId: 'test',
      })
      const fs = new FsRecorder({
        root,
        ignore: [],
        context,
        snapshots: new SnapshotStore(join(dir, 'snaps')),
      })
      await fs.start()

      // The agent's last save, then an immediate session end — the ordinary ending.
      writeFileSync(join(root, 'final-edit.ts'), 'export const done = true\n', 'utf8')
      await fs.stop()

      const writes = store
        .query({ sessionId: session.id, kind: 'file.write' })
        .filter((e) => e.target?.resolved.includes('final-edit.ts'))
      expect(writes).toHaveLength(1)
      expect(writes[0]!.snapshotRef?.after).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      db.close()
    }
  })
})
