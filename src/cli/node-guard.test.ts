/**
 * The old-Node refusal must be a sentence, never a stack trace.
 *
 * npm's `engines` field only warns at install, so Node 20 users reach first run and —
 * without this guard — crash with ERR_UNKNOWN_BUILTIN_MODULE from node:sqlite's import.
 * The guard is a pure function so the refusal is testable from the Node running the
 * suite, whatever version that is.
 */

import { describe, expect, it } from 'vitest'
import { MIN_NODE, unsupportedNodeReason } from './node-guard.js'

describe('node version guard', () => {
  it('refuses the Nodes that cannot run node:sqlite flag-free', () => {
    expect(unsupportedNodeReason('18.19.0')).toMatch(/needs Node 22\.13/)
    expect(unsupportedNodeReason('20.11.1')).toMatch(/needs Node 22\.13/)
    expect(unsupportedNodeReason('22.5.0')).toMatch(/needs Node 22\.13/)
    expect(unsupportedNodeReason('22.12.0')).toMatch(/needs Node 22\.13/)
  })

  it('accepts every supported Node', () => {
    expect(unsupportedNodeReason('22.13.0')).toBeNull()
    expect(unsupportedNodeReason('22.14.1')).toBeNull()
    expect(unsupportedNodeReason('23.0.0')).toBeNull()
    expect(unsupportedNodeReason('24.2.0')).toBeNull()
  })

  it('accepts the Node actually running this suite (engines gate holds)', () => {
    expect(unsupportedNodeReason(process.versions.node)).toBeNull()
  })

  it('lets an unparseable version run rather than refusing a working Node', () => {
    expect(unsupportedNodeReason('weird-fork')).toBeNull()
    expect(unsupportedNodeReason('')).toBeNull()
  })

  it('names the version the user is on, so the message is actionable', () => {
    expect(unsupportedNodeReason('20.11.1')).toContain('20.11.1')
  })

  it('stays in sync with package.json engines', async () => {
    const { readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
        'utf8',
      ),
    ) as { engines: { node: string } }
    expect(pkg.engines.node).toBe(`>=${MIN_NODE[0]}.${MIN_NODE[1]}`)
  })
})
