/**
 * LODESTAR — V2 signal derivation.
 *
 * Computes effectClass, blastRadius, and reversible for every event. V0 stores these
 * and uses none of them: they exist so the Prevention layer has a real dataset the day
 * it is built, rather than a schema migration of an immutable record. See
 * ARCHITECTURE.md §4 and LODESTAR-VISION.md §3 (Layer 4).
 *
 * Discipline that keeps this honest:
 *
 * - This is pattern matching over a resolved command, not intent inference. It never
 *   reads the agent's narration. It is not a Reality Fact and never reaches a report.
 * - When we cannot tell, `reversible` is left **absent** — meaning "we do not know" —
 *   rather than guessed. Guessing `true` here would eventually tell V2 that an
 *   irreversible action was safe to automate, which is the worst error this file could
 *   make. Absent is a safe answer; wrong is not.
 */

import type { BlastRadius, EffectClass, EventKind } from '../types/events.js'

export interface DerivedSignals {
  effectClass: EffectClass
  blastRadius?: BlastRadius
  reversible?: boolean
}

/**
 * Commands whose effects we cannot undo from a file snapshot.
 *
 * Deliberately conservative and small. A pattern here claims certainty about
 * irreversibility, so it must be obviously true — this list is not the place to be
 * clever, and it is not a security boundary. Anything unmatched falls through to
 * "unknown", which is the correct answer for most commands.
 */
const IRREVERSIBLE: Array<{ re: RegExp; blast: BlastRadius; effect: EffectClass }> = [
  { re: /\brm\s+(-\w*[rf]\w*\s+)+/i, blast: 'repo', effect: 'destroy' },
  { re: /\brmdir\s+\/s\b/i, blast: 'repo', effect: 'destroy' },
  { re: /\bgit\s+push\b.*(--force\b|-f\b)/i, blast: 'repo', effect: 'destroy' },
  { re: /\bgit\s+reset\s+--hard\b/i, blast: 'repo', effect: 'destroy' },
  { re: /\bgit\s+clean\b.*-\w*f/i, blast: 'repo', effect: 'destroy' },
  { re: /\bgit\s+branch\s+-D\b/i, blast: 'repo', effect: 'destroy' },
  { re: /\bdrop\s+(table|database|schema)\b/i, blast: 'service', effect: 'destroy' },
  { re: /\btruncate\s+table\b/i, blast: 'service', effect: 'destroy' },
  { re: /\bkubectl\s+delete\b/i, blast: 'service', effect: 'destroy' },
  { re: /\bterraform\s+destroy\b/i, blast: 'account', effect: 'destroy' },
  { re: /\bnpm\s+publish\b/i, blast: 'account', effect: 'destroy' },
  { re: /\baws\s+\w+\s+delete-/i, blast: 'account', effect: 'destroy' },
]

/** Commands that reach the network. A fact about the command, never a judgement. */
const NETWORK = /\b(curl|wget|npm\s+(i|install|publish)|pip\s+install|git\s+(push|pull|fetch|clone))\b/i

/** Read-only by construction — these cannot mutate anything, so they are safe to call reversible. */
const READ_ONLY = /^(ls|dir|cat|type|head|tail|grep|rg|find|pwd|whoami|echo|git\s+(status|log|diff|show|branch$))\b/i

export function classifyCommand(command: string): DerivedSignals {
  const cmd = command.trim()

  for (const { re, blast, effect } of IRREVERSIBLE) {
    if (re.test(cmd)) return { effectClass: effect, blastRadius: blast, reversible: false }
  }

  if (READ_ONLY.test(cmd)) {
    return { effectClass: 'read', blastRadius: 'file', reversible: true }
  }

  if (NETWORK.test(cmd)) {
    // Reversible is deliberately absent: `npm install` is usually undoable, `git push`
    // is usually not, and we are not going to pretend to know which this was.
    return { effectClass: 'network', blastRadius: 'repo' }
  }

  // The common case: a build, a test, a script. It executed; beyond that we do not know.
  return { effectClass: 'execute', blastRadius: 'repo' }
}

export function classifyFileEvent(kind: EventKind, snapshotted: boolean): DerivedSignals {
  switch (kind) {
    case 'file.read':
      return { effectClass: 'read', blastRadius: 'file', reversible: true }
    case 'file.write':
      // Reversible exactly when we hold the prior content. Not a guess — a fact about
      // our own record.
      return { effectClass: 'write', blastRadius: 'file', reversible: snapshotted }
    case 'file.delete':
      return { effectClass: 'destroy', blastRadius: 'file', reversible: snapshotted }
    default:
      return { effectClass: 'write', blastRadius: 'file' }
  }
}
