/**
 * LODESTAR — command dispatch.
 *
 * Nine commands. Not fifty. The sixth (`graph`) was added by decision D-062;
 * `replay`, `explain`, and `memory` by D-073 — every one under D-012's rule that a
 * new command costs a DECISIONS.md entry. A tenth costs the same. See USER-FLOW.md §7.
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
import { cmdReplay } from './commands/replay.js'
import { cmdExplain } from './commands/explain.js'
import { cmdMemory } from './commands/memory.js'

const HELP = `${bold('LODESTAR')} - Trust layer for AI agents

${bold('Commands:')}

  init        Initialize LODESTAR in a project
  run         Run an agent through LODESTAR
  claude      Run Claude Code through LODESTAR
  report      View AI session reports
  replay      Reconstruct a session: the full timeline, from the evidence
  explain     Why each reported fact is believed, evidence expanded
  sessions    List previous sessions
  memory      What happened before: past sessions and declared claims
  status      Show current recording status
  graph       The organizational evidence graph (V1)

${dim('  lodestar run --mission "refactor auth" claude   record what you asked for')}
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

/**
 * Pull `--mission <text>` out of the args that precede the agent name.
 *
 * Stops at the first token that is not a LODESTAR flag: from there on, argv is the
 * agent's property and is never inspected again. The sugar form (`lodestar claude …`)
 * takes no mission flag for the same reason — its whole argv belongs to the agent;
 * use `lodestar run --mission "…" claude` or LODESTAR_MISSION instead (D-073).
 */
export function extractMission(args: string[]): { mission: string | null; rest: string[] } {
  let mission: string | null = null
  let i = 0
  while (i < args.length && args[i] === '--mission') {
    const value = args[i + 1]
    if (value === undefined) break
    mission = value
    i += 2
  }
  return { mission, rest: args.slice(i) }
}

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
      case 'replay':
        return cmdReplay(rest)
      case 'explain':
        return cmdExplain(rest)
      case 'memory':
        return cmdMemory(rest)
      case 'graph':
        return cmdGraph(rest)
      case 'run': {
        // `--mission` is consumed only BEFORE the agent name. Everything after the
        // agent belongs to the agent, verbatim — LODESTAR never takes a flag out of
        // the agent's argv, or `lodestar run claude --mission x` would silently mean
        // something different from `claude --mission x` (D-073).
        const { mission, rest: runArgs } = extractMission(rest)
        const [agent, ...agentArgs] = runArgs
        if (!agent) {
          errOut(fail('lodestar run needs an agent: lodestar run claude'))
          errOut(dim('  With a stated mission:  lodestar run --mission "refactor auth" claude'))
          return 1
        }
        return cmdRun(agent, agentArgs, { mission })
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
