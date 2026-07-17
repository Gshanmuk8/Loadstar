/**
 * No source or documentation file may contain a raw NUL byte — D-069.
 *
 * ---------------------------------------------------------------------------
 * WHY A BYTE-LEVEL TEST EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * `src/recorder/index.ts` shipped with a literal 0x00 byte inside a template string —
 * the author meant the six-character escape and an editor or tool wrote the character
 * itself. The code still compiled and behaved identically, which is exactly why nothing
 * caught it. The damage was to every tool AROUND the code:
 *
 *   - ripgrep classified the file as binary: `rg -l` silently omitted it, and content
 *     searches printed "binary file matches" instead of the matching lines
 *   - `git diff` and `git grep` treat NUL-bearing files as binary
 *   - IDE search, and any agent tooling built on those primitives, skipped it
 *
 * A file that every search tool skips is invisible during review — in this repo that
 * means fact-engine and recorder code nobody can grep is code nobody re-reads. The bug
 * class is trivially reintroducible (one paste, one escape-to-literal conversion by a
 * tool), it is invisible in every editor rendering, and it is one byte — so the gate is
 * a test, not a convention (the D-052 reasoning, applied to bytes).
 *
 * Scoped to the trees a developer greps: source, tests, docs, spec. Not `node_modules`,
 * not `dist`, and not asset formats that are legitimately binary.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Trees a developer expects text search to cover. */
const SCANNED_DIRS = ['src', 'docs', 'spec', 'verifier', 'stress', 'demo', 'site']
const SCANNED_ROOT_FILES = ['README.md', 'CLAUDE.md', 'package.json', 'tsconfig.json']

/** Text formats only — an extension here asserts "this must never look binary". */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml',
])

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      return name === 'node_modules' || name === 'dist' || name.startsWith('.') ? [] : textFiles(p)
    }
    return TEXT_EXTENSIONS.has(extname(name).toLowerCase()) ? [p] : []
  })
}

describe('source hygiene — no raw NUL bytes in text files (D-069)', () => {
  it('every text file in the repo is free of 0x00', () => {
    const files = [
      ...SCANNED_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => textFiles(join(ROOT, d))),
      ...SCANNED_ROOT_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
    ]

    const offenders = files
      .map((f) => ({ f, buf: readFileSync(f) }))
      .filter(({ buf }) => buf.includes(0))
      .map(({ f, buf }) => `  ${f.slice(ROOT.length + 1)} — first NUL at byte ${buf.indexOf(0)}`)

    expect(
      offenders.length,
      offenders.length
        ? `\n\nThese files contain a raw NUL byte, so ripgrep, git, and IDE search treat ` +
            `them as binary and silently skip them:\n\n${offenders.join('\n')}\n\n` +
            'If the NUL is meant to be IN a string, write the six-character escape ' +
            '(backslash-u-0000) instead — the runtime value is identical and the file ' +
            'stays searchable. See DECISIONS.md D-069, issue 3.\n'
        : '',
    ).toBe(0)
  })

  it('actually scans the trees it claims to', () => {
    // The decisions.test.ts guard, applied here: if the walk breaks, everything looks
    // clean, which is the silent-pass failure this codebase keeps rediscovering.
    const srcFiles = textFiles(join(ROOT, 'src'))
    expect(srcFiles.length).toBeGreaterThan(20)
    expect(srcFiles.some((f) => f.endsWith('index.ts'))).toBe(true)
    const docFiles = textFiles(join(ROOT, 'docs'))
    expect(docFiles.length).toBeGreaterThan(10)
  })
})
