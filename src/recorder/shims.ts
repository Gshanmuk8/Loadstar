/**
 * LODESTAR — PATH shims and coverage probing.
 *
 * See DECISIONS.md D-023 for the investigation this implements.
 *
 * The mechanism: prepend a directory of shims to PATH before launching the agent. The
 * agent runs commands through a shell; the shell resolves them via PATH; our shim runs,
 * records, and execs the real binary with its exit code passed through untouched.
 *
 * ---------------------------------------------------------------------------
 * THE PART THAT MAKES THIS HONEST — do not remove the probe
 * ---------------------------------------------------------------------------
 *
 * Shims do NOT reliably win. Claude Code spawns a *login* shell, and on Git for Windows
 * `/etc/profile` prepends `/mingw64/bin` and `/usr/bin` ahead of the inherited PATH.
 * Our directory survives but is demoted, so a shim wins only for commands those
 * directories do not already contain.
 *
 * A bypassed shim emits **nothing**. Silence is indistinguishable from "the command
 * never ran" — the same failure as D-022, where a filter that silently matched nothing
 * looked exactly like one that worked.
 *
 * So we do not install shims and hope. `probeCoverage()` asks the *same shell the agent
 * will use* to resolve each command, and we report per-command what is observed and what
 * is not. An unknowable hole becomes a declared one.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THIS FILE EXISTS TO HOLD
 * ---------------------------------------------------------------------------
 *
 * **Fidelity beats coverage.** If observing a command would change how it executes, we do
 * not observe it. See D-038 — a `.cmd` shim in front of a native binary rewrote the
 * agent's own arguments.
 *
 * **Unknown is not absent.** "We could not measure" and "it is not installed" are
 * opposite claims and must never share a word. See D-040.
 *
 * This header used to end with "Measured on this machine: npm, node, python, docker HIT."
 * That line was not a measurement — it was an artifact of the D-040 inflation bug, which
 * reported `observed` for tools that were not installed at all. It is deleted rather than
 * corrected, because a coverage claim written into a comment cannot be re-measured by
 * anyone reading it. Run `lodestar run` and read the probe output; that is the only
 * coverage statement this project should make.
 */

import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * High-value commands, per Phase 6. These are where consequential things happen and
 * where RF-01 gets its evidence.
 *
 * ---------------------------------------------------------------------------
 * THIS LIST AND `TEST_PATTERNS` ARE ONE INVARIANT, ENFORCED BY A TEST — D-050
 * ---------------------------------------------------------------------------
 *
 * D-048 claimed these two lists were "reconciled". They were not. The matcher still
 * recognised `bun`, `nox`, and `ctest`, none of which were shimmed — so those branches
 * could never fire, and the D-048 comment asserting the reconciliation was itself the
 * drift it warned about. A comment cannot hold an invariant across two files; only a test
 * can, so `shims.test.ts` now fails if a runner is matched but not observable.
 *
 * `bun`, `nox`, and `ctest` are added here rather than deleted from the matcher: they are
 * real runners people really use, the probe reports `absent` honestly on a machine that
 * lacks them, and a shim costs nothing until the command exists. Coverage we can measure
 * beats a matcher entry we cannot.
 *
 * The rule, in one line: **if the matcher names it, the boundary must be able to see it.**
 */
export const SHIMMED_COMMANDS = [
  'git', 'npm', 'npx', 'node', 'pnpm', 'yarn', 'bun',
  'python', 'python3', 'pytest', 'tox', 'nox',
  'docker', 'make', 'cargo', 'go',
  'gradle', 'gradlew', 'mvn', 'dotnet', 'ctest',
]

/**
 * Single-quote a string for POSIX sh.
 *
 * The only quoting form sh does not expand anything inside. The `'\''` dance is the
 * standard way to embed a literal quote: close, escaped quote, reopen.
 */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Escape a literal for interpolation into a batch file. `%%` is batch's only escape. */
function batLiteral(s: string): string {
  return s.replace(/%/g, '%%')
}

const isWindows = process.platform === 'win32'

/**
 * Does this command resolve to a batch file on this machine?
 *
 * Decides whether a `.cmd` shim is safe to install (D-038). Best-effort and resolved at
 * install time, which is the honest limit: the agent's PATH may differ. If we guess wrong
 * we lose coverage, never fidelity — the failure direction that matters. `probeCoverage`
 * measures the real answer afterwards and reports it.
 *
 * The shim directory does not exist yet, so there is nothing to exclude from this scan.
 */
function resolvesToBatch(command: string): boolean {
  const exts = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';')
  for (const d of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!d) continue
    for (const ext of exts) {
      for (const candidate of [join(d, command + ext.toLowerCase()), join(d, command + ext)]) {
        try {
          if (!statSync(candidate).isFile()) continue
          return /\.(cmd|bat)$/i.test(candidate)
        } catch {
          /* not here; keep scanning */
        }
      }
    }
  }
  return false
}

/**
 * What LODESTAR can say about one command.
 *
 * ---------------------------------------------------------------------------
 * FOUR STATES, BECAUSE `absent` WAS SECRETLY TWO — D-040
 * ---------------------------------------------------------------------------
 *
 * `absent` used to mean both "not installed on this machine" and "the probe failed, we
 * have no idea". Two states with opposite meanings behind one word, and the probe's own
 * error path returned it — so a total measurement failure rendered as a confident claim
 * that nothing was installed.
 *
 * Conflating *unknown* with *known-absent* is precisely what D-023 exists to prevent.
 *
 * - `observed` — our shim wins PATH resolution AND the command really exists.
 * - `shadowed` — the command exists, something else wins. NOT observed.
 * - `absent`   — the command is not installed. Nothing to observe. **Measured.**
 * - `unknown`  — we could not measure. Says nothing about the command, only about us.
 */
export type ShimStatus = 'observed' | 'shadowed' | 'absent' | 'unknown'

export interface CommandCoverage {
  command: string
  status: ShimStatus
  /** What the agent's shell actually resolves this to. The evidence for `status`. */
  resolvedTo?: string
  /** Why the status is `unknown`. Absent otherwise. */
  reason?: string
}

export interface ShimInstallation {
  dir: string
  /** PATH value to hand the agent, with the shim dir prepended. */
  pathValue: string
  commands: string[]
}

/**
 * Write shims for each command.
 *
 * A POSIX script (bash/sh/zsh) is always written — it is inert on any shell that does not
 * pick it. A `.cmd` is written **only** where it cannot change execution: on Windows, for
 * a command that already resolves to a batch file. See D-038.
 *
 * Every shim runs the real binary and exits with the real code. A shim that swallowed a
 * failure would manufacture success, which is the one thing this product must never do.
 */
export function installShims(
  dir: string,
  runnerScript: string,
  nodeExec: string,
  commands: string[] = SHIMMED_COMMANDS,
): ShimInstallation {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const nodePosix = nodeExec.split('\\').join('/')
  const runnerPosix = runnerScript.split('\\').join('/')
  const dirPosix = dir.split('\\').join('/')

  for (const cmd of commands) {
    // ---------------------------------------------------------------------------
    // The shim dir is BAKED IN. It must never be inferred at runtime.
    // ---------------------------------------------------------------------------
    //
    // The runner finds the real binary by scanning PATH and skipping its own directory.
    // It previously fell back to `dirname(process.argv[1])` when the env var was
    // missing — but argv[1] is `dist/recorder/shim-entry.js`, NOT this directory. So it
    // skipped the wrong path, found this shim again, and execed itself.
    //
    // That is a fork bomb, and stress testing hit it: with LODESTAR_SHIM_DIR unset, the
    // shim recursed until the OS killed it. Env vars can be stripped by a login shell,
    // a sudo, or a sandbox; the shim's own location cannot. So we write it in.
    //
    // ---------------------------------------------------------------------------
    // The paths are SINGLE-quoted. Double quotes were a live substitution bug.
    // ---------------------------------------------------------------------------
    //
    // This template used to interpolate into `"..."`, where sh still expands `$`,
    // backticks, and `\`. Nothing escaped them, so a project path was executable text:
    //
    //   /home/u/my$(whoami)proj  →  exec "/home/u/my<output-of-whoami>proj/..."
    //
    // The likelier and quieter variant is worse. A path containing a plain `$`
    // (`/home/u/foo$bar/`) expands to nothing, so `--shim-dir` arrives wrong, `findReal`
    // excludes the wrong directory, the shim finds *itself*, and it recurses until the
    // depth guard stops it. That is D-026 again — the same fork bomb, reached through the
    // path instead of argv — and the same lesson: the shim's own location must never
    // depend on anything that gets re-interpreted at runtime.
    //
    // Single quotes are the only sh form with no expansion at all. `probeCoverage()`
    // below already got this right; the install path did not. `"$@"` stays double-quoted
    // because that is the correct sh idiom for forwarding argv verbatim.
    const posix = `#!/bin/sh
exec ${shQuote(nodePosix)} ${shQuote(runnerPosix)} --shim-dir ${shQuote(dirPosix)} ${shQuote(cmd)} "$@"
`
    const p = join(dir, cmd)
    writeFileSync(p, posix, 'utf8')
    try {
      chmodSync(p, 0o755)
    } catch {
      // Windows filesystems have no execute bit. Harmless: only the .cmd runs there.
    }

    // ---------------------------------------------------------------------------
    // THE .cmd SHIM IS ONLY SAFE FOR TARGETS THAT ARE THEMSELVES BATCH FILES — D-038
    // ---------------------------------------------------------------------------
    //
    // A `.cmd` shim is a batch file, so reaching it routes the arguments through cmd.exe.
    // For a target that is *already* a batch file (`npm.cmd`, `yarn.cmd`), the caller's
    // baseline goes through cmd.exe anyway — we add no layer, and nothing changes.
    //
    // For a NATIVE target (`node.exe`, `git.exe`, `python.exe`), PowerShell's baseline is
    // a direct CreateProcess with no cmd.exe at all. Installing `node.cmd` inserted a
    // parser the command never had. Measured:
    //
    //   $env:MYSECRET = "leaked-value"
    //     without lodestar: ["%MYSECRET%"]        ← what the agent typed
    //     with lodestar:    ["leaked-value"]      ← what actually ran
    //     without: ["a^b"]   with: ["ab"]
    //
    // Three failures in one, none of which the record disclosed:
    //   1. It CHANGED what executed. The wedge's first rule is that it must not.
    //   2. It recorded the post-expansion form as the agent's argument — the ledger
    //      attributing to the agent something it never typed.
    //   3. It laundered secrets past D-028: cmd.exe expanded `%MYSECRET%` before any
    //      LODESTAR code ran, so redaction saw a plain string, and the VALUE landed
    //      permanently in an append-only ledger. Secret-named env vars are exactly what
    //      D-028 exists to catch, and this was the one path around it.
    //
    // It also imposed cmd.exe's 8191-char command line limit where the native baseline
    // allows 32767 — breaking long commands, recording nothing, and returning exit 1,
    // indistinguishable from a genuine assertion failure.
    //
    // So: fidelity beats coverage. Where observing would change execution, we do not
    // observe — the command runs untouched, resolves past us, and the probe reports it
    // `shadowed`. A declared hole is worth more than a fabricated argument.
    if (isWindows && resolvesToBatch(cmd)) {
      // `%` is legal in a Windows directory name (`C:\my%20docs\`) and would otherwise be
      // read as a variable reference. Inside a batch file `%%` is the literal escape.
      writeFileSync(
        join(dir, `${cmd}.cmd`),
        `@ECHO off\r\n"${batLiteral(nodeExec)}" "${batLiteral(runnerScript)}" --shim-dir "${batLiteral(dir)}" ${cmd} %*\r\nexit /b %ERRORLEVEL%\r\n`,
        'utf8',
      )
    }
  }

  return {
    dir,
    pathValue: dir + delimiter + (process.env['PATH'] ?? ''),
    commands,
  }
}

/**
 * Ask the agent's own shell what each command resolves to.
 *
 * This is the measurement D-023 is built on. It must run in the *same kind of shell*
 * the agent will use — a non-login probe would report coverage we do not have, which is
 * worse than no probe at all.
 *
 * `shimDir` is compared case-insensitively and separator-normalized because Windows
 * hands back mixed forms (`C:\x` vs `/c/x`).
 */
export function probeCoverage(
  shimDir: string,
  pathValue: string,
  commands: string[],
  shell: ShellSpec | null,
): CommandCoverage[] {
  const unknown = (reason: string): CommandCoverage[] =>
    commands.map((command) => ({ command, status: 'unknown' as const, reason }))

  if (!shell) {
    // No shell to probe with says nothing about the commands — only about us.
    // This used to return `absent`, which claimed nothing was installed. D-040.
    return unknown('no POSIX shell available to probe with')
  }

  // ---------------------------------------------------------------------------
  // The shell does its own path math. Do NOT compare paths in JS.
  // ---------------------------------------------------------------------------
  //
  // Git Bash reports our shim as `/tmp/claude/.../shims/npm` while Node knows it as
  // `C:\Users\madara\AppData\Local\Temp\claude\...\shims`. Same directory, unrelated
  // strings — a JS-side comparison called a working shim "shadowed" and under-reported
  // coverage. Any normalize()/toLowerCase() scheme is guessing at the shell's mount
  // table.
  //
  // So we `cd` into the shim dir and ask the shell for its own spelling via `pwd -P`,
  // then compare inside the shell. One invocation, no guessing, and correct on any
  // shell that can reach the directory at all.
  // ---------------------------------------------------------------------------
  // TWO RESOLUTIONS PER COMMAND, BECAUSE `absent` WAS UNREACHABLE — D-040
  // ---------------------------------------------------------------------------
  //
  // The old script asked `command -v` once, with the shim dir on PATH. Our shim is
  // always there, so `command -v` always found *something* and the `absent` branch could
  // never fire. Measured against a clean PATH, the probe claimed `observed` for `docker`,
  // `cargo`, and `go` on a machine where none of them were installed — and `run.ts`
  // printed that claim to the developer. The mechanism built to make coverage honest was
  // inflating it.
  //
  // So each command is resolved twice: once as the agent's shell sees it (does our shim
  // win?) and once with the shim directory removed from PATH (does the command exist at
  // all?). `absent` now means measured-absent.
  //
  // BARE is built inside the shell, from the shell's own post-login PATH. Computing it in
  // JS would compare the wrong PATH — the login shell rewrites it, which is the entire
  // reason D-023 exists.
  //
  // `${r#"$SHIM"/}` quotes $SHIM so it is a literal prefix, not a glob: a project path
  // containing `[` or `*` otherwise made the strip miss and called a working shim
  // `shadowed`.
  const script = `
SHIM=$(cd ${shQuote(shimDir.split('\\').join('/'))} 2>/dev/null && pwd -P) || SHIM=''
BARE=''
OIFS=$IFS; IFS=:
for d in $PATH; do
  [ "$d" = "$SHIM" ] && continue
  BARE="\${BARE:+$BARE:}$d"
done
IFS=$OIFS
for c in ${commands.map(shQuote).join(' ')}; do
  r=$(command -v "$c" 2>/dev/null || true)
  real=$(PATH="$BARE" command -v "$c" 2>/dev/null || true)
  w=0
  if [ -n "$SHIM" ] && [ -n "$r" ] && [ "\${r#"$SHIM"/}" != "$r" ]; then w=1; fi
  printf '%s|%s|%s|%s\\n' "$c" "$w" "$real" "$r"
done
`

  let output: string
  try {
    output = execFileSync(shell.bin, [...shell.args, script], {
      env: { ...process.env, PATH: pathValue },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    })
  } catch (e) {
    // The probe failed. That is a fact about LODESTAR, not about the commands.
    return unknown(`probe shell failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  const parsed = new Map<string, CommandCoverage>()
  for (const line of output.split('\n')) {
    const [command, won, real, resolved] = line.trim().split('|')
    if (!command || won === undefined) continue

    // Not installed anywhere outside our shim dir: there is nothing here to observe.
    if (!real) {
      parsed.set(command, { command, status: 'absent' })
      continue
    }
    if (won === '1') {
      parsed.set(command, { command, status: 'observed', resolvedTo: real })
      continue
    }
    const entry: CommandCoverage = { command, status: 'shadowed' }
    if (resolved) entry.resolvedTo = resolved
    parsed.set(command, entry)
  }

  // A command the probe never answered for is unknown — never assumed either way.
  return commands.map(
    (c) => parsed.get(c) ?? { command: c, status: 'unknown' as const, reason: 'probe returned no answer' },
  )
}

export interface ShellSpec {
  bin: string
  /** Login flags included: we must probe the shell the agent actually gets. */
  args: string[]
}

/**
 * Find a POSIX shell to probe with, mirroring how the runtime picks one.
 *
 * Runtimes consult their own env var first (Claude Code checks `CLAUDE_CODE_SHELL`),
 * then `SHELL`, then fall back to common shells. We follow the same order so the probe
 * measures the agent's real conditions rather than an approximation of them.
 *
 * WHICH env vars runtimes consult is runtime-specific knowledge, and it does not live
 * here: the caller passes it in from the adapter registry (`shellSelectionEnvVars()`).
 * This file must know nothing about any vendor — the recorder observes runtimes; the
 * registry describes them.
 */
export function detectProbeShell(runtimeShellEnvVars: readonly string[] = []): ShellSpec | null {
  const candidates = [
    ...runtimeShellEnvVars.map((v) => process.env[v]),
    process.env['SHELL'],
    'bash',
    'zsh',
    'sh',
  ].filter((c): c is string => Boolean(c))

  // `-l -c`: the login shell is what rewrites PATH, and therefore what determines whether
  // our shims win. Probing without -l would measure a world the agent does not live in.
  const args = ['-l', '-c']

  for (const bin of candidates) {
    try {
      // ---------------------------------------------------------------------------
      // Probe with the EXACT invocation we will use, and check the OUTPUT — D-040
      // ---------------------------------------------------------------------------
      //
      // This used to liveness-check with `-c 'exit 0'` and accept any zero exit.
      // `powershell.exe -c "exit 0"` returns 0. So did `cmd.exe`. Both were accepted as
      // POSIX shells, and the real probe then ran `-l -c <sh script>`, which failed —
      // landing in a catch that reported every command `absent`, i.e. "nothing is
      // installed", from a shell that never ran a line of our script.
      //
      // Two lessons, both already in this codebase's history: test the thing you will
      // actually do (`-c` is not `-l -c`), and check for evidence of success rather than
      // the absence of failure. An exit code of 0 is not proof that a POSIX shell ran.
      const out = execFileSync(bin, [...args, 'printf %s __lodestar_probe_ok__'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      })
      if (out.includes('__lodestar_probe_ok__')) return { bin, args }
    } catch {
      continue
    }
  }
  return null
}

export function summarize(coverage: CommandCoverage[]): {
  observed: string[]
  shadowed: string[]
  absent: string[]
  unknown: string[]
} {
  const of = (s: ShimStatus): string[] =>
    coverage.filter((c) => c.status === s).map((c) => c.command)
  return {
    observed: of('observed'),
    shadowed: of('shadowed'),
    absent: of('absent'),
    unknown: of('unknown'),
  }
}
