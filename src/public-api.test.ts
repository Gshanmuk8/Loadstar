/**
 * The library entry point stays whole — release audit, V1.
 *
 * package.json's `main`/`types` point at this barrel. Two ways it can silently rot:
 * the file stops being emitted (the pre-release audit found `main` pointing at a
 * dist/index.js that did not exist), or ESM `export *` drops a name because two
 * barrels export it ambiguously — TypeScript EXCLUDES ambiguous re-exports instead
 * of erroring, which is exactly the kind of silent failure this repo hunts.
 *
 * So the documented surface (V1-DESIGN §11, STABILITY.md) is pinned by name. A
 * removal or an ambiguity collision fails here, loudly, before it ships.
 */

import { describe, expect, it } from 'vitest'
import * as lodestar from './index.js'

describe('public library entry (package.json main)', () => {
  it('exports the documented record-layer surface', () => {
    for (const name of [
      'buildRecord',
      'computeRecordId',
      'checkRecord',
      'serializeRecord',
      'recordScriptTag',
      'checkLink',
      'makeLink',
      'computeLinkId',
      'serializeLink',
      'activeLinks',
      'deriveIdentityDirectives',
      'repoAddress',
    ] as const) {
      expect(typeof lodestar[name], name).toBe('function')
    }
    expect(lodestar.RECORD_FORMAT).toBe('lodestar-evidence-record')
    expect(lodestar.LINK_FORMAT).toBe('lodestar-link')
  })

  it('exports the documented graph-layer surface', () => {
    for (const name of [
      'initGraph',
      'openGraph',
      'findGraphRoot',
      'addRecordValue',
      'addRecordFile',
      'addLinkValue',
      'addFromProject',
      'verifyGraph',
      'reindex',
      'syncGraph',
      'configureShare',
      'resolveIdentities',
      'normalizeRemoteUrl',
      'queryRepos',
      'queryRepoHistory',
      'queryFileHistory',
      'queryDivergences',
      'queryTimeline',
      'queryCoverage',
      'queryLinks',
      'reportJson',
    ] as const) {
      expect(typeof lodestar[name], name).toBe('function')
    }
    expect(lodestar.GRAPH_FORMAT).toBe('lodestar-evidence-graph')
  })
})
