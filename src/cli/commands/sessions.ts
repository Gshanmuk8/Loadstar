/**
 * `lodestar sessions` — list previous sessions.
 *
 * See USER-FLOW.md §8.
 */

import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { findProjectRoot, paths } from '../../core/project.js'
import { out, dim, bold, formatWhen, formatDuration } from '../ui.js'
import { requireProject } from './shared.js'

export function cmdSessions(): number {
  const root = findProjectRoot()
  if (!root) return requireProject()

  const db = openDatabase(paths(root).db)
  try {
    const store = new SqliteEventStore(db)
    const sessions = store.listSessions()

    if (!sessions.length) {
      out()
      out(dim('No sessions recorded yet.'))
      out()
      out(dim('Start one:'))
      out(dim('  lodestar claude'))
      out()
      return 0
    }

    out()
    out(bold('Sessions:'))
    out()
    for (const s of sessions) {
      const label = s.mission ?? dim('(no mission recorded)')
      const duration =
        s.endedAt && s.startedAt
          ? dim(
              ` · ${formatDuration(new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime())}`,
            )
          : dim(' · running')
      out(`  ${bold(`#${String(s.number).padStart(3, '0')}`)}  ${label}`)
      out(`       ${dim(formatWhen(s.startedAt))}${duration}`)
      out()
    }
    return 0
  } finally {
    db.close()
  }
}
