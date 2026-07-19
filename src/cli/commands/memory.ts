/**
 * `lodestar memory` — what happened before (D-073).
 *
 * A deterministic digest of this project's recorded history: every session with its
 * mission, outcome, and integrity, plus the declared claims (links) in the project's
 * evidence graph when one exists. The ledger and the graph ARE the memory — this
 * command is a view over them, not a store beside them.
 *
 * Two things this deliberately is not:
 *   - It is never fed back to an agent. LODESTAR observes agents; it does not brief
 *     them (the V0 do-not-build list's first line, still binding).
 *   - It is never summarized by a model. A generated summary of the corpus is the
 *     agent-reporting-on-itself problem at project scale (V1-DESIGN §0.6).
 *
 * Writing to memory already exists and is not duplicated here: finish sessions
 * (`lodestar claude`), and declare claims (`lodestar graph link … --reason`).
 */

import { findProjectRoot, paths } from '../../core/project.js'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { buildIndex, type SessionIndexRow } from '../../facts/report.js'
import {
  findGraphRoot,
  openGraph,
  queryLinks,
  reportJson,
  type LinksReport,
} from '../../graph/index.js'
import { out, dim, bold, red, yellow, green, formatWhen } from '../ui.js'
import { plural, LIST_CAP } from '../render.js'
import { requireProject } from './shared.js'

export function cmdMemory(args: string[]): number {
  const root = findProjectRoot()
  if (!root) return requireProject()

  const asJson = args.includes('--json')

  const db = openDatabase(paths(root).db)
  let rows: SessionIndexRow[]
  try {
    const store = new SqliteEventStore(db)
    rows = buildIndex(store)
  } finally {
    db.close()
  }

  // The graph is optional context, not a requirement: a solo project with no graph
  // still has a memory — its own ledger.
  let links: LinksReport | null = null
  let graphNote: string | null = null
  const graphDir = findGraphRoot(process.cwd())
  if (graphDir) {
    try {
      links = queryLinks(openGraph(graphDir))
    } catch (err) {
      graphNote = `The graph at ${graphDir} could not be read: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (asJson) {
    // Deterministic for a given ledger + graph, same as every graph query (D-063).
    out(reportJson({ sessions: rows, links }))
    return 0
  }

  out()
  out(`${bold('LODESTAR')}  memory  ${dim('·')}  ${dim(root)}`)
  out()

  if (!rows.length) {
    out(dim('  Nothing recorded yet. This project has no history to remember.'))
    out()
    out(dim('  Start one:  lodestar claude'))
    out()
    return 0
  }

  // ---- sessions, newest first ----------------------------------------------
  out(bold(`  Sessions (${rows.length})`))
  out()
  for (const row of rows.slice(0, LIST_CAP)) {
    const s = row.session
    const integrity =
      row.status === 'BROKEN' ? red('BROKEN') : row.status === 'DEGRADED' ? yellow('DEGRADED') : green('verified-chain')
    const finding =
      row.factsVerdict === 'record-untrustworthy'
        ? red('untrustworthy')
        : row.factCount > 0
          ? yellow(plural(row.factCount, 'divergence'))
          : dim('no divergences observed')
    out(`  ${bold(`#${String(s.number).padStart(3, '0')}`)}  ${s.mission ?? dim('(no mission recorded)')}`)
    out(
      `       ${dim(`${formatWhen(s.startedAt)} · ${s.runtimeId} · ${plural(row.commands, 'command')} · ${plural(row.filesChanged, 'file')} changed`)}`,
    )
    out(`       ${finding}  ${dim('·')}  ${integrity}${row.closed ? '' : `  ${dim('·')}  ${yellow('never closed')}`}`)
    out()
  }
  if (rows.length > LIST_CAP) {
    out(dim(`  … and ${rows.length - LIST_CAP} more — lodestar sessions lists them all`))
    out()
  }

  // ---- declared claims, from the graph -------------------------------------
  if (graphNote) {
    out(`  ${yellow('⚠')} ${graphNote}`)
    out()
  }
  if (links) {
    const active = links.links.filter((l) => !l.retracted)
    out(bold(`  Declared claims (${active.length})`))
    out(dim('  Authored statements from the evidence graph — claims, not observations (P5).'))
    out(dim('  Authors are unauthenticated until V2 signatures.'))
    out()
    if (!active.length) {
      out(dim('  None declared yet. Record one:  lodestar graph link <type> <from> <to> --reason "…"'))
    }
    for (const l of active.slice(0, LIST_CAP)) {
      out(`  ${yellow('▪')} ${bold(l.type)}  ${dim(`by ${l.author}`)}`)
      if (l.reason) out(`      ${l.reason}`)
      out(dim(`      ${l.from} → ${l.to}`))
    }
    if (active.length > LIST_CAP) out(dim(`  … and ${active.length - LIST_CAP} more — lodestar graph query links`))
    out()
  } else if (!graphNote) {
    out(dim('  No evidence graph found — declared claims (decisions, notes) live there.'))
    out(dim('  Create one:  lodestar graph init'))
    out()
  }

  return 0
}
