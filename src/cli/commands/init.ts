/**
 * `lodestar init` — give LODESTAR a place to store reality.
 *
 * See USER-FLOW.md §3.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../../storage/db.js'
import { writeConfig } from '../../core/config.js'
import { detectProject, paths } from '../../core/project.js'
import { detectRuntimes } from '../../adapters/registry.js'
import { out, ok, dim, bold, warn } from '../ui.js'

export function cmdInit(): number {
  const root = process.cwd()
  const p = paths(root)

  if (existsSync(p.config)) {
    out(warn('LODESTAR is already initialized here.'))
    out(dim(`  ${p.lodestarDir}`))
    return 0
  }

  const project = detectProject(root)
  const runtimes = detectRuntimes()

  mkdirSync(p.sessions, { recursive: true })
  writeConfig(p.config)

  // Creating the database here — not at npm install — is deliberate. A global install
  // has no project to create one for, and postinstall scripts that write files are
  // what careful developers audit installers for. See DECISIONS.md D-015.
  openDatabase(p.db).close()

  const pmLabel = project.packageManager ?? 'none detected'
  const runtimeLabel = runtimes.length ? runtimes.map((r) => r.id).join(', ') : 'none detected'

  out()
  out(ok(`Project detected      ${dim(`${project.language} · ${pmLabel} · git ${project.git ? 'yes' : 'no'}`)}`))
  out(ok(`Runtime detected      ${dim(runtimeLabel)}`))
  out(ok(`Database created      ${dim('.lodestar/lodestar.db')}`))
  out(ok('Recording enabled'))
  out()
  out(bold('LODESTAR initialized.'))

  if (!runtimes.length) {
    out()
    out(warn('No supported agent runtime found on PATH.'))
    out(dim('  LODESTAR records from the filesystem and process tree regardless,'))
    out(dim('  but `lodestar claude` needs Claude Code installed.'))
  }

  ensureGitignore(root, project.git)

  out()
  out(dim('Next:'))
  out(dim('  lodestar claude'))
  out()
  return 0
}

/**
 * The record is the developer's own, not a repo artifact — and it can contain paths
 * and command output from their machine. Committing it by accident is a privacy
 * problem, so append the ignore rather than asking.
 */
function ensureGitignore(root: string, isGit: boolean): void {
  if (!isGit) return
  const file = join(root, '.gitignore')
  try {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (/^\.lodestar\/?\s*$/m.test(current)) return
    const prefix = current.length && !current.endsWith('\n') ? '\n' : ''
    appendFileSync(file, `${prefix}\n# LODESTAR — local AI execution record\n.lodestar/\n`, 'utf8')
    out(ok(`Added to .gitignore   ${dim('.lodestar/')}`))
  } catch {
    // Not worth failing init over.
  }
}
