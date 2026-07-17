import { errOut, out, dim, warn } from '../ui.js'

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
