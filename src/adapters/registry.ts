/**
 * LODESTAR — runtime adapter registry.
 *
 * The runtime-independence boundary. Adding a runtime must mean writing one small
 * adapter and changing nothing else. If storage, analysis, or reporting ever imports
 * a runtime-specific type, runtime independence is already broken — guard this in
 * review. See API-DESIGN.md §3.
 */

import { execFileSync } from 'node:child_process'

/**
 * What an adapter can and cannot observe.
 *
 * Declared, not assumed, for two reasons. Honest coverage: the UI reports what it did
 * *not* independently verify, because a trust product with silent holes is worse than
 * one with disclosed holes. And V2 readiness: `preExecution` tells the future Gate
 * layer which runtimes it can actually enforce on.
 */
export interface AdapterCapabilities {
  toolCalls: boolean
  resolvedTargets: boolean
  mission: boolean
  stdio: boolean
  /** Can we see actions BEFORE they commit? The V2 gate question. */
  preExecution: boolean
}

export interface RuntimeAdapter {
  readonly id: string
  readonly displayName: string
  /** The executable to look for on PATH. */
  readonly bin: string
  readonly capabilities: AdapterCapabilities
  /**
   * The environment variable this runtime consults to choose its shell, if it has one.
   *
   * The coverage probe must measure the shell the agent will actually get, so it
   * mirrors each runtime's selection order. That order is runtime-specific knowledge,
   * and this field is where it lives — the recorder consumes the aggregated list via
   * `shellSelectionEnvVars()` and hard-codes nothing about any vendor.
   */
  readonly shellEnvVar?: string
}

/**
 * Claude Code — the wedge runtime.
 *
 * Capabilities are honest about V0's reality: we wrap the process, so we get stdio
 * and the ground-truth floor, but we do not yet hook the tool-execution layer. Tier 2
 * (intent) arrives when the hook lands; until then this adapter declares false and the
 * report says so rather than implying coverage it does not have.
 */
const claudeCode: RuntimeAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  bin: 'claude',
  capabilities: {
    toolCalls: false,
    resolvedTargets: false,
    mission: false,
    stdio: true,
    preExecution: false,
  },
  shellEnvVar: 'CLAUDE_CODE_SHELL',
}

/**
 * Recording with no adapter at all.
 *
 * This is what makes the cross-agent pillar real at V0 without violating depth-on-one:
 * the ground-truth floor needs no adapter, so any agent's disk and process effects are
 * recorded from day one — degraded, disclosed, but real. See DECISIONS.md D-004.
 */
export const FLOOR_ONLY: AdapterCapabilities = {
  toolCalls: false,
  resolvedTargets: false,
  mission: false,
  stdio: true,
  preExecution: false,
}

const ADAPTERS: RuntimeAdapter[] = [claudeCode]

export function getAdapter(command: string): RuntimeAdapter | null {
  return ADAPTERS.find((a) => a.bin === command || a.id === command) ?? null
}

/**
 * Every shell-selection env var any registered runtime consults, in registration order.
 *
 * The probe honors these before `SHELL` so it measures the agent's real conditions. A
 * variable set for a runtime that is not running is harmless — it still names a shell
 * the user configured — and a runtime the registry does not know contributes nothing,
 * which is exactly the floor-only degradation the probe already reports honestly.
 */
export function shellSelectionEnvVars(): string[] {
  return ADAPTERS.map((a) => a.shellEnvVar).filter((v): v is string => Boolean(v))
}

export function isOnPath(bin: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(probe, [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Which supported runtimes are actually installed here. */
export function detectRuntimes(): RuntimeAdapter[] {
  return ADAPTERS.filter((a) => isOnPath(a.bin))
}
