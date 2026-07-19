/**
 * `lodestar explain [n]` — why each reported fact is believed (D-073).
 *
 * The report says WHAT was observed; this command answers "why do you believe
 * that?" for every fact: the evidence chain expanded to full events, the
 * assumptions each conclusion rests on, what was checked and what could not be
 * seen. Local explain only — deterministic rendering of the same `SessionReport`
 * model (D-049). No narration is generated here or anywhere: an explanation this
 * product cannot cite is an explanation it does not give.
 */

import { findProjectRoot, paths } from '../../core/project.js'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { buildReport, FACT_TITLES, type SessionReport } from '../../facts/report.js'
import { out, dim, bold, warn, red, yellow, green, cyan, formatWhen } from '../ui.js'
import { renderIntegrity, renderLimitations, renderOutcome, wrapText, plural } from '../render.js'
import { requireProject } from './shared.js'

export function cmdExplain(args: string[]): number {
  const root = findProjectRoot()
  if (!root) return requireProject()

  const wanted = args.find((a) => /^\d+$/.test(a))
  const sessionNumber = wanted ? Number(wanted) : undefined

  const db = openDatabase(paths(root).db)
  try {
    const store = new SqliteEventStore(db)
    const session =
      sessionNumber !== undefined ? store.getSessionByNumber(sessionNumber) : store.latestSession()

    if (!session) {
      out()
      out(warn(sessionNumber !== undefined ? `No session #${sessionNumber}.` : 'No sessions recorded yet.'))
      out()
      return 1
    }

    const report = buildReport(store, session.id)
    if (!report) {
      out()
      out(warn('That session could not be read.'))
      out()
      return 1
    }

    render(report)
    return report.integrity.status === 'BROKEN' ? 2 : 0
  } finally {
    db.close()
  }
}

/** The human title for a catalog id, tolerating ids this build does not know. */
function titleOf(id: string): string {
  return (FACT_TITLES as Record<string, string>)[id] ?? id
}

function render(r: SessionReport): void {
  const { session } = r

  out()
  out(
    `${bold('LODESTAR')}  explain · session #${String(session.number).padStart(3, '0')}  ${dim('·')}  ` +
      `${session.runtimeId}  ${dim('·')}  ${formatWhen(session.startedAt)}`,
  )
  if (session.mission) out(dim(`  ${session.mission}`))

  // A broken chain ends the explanation before it begins: explaining facts computed
  // from altered bytes would lend them a credibility they do not have.
  if (r.factsVerdict === 'record-untrustworthy') {
    out()
    out(`  ${red('✗')} ${bold('Nothing in this record can be explained.')}`)
    out(dim('    The chain does not recompute, so every event in it is untrusted — including'))
    out(dim('    the ones a fact would cite as its evidence.'))
    renderIntegrity(r)
    out()
    return
  }

  // ---- what was checked, before what was found (D-048: coverage is declared) ----
  out()
  out(bold(`  What was checked (${r.catalog.length})`))
  out(dim('  The facts this record\'s generator declares it evaluates. Absence of a finding'))
  out(dim('  below is a statement about these checks only — never about anything unchecked.'))
  out()
  for (const id of r.catalog) {
    const fired = r.facts.some((f) => f.id === id)
    // A dot, not a check mark: "declared and no finding" is weaker than "checked and
    // clean" — a declared fact can still be skipped for cause (RF-04 under a clock
    // regression), and that cause is disclosed in the limitations, not here.
    out(`  ${fired ? yellow('▪') : dim('·')} ${dim(id)}  ${titleOf(id)}${fired ? yellow('  — observed, below') : dim('  — no finding')}`)
  }
  out()

  // ---- each fact, evidence expanded ----------------------------------------
  if (r.factsVerdict === 'none-observed') {
    out(`  ${green('✓')} No divergences observed.`)
    if (r.limitations.length) out(dim('    Read the limitations below before treating that as all-clear.'))
    out()
  } else {
    out(bold(`  Divergences (${r.facts.length})`))
    out()
    for (const v of r.views) {
      out(`  ${yellow('▪')} ${bold(v.title)}  ${dim(`· ${v.fact.id} · confidence: ${v.fact.confidence}`)}`)
      out(`    ${wrapText(v.fact.statement, 4)}`)
      out()
      out(dim('    Observed:'))
      for (const s of v.steps) {
        if (s.state === 'consequence') continue
        const at = s.ts ? `  ${dim(new Date(s.ts).toLocaleTimeString())}` : ''
        out(`      ${green('✓')} ${s.text}${at}${s.eventSeq !== undefined ? dim(`  (#${s.eventSeq})`) : ''}`)
      }
      const consequence = v.steps.find((s) => s.state === 'consequence')
      if (consequence) {
        out(dim('    Together:'))
        out(`      ${yellow('⚠')} ${consequence.text}`)
      }
      out(dim('    Evidence, resolved:'))
      for (const ev of v.fact.evidence) {
        const e = r.evidence[ev.eventId]
        if (!e) {
          out(`      ${red('?')} ${cyan(`#${ev.eventSeq}`)} ${ev.source} — event not found in record`)
          continue
        }
        out(
          `      ${cyan(`#${e.seq}`)} ${e.kind}  ${dim(e.source)}  ${dim(new Date(e.ts).toLocaleTimeString())}`,
        )
        out(`         ${e.summary}${e.target ? dim(`  → ${e.target}`) : ''}`)
      }
      if (v.assumptions.length) {
        out(dim('    This conclusion assumes:'))
        for (const a of v.assumptions) out(`      ${yellow('assumes')} ${dim(wrapText(a, 14))}`)
      }
      out()
    }
  }

  // ---- what could not be seen ----------------------------------------------
  renderLimitations(r)

  if (r.coverage.length) {
    const observed = r.coverage.filter((c) => c.status === 'observed').map((c) => c.command)
    const holes = r.coverage.filter((c) => c.status !== 'observed' && c.status !== 'absent')
    out(bold('  Command coverage, as measured at session start'))
    if (observed.length) out(dim(`    observed: ${observed.join(' ')}`))
    for (const h of holes) {
      out(`    ${yellow(h.status === 'unknown' ? 'unmeasured' : 'not observed')}: ${h.command}${h.reason ? dim(` — ${h.reason}`) : ''}`)
    }
    out()
  }

  if (r.interference.length) {
    out(bold('  LODESTAR interference'))
    out(dim('  We changed this session. Failures caused by us are not the agent\'s.'))
    for (const n of r.interference) out(`  ${yellow('!')} ${wrapText(n, 4)}`)
    out()
  }

  renderOutcome(r)
  renderIntegrity(r)
  out()
  out(dim(`  Every claim above cites ${plural(Object.keys(r.evidence).length, 'recorded event')}. Export and`))
  out(dim('  verify them independently:  lodestar report --record'))
  out()
}
