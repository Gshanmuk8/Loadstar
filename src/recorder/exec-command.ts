/**
 * LODESTAR — resolving and executing external commands, correctly, on both platforms.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE MODULE AND NOT TWO COPIES — D-072
 * ---------------------------------------------------------------------------
 *
 * The shim runner learned, bug by bug, how to execute a command on Windows: batch
 * files cannot be spawned directly, cmd.exe needs its own quoting, and some arguments
 * cannot survive cmd.exe at all. All of that knowledge lived in shim-runner.ts — and
 * the launcher, one directory over, had none of it.
 *
 * So `lodestar claude` failed with `spawn claude ENOENT` on every Windows machine with
 * an npm-installed Claude Code, while `claude` itself worked fine in the same terminal.
 * The mechanism: npm installs CLIs as `claude.cmd`, a batch shim. Node's `spawn` with
 * `shell: false` hands the name to CreateProcess, which resolves only native
 * executables (`.exe`/`.com`) — it does not consult PATHEXT the way a shell does. So
 * `where claude` succeeds, `isOnPath('claude')` succeeds, and the spawn that actually
 * matters fails. The product's front door was open on one platform and painted shut on
 * the other.
 *
 * Two spawn sites, one execution problem, one module. A fix that lands in only one
 * copy is how the launcher got here — the shim was fixed for this exact failure in
 * Phase 6 (see the D-038 history below) and the launcher never was.
 */

import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Is this path something a shell would actually execute?
 *
 * ---------------------------------------------------------------------------
 * WHY `existsSync` WAS NOT ENOUGH
 * ---------------------------------------------------------------------------
 *
 * This used `existsSync`, which is true for directories and for files with no execute
 * bit. On POSIX `exts` is `['']`, so a *directory* named `node` in an earlier PATH entry
 * — or a non-`+x` file named `go` — was returned as "the real binary". `spawnSync` then
 * failed EACCES/EISDIR, and the shim reported "the command did NOT run" with exit 126.
 *
 * A real shell does not do that. It skips the entry and keeps scanning, so the command
 * works without LODESTAR and breaks with it — the one asymmetry the wedge cannot afford.
 *
 * So the check answers the question the shell asks: is it a regular file, and can this
 * process execute it? `X_OK` is meaningless on Windows (`accessSync` reports every
 * readable file as executable), which is fine — there, extension *is* the executability
 * contract, and PATHEXT has already filtered for it.
 *
 * Errors resolve to `false`: an unreadable or vanished candidate is not a binary we can
 * run, and guessing otherwise re-creates the bug this replaced.
 */
function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false
    if (process.platform === 'win32') return true
    accessSync(candidate, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function norm(p: string): string {
  return p.split('\\').join('/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Read an env var the way Windows does: by name, ignoring case.
 *
 * `process.env` is case-insensitive on Windows because Node proxies it — but a *copied*
 * env object (the agent env, a test fixture) is a plain object and is not. The recorder
 * builds exactly such copies, and setups differ on whether they spell it `PATH` or
 * `Path`, so an exact-key read resolves against a PATH that is not the child's.
 */
function envLookup(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const exact = env[name]
  if (exact !== undefined) return exact
  const upper = name.toUpperCase()
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper) return env[key]
  }
  return undefined
}

export interface ResolveOptions {
  /**
   * The environment the CHILD will run with — not necessarily ours. Resolution must
   * scan the PATH the spawned process will actually see, or the record and the
   * execution can disagree about what ran.
   */
  env?: NodeJS.ProcessEnv
  /** A directory to skip. The shim uses this to avoid resolving back into itself. */
  excludeDir?: string
}

/**
 * Find the executable a shell would run for `command`, or null.
 *
 * The manual PATH × PATHEXT scan a shell performs, minus the shell. This exists
 * because the two resolvers the OS offers are both wrong for us: CreateProcess ignores
 * PATHEXT (which is the D-072 ENOENT), and `where.exe` answers for *our* environment,
 * not the child's, and costs a process per query.
 */
export function resolveOnPath(command: string, opts: ResolveOptions = {}): string | null {
  const env = opts.env ?? process.env
  const exts =
    process.platform === 'win32'
      ? (envLookup(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';')
      : ['']

  // A command with a separator is a path, not a PATH lookup — a shell would not scan.
  if (command.includes('/') || command.includes('\\')) {
    if (isExecutableFile(command)) return command
    for (const ext of exts) {
      if (ext && isExecutableFile(command + ext.toLowerCase())) return command + ext.toLowerCase()
      if (ext && isExecutableFile(command + ext)) return command + ext
    }
    return null
  }

  const exclude = opts.excludeDir ? norm(opts.excludeDir) : null
  for (const dir of (envLookup(env, 'PATH') ?? '').split(delimiter)) {
    if (!dir) continue
    if (exclude && norm(dir) === exclude) continue // never resolve back into the shim
    for (const ext of exts) {
      const candidate = join(dir, command + ext.toLowerCase())
      if (isExecutableFile(candidate)) return candidate
      const upper = join(dir, command + ext)
      if (isExecutableFile(upper)) return upper
    }
  }
  return null
}

/**
 * Quote a token for cmd.exe.
 *
 * ---------------------------------------------------------------------------
 * `\"` IS THE WRONG ESCAPE HERE, AND IT WAS AN ARBITRARY-EXECUTION BUG
 * ---------------------------------------------------------------------------
 *
 * This function used to emit `"${token.replace(/"/g, '\\"')}"`. That is the **MSVCRT**
 * escape — correct for a C program parsing its own argv, and meaningless to cmd.exe,
 * which tracks quote state by counting `"` and does not honor the backslash.
 *
 * So the quote closed early and the remainder was parsed as shell text:
 *
 *   arg:  x"&echo PWNED&"y
 *   line: npm.cmd "x\"&echo PWNED&\"y"
 *         → cmd sees the quote close after `x\`, runs `echo PWNED` as a command,
 *           and npm receives a truncated argument.
 *
 * Reachable for every `.cmd`/`.bat` target — on Windows that is npm, npx, pnpm, yarn,
 * and tsc, i.e. the common case. An agent passing a crafted `--define` value could run
 * arbitrary commands *because LODESTAR was watching*. A recorder that creates the
 * vulnerability it exists to observe is the worst possible failure for this product.
 *
 * The correct cmd.exe escape for a literal quote inside a quoted string is `""`, which
 * also survives the batch `%*` splice and the final MSVCRT parse. This is the same
 * conclusion Rust's standard library reached for `make_bat_command_line` after
 * CVE-2024-24576 ("BatBadBut"), and we follow it deliberately rather than inventing our
 * own scheme in a place where being clever has already cost us once.
 */
export function cmdQuote(token: string): string {
  if (token.length && !CMD_NEEDS_QUOTING.test(token)) return token
  return `"${token.replace(/"/g, '""')}"`
}

/**
 * Characters that force quoting.
 *
 * Wider than the old charclass, which omitted `,` `;` `=` `!` — all of which cmd treats
 * as token separators or expansion syntax when unquoted.
 */
const CMD_NEEDS_QUOTING = /[\s&|<>()^"%,;=!]/

/**
 * Argument content that cannot be passed through `cmd /c` faithfully, at all.
 *
 * ---------------------------------------------------------------------------
 * WHY CALLERS REFUSE INSTEAD OF DOING THEIR BEST
 * ---------------------------------------------------------------------------
 *
 * `%VAR%` expansion happens while cmd.exe parses the line, and there is no escape for it
 * there — `%%` works only inside a batch file, not on a `/c` command line. So `%PATH%`
 * as an argument becomes its value before the target program ever sees it. A newline is
 * worse: it terminates the command outright.
 *
 * That leaves three options, and only one is acceptable for a trust product:
 *
 *   - Expand it silently. The command runs with arguments the developer did not write,
 *     and LODESTAR records the *pre*-expansion argv — so the record disagrees with what
 *     actually ran. The record lying is the one unrecoverable failure.
 *   - Strip or mangle it. Same problem, quieter.
 *   - Refuse, loudly, and say why.
 *
 * Rust's standard library reaches the same conclusion and rejects `%` in batch arguments
 * outright. We are narrower: only a *variable-shaped* `%NAME%` can expand, so `50% done`,
 * `%20` in a URL, and a bare trailing `%` all still work. Only the genuinely unfixable
 * case is refused.
 */
const BATCH_UNSAFE_ARG = /%[A-Za-z_][A-Za-z0-9_]*%|[\r\n]/

export function isBatchTarget(real: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(real)
}

/** The first argument that cannot survive `cmd /c`, or null if all of them can. */
export function unsafeBatchArg(args: readonly string[]): string | null {
  for (const a of args) if (BATCH_UNSAFE_ARG.test(a)) return a
  return null
}

/** What to hand Node's spawn/spawnSync so the resolved target actually executes. */
export interface SpawnSpec {
  file: string
  args: string[]
  /** True exactly when we built the cmd.exe line ourselves and Node must not re-quote. */
  windowsVerbatimArguments: boolean
}

/**
 * How to invoke a resolved executable, faithfully, on this platform.
 *
 * ---------------------------------------------------------------------------
 * WINDOWS BATCH WRAPPERS — two bugs live here, both of which BROKE the command
 * ---------------------------------------------------------------------------
 *
 * On Windows `npm` is `npm.cmd`, a batch file. Two failures were hit in sequence during
 * Phase 6, and both are worth remembering because both were silent-ish:
 *
 *  1. `spawnSync(real, args)` with `shell: false` — Node refuses to execute .cmd/.bat
 *     directly (hardened against batch-file command injection). The spawn fails,
 *     `status` is null, and `npm test` never runs at all.
 *
 *  2. `spawnSync(real, args, { shell: true })` — Node does NOT quote the executable
 *     path, so `C:\Program Files\nodejs\npm.cmd` reaches cmd.exe unquoted and splits at
 *     the space: `'C:\Program' is not recognized as an internal or external command`.
 *     The command still never runs.
 *
 * So batch files are invoked through cmd.exe explicitly, with every token quoted by us
 * and `windowsVerbatimArguments` telling Node to stop "helping". `/s` makes cmd strip
 * the outer quote pair; `/d` skips AutoRun scripts that could alter behavior.
 *
 * Native executables take the direct path — no shell, no quoting, nothing to get wrong.
 *
 * Callers must gate batch targets through `unsafeBatchArg` FIRST — this function quotes
 * what can be quoted; it cannot make `%VAR%` or a newline survivable.
 */
export function spawnSpec(real: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  if (!isBatchTarget(real)) {
    return { file: real, args, windowsVerbatimArguments: false }
  }
  const line = [real, ...args].map(cmdQuote).join(' ')
  return {
    file: envLookup(env, 'ComSpec') ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  }
}
