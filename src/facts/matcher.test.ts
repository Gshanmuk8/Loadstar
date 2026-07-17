/**
 * The test-command matcher — D-048 / D-050.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * A missed matcher is the quietest bug in the product. It does not throw, it does not log,
 * and it does not produce a wrong fact. It produces **no fact**, which renders as a clean
 * report — the exact failure mode LODESTAR exists to prevent, committed by LODESTAR.
 *
 * So the matcher is tested from three directions:
 *
 *   1. It fires on the runners people actually use.
 *   2. It does NOT fire on commands that merely mention a runner.
 *   3. Everything it claims to recognise, the recorder can actually observe.
 *
 * The third is the one that had drifted for two decisions running, and the only one a
 * comment could never have held.
 */

import { describe, expect, it } from 'vitest'
import { isTestCommand, isTestShapedCommand, TEST_RUNNERS } from './index.js'
import { SHIMMED_COMMANDS } from '../recorder/shims.js'

// ===========================================================================
// The invariant: matched implies observable.
// ===========================================================================

describe('matcher/shim reconciliation — D-050', () => {
  /**
   * The assertion D-048 made in a comment and never checked.
   *
   * It was false when written: `bun`, `nox`, and `ctest` were matched and unshimmed. This
   * test is the reason that cannot recur — a runner added to `TEST_MATCHERS` without a
   * shim now fails here rather than silently producing a session with no RF-03/RF-04.
   */
  it('every runner the matcher recognises is a command the boundary shims', () => {
    const unobservable = TEST_RUNNERS.filter((r) => !SHIMMED_COMMANDS.includes(r))
    expect(unobservable).toEqual([])
  })

  it('names at least the runners the catalog was written against', () => {
    // A guard against "fixing" the invariant above by deleting runners from the matcher.
    // Both lists shrinking to nothing would pass that test and observe nothing.
    for (const r of ['npm', 'pnpm', 'yarn', 'pytest', 'cargo', 'go', 'make', 'mvn', 'gradle']) {
      expect(TEST_RUNNERS).toContain(r)
    }
  })
})

// ===========================================================================
// Positive: it fires on real test commands.
// ===========================================================================

describe('test commands the matcher must recognise', () => {
  const shouldMatch = [
    'npm test',
    'npm run test',
    'npm run test:unit',
    'pnpm test',
    'pnpm run test',
    'yarn test',
    'bun test',
    'pytest',
    'pytest tests/ -v',
    'tox',
    'nox -s tests',
    'python -m pytest',
    'python3 -m pytest tests/',
    'python3 -m unittest discover',
    'python3.11 -m pytest',
    'go test ./...',
    'cargo test',
    'cargo test --all-features',
    'gradle test',
    './gradlew test',
    'gradlew.bat test',
    'mvn test',
    'mvn verify',
    'mvn -B clean test',
    'make test',
    'make -C backend test',
    'dotnet test',
    'ctest',
    'ctest --output-on-failure',
    // Case is not meaning. `NPM TEST` on Windows is the same command.
    'NPM TEST',
  ]

  for (const cmd of shouldMatch) {
    it(`matches: ${cmd}`, () => {
      expect(isTestCommand(cmd)).toBe(true)
    })
  }
})

// ===========================================================================
// Negative: it must not fire on commands that merely MENTION a runner.
// ===========================================================================

describe('commands the matcher must NOT treat as a test run', () => {
  const shouldNotMatch = [
    // The D-048 bug: unanchored patterns matched a runner anywhere in the string. These
    // are not test runs, and treating them as one dates RF-04 against a command that
    // never tested anything.
    'echo npm test',
    'cat npm test.log',
    'grep -r "npm test" .',
    'git commit -m "npm test now passes"',
    // Real commands that are not test runs.
    'npm install',
    'npm run build',
    'npm run lint',
    'go build ./...',
    'cargo build',
    'mvn compile',
    'make build',
    'dotnet build',
    'git status',
    'node -e "process.exit(1)"',
    // A watcher never terminates with a verdict, so it is not a completed run. Using it
    // as "the last test run" would anchor RF-04 to a test that never finished.
    'npm run test:watch',
    'vitest --watch',
    'npm test -- --watch',
    'pytest --ui',
    // Empty and whitespace: not a command, not a test.
    '',
    '   ',
  ]

  for (const cmd of shouldNotMatch) {
    it(`does not match: ${JSON.stringify(cmd)}`, () => {
      expect(isTestCommand(cmd)).toBe(false)
    })
  }

  /**
   * A runner we cannot observe must not be recognised.
   *
   * `jest`, `vitest`, and `mocha` were in the matcher before D-048 and were removed
   * because nothing shims them. This pins that: recognising them would mean RF-03 could
   * conclude "a test ran" from a command the boundary never actually sees, and RF-04
   * could anchor to a run whose exit code we do not have.
   *
   * If these are ever wanted, they must be shimmed FIRST. The invariant test above then
   * lets them in.
   */
  it('does not recognise bare runners that are not shimmed', () => {
    expect(isTestCommand('jest')).toBe(false)
    expect(isTestCommand('vitest run')).toBe(false)
    expect(isTestCommand('mocha test/')).toBe(false)
  })
})

// ===========================================================================
// The two predicates — D-069. "Observed" and "completed-run candidate" differ
// in exactly one place: watchers.
// ===========================================================================

describe('isTestShapedCommand vs isTestCommand — D-069', () => {
  /**
   * A watcher IS an observed test command. RF-03's statement is about observation, so
   * its guard must use the shape predicate — `npm run test:watch` blocking on
   * `isTestCommand` alone is the bug where the engine said "no test command was
   * observed" about a session in which one visibly was.
   */
  const watchers = ['npm run test:watch', 'npm test -- --watch', 'pytest --ui']

  for (const cmd of watchers) {
    it(`watcher is test-shaped but not a completed-run candidate: ${cmd}`, () => {
      expect(isTestShapedCommand(cmd)).toBe(true)
      expect(isTestCommand(cmd)).toBe(false)
    })
  }

  it('on non-watch commands the two predicates agree — watchers are the only split', () => {
    for (const cmd of ['npm test', 'pytest', 'cargo test', 'echo npm test', 'npm run build', '']) {
      expect(isTestShapedCommand(cmd)).toBe(isTestCommand(cmd))
    }
  })
})
