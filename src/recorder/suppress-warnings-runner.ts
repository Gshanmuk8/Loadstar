/**
 * Suppress the node:sqlite ExperimentalWarning inside shims — and nothing else.
 *
 * A shim runs in place of a real command, inside the developer's terminal. Leaking
 * `(node:1234) ExperimentalWarning: SQLite is an experimental feature` into the output
 * of every `npm test` would change what the developer sees, which breaks the rule that
 * LODESTAR must be invisible during a session.
 *
 * Same reasoning and same narrow scope as src/cli/suppress-warnings.ts — one warning,
 * matched by name and message, never NODE_NO_WARNINGS. See DECISIONS.md D-019.
 */

const originalEmit = process.emit.bind(process)

// @ts-expect-error -- intentionally narrow monkey-patch of the warning channel
process.emit = (name: string, data: unknown, ...rest: unknown[]): boolean => {
  if (
    name === 'warning' &&
    data instanceof Error &&
    data.name === 'ExperimentalWarning' &&
    /SQLite/i.test(data.message)
  ) {
    return false
  }
  // @ts-expect-error -- everything else passes through untouched
  return originalEmit(name, data, ...rest)
}
