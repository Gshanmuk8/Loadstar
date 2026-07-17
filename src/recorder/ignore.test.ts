/**
 * These tests exist because chokidar 4 silently dropped glob support in `ignored`,
 * and nothing failed loudly when it did. The record filled with LODESTAR's own
 * database writes, and each write triggered another — an unbounded loop.
 *
 * The lesson worth keeping: an ignore rule that silently matches nothing looks exactly
 * like an ignore rule that works, until something recurses. These assertions are the
 * only thing standing between us and that failure returning.
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { makeIgnoreMatcher, isLodestarPath, ALWAYS_IGNORE } from './ignore.js'
import { DEFAULT_CONFIG } from '../core/config.js'

const root = process.platform === 'win32' ? 'C:\\proj' : '/proj'
const p = (...parts: string[]) => join(root, ...parts)

describe('ignore matcher', () => {
  const ignored = makeIgnoreMatcher(root, DEFAULT_CONFIG.ignore)

  it('ignores LODESTAR\'s own directory — the feedback-loop guard', () => {
    // If this ever returns false, writing an event triggers a watch event, which
    // writes an event. The product hangs the machine it is meant to observe.
    expect(ignored(p('.lodestar', 'lodestar.db'))).toBe(true)
    expect(ignored(p('.lodestar', 'lodestar.db-wal'))).toBe(true)
    expect(ignored(p('.lodestar', 'lodestar.db-shm'))).toBe(true)
    expect(ignored(p('.lodestar', 'sessions', 'blobs', 'ab', 'cdef'))).toBe(true)
    expect(ignored(p('.lodestar'))).toBe(true)
  })

  it('ignores git internals', () => {
    expect(ignored(p('.git'))).toBe(true)
    expect(ignored(p('.git', 'HEAD'))).toBe(true)
    expect(ignored(p('.git', 'objects', 'ab', 'cd'))).toBe(true)
  })

  it('ignores dependency and build directories', () => {
    expect(ignored(p('node_modules', 'react', 'index.js'))).toBe(true)
    expect(ignored(p('dist', 'out.js'))).toBe(true)
    expect(ignored(p('build', 'x.o'))).toBe(true)
    expect(ignored(p('.next', 'cache', 'x'))).toBe(true)
    expect(ignored(p('target', 'debug', 'app'))).toBe(true)
    expect(ignored(p('__pycache__', 'm.pyc'))).toBe(true)
  })

  it('ignores nested node_modules', () => {
    expect(ignored(p('packages', 'app', 'node_modules', 'x', 'i.js'))).toBe(true)
  })

  it('does NOT ignore real source files', () => {
    expect(ignored(p('src', 'auth.ts'))).toBe(false)
    expect(ignored(p('package.json'))).toBe(false)
    expect(ignored(p('src', 'nested', 'deep', 'mod.ts'))).toBe(false)
  })

  it('does not ignore files that merely resemble ignored names', () => {
    // `dist` the directory is noise; `distributed.ts` is somebody's source file.
    expect(ignored(p('src', 'distributed.ts'))).toBe(false)
    expect(ignored(p('src', 'building.ts'))).toBe(false)
    expect(ignored(p('my-dist-tool.ts'))).toBe(false)
  })

  it('never ignores the project root itself', () => {
    expect(ignored(root)).toBe(false)
  })

  it('ignores anything outside the project root', () => {
    expect(ignored(join(root, '..', 'elsewhere', 'secrets.env'))).toBe(true)
  })

  it('ignores .lodestar even when config tries to drop it', () => {
    // ALWAYS_IGNORE is a structural invariant. A config that could disable it could
    // hang the developer's machine, so config may only ADD.
    const permissive = makeIgnoreMatcher(root, [])
    expect(permissive(p('.lodestar', 'lodestar.db'))).toBe(true)
    expect(ALWAYS_IGNORE).toContain('**/.lodestar/**')
  })
})

describe('isLodestarPath', () => {
  it('detects our own footprint, as git reports it', () => {
    // git status returns posix-style relative paths on every platform.
    expect(isLodestarPath('.lodestar/lodestar.db')).toBe(true)
    expect(isLodestarPath('.lodestar/sessions/blobs/ab/cd')).toBe(true)
  })

  it('does not flag ordinary files', () => {
    expect(isLodestarPath('src/auth.ts')).toBe(false)
    expect(isLodestarPath('README.md')).toBe(false)
  })

  it('matches on a path segment, not a substring', () => {
    expect(isLodestarPath('src/my.lodestar.config.ts')).toBe(false)
  })
})
