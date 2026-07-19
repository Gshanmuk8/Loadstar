/**
 * Shared terminal sections for the session views — report, replay, explain (D-073).
 *
 * One wording per judgment, printed from the model verbatim (D-049): three commands
 * describing the same file change, command result, or integrity state in three
 * different sentences are three answers to the one question this product answers.
 * These helpers do layout and colour only; every value comes from `SessionReport`.
 */

import type { SessionReport } from '../facts/report.js'
import { out, dim, bold, red, yellow, green } from './ui.js'

/** `1 event` / `2 events`. Cosmetic; never changes a count. */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** Wrap long prose to the terminal, indented. Cosmetic only — never changes meaning. */
export function wrapText(s: string, indent: number): string {
  const width = Math.max(40, (process.stdout.columns ?? 80) - indent - 4)
  const pad = ' '.repeat(indent)
  const words = s.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) lines.push(line)
  return lines.join(`\n${pad}`)
}

/**
 * Long lists are capped, and the cap is announced. A silent truncation reads as
 * "that was everything", which is the exact silence-as-all-clear failure the
 * coverage rules exist to prevent.
 */
export const LIST_CAP = 20

/** Every completed command the boundary observed, with its recorded result. */
export function renderCommands(r: SessionReport): void {
  if (!r.commands.length) return
  out(bold(`  Commands (${r.commands.length})`))
  out()
  for (const c of r.commands.slice(0, LIST_CAP)) {
    // Same glyph rule the fact chains use: a nonzero exit or a signal is marked, a
    // zero exit is not. The summary sentence itself comes from the model.
    const marked = /exited with code [1-9]|terminated by/.test(c.summary)
    out(
      `  ${marked ? red('✗') : green('✓')} ${c.summary}  ` +
        dim(`#${c.seq} · ${new Date(c.ts).toLocaleTimeString()}`),
    )
  }
  if (r.commands.length > LIST_CAP) {
    out(dim(`    … and ${r.commands.length - LIST_CAP} more — lodestar replay shows every event`))
  }
  out()
}

/** Every file the session touched. The availability verdict is the model's (D-054). */
export function renderChanges(r: SessionReport): void {
  if (!r.changes.length) return
  out(bold(`  Files changed (${r.changes.length})`))
  out()
  for (const f of r.changes.slice(0, LIST_CAP)) {
    const marks: string[] = []
    if (f.deleted) marks.push(red('deleted'))
    // RF-07's territory: a path outside the project must never look local.
    if (!f.inScope) marks.push(yellow('outside the project'))
    const writes = f.writes > 1 ? dim(` · ${f.writes} writes`) : ''
    out(
      `  ${f.deleted ? red('-') : yellow('~')} ${f.display}` +
        (marks.length ? `  ${marks.join('  ')}` : '') +
        writes,
    )
    if (f.content !== 'available' && f.contentNote) out(dim(`      ${wrapText(f.contentNote, 6)}`))
  }
  if (r.changes.length > LIST_CAP) out(dim(`    … and ${r.changes.length - LIST_CAP} more`))
  out()
}

/**
 * What we could not determine, printed whether or not there are facts.
 *
 * This block is the reason an empty report cannot imply success. `limitations` says
 * what the fact engine could not compute; `integrity.degraded` says what the record
 * itself is missing. They are different questions and both get answered.
 */
export function renderLimitations(r: SessionReport): void {
  const notes = [...r.limitations, ...r.integrity.degraded]
  if (!notes.length) return

  out(bold(`  Limitations (${notes.length})`))
  out(dim('  What LODESTAR could not determine. Not evidence of absence.'))
  out()
  for (const n of notes) out(`  ${yellow('?')} ${wrapText(n, 4)}`)
  out()
}

/** How the session ended — the model's sentence, from the chained session.end event. */
export function renderOutcome(r: SessionReport): void {
  const o = r.outcome
  const glyph =
    o.state === 'exited' && o.exitCode === 0
      ? green('✓')
      : o.state === 'exited'
        ? red('✗')
        : yellow('▪')
  out(`  ${glyph} Result: ${o.text}`)
}

/** The integrity block — identical in every command that prints one. */
export function renderIntegrity(r: SessionReport): void {
  const { status, chain } = r.integrity
  out()
  switch (status) {
    case 'VERIFIED':
      out(`  ${green('VERIFIED')}  ${dim(`evidence consistent · ${chain.eventsChecked} events, chain intact`)}`)
      out(dim(`            record ${r.recordId.slice(0, 16)}… — the citable id of this evidence`))
      break
    case 'DEGRADED':
      // Do NOT count the notes here. The limitations block merges two lists (what the
      // fact engine could not compute, and what the record is missing), and a count
      // taken from one of the two reads as a count of both. Pointing at the block is
      // honest; a number that disagrees with what the user can see costs more trust
      // than it buys.
      out(`  ${yellow('DEGRADED')}  ${dim('some evidence unavailable · see Limitations above')}`)
      out(dim(`            the chain itself is intact across ${plural(chain.eventsChecked, 'event')}`))
      break
    case 'BROKEN':
      out(`  ${red('BROKEN')}    ${bold('integrity failure detected')}`)
      out(dim(`            ${chain.reason ?? 'the chain does not recompute'}`))
      if (chain.brokenAt !== undefined) out(dim(`            first break at event #${chain.brokenAt}`))
      out()
      out(dim('  This record was altered after it was written. Nothing above it can be trusted.'))
      break
  }
}
