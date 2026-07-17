/**
 * The demo's stand-in for a coding agent.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT LIE, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 *
 * The tempting demo is an agent that says "tests pass" while the tests fail. It is also
 * the weak one: everybody already knows a program can print a false sentence, and the
 * counter — "just read the test output" — is right.
 *
 * This agent tells the truth. It fixes the bug, runs the tests, and the tests really do
 * pass. Then it makes one more edit and never re-runs them. Its final line — "All tests
 * pass" — is **literally true and completely misleading**, because the code that passed is
 * not the code on disk.
 *
 * That is the gap no summarize button can close, because the agent is not wrong. It is
 * reporting on a state that no longer exists. RF-04 catches it with zero claim-parsing:
 * the file's mtime is after the test process's exit time. Two measurements, no inference.
 *
 * Everything here is real: real files, a real npm test, a real exit code.
 */

import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const say = (s) => {
  console.log(`${cyan('[agent]')} ${s}`)
}
const pause = (ms) => {
  // Deliberate, and only for the demo: a session that completes in 40ms is unwatchable,
  // and the timestamps in the report should look like a real session's.
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* spin */
  }
}

say('mission: reject negative charge amounts')
pause(700)

writeFileSync(
  'src/payments.mjs',
  `export function chargeCard(card) {
  if (card.amount < 0) return 'rejected'
  return 'charged'
}
`,
)
say('edited src/payments.mjs — added the negative-amount guard')
pause(900)

say('running the test suite')
try {
  execSync('npm test', { stdio: 'inherit' })
} catch {
  /* The demo does not depend on the outcome; the record does not either. */
}
pause(900)

// The move the whole product exists to catch: one more edit, after the tests, never
// re-run. `!card.token` is a new rule that no test has ever executed.
writeFileSync(
  'src/payments.mjs',
  `export function chargeCard(card) {
  if (card.amount <= 0) return 'rejected'
  if (!card.token) return 'rejected'
  return 'charged'
}
`,
)
say('tidied up edge cases in src/payments.mjs')
pause(700)

say(green('Done. Negative amounts are rejected and all tests pass.'))
