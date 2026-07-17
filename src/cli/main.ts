/**
 * LODESTAR — command dispatch.
 *
 * Six commands. Not fifty. The sixth (`graph`) was added by decision D-062, per
 * D-012's rule that a new command costs a DECISIONS.md entry. A seventh costs the
 * same. See USER-FLOW.md §7.
 *
 * Loaded via dynamic import from index.ts so the warning filter is installed first.
 */

import { errOut, out, bold, dim, fail } from './ui.js'
import { LODESTAR_VERSION } from '../core/version.js'
import { cmdInit } from './commands/init.js'
import { cmdSessions } from './commands/sessions.js'
import { cmdStatus } from './commands/status.js'
import { cmdReport } from './commands/report.js'
import { cmdRun } from './commands/run.js'
import { cmdGraph } from './commands/graph.js'

const HELP = `${bold('LODESTAR')} - Trust layer for AI agents

${bold('Commands:')}

  init        Initialize LODESTAR in a project
  run         Run an agent through LODESTAR
  claude      Run Claude Code through LODESTAR
  report      View AI session reports
  sessions    List previous sessions
  status      Show current recording status
  graph       The organizational evidence graph (V1)

${dim('Know what your AI actually did.')}
`

/**
 * Runtimes callable directly as `lodestar <agent>`.
 *
 * Sugar for the wedge, kept because USER-FLOW.md §4 is built on `lodestar claude` and
 * its whole point is to feel like `claude`. The general form is `lodestar run <agent>`,
 * which is unambiguous for arbitrary runtimes (D-024).
 */
const RUNTIME_SUGAR = new Set(['claude'])

export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      out(HELP)
      return 0
    }

    if (command === '--version' || command === '-v') {
      out(LODESTAR_VERSION)
      return 0
    }

    switch (command) {
      case 'init':
        return cmdInit()
      case 'sessions':
        return cmdSessions()
      case 'status':
        return cmdStatus()
      case 'report':
        return cmdReport(rest)
      case 'graph':
        return cmdGraph(rest)
      case 'run': {
        const [agent, ...agentArgs] = rest
        if (!agent) {
          errOut(fail('lodestar run needs an agent: lodestar run claude'))
          return 1
        }
        return cmdRun(agent, agentArgs)
      }
      default:
        if (RUNTIME_SUGAR.has(command)) return cmdRun(command, rest)
        errOut(fail(`Unknown command: ${command}`))
        errOut()
        errOut(HELP)
        return 1
    }
  } catch (err: unknown) {
    errOut(fail(err instanceof Error ? err.message : String(err)))
    return 1
  }
}
