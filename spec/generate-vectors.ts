/**
 * LODESTAR — golden vector generator.
 *
 *   npm run vectors        (or: npx tsx spec/generate-vectors.ts)
 *
 * ---------------------------------------------------------------------------
 * REGENERATING VECTORS IS A FORMAT EVENT, NOT A CHORE — D-060
 * ---------------------------------------------------------------------------
 *
 * The files this writes into spec/vectors/ are the LODESTAR record format's
 * conformance suite: fixed inputs and the exact bytes/hashes a conforming
 * implementation must produce for them (RECORD-SPEC.md §8). The tests in
 * src/record/record.test.ts assert that the CURRENT implementation reproduces the
 * COMMITTED vectors — so if you changed hashing, canonicalization, the hashed field
 * set, or the record shape, those tests fail, and rerunning this script to "fix" them
 * is exactly the moment you are changing the format.
 *
 * That is sometimes the right thing to do. When it is: bump RECORD_FORMAT_VERSION,
 * update RECORD-SPEC.md, record the decision in DECISIONS.md, and regenerate. What is
 * never right is regenerating to make a red test green without noticing that a
 * format change happened — the diff of spec/vectors/ in review is the alarm.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJSON } from '../src/core/hash.js'
import { buildRecord } from '../src/record/build.js'
import { serializeRecord } from '../src/record/serialize.js'
import { seedVectorStore } from '../src/record/vector-fixture.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'vectors')
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------------------
// 1. Canonicalization vectors — the cases where implementations actually diverge.
//    Every `value` is expressible in plain JSON so any language can load the file.
// ---------------------------------------------------------------------------

const canonicalCases: Array<{ name: string; value: unknown }> = [
  { name: 'keys sorted', value: { b: 1, a: 2 } },
  { name: 'nested keys sorted, arrays keep order', value: { z: { y: 1, x: 2 }, a: [{ c: 1, b: 2 }, 3, 1] } },
  { name: 'null is preserved (it is a claim, not an absence)', value: { a: null } },
  { name: 'empty object and empty array', value: { o: {}, a: [] } },
  { name: 'string escapes: quote, backslash, newline, control', value: { s: 'he said "hi"\\\n' } },
  { name: 'unicode stays literal utf-8, including astral pairs', value: { s: 'héllo — 𝄞' } },
  { name: 'keys sort by utf-16 code units', value: { 'β': 1, a: 2, B: 3 } },
  {
    name: 'numbers: shortest round-trip form (ECMA-262 Number::toString)',
    value: { i: 42, f: 0.1, half: 1767323050000.5, neg: -7, negzero: -0, big: 1e21, small: 1e-7 },
  },
]

const canonicalVectors = canonicalCases.map((c) => ({
  name: c.name,
  value: c.value,
  canonical: canonicalJSON(c.value),
}))

writeFileSync(
  join(OUT, 'canonical-json.json'),
  JSON.stringify(canonicalVectors, null, 2) + '\n',
  'utf8',
)

// ---------------------------------------------------------------------------
// 2. The session record vector — the full Evidence Record for the fixed session,
//    byte-exact. THE conformance artifact: reproduce this file and you have
//    implemented the format.
// ---------------------------------------------------------------------------

const { store, sessionId, close } = seedVectorStore()
const record = buildRecord(store, sessionId)
if (!record) throw new Error('vector session did not build')

writeFileSync(join(OUT, 'session-record.json'), serializeRecord(record), 'utf8')

// ---------------------------------------------------------------------------
// 3. Chain hashes, extracted — a smaller target for an implementer working up to
//    the full record: reproduce these hashes from the events first.
// ---------------------------------------------------------------------------

writeFileSync(
  join(OUT, 'chain-hashes.json'),
  JSON.stringify(
    {
      genesis: record.observations.genesis,
      head: record.observations.head,
      recordId: record.recordId,
      events: record.observations.events.map((e) => ({
        seq: e.seq,
        id: e.id,
        prevHash: e.prevHash,
        hash: e.hash,
      })),
    },
    null,
    2,
  ) + '\n',
  'utf8',
)

close()

console.log(`vectors written to ${OUT}`)
console.log(`  recordId ${record.recordId}`)
console.log(`  head     ${record.observations.head}`)
console.log(`  events   ${record.observations.count}`)
console.log(`  facts    ${record.evidence.facts.map((f) => f.id).join(', ')}`)
