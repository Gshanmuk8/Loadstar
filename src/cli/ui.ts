/**
 * LODESTAR — terminal output primitives.
 *
 * Deliberately dependency-free. A TUI library is Phase 10 polish; the engine must not
 * wait on it. See USER-FLOW.md for the exact shape of every output.
 */

const useColor = process.stdout.isTTY && !process.env['NO_COLOR']

const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)

export const dim = wrap('2')
export const bold = wrap('1')
export const red = wrap('31')
export const yellow = wrap('33')
export const green = wrap('32')
export const cyan = wrap('36')

export const ok = (s: string) => `${green('✓')} ${s}`
export const warn = (s: string) => `${yellow('⚠')} ${s}`
export const fail = (s: string) => `${red('✗')} ${s}`

/**
 * Neutralize terminal control sequences in everything we print.
 *
 * The strings this CLI renders come from evidence: command lines, filenames, link
 * reasons — all writable by the observed agent. `html.ts` already establishes the
 * rule for the HTML surface ("escaping everything, always, at the boundary"); this is
 * the same rule for the terminal. Without it, a command named `\x1b[2J\x1b[H...` or a
 * reason carrying `\r` can move the cursor and overwrite lines — including the
 * verdict — in `report --terminal` and every `graph query`. A trust tool whose
 * verdict line can be repainted by the party under observation has no verdict.
 *
 * What passes: printable text, `\n`, `\t`, and — only when color is on — LODESTAR's
 * own SGR color codes (`ESC[<digits;>m`, which restyle text but cannot move the
 * cursor). Every other ESC is dropped so its payload prints as visible characters
 * (disclosed, not executed), and remaining C0/C1 control bytes (including `\r`, BEL,
 * and the single-byte CSI/OSC introducers) are stripped.
 */
function neutralizeControls(s: string): string {
  const noEsc = useColor
    ? s.replace(/\x1b(?!\[[0-9;]*m)/g, '') // keep SGR; bare/other ESC becomes visible text
    : s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b/g, '') // color off: no ESC at all
  // eslint-disable-next-line no-control-regex
  return noEsc.replace(/[\0-\x08\x0b-\x1a\x1c-\x1f\x7f\u0080-\u009f]/g, '')
}

export function out(s = ''): void {
  process.stdout.write(neutralizeControls(s) + '\n')
}

export function errOut(s = ''): void {
  process.stderr.write(neutralizeControls(s) + '\n')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** "Today 10:30 AM" / "Yesterday 5:20 PM" / "Mon 14 Jul" — as specified in USER-FLOW.md §8. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const days = daysBetween(d, now)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  if (days < 7) return `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${time}`
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysBetween(a: Date, b: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((day(b) - day(a)) / 86_400_000)
}
