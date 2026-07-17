/**
 * STRESS 4 — the fork-bomb guard.
 *
 * The shim finds the real binary by scanning PATH and SKIPPING its own directory. If
 * that skip ever fails, the shim finds itself, execs itself, and recurses until the
 * machine dies. This is the single most dangerous line in shim-runner.ts.
 *
 * The suspicious path: `shimDir` falls back to `dirname(process.argv[1])` when
 * LODESTAR_SHIM_DIR is unset — and argv[1] is `dist/recorder/shim-entry.js`, NOT the
 * shim directory. So the fallback would skip the wrong directory entirely.
 *
 * Every spawn here is hard-timeout'd. A hang IS the failure.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installShims, detectProbeShell } from '../dist/recorder/shims.js'

const REPO = resolve(import.meta.dirname, '..')
const runner = join(REPO, 'dist', 'recorder', 'shim-entry.js')
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  PASS' : '  FAIL <<<'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const shell = detectProbeShell()
if (!shell) {
  console.log('  no POSIX shell — cannot run this suite')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'fb-'))
const shimDir = join(dir, 'shims')
const install = installShims(shimDir, runner, process.execPath, ['node'])

/** Run through the shim with a hard timeout. A timeout means we recursed. */
function attempt(env, label) {
  const t0 = Date.now()
  const p = spawnSync(shell.bin, ['-c', 'node -e "console.log(42)"'], {
    env,
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
  })
  const ms = Date.now() - t0
  const hung = p.signal === 'SIGKILL' || p.error?.code === 'ETIMEDOUT'
  return { ms, hung, status: p.status, out: (p.stdout ?? '').trim(), err: (p.stderr ?? '').slice(0, 160).trim(), label }
}

console.log('\n=== FORK-BOMB GUARD ===')

// 1. The normal case: env set correctly.
{
  const env = { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir }
  const r = attempt(env, 'env set')
  check('shim resolves the REAL node when env is set', !r.hung && r.out === '42', `${r.ms}ms status=${r.status}`)
}

// 2. THE DANGEROUS CASE: LODESTAR_SHIM_DIR unset, shim dir first on PATH.
{
  const env = { ...process.env, PATH: install.pathValue }
  delete env.LODESTAR_SHIM_DIR
  const r = attempt(env, 'env unset')
  // If this hangs or dies, the fallback found the shim itself.
  check('NO fork bomb when LODESTAR_SHIM_DIR is unset', !r.hung, r.hung ? `HUNG ${r.ms}ms — RECURSED` : `${r.ms}ms`)
  check('still runs the real command without the env var', r.out === '42', `stdout=${JSON.stringify(r.out)} stderr=${JSON.stringify(r.err)}`)
}

// 3. Env var pointing at the WRONG directory.
{
  const env = { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: join(dir, 'not-the-shims') }
  const r = attempt(env, 'env wrong')
  check('NO fork bomb when LODESTAR_SHIM_DIR is wrong', !r.hung, r.hung ? `HUNG ${r.ms}ms — RECURSED` : `${r.ms}ms`)
}

// 4. Shim dir listed TWICE on PATH.
{
  const env = { ...process.env, PATH: `${shimDir};${install.pathValue}`, LODESTAR_SHIM_DIR: shimDir }
  const r = attempt(env, 'dup path')
  check('NO fork bomb when shim dir appears twice on PATH', !r.hung, r.hung ? `HUNG ${r.ms}ms` : `${r.ms}ms`)
}

// 5. Trailing-separator / casing variants of the same directory.
{
  const env = { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir + '\\' }
  const r = attempt(env, 'trailing sep')
  check('NO fork bomb with a trailing separator in the env var', !r.hung, r.hung ? `HUNG ${r.ms}ms` : `${r.ms}ms`)
}

rmSync(dir, { recursive: true, force: true })

const failed = results.filter((r) => !r.pass)
console.log(`\n${'='.repeat(60)}`)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
process.exit(failed.length ? 1 : 0)
