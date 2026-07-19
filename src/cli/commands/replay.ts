/**
 * `lodestar replay [n]` — reconstruct one session from its evidence (D-073).
 *
 * "What exactly happened during this AI session?", answered as the full ordered
 * timeline: every event, in chain order, with its tier visible. This command renders
 * the same `SessionReport` the report and dashboard use (D-049); it re-executes
 * nothing and infers nothing. Deterministic replay-as-re-execution was deliberately
 * demoted (D-006); this is the timeline that decision said covers the need.
 *
 * The tier labels are load-bearing: narration and intent are the agent's own voice,
 * and rendering them beside observed events unlabelled would be the
 * agent-reporting-on-itself problem sneaking back in through the view layer.
 */

import { findProjectRoot, paths } from '../../core/project.js'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { buildReport, type SessionReport } from '../../facts/report.js'
import { out, dim, bold, warn, red, yellow, cyan, formatWhen, formatDuration } from '../ui.js'
import { renderChanges, renderIntegrity, renderLimitations, renderOutcome, plural } from '../render.js'
import { requireProject } from './shared.js'

export function cmdReplay(args: string[]): number {
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
      out(dim('  Record one:'))
      out(dim('    lodestar claude'))
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

function render(r: SessionReport): void {
  const { session, identity } = r

  out()
  out(
    `${bold('LODESTAR')}  replay · session #${String(session.number).padStart(3, '0')}  ${dim('·')}  ` +
      formatWhen(session.startedAt),
  )
  out()

  // ---- who ran, and what was asked ----------------------------------------
  const agent = [
    session.runtimeId,
    identity.runtimeVersion ? `v${identity.runtimeVersion}` : null,
    identity.model ?? null,
  ].filter(Boolean)
  out(`  ${dim('Agent')}    ${agent.join('  ')}`)
  out(`  ${dim('Mission')}  ${session.mission ?? dim('(no mission recorded)')}`)
  if (identity.gitCommit) out(`  ${dim('From')}     ${dim(`git ${identity.gitCommit.slice(0, 12)}`)}`)
  const duration =
    session.endedAt && session.startedAt
      ? formatDuration(new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime())
      : null
  out(
    dim(
      `  ${plural(r.counts.events, 'event')} · ${plural(r.counts.commands, 'command')} · ` +
        `${plural(r.counts.filesChanged, 'file')} changed${duration ? ` · ${duration}` : ''}`,
    ),
  )

  // A rewritten record still gets its timeline shown — the events are the evidence of
  // the tamper — but nothing here may read as trustworthy before the reader knows.
  if (r.integrity.status === 'BROKEN') {
    out()
    out(`  ${red('✗')} ${bold('This record was altered after it was written.')}`)
    out(dim('    The timeline below is what the altered record NOW says — not what happened.'))
  }

  // ---- the timeline --------------------------------------------------------
  out()
  out(bold(`  Timeline (${r.timeline.length} events)`))
  out(dim('  ● marks events cited by a Reality Fact. Tier labels mark the agent\'s own voice.'))
  out()
  for (const e of r.timeline) {
    // The agent's claims must never be typeset as observations (D-053's reasoning at
    // the view layer): groundTruth is unlabelled, everything else says what it is.
    const tier =
      e.tier === 'groundTruth' ? '' : yellow(`[${e.tier === 'narration' ? 'claimed' : 'intent'}] `)
    const mark = e.cited ? cyan('●') : dim('·')
    const time = new Date(e.ts).toLocaleTimeString()
    out(`  ${mark} ${dim(`#${String(e.seq).padStart(3, ' ')}`)}  ${dim(time)}  ${tier}${e.summary}`)
  }
  out()

  // ---- what changed, how it ended, whether to trust it ---------------------
  renderChanges(r)

  if (r.facts.length) {
    out(bold(`  Divergences (${r.facts.length})`))
    for (const v of r.views) {
      out(`  ${yellow('▪')} ${v.title} ${dim(`· ${v.fact.id} · evidence ${v.fact.evidence.map((e) => `#${e.eventSeq}`).join(' ')}`)}`)
    }
    out(dim('    lodestar explain shows each one with its full evidence chain.'))
    out()
  }

  renderLimitations(r)
  renderOutcome(r)
  renderIntegrity(r)
  out()
  out(dim('  lodestar explain            why each reported fact is believed'))
  out(dim('  lodestar report --record    export this session as a verifiable record'))
  out()
}
