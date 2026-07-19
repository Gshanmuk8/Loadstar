/**
 * `lodestar status` — recording state, current session, chain integrity.
 *
 * The integrity line is why there is no `lodestar verify` command: a trust product
 * must let you check its central claim yourself, and a line in the status you already
 * read is more reachable than a command you never run. See DECISIONS.md D-016.
 */

import { basename } from 'node:path'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { findProjectRoot, paths } from '../../core/project.js'
import { readConfig } from '../../core/config.js'
import { out, dim, bold, green, red, yellow } from '../ui.js'
import { describeOpenSession, openSessionState, requireProject } from './shared.js'

export function cmdStatus(): number {
  const root = findProjectRoot()
  if (!root) return requireProject()

  const p = paths(root)
  const config = readConfig(p.config)
  const db = openDatabase(p.db)

  try {
    const store = new SqliteEventStore(db)
    const latest = store.latestSession()

    out()
    out(bold('LODESTAR'))
    out()
    out(`${dim('Project:')}\n${basename(root)}`)
    out()
    out(`${dim('Recording:')}\n${config.recording ? green('ACTIVE') : yellow('DISABLED')}`)
    out()

    if (!latest) {
      out(dim('No sessions recorded yet.'))
      out()
      return 0
    }

    const open = !latest.endedAt
    const state = open ? openSessionState(latest) : null
    const events = store.query({ sessionId: latest.id })

    out(
      `${dim(state === 'running' ? 'Current session:' : 'Last session:')}\n#${String(latest.number).padStart(3, '0')}`,
    )
    // An open session whose wrapper died must never read as "current" (D-074).
    if (state && state !== 'running') {
      out(yellow(describeOpenSession(state, latest.wrapperPid)))
    }
    out()
    out(`${dim('Events captured:')}\n${events.length}`)
    out()

    const result = store.verify(latest.id)
    out(dim('Record integrity:'))
    if (result.intact) {
      out(`${green('✓')} verified ${dim(`(${result.eventsChecked} events)`)}`)
    } else {
      out(`${red('✗')} BROKEN at event ${result.brokenAt}`)
      out(dim(`  ${result.reason}`))
    }
    out()

    return result.intact ? 0 : 1
  } finally {
    db.close()
  }
}
