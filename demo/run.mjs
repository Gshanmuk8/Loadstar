/**
 * `node demo/run.mjs` — the whole product, on a real project, in about 30 seconds.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCAFFOLD AND NOT A SCRIPT OF SCREENSHOTS
 * ---------------------------------------------------------------------------
 *
 * A demo that is faked is a demo that will be wrong the first time someone asks a
 * question. This one builds a real git repo, records a real session through the real
 * wrapper, and produces a real report — so anything you point at on screen is something
 * you can also open, verify, and be questioned about.
 *
 * It is deterministic in what it *shows* (same project, same agent, same facts) and honest
 * about what it measures (real timestamps, real coverage on this machine, real exit codes).
 *
 * Usage:
 *   npm run build && node demo/run.mjs          # set up + record + terminal report
 *   node demo/run.mjs --keep                    # leave the workspace for a live dashboard
 *
 * Then, for the browser:
 *   cd demo/.workspace && node ../../dist/cli/index.js report
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = join(HERE, '.workspace')
const CLI = join(HERE, '..', 'dist', 'cli', 'index.js')

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function step(n, title, cmd) {
  console.log()
  console.log(`${dim(`── ${n} ──`)} ${bold(title)}`)
  if (cmd) console.log(dim(`$ ${cmd}`))
  console.log()
}

if (!existsSync(CLI)) {
  console.error('Build first:  npm run build')
  process.exit(1)
}

// ---- a real project ---------------------------------------------------------
rmSync(WORKSPACE, { recursive: true, force: true })
mkdirSync(join(WORKSPACE, 'src'), { recursive: true })

writeFileSync(
  join(WORKSPACE, 'package.json'),
  JSON.stringify({ name: 'payments-api', version: '1.0.0', scripts: { test: 'node test.mjs' } }, null, 2) + '\n',
)

// The bug the agent is asked to fix: negative amounts are charged.
writeFileSync(
  join(WORKSPACE, 'src', 'payments.mjs'),
  `export function chargeCard(card) {
  return 'charged'
}
`,
)

// A real test. It really fails against the code above, and really passes after the fix.
writeFileSync(
  join(WORKSPACE, 'test.mjs'),
  `import { chargeCard } from './src/payments.mjs'

const result = chargeCard({ amount: -50 })
if (result !== 'rejected') {
  console.log('FAIL: a negative amount must be rejected, got:', result)
  process.exit(1)
}
console.log('PASS: negative amounts rejected')
`,
)

const git = (args) => execSync(`git ${args}`, { cwd: WORKSPACE, stdio: 'pipe' })
git('init -q .')
git('add -A')
execSync('git -c user.email=dev@example.com -c user.name=dev commit -qm "payments module"', {
  cwd: WORKSPACE,
  stdio: 'pipe',
})

const run = (args, opts = {}) =>
  execFileSync(process.execPath, [CLI, ...args], { cwd: WORKSPACE, stdio: 'inherit', ...opts })

step(1, 'Initialize LODESTAR in the project', 'lodestar init')
run(['init'])

step(2, 'Run the agent, wrapped', 'lodestar claude   (here: lodestar run node agent.mjs)')
try {
  execFileSync(process.execPath, [CLI, 'run', 'node', join(HERE, 'agent.mjs')], {
    cwd: WORKSPACE,
    stdio: 'inherit',
  })
} catch {
  // The wrapper returns the AGENT's exit code, so a failing agent is not a failing demo.
}

step(3, 'See what actually happened', 'lodestar report')
try {
  run(['report', '--terminal'])
} catch {
  // `report` exits 2 on a BROKEN chain. Not expected here, and not a reason to stop.
}

console.log()
console.log(bold('  The agent told the truth. The report still found something.'))
console.log()
console.log('  It fixed the bug, ran the tests, and they really passed — then edited the')
console.log('  file again and never re-ran them. "All tests pass" was true when it was said')
console.log('  and false by the time it was read. No claim-parsing: RF-04 compares the')
console.log('  file\'s modification time to the test process\'s exit time.')
console.log()
console.log(dim('  Open the dashboard:'))
console.log(dim(`    cd demo/.workspace && node ../../dist/cli/index.js report`))
console.log()
console.log(dim('  Share it as a self-contained file:'))
console.log(dim(`    node ../../dist/cli/index.js report --html`))
console.log()

if (!process.argv.includes('--keep')) {
  console.log(dim('  (Pass --keep to leave demo/.workspace in place.)'))
  console.log()
}
