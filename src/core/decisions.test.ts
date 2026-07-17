/**
 * Every decision cited in code must exist in DECISIONS.md — D-052.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TEST AND NOT A CONVENTION
 * ---------------------------------------------------------------------------
 *
 * The convention already existed. `CLAUDE.md` tells every contributor to read `DECISIONS.md`
 * *"before re-opening a settled question"*. It did not hold:
 *
 *   - **D-047 and D-048** were cited throughout the code for weeks with no entry in that
 *     file. Real decisions, correctly implemented, whose reasoning lived only in a source
 *     comment.
 *   - **D-025** was cited in four places and existed only as a "Resolves D-025" line
 *     inside D-034's body.
 *
 * A settled question with no entry gets re-litigated by the next person — and the code
 * comment holding the reasoning is exactly what they would change. It is also how D-048's
 * "reconciled" claim rotted into the D-050 drift: **a comment is not load-bearing, and
 * nothing checks it.**
 *
 * This is the smallest possible thing that makes the rule real. It costs one grep and it
 * fails the build, which is more than a paragraph of guidance has ever done.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const DECISIONS = join(SRC, '..', 'docs', 'DECISIONS.md')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

describe('D-052 — a decision cited in code exists in DECISIONS.md', () => {
  it('has no dangling decision references', () => {
    const doc = readFileSync(DECISIONS, 'utf8')

    // A decision is "documented" when it has its own heading. A passing mention inside
    // another entry's prose does not count — that is precisely the D-025 case: cited four
    // times in code, discoverable only by reading D-034's body.
    const documented = new Set(
      [...doc.matchAll(/^##\s+(D-\d{3})\b/gm)].map((m) => m[1]!),
    )

    const dangling = new Map<string, string[]>()
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\bD-(\d{3})\b/g)) {
        const id = `D-${m[1]}`
        if (documented.has(id)) continue
        const where = dangling.get(id) ?? []
        const rel = file.slice(SRC.length + 1).split('\\').join('/')
        if (!where.includes(rel)) where.push(rel)
        dangling.set(id, where)
      }
    }

    // The message matters: whoever hits this needs to know it is not a naming nit. They
    // have written reasoning into a comment where the next contributor will not find it.
    const report = [...dangling.entries()]
      .map(([id, files]) => `  ${id} — cited in ${files.join(', ')}`)
      .join('\n')

    expect(
      dangling.size,
      dangling.size
        ? `\n\nThese decisions are cited in code but have no "## ${'D-0XX'}" heading in ` +
            `docs/DECISIONS.md:\n\n${report}\n\n` +
            'Write the entry before landing the code (D-052). The number in a comment is a ' +
            'reference a reader will follow; a reference that goes nowhere means the ' +
            'reasoning lives only in that comment, which is how D-048 rotted into D-050.\n'
        : '',
    ).toBe(0)
  })

  it('finds the decisions this repo actually depends on', () => {
    // A guard against the test passing because the regex matched nothing. If the parse
    // breaks, `documented` goes empty and every reference looks dangling — but if the
    // SCAN breaks, everything looks fine, which is the silent-pass failure this codebase
    // keeps rediscovering (D-022, D-040, D-048).
    const doc = readFileSync(DECISIONS, 'utf8')
    const documented = [...doc.matchAll(/^##\s+(D-\d{3})\b/gm)].map((m) => m[1]!)

    expect(documented.length).toBeGreaterThan(40)
    for (const id of ['D-009', 'D-025', 'D-034', 'D-044', 'D-045', 'D-047', 'D-048', 'D-049', 'D-050', 'D-053']) {
      expect(documented).toContain(id)
    }

    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => readFileSync(f, 'utf8').includes('D-053'))).toBe(true)
  })
})
