/**
 * LODESTAR — path ignore matching.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS — do not replace it with chokidar's `ignored` globs
 * ---------------------------------------------------------------------------
 *
 * chokidar 4 **removed glob support** from `ignored`. It still accepts an array of
 * strings without complaint — and silently matches nothing. Passing
 * `['**\/.lodestar\/**']` to chokidar 4 is indistinguishable, at the type level and at
 * runtime, from passing nothing at all.
 *
 * That failure mode was not theoretical here. It meant LODESTAR watched its own
 * database: every `emit()` wrote to `.lodestar/lodestar.db`, the watcher saw the write,
 * which emitted an event, which wrote to the database. An unbounded feedback loop that
 * snapshots a growing database on every turn.
 *
 * So ignore matching is done here, explicitly, with picomatch, and verified by tests.
 */

import picomatch from 'picomatch'
import { relative, sep } from 'node:path'

/**
 * Never watched, regardless of configuration.
 *
 * This is a structural invariant, not a preference. `.lodestar` is LODESTAR's own
 * footprint — recording it corrupts the record with the act of recording and risks the
 * feedback loop described above. `.git` is git's internal state, which the git recorder
 * reads deliberately and must not also receive as a flood of file events.
 *
 * User config can ADD ignores. It cannot remove these. A config file that could
 * disable this could hang the developer's machine.
 */
export const ALWAYS_IGNORE = [
  '**/.lodestar',
  '**/.lodestar/**',
  '**/.git',
  '**/.git/**',
]

/** Glob → posix. Windows hands us backslashes; picomatch only speaks `/`. */
function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/**
 * `**\/foo/**` matches `foo/bar` but NOT `foo` itself, so a directory pattern alone
 * lets the watcher descend into a tree it was told to skip. Adding the bare form lets
 * chokidar prune at the directory instead of filtering every file underneath.
 */
function expand(patterns: string[]): string[] {
  const out = new Set<string>()
  for (const p of patterns) {
    out.add(p)
    if (p.endsWith('/**')) out.add(p.slice(0, -3))
  }
  return [...out]
}

/**
 * Build a matcher for chokidar 4's `ignored` option.
 *
 * Returns true for paths that must NOT be recorded. Matches against both the
 * project-relative path (what the config author means) and the absolute path (what
 * chokidar passes), because a pattern like `**\/node_modules/**` should work either way.
 */
export function makeIgnoreMatcher(root: string, patterns: string[]): (p: string) => boolean {
  const isMatch = picomatch(expand([...ALWAYS_IGNORE, ...patterns]), { dot: true })

  return (p: string): boolean => {
    const abs = toPosix(p)
    const rel = toPosix(relative(root, p))

    // The root itself is never ignored; relative() gives '' for it.
    if (rel === '') return false

    // Anything outside the project root is out of scope by definition.
    if (rel.startsWith('../')) return true

    return isMatch(rel) || isMatch(abs)
  }
}

/**
 * Is this path inside LODESTAR's own record directory?
 *
 * Used by the git recorder: if a user has not gitignored `.lodestar`, git reports it as
 * untracked, and RF-02 ("session ended with a dirty working tree") would fire on
 * LODESTAR's own artifacts. Reporting our own footprint as the agent's mess is a false
 * positive on a Reality Fact, which is the one class of bug this product cannot afford.
 */
export function isLodestarPath(p: string): boolean {
  const parts = toPosix(p).split('/')
  return parts.includes('.lodestar')
}
