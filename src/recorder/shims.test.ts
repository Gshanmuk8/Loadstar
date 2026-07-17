/**
 * Phase 6 — shim installation and coverage probing.
 *
 * Two bugs found here during Phase 6 both had the same shape: the shim intercepted a
 * command and then **failed to run it**, silently. `npm test` never executed. These
 * tests exist so that class of failure has to get past an assertion next time.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { installShims, probeCoverage, detectProbeShell, summarize } from './shims.js'
import { shellSelectionEnvVars } from '../adapters/registry.js'

let dir: string
const runner = join(process.cwd(), 'dist', 'recorder', 'shim-entry.js')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-shim-'))
})
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('shim installation', () => {
  it('always writes the POSIX form — it is inert on shells that do not pick it', () => {
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['npm', 'git'])

    expect(existsSync(join(shimDir, 'npm'))).toBe(true)
    expect(existsSync(join(shimDir, 'git'))).toBe(true)
  })

  it('never writes a .cmd in front of a NATIVE binary — fidelity beats coverage', () => {
    // D-038. This test used to assert that BOTH forms were always written, which is the
    // bug: a .cmd shim routes arguments through cmd.exe, and for a native target
    // (git.exe) the caller's baseline has no cmd.exe at all. That extra parser expanded
    // `%VAR%` in the agent's own arguments before any LODESTAR code ran — changing what
    // executed, recording the post-expansion form as the agent's, and laundering secret
    // values past redaction.
    //
    // Coverage bought by rewriting the agent's command is not coverage. Where observing
    // would change execution we decline, the command resolves past us untouched, and the
    // probe reports it `shadowed`.
    if (process.platform !== 'win32') {
      // Off Windows a .cmd can never be resolved, so none should be written at all.
      const shimDir = join(dir, 'shims')
      installShims(shimDir, runner, process.execPath, ['npm', 'git'])
      expect(existsSync(join(shimDir, 'npm.cmd'))).toBe(false)
      return
    }

    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['npm', 'git'])

    // git resolves to git.exe — native. A .cmd in front of it would insert cmd.exe.
    expect(existsSync(join(shimDir, 'git.cmd'))).toBe(false)
    // npm resolves to npm.cmd — already a batch file, so the caller's baseline already
    // goes through cmd.exe. We add no layer, so the shim is safe and coverage is kept.
    expect(existsSync(join(shimDir, 'npm.cmd'))).toBe(true)
  })

  it('prepends the shim dir to PATH', () => {
    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['npm'])
    expect(install.pathValue.startsWith(shimDir)).toBe(true)
  })

  it('POSIX shim execs rather than wrapping, so signals and exit codes pass through', () => {
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['npm'])
    // An extra process layer is an extra place to lose an exit code or swallow a signal.
    expect(readFileSync(join(shimDir, 'npm'), 'utf8')).toMatch(/^exec /m)
  })

  it('cmd shim propagates ERRORLEVEL — never a fabricated success', () => {
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['npm'])
    expect(readFileSync(join(shimDir, 'npm.cmd'), 'utf8')).toMatch(/exit \/b %ERRORLEVEL%/i)
  })

  it('reinstalling is clean rather than cumulative', () => {
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['npm', 'git'])
    installShims(shimDir, runner, process.execPath, ['npm'])
    // A stale shim for a command we no longer intercept would record against a dead
    // session forever.
    expect(existsSync(join(shimDir, 'git'))).toBe(false)
    expect(existsSync(join(shimDir, 'npm'))).toBe(true)
  })
})

describe('coverage probe', () => {
  it('detects a shell using the LOGIN form the agent actually gets', () => {
    const shell = detectProbeShell()
    if (!shell) return // no POSIX shell on this machine; nothing to assert
    // Probing without -l would measure a world the agent does not live in: the login
    // shell is precisely what rewrites PATH and demotes our shims (D-023).
    expect(shell.args).toContain('-l')
  })

  it('reports UNKNOWN — not absent — when there is no shell to ask', () => {
    // The old assertion here was `absent`, directly under a comment reading "Unknown must
    // remain unknown. Never assume coverage we could not measure." The principle was
    // right and the assertion contradicted it: `absent` claims "not installed on this
    // machine", which is a measurement we never took. D-040.
    //
    // This mattered in practice. `detectProbeShell` accepted powershell.exe (its `-c
    // 'exit 0'` liveness check returns 0), the real `-l -c` probe then failed, and every
    // command was reported `absent` — a confident claim that nothing was installed, from
    // a shell that never ran a line of our script.
    const coverage = probeCoverage(join(dir, 'shims'), '', ['npm', 'git'], null)
    expect(coverage.every((c) => c.status === 'unknown')).toBe(true)
    // And it must say why. "Unknown" without a reason is just a shrug.
    expect(coverage[0]?.reason).toBeTruthy()
  })

  it('rejects a non-POSIX shell instead of measuring nothing with it', () => {
    if (process.platform !== 'win32') return
    // powershell.exe and cmd.exe both accept `-c "exit 0"` and return 0, which is how
    // they passed the old liveness check. The probe must test the invocation it will
    // actually use (`-l -c`) and check for OUTPUT, not the absence of failure.
    //
    // The env-var route is the runtime's own (the registry supplies which vars exist —
    // vendor knowledge lives there, not in the recorder), so the hostile value is
    // planted in the runtime's var and passed the way the recorder passes it.
    for (const bin of ['powershell.exe', 'cmd.exe']) {
      const before = process.env['CLAUDE_CODE_SHELL']
      process.env['CLAUDE_CODE_SHELL'] = bin
      try {
        const shell = detectProbeShell(shellSelectionEnvVars())
        expect(shell?.bin).not.toBe(bin)
      } finally {
        if (before === undefined) delete process.env['CLAUDE_CODE_SHELL']
        else process.env['CLAUDE_CODE_SHELL'] = before
      }
    }
  })

  it('identifies our shim regardless of how the shell spells the path', () => {
    const shell = detectProbeShell()
    if (!shell) return

    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])
    const coverage = probeCoverage(shimDir, install.pathValue, ['node'], shell)

    // The regression this guards: Git Bash reports `/tmp/.../shims/node` while Node
    // knows the directory as `C:\Users\...\Temp\...\shims`. A JS-side string compare
    // called a working shim "shadowed". The shell now does its own path math.
    expect(coverage[0]!.status).toBe('observed')
    expect(coverage[0]!.resolvedTo).toBeTruthy()
  })

  it('marks a command as absent when it is not installed at all', () => {
    const shell = detectProbeShell()
    if (!shell) return
    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])
    // Probe for something we did not shim and that does not exist.
    const coverage = probeCoverage(shimDir, install.pathValue, ['definitely-not-a-real-command-xyz'], shell)
    expect(coverage[0]!.status).toBe('absent')
  })

  it('summarize splits observed from not-observed', () => {
    const s = summarize([
      { command: 'npm', status: 'observed', resolvedTo: '/x/npm' },
      { command: 'git', status: 'shadowed', resolvedTo: '/mingw64/bin/git' },
      { command: 'go', status: 'absent' },
    ])
    expect(s.observed).toEqual(['npm'])
    expect(s.shadowed).toEqual(['git'])
    expect(s.absent).toEqual(['go'])
  })
})

/**
 * Windows batch wrappers, end to end, through the real shim.
 *
 * On Windows `npm`, `npx`, `pnpm`, and `yarn` are all `.cmd` files, so this is the common
 * path, not an edge case. It is tested by running the real thing rather than by
 * inspecting the quoting: the bug being guarded was a *quoting scheme that looked
 * correct* — `\"` is a perfectly plausible escape, and it is simply the wrong one for
 * cmd.exe. Reading the code is what let it ship. Only executing it proves anything.
 */
describe('windows batch argument fidelity', () => {
  const win = process.platform === 'win32'

  /** A .cmd that reports the argv it actually received, via node. */
  function makeEchoBat(binDir: string, outFile: string): void {
    mkdirSync(binDir, { recursive: true })
    const dump = join(binDir, 'dump.mjs')
    writeFileSync(
      dump,
      `import {writeFileSync} from 'node:fs'\nwriteFileSync(${JSON.stringify(outFile)}, JSON.stringify(process.argv.slice(2)))\n`,
    )
    writeFileSync(
      join(binDir, 'show.cmd'),
      `@ECHO off\r\n"${process.execPath}" "${dump}" %*\r\n`,
      'utf8',
    )
  }

  function runShim(shimDir: string, binDir: string, args: string[]): { stdout: string; status: number | null } {
    const r = execFileSync(
      process.execPath,
      [runner, '--shim-dir', shimDir, 'show', ...args],
      {
        env: { ...process.env, PATH: `${binDir}${delimiter}${process.env['PATH'] ?? ''}` },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    return { stdout: r, status: 0 }
  }

  it('does not execute injected commands hidden in an argument', () => {
    if (!win || !existsSync(runner)) return
    const binDir = join(dir, 'bin')
    const outFile = join(dir, 'argv.json')
    makeEchoBat(binDir, outFile)
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['show'])

    // The exact payload the old `\"` escape executed: cmd's quote state closed early and
    // `echo INJECTED_PWNED` became a command in its own right.
    const hostile = 'x"&echo INJECTED_PWNED&"y'
    const { stdout } = runShim(shimDir, binDir, [hostile])

    expect(stdout).not.toContain('INJECTED_PWNED')
    expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual([hostile])
  })

  it('passes ordinary awkward arguments through byte-identically', () => {
    if (!win || !existsSync(runner)) return
    const binDir = join(dir, 'bin')
    const outFile = join(dir, 'argv.json')
    makeEchoBat(binDir, outFile)
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['show'])

    // `50% done` and `%20` must survive: only a variable-shaped %NAME% can expand, and
    // refusing these would break real commands for no safety gain.
    const args = ['a b', 'c&d', 'e|f', 'g(h)', '50% done', 'https://x/a%20b', '--define=x=1', '']
    runShim(shimDir, binDir, args)
    expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual(args)
  })

  it('refuses rather than letting cmd.exe expand %VAR% in an argument', () => {
    if (!win || !existsSync(runner)) return
    const binDir = join(dir, 'bin')
    makeEchoBat(binDir, join(dir, 'argv.json'))
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['show'])

    // %USERNAME% cannot be escaped on a `cmd /c` line. Expanding it silently would run a
    // command the developer did not write, and record the one they did — a lie in an
    // immutable ledger. Refusing is the honest failure.
    let status: number | null = null
    let stderr = ''
    try {
      execFileSync(process.execPath, [runner, '--shim-dir', shimDir, 'show', '%USERNAME%'], {
        env: { ...process.env, PATH: `${binDir}${delimiter}${process.env['PATH'] ?? ''}` },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      status = 0
    } catch (e) {
      const err = e as { status?: number; stderr?: string }
      status = err.status ?? null
      stderr = err.stderr ?? ''
    }

    expect(status).toBe(126)
    expect(stderr).toContain('refusing')
  })
})

describe('fork-bomb guard', () => {
  const shell = detectProbeShell()

  it('bakes the shim directory into the shim script', () => {
    const shimDir = join(dir, 'shims')
    installShims(shimDir, runner, process.execPath, ['npm'])

    // The regression this guards is the worst bug found in this codebase. The runner
    // finds the real binary by skipping its own directory; it used to infer that
    // directory from `dirname(process.argv[1])`, which is dist/recorder/ — NOT the shim
    // dir. So it never skipped itself, found the shim again, and recursed until the OS
    // killed it. Stress testing hung for 10s before SIGKILL.
    //
    // Env vars can be stripped by a login shell, a sudo, or a sandbox. The shim's own
    // location cannot. It must be written in.
    //
    // Assert the INVARIANT — the directory is present and passed via --shim-dir — not the
    // quoting used to spell it. This assertion used to hard-code `--shim-dir "…"`, and it
    // failed when the double quotes were replaced with single quotes to stop sh from
    // expanding `$` in project paths. The quoting style is an implementation detail; the
    // baked-in path is the thing that stops the fork bomb.
    const posix = readFileSync(join(shimDir, 'npm'), 'utf8')
    expect(posix).toContain('--shim-dir')
    expect(posix).toContain(shimDir.split('\\').join('/'))

    const bat = readFileSync(join(shimDir, 'npm.cmd'), 'utf8')
    expect(bat).toContain('--shim-dir')
    expect(bat).toContain(shimDir)
  })

  it('does not let a project path expand inside the POSIX shim', () => {
    // The same class of bug as the fork bomb (D-026), reached through the path instead of
    // argv. The template interpolated into "..." where sh still expands `$`, so a project
    // at /home/u/foo$bar/ produced a WRONG --shim-dir — findReal would then exclude the
    // wrong directory, the shim would find itself, and it would recurse.
    const nasty = join(dir, 'p$(id)x', 'shims')
    installShims(nasty, runner, process.execPath, ['npm'])

    const posix = readFileSync(join(nasty, 'npm'), 'utf8')
    // Single-quoted: sh performs no expansion at all inside them.
    expect(posix).toContain(`'${nasty.split('\\').join('/')}'`)
  })

  it('does NOT recurse when LODESTAR_SHIM_DIR is absent', () => {
    if (!shell || !existsSync(runner)) return
    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])

    const env: NodeJS.ProcessEnv = { ...process.env, PATH: install.pathValue }
    delete env['LODESTAR_SHIM_DIR']

    const t0 = Date.now()
    const out = execFileSync(shell.bin, ['-c', 'node -e "console.log(42)"'], {
      env,
      encoding: 'utf8',
      timeout: 15_000,
    })
    // A hang IS the failure. Before the fix this never returned.
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(out.trim()).toBe('42')
  })
})

describe('the shim must not break the command', () => {
  const shell = detectProbeShell()

  it('runs the real command and returns its REAL exit code', () => {
    if (!shell || !existsSync(runner)) return
    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])

    // Through the shim: node must actually run, and exit 3 must survive.
    let status = 0
    try {
      execFileSync(shell.bin, ['-c', 'node -e "process.exit(3)"'], {
        env: { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir },
        stdio: 'ignore',
      })
    } catch (e) {
      status = (e as { status?: number }).status ?? -1
    }
    // This is the assertion the two Phase 6 bugs would have failed: the command ran at
    // all, and its code was not invented.
    expect(status).toBe(3)
  })

  it('passes stdout through untouched', () => {
    if (!shell || !existsSync(runner)) return
    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])

    const out = execFileSync(shell.bin, ['-c', 'node -e "console.log(6*7)"'], {
      env: { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir },
      encoding: 'utf8',
    })
    // If LODESTAR's own noise (an ExperimentalWarning, a banner) leaked in here, the
    // developer's output would differ from the unwrapped run.
    expect(out.trim()).toBe('42')
  })

  it('records nothing and still runs when no session is configured', () => {
    if (!shell || !existsSync(runner)) return
    const shimDir = join(dir, 'shims')
    const install = installShims(shimDir, runner, process.execPath, ['node'])

    // No LODESTAR_SESSION_ID / LODESTAR_DB. Recording is impossible; execution is not
    // optional. The command must still work.
    const out = execFileSync(shell.bin, ['-c', 'node -e "console.log(\'ran\')"'], {
      env: { ...process.env, PATH: install.pathValue, LODESTAR_SHIM_DIR: shimDir },
      encoding: 'utf8',
    })
    expect(out.trim()).toBe('ran')
  })
})
