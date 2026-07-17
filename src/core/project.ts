/**
 * LODESTAR — project detection and paths.
 *
 * Detection is best-effort and must never block `init`. An unrecognized project still
 * gets a working record — the ground-truth floor does not care what language you write.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const LODESTAR_DIR = '.lodestar'

export interface ProjectPaths {
  root: string
  lodestarDir: string
  db: string
  config: string
  sessions: string
}

export function paths(root: string): ProjectPaths {
  const lodestarDir = join(root, LODESTAR_DIR)
  return {
    root,
    lodestarDir,
    db: join(lodestarDir, 'lodestar.db'),
    config: join(lodestarDir, 'config.json'),
    sessions: join(lodestarDir, 'sessions'),
  }
}

export interface ProjectInfo {
  language: string
  packageManager: string | null
  git: boolean
}

export function detectProject(root: string): ProjectInfo {
  return {
    language: detectLanguage(root),
    packageManager: detectPackageManager(root),
    git: existsSync(join(root, '.git')),
  }
}

function detectLanguage(root: string): string {
  if (existsSync(join(root, 'tsconfig.json'))) return 'TypeScript'
  if (existsSync(join(root, 'package.json'))) {
    // A package.json without a tsconfig can still be TypeScript; check deps before
    // calling it JavaScript, since the label shows up in `init` output.
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['typescript']) return 'TypeScript'
    } catch {
      // Malformed package.json is the user's problem, not init's. Fall through.
    }
    return 'JavaScript'
  }
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'requirements.txt')))
    return 'Python'
  if (existsSync(join(root, 'go.mod'))) return 'Go'
  if (existsSync(join(root, 'Cargo.toml'))) return 'Rust'
  if (existsSync(join(root, 'pom.xml')) || existsSync(join(root, 'build.gradle'))) return 'Java'
  return 'unknown'
}

function detectPackageManager(root: string): string | null {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb'))) return 'bun'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  if (existsSync(join(root, 'package.json'))) return 'npm'
  if (existsSync(join(root, 'pyproject.toml'))) return 'pip'
  if (existsSync(join(root, 'go.mod'))) return 'go'
  if (existsSync(join(root, 'Cargo.toml'))) return 'cargo'
  return null
}

/** Walk up from `from` looking for an initialized project. */
export function findProjectRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, LODESTAR_DIR, 'config.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}
