/**
 * Identity — the vectors, plus the property the vectors cannot state.
 *
 * The committed vectors (spec/identity-vectors.json) were written BEFORE this
 * implementation existed (V1-VALIDATION §10). These tests make the implementation
 * answer to them, never the reverse: changing an expected value is a GRAPH-SPEC
 * change and needs a DECISIONS entry.
 *
 * The property test at the bottom guards the claim the vectors cannot express:
 * resolution is ORDER-INDEPENDENT — same evidence set, same groups, whatever order
 * the records arrived in. That claim is load-bearing (M-V engineering §3): the
 * first design failed it, and this test is why a regression cannot land quietly.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeRemoteUrl } from './normalize.js'
import { buildEvidence, resolveIdentities, type EvidenceInput, type Resolution } from './identity.js'

const VECTORS = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  'spec',
  'identity-vectors.json',
)

interface NormVector {
  name: string
  input: string
  expected: string | null
}

interface ResolutionVector {
  name: string
  records: Array<EvidenceInput & { chainHead?: string }>
  expectedGroups: Array<{
    displayName: string
    basis: string
    members: string[]
    sessionCount?: number
    ambiguous?: boolean
    rootConflict?: boolean
  }>
  expectedCandidates: Array<{ kind: string; between: string[]; via: string }>
  expectedGroupCount?: number
  expectedTogether?: string[][]
  expectedApart?: string[][]
}

const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as {
  normalization: NormVector[]
  resolution: ResolutionVector[]
}

describe('remote URL normalization (vector-pinned)', () => {
  it('reproduces every committed vector', () => {
    expect(vectors.normalization.length).toBeGreaterThan(0)
    for (const v of vectors.normalization) {
      expect(normalizeRemoteUrl(v.input), v.name).toBe(v.expected)
    }
  })
})

function resolveVector(v: ResolutionVector, reverse = false): Resolution {
  const evidence = v.records.map((r) => buildEvidence(r))
  if (reverse) evidence.reverse()
  return resolveIdentities(evidence)
}

function groupOf(res: Resolution, recordId: string): string {
  for (const g of res.groups) {
    if (g.members.some((m) => m.recordId === recordId)) return g.displayName
  }
  throw new Error(`record ${recordId} is in no group`)
}

describe('identity resolution (vector-pinned)', () => {
  for (const v of vectors.resolution) {
    it(v.name, () => {
      const res = resolveVector(v)

      if (v.expectedGroupCount !== undefined) {
        expect(res.groups.length, 'group count').toBe(v.expectedGroupCount)
      }
      for (const expected of v.expectedGroups) {
        const g = res.groups.find((x) => x.displayName === expected.displayName)
        expect(g, `group ${expected.displayName} exists`).toBeTruthy()
        expect(g!.basis, `${expected.displayName} basis`).toBe(expected.basis)
        expect(
          g!.members.map((m) => m.recordId).sort(),
          `${expected.displayName} members`,
        ).toEqual([...expected.members].sort())
        if (expected.sessionCount !== undefined) {
          expect(g!.sessionCount, `${expected.displayName} sessions`).toBe(expected.sessionCount)
        }
        if (expected.ambiguous) expect(g!.ambiguous, `${expected.displayName} ambiguous`).toBe(true)
        if (expected.rootConflict) {
          expect(g!.rootConflict, `${expected.displayName} rootConflict`).toBe(true)
        } else {
          expect(g!.rootConflict, `${expected.displayName} no false conflict`).toBeUndefined()
        }
      }

      expect(
        res.candidates.map((c) => ({ kind: c.kind, between: c.between, via: c.via })),
        'candidates',
      ).toEqual(v.expectedCandidates)

      for (const together of v.expectedTogether ?? []) {
        const names = together.map((id) => groupOf(res, id))
        expect(new Set(names).size, `together: ${together.join(',')}`).toBe(1)
      }
      for (const apart of v.expectedApart ?? []) {
        const names = apart.map((id) => groupOf(res, id))
        expect(new Set(names).size, `apart: ${apart.join(',')}`).toBe(apart.length)
      }
    })
  }

  it('is order-independent: reversed input produces identical resolution', () => {
    for (const v of vectors.resolution) {
      const forward = resolveVector(v)
      const backward = resolveVector(v, true)
      expect(JSON.stringify(backward), v.name).toBe(JSON.stringify(forward))
    }
  })

  it('resolves an empty evidence set to an empty, honest answer', () => {
    const res = resolveIdentities([])
    expect(res.groups).toEqual([])
    expect(res.candidates).toEqual([])
  })
})
