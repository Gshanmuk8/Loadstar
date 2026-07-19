import { errOut, out, dim, warn } from '../ui.js'
import type { Session } from '../../types/events.js'

/** Every command except `init` needs an initialized project. Say so once, consistently. */
export function requireProject(): number {
  errOut()
  errOut(warn('No LODESTAR project found here.'))
  out()
  out(dim('Initialize one:'))
  out(dim('  lodestar init'))
  out()
  return 1
}

/**
 * What an OPEN session (no endedAt) actually is, as far as a read can tell (D-074).
 *
 * `running`     — the wrapper that owns it is alive right now.
 * `interrupted` — the wrapper is gone and never closed the session. The record ends
 *                 where it ends; everything after the last event is unobserved.
 * `unknown`     — recorded before wrapper PIDs existed (schema v1). May be either.
 *
 * A heuristic and labelled as one: PIDs are reused, so `running` can rarely be a
 * stranger wearing the wrapper's number. This never touches the ledger or the record
 * — it is read-time narration, same class as index-freshness notes (D-066).
 */
export type OpenSessionState = 'running' | 'interrupted' | 'unknown'

export function openSessionState(s: Session): OpenSessionState {
  if (s.endedAt) throw new Error('openSessionState is only meaningful for open sessions')
  if (typeof s.wrapperPid !== 'number') return 'unknown'
  try {
    // Signal 0: existence probe, delivers nothing.
    process.kill(s.wrapperPid, 0)
    return 'running'
  } catch (err) {
    // EPERM = alive but not ours; anything else (ESRCH) = gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM' ? 'running' : 'interrupted'
  }
}

/** The one wording for an interrupted session, shared by every command that shows it. */
export function describeOpenSession(state: OpenSessionState, wrapperPid?: number | null): string {
  switch (state) {
    case 'running':
      return 'running'
    case 'interrupted':
      return `interrupted — the wrapper (pid ${wrapperPid}) is gone and never closed this session`
    case 'unknown':
      return 'open — never closed; recorded before wrapper liveness existed, so it may be running or interrupted'
  }
}
