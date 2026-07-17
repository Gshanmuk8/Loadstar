/**
 * Suppress the node:sqlite ExperimentalWarning — and nothing else.
 *
 * This MUST be a separate module imported before anything that touches node:sqlite.
 * ESM hoists imports and evaluates them in order, so a patch written inline in the
 * entry file runs *after* its own imports have already loaded node:sqlite and emitted
 * the warning. A side-effect module placed first in the import list runs first.
 *
 * Scope discipline: this filters exactly one warning, matched by name and message.
 * It does not use NODE_NO_WARNINGS or --no-warnings, which would hide real warnings
 * — including ones about the record. The experimental status of node:sqlite is not
 * hidden from the *decision* (see DECISIONS.md D-019), only from every single run of
 * a CLI where the user cannot act on it.
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
  // @ts-expect-error -- pass everything else through untouched
  return originalEmit(name, data, ...rest)
}
