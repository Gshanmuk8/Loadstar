/**
 * LODESTAR — project config.
 *
 * `init` writes sensible defaults and V0 ships no `config` command; editing this file
 * by hand is enough for one developer on one machine. See DECISIONS.md D-012.
 */

import { readFileSync, writeFileSync } from 'node:fs'

export interface LodestarConfig {
  version: number
  /** Recording master switch. */
  recording: boolean
  /** Globs watched by the filesystem recorder, relative to project root. */
  watch: string[]
  /** Never watched. Build output and dependency dirs are noise, not reality. */
  ignore: string[]
  /** Truncation bound for captured process output. Records are text; keep them small. */
  maxOutputBytes: number
  /**
   * Print the Reality Facts summary when a wrapped session exits.
   * Open question — see DECISIONS.md D-018.
   */
  sessionEndSummary: boolean
}

export const DEFAULT_CONFIG: LodestarConfig = {
  version: 1,
  recording: true,
  watch: ['**/*'],
  ignore: [
    '**/.lodestar/**',
    '**/.git/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/target/**',
    '**/__pycache__/**',
    '**/.venv/**',
    '**/*.log',
  ],
  maxOutputBytes: 8 * 1024,
  sessionEndSummary: true,
}

export function writeConfig(path: string, config: LodestarConfig = DEFAULT_CONFIG): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

export function readConfig(path: string): LodestarConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    // A broken config must not break recording. Defaults are always valid.
    return DEFAULT_CONFIG
  }
}
