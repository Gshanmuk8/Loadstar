/**
 * Run every stress suite. `npm run stress`.
 *
 * These are separate from `npm test` because they spawn dozens of real OS processes,
 * hammer real filesystems, and deliberately try to fork bomb the machine. They are slow
 * and they are worth it: the two worst bugs in this codebase — the chokidar feedback
 * loop and the shim fork bomb — were both invisible to unit tests and both would have
 * hung a user's machine.
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const HERE = import.meta.dirname
const suites = [
  ['adversarial', ['adversarial.mjs']],
  ['runtime', ['runtime.mjs']],
  ['fork-bomb guard', ['forkbomb.mjs']],
  ['concurrency (12x40)', ['concurrency.mjs', '12', '40']],
  ['concurrency (32x100)', ['concurrency.mjs', '32', '100']],
]

let failed = 0
for (const [name, args] of suites) {
  console.log(`\n${'#'.repeat(64)}\n### ${name}\n${'#'.repeat(64)}`)
  const p = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', join(HERE, args[0]), ...args.slice(1)],
    { stdio: 'inherit', timeout: 10 * 60_000 },
  )
  if (p.status !== 0) {
    failed++
    console.log(`\n>>> SUITE FAILED: ${name}`)
  }
}

console.log(`\n${'='.repeat(64)}`)
console.log(failed ? `${failed}/${suites.length} SUITES FAILED` : `all ${suites.length} stress suites passed`)
process.exit(failed ? 1 : 0)
