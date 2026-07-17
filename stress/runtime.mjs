/**
 * STRESS 3 — the live paths: filesystem churn, shim exit-code fidelity, hard kill.
 *
 * These exercise real watchers, real processes, and real signals. Nothing is mocked,
 * because the failures worth finding here only exist in the real thing.
 */
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase } from '../dist/storage/db.js'
import { SqliteEventStore } from '../dist/storage/event-store.js'
import { paths } from '../dist/core/project.js'
import { writeConfig } from '../dist/core/config.js'
import { Recorder } from '../dist/recorder/index.js'
import { FLOOR_ONLY } from '../dist/adapters/registry.js'
import { installShims, detectProbeShell, probeCoverage } from '../dist/recorder/shims.js'

const REPO = resolve(import.meta.dirname, '..')
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  PASS' : '  FAIL <<<'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

function project() {
  const root = mkdtempSync(join(tmpdir(), 'stress-rt-'))
  mkdirSync(join(paths(root).sessions), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeConfig(paths(root).config)
  openDatabase(paths(root).db).close()
  return root
}
function read(root, sessionId) {
  const db = openDatabase(paths(root).db)
  try {
    const s = new SqliteEventStore(db)
    return { events: s.query({ sessionId }), verify: s.verify(sessionId), session: s.getSession(sessionId) }
  } finally {
    db.close()
  }
}

// ===========================================================================
console.log('\n=== FILESYSTEM CHURN ===')
// ===========================================================================
{
  const root = project()
  const r = new Recorder({ root, runtimeId: 'stress', capabilities: FLOOR_ONLY })
  const sess = await r.start()

  const N = 300
  const t0 = Date.now()
  for (let i = 0; i < N; i++) writeFileSync(join(root, 'src', `f${i}.ts`), `export const v${i} = ${i}\n`)
  await settle(2500)
  const summary = await r.stop(0)
  const elapsed = Date.now() - t0

  const { events, verify } = read(root, sess.id)
  const writes = events.filter((e) => e.kind === 'file.write')
  check(`${N} files written rapidly — chain intact`, verify.intact, verify.reason ?? '')
  check(`captured ${writes.length}/${N} writes`, writes.length >= N * 0.9, `${writes.length}/${N} in ${elapsed}ms`)
  check('every write has a resolved target', writes.every((e) => e.target?.resolved?.includes('.ts')))
  check('every write is groundTruth', writes.every((e) => e.signalTier === 'groundTruth'))
  check('every write has an after-snapshot', writes.every((e) => e.snapshotRef?.after))
  check('no .lodestar self-observation', !events.some((e) => String(e.target?.resolved ?? '').includes('.lodestar')))
  rmSync(root, { recursive: true, force: true })
}
{
  // Same file rewritten many times: dedup must suppress identical content.
  const root = project()
  const f = join(root, 'src', 'churn.ts')
  writeFileSync(f, 'v0')
  const r = new Recorder({ root, runtimeId: 'stress', capabilities: FLOOR_ONLY })
  const sess = await r.start()
  for (let i = 0; i < 30; i++) {
    writeFileSync(f, 'IDENTICAL')
    await settle(30)
  }
  await settle(800)
  await r.stop(0)
  const { events, verify } = read(root, sess.id)
  const writes = events.filter((e) => e.kind === 'file.write')
  check('30 identical rewrites collapse', writes.length <= 2, `${writes.length} events`)
  check('chain intact after churn', verify.intact)
  rmSync(root, { recursive: true, force: true })
}

// ===========================================================================
console.log('\n=== EXIT CODE FIDELITY ===')
// ===========================================================================
{
  const root = project()
  const r = new Recorder({ root, runtimeId: 'stress', capabilities: FLOOR_ONLY })
  const sess = await r.start()

  const codes = [0, 1, 2, 3, 42, 77, 126, 127, 255]
  const got = []
  for (const c of codes) {
    const res = await r.proc.run(process.execPath, ['-e', `process.exit(${c})`])
    got.push(res.exitCode)
  }
  await r.stop(0)

  check('every exit code recorded exactly', JSON.stringify(got) === JSON.stringify(codes), `${got.join(',')}`)
  const { events } = read(root, sess.id)
  const recorded = events.filter((e) => e.kind === 'process.exit').map((e) => e.payload.exitCode)
  check('exit codes in the ledger match reality', JSON.stringify(recorded) === JSON.stringify(codes))
  rmSync(root, { recursive: true, force: true })
}

// ===========================================================================
console.log('\n=== SHIM EXIT-CODE FIDELITY (through a real shell) ===')
// ===========================================================================
{
  const shell = detectProbeShell()
  const runner = join(REPO, 'dist', 'recorder', 'shim-entry.js')
  if (!shell || !existsSync(runner)) {
    check('shim fidelity (skipped — no shell)', true, 'skipped')
  } else {
    const root = project()
    const shimDir = join(paths(root).lodestarDir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])

    const codes = [0, 1, 3, 42, 255]
    const got = []
    for (const c of codes) {
      const p = spawnSync(shell.bin, ['-c', `node -e "process.exit(${c})"`], {
        env: { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir },
        stdio: 'ignore',
      })
      got.push(p.status)
    }
    // The two Phase 6 bugs both failed exactly here: the command never ran.
    check('shim preserves every exit code', JSON.stringify(got) === JSON.stringify(codes), `${got.join(',')}`)

    const out = spawnSync(shell.bin, ['-c', 'node -e "console.log(6*7)"'], {
      env: { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir },
      encoding: 'utf8',
    })
    check('shim leaks nothing into stdout', out.stdout.trim() === '42', JSON.stringify(out.stdout.trim()))

    // Args with spaces and quotes must survive the cmd.exe quoting path.
    const tricky = spawnSync(shell.bin, ['-c', `node -e "console.log(process.argv[1])" "a b c"`], {
      env: { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir },
      encoding: 'utf8',
    })
    check('shim preserves args containing spaces', tricky.stdout.trim() === 'a b c', JSON.stringify(tricky.stdout.trim()))

    rmSync(root, { recursive: true, force: true })
  }
}

// ===========================================================================
console.log('\n=== HARD KILL MID-SESSION ===')
// ===========================================================================
{
  const root = project()
  const script = join(root, 'longrun.mjs')
  writeFileSync(
    script,
    `
import { pathToFileURL } from 'node:url'
const d = (p) => pathToFileURL(${JSON.stringify(REPO.split('\\').join('/'))} + '/' + p).href
const { Recorder } = await import(d('dist/recorder/index.js'))
const { FLOOR_ONLY } = await import(d('dist/adapters/registry.js'))
import { writeFileSync } from 'node:fs'
const r = new Recorder({ root: process.argv[2], runtimeId: 'stress', capabilities: FLOOR_ONLY })
const s = await r.start()
console.log(s.id)
for (let i = 0; i < 20; i++) {
  writeFileSync(process.argv[2] + '/src/k' + i + '.ts', 'x' + i)
  await new Promise(r => setTimeout(r, 60))
}
await new Promise(() => {})   // hang forever; we get killed
`,
  )

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script, root], { stdio: ['ignore', 'pipe', 'pipe'] })
  let sessionId = ''
  child.stdout.on('data', (d) => { sessionId ||= d.toString().trim().split('\n')[0] })
  await settle(2500)
  child.kill('SIGKILL') // no cleanup, no stop(), no session.end
  await settle(500)

  if (!sessionId) {
    check('hard kill (could not start child)', false)
  } else {
    const { events, verify, session } = read(root, sessionId)
    check('partial chain still verifies after SIGKILL', verify.intact, verify.reason ?? '')
    check('partial chain has real events', events.length > 1, `${events.length} events`)
    check('no session.end was invented', !events.some((e) => e.kind === 'session.end'))
    check('unclosed session stays unclosed', session?.endedAt === null)
    // The critical one: a crash must not become a successful session.
    check('killed session has NO exit code (unknown stays unknown)', session?.exitCode === null)
  }
  rmSync(root, { recursive: true, force: true })
}

// ===========================================================================
console.log('\n=== RECORDER RESILIENCE ===')
// ===========================================================================
{
  // Non-git dir, no shell, nothing installed: must degrade, not throw.
  const root = project()
  const r = new Recorder({ root, runtimeId: 'stress', capabilities: FLOOR_ONLY })
  const sess = await r.start()
  const summary = await r.stop(0)
  check('non-git project records without error', summary.coverage.git === false && summary.coverage.errors.length === 0)
  check('integrity intact on empty-ish session', summary.integrityIntact)
  check('coverage claims nothing it did not measure', summary.coverage.commands.length === 0 && summary.coverage.toolCalls === false)
  rmSync(root, { recursive: true, force: true })
}
{
  // A file deleted between the watch event and the snapshot read.
  const root = project()
  const r = new Recorder({ root, runtimeId: 'stress', capabilities: FLOOR_ONLY })
  const sess = await r.start()
  for (let i = 0; i < 40; i++) {
    const f = join(root, 'src', `race${i}.ts`)
    writeFileSync(f, 'transient')
    rmSync(f, { force: true }) // gone before the watcher can read it
  }
  await settle(1500)
  const summary = await r.stop(0)
  const { verify } = read(root, sess.id)
  check('create+delete race does not corrupt the chain', verify.intact, verify.reason ?? '')
  check('recorder survived the race', summary.integrityIntact)
  rmSync(root, { recursive: true, force: true })
}

// ===========================================================================
const failed = results.filter((r) => !r.pass)
console.log(`\n${'='.repeat(60)}`)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
}
process.exit(failed.length ? 1 : 0)
