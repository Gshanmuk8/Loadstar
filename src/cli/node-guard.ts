/**
 * Refuse to run on a Node that cannot run us — with a sentence, not a stack trace.
 *
 * The store uses node:sqlite, flag-free only from Node 22.13 (D-019). package.json
 * declares `engines`, but npm only *warns* on an engine mismatch at install — it does
 * not block. So a developer on Node 20 LTS (still the most-installed Node) gets a
 * clean `npm install -g` and then, on first run, an unhandled
 * `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` rejection from deep inside the import
 * graph. A first-run crash with a raw stack is indistinguishable from a broken
 * product; this check turns it into an instruction.
 *
 * Pure function of the version string so the refusal is testable on any Node.
 */

/** Minimum Node for flag-free node:sqlite. Keep in sync with package.json `engines`. */
export const MIN_NODE: readonly [number, number] = [22, 13]

/** The refusal message for an unsupported Node version, or null if this Node is fine. */
export function unsupportedNodeReason(version: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(version)
  // Unparseable is not proof of incompatibility. Let it run and fail honestly rather
  // than refuse a Node we merely do not recognize.
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return null
  return (
    `lodestar needs Node ${MIN_NODE[0]}.${MIN_NODE[1]} or newer — this is Node ${version}.\n` +
    `The record store uses node:sqlite, which ships flag-free from Node ${MIN_NODE[0]}.${MIN_NODE[1]}.\n` +
    `Upgrade at https://nodejs.org and re-run.\n`
  )
}
