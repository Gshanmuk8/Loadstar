/**
 * The Evidence Record and its conformance suite.
 *
 * Three claims under test, in rising order of importance:
 *
 *   1. The record is DETERMINISTIC — the same ledger produces byte-identical records.
 *   2. The record IS the model — a report derived from an exported record equals the
 *      report built live from the store (D-059: renderers cannot tell the difference).
 *   3. The FORMAT IS PINNED — the implementation reproduces the committed golden
 *      vectors byte-for-byte, and the standalone verifier (an independent
 *      reimplementation, D-060) verifies them and rejects tampered variants.
 *
 * Claim 3 is the one that makes the format a format: a change to hashing,
 * canonicalization, or the hashed field set fails here FIRST, loudly, as a diff
 * against spec/vectors/ — instead of silently invalidating every record in the field.
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJSON } from '../core/hash.js'
import { buildRecord, computeRecordId } from './build.js'
import { serializeRecord, recordScriptTag } from './serialize.js'
import { RECORD_FORMAT, RECORD_FORMAT_VERSION, type EvidenceRecord } from './types.js'
import { seedVectorStore } from './vector-fixture.js'
import { buildReport, reportFromRecord } from '../facts/report.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const VECTORS = join(REPO, 'spec', 'vectors')
const VERIFIER = join(REPO, 'verifier', 'lodestar-verify.mjs')

function buildVectorRecord(): EvidenceRecord {
  const { store, sessionId, close } = seedVectorStore()
  try {
    const record = buildRecord(store, sessionId)
    if (!record) throw new Error('vector session did not build')
    return record
  } finally {
    close()
  }
}

/** Run the standalone verifier the way a recipient would: as a subprocess. */
function verify(file: string): { code: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [VERIFIER, file], { encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { code: e.status ?? -1, stdout: e.stdout ?? '' }
  }
}

describe('evidence record', () => {
  it('is deterministic: the same ledger produces byte-identical records', () => {
    const a = serializeRecord(buildVectorRecord())
    const b = serializeRecord(buildVectorRecord())
    expect(a).toBe(b)
  })

  it('is content-addressed: recordId recomputes, and any change moves it', () => {
    const record = buildVectorRecord()
    expect(computeRecordId(record)).toBe(record.recordId)

    const tampered = structuredClone(record)
    ;(tampered.evidence.facts[0]!.statement as string) = 'nothing happened'
    expect(computeRecordId(tampered)).not.toBe(record.recordId)
  })

  it('declares its format and the engine catalog it was computed with', () => {
    const record = buildVectorRecord()
    expect(record.format).toBe(RECORD_FORMAT)
    expect(record.formatVersion).toBe(RECORD_FORMAT_VERSION)
    expect(record.evidence.catalog).toEqual(['RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06', 'RF-07'])
  })

  it('identity comes from the chained session.start, not the mutable table', () => {
    const record = buildVectorRecord()
    expect(record.identity).toEqual({
      machineId: 'vector-machine-0001',
      runtimeVersion: '9.9.9',
      model: 'vector-model-1',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
    })
  })

  it('a report derived from the record equals the report built live from the store', () => {
    const { store, sessionId, close } = seedVectorStore()
    try {
      const record = buildRecord(store, sessionId)!
      const fromStore = buildReport(store, sessionId)!
      const fromRecord = reportFromRecord(record)
      expect(fromRecord).toEqual(fromStore)
      // And the round trip through serialization changes nothing: an exported record
      // read back produces the same report a live ledger does.
      const reparsed = JSON.parse(serializeRecord(record)) as EvidenceRecord
      expect(reportFromRecord(reparsed)).toEqual(fromStore)
    } finally {
      close()
    }
  })
})

describe('golden vectors (the format, pinned)', () => {
  it('canonical JSON reproduces every committed vector', () => {
    const vectors = JSON.parse(readFileSync(join(VECTORS, 'canonical-json.json'), 'utf8')) as Array<{
      name: string
      value: unknown
      canonical: string
    }>
    expect(vectors.length).toBeGreaterThan(0)
    for (const v of vectors) {
      expect(canonicalJSON(v.value), v.name).toBe(v.canonical)
    }
  })

  it('the implementation reproduces the committed session record byte-for-byte', () => {
    const committed = readFileSync(join(VECTORS, 'session-record.json'), 'utf8')
    expect(serializeRecord(buildVectorRecord())).toBe(committed)
  })

  it('the committed chain hashes match the built record', () => {
    const committed = JSON.parse(readFileSync(join(VECTORS, 'chain-hashes.json'), 'utf8')) as {
      head: string
      recordId: string
      events: Array<{ seq: number; hash: string }>
    }
    const record = buildVectorRecord()
    expect(record.recordId).toBe(committed.recordId)
    expect(record.observations.head).toBe(committed.head)
    expect(record.observations.events.map((e) => ({ seq: e.seq, hash: e.hash }))).toEqual(
      committed.events.map((e) => ({ seq: e.seq, hash: e.hash })),
    )
  })

  it('the vector session fires the catalog it was designed to fire', () => {
    const record = buildVectorRecord()
    expect(record.evidence.facts.map((f) => f.id).sort()).toEqual(
      ['RF-01', 'RF-02', 'RF-04', 'RF-04', 'RF-05', 'RF-06', 'RF-07'].sort(),
    )
    // The narration event is in the observations and cited by nothing.
    const narration = record.observations.events.filter((e) => e.signalTier === 'narration')
    expect(narration).toHaveLength(1)
    const cited = new Set(record.evidence.facts.flatMap((f) => f.evidence.map((p) => p.eventId)))
    expect(cited.has(narration[0]!.id)).toBe(false)
  })
})

describe('standalone verifier (the independent implementation)', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'lodestar-verify-'))

  it('verifies the committed vector record: INTACT, exit 0, deterministic output', () => {
    const file = join(VECTORS, 'session-record.json')
    const first = verify(file)
    const second = verify(file)
    expect(first.code).toBe(0)
    expect(first.stdout).toContain('result INTACT')
    expect(first.stdout).toContain('[ok]')
    expect(first.stdout).not.toContain('[FAIL]')
    // Deterministic: two runs, identical bytes. A verifier whose output wobbles cannot
    // be diffed, and a verifier that cannot be diffed cannot be audited.
    expect(second.stdout).toBe(first.stdout)
  })

  it('verifies a record embedded in an exported HTML page', () => {
    const dir = tmp()
    try {
      const record = buildVectorRecord()
      const html = `<!doctype html><html><body><h1>report</h1>${recordScriptTag(record)}</body></html>`
      const file = join(dir, 'report.html')
      writeFileSync(file, html, 'utf8')
      const r = verify(file)
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('result INTACT')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a rewritten exit code: the forged-pass attack reads ALTERED, exit 2', () => {
    const dir = tmp()
    try {
      const record = structuredClone(buildVectorRecord())
      const exit = record.observations.events.find(
        (e) => e.kind === 'process.exit' && (e.payload as { exitCode?: unknown }).exitCode === 1,
      )!
      ;(exit.payload as { exitCode: number }).exitCode = 0
      const file = join(dir, 'forged.json')
      writeFileSync(file, serializeRecord(record), 'utf8')
      const r = verify(file)
      expect(r.code).toBe(2)
      expect(r.stdout).toContain('result ALTERED')
      expect(r.stdout).toContain('does not match its hash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a deleted event: the chain gap is named, exit 2', () => {
    const dir = tmp()
    try {
      const record = structuredClone(buildVectorRecord())
      record.observations.events.splice(6, 1) // silently remove the npm-test failure
      record.observations.count = record.observations.events.length
      const file = join(dir, 'gapped.json')
      writeFileSync(file, serializeRecord(record), 'utf8')
      const r = verify(file)
      expect(r.code).toBe(2)
      expect(r.stdout).toContain('sequence gap')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an inflated status: VERIFIED stated over disclosed gaps, exit 2', () => {
    const dir = tmp()
    try {
      const record = structuredClone(buildVectorRecord())
      // The vector session is honestly DEGRADED (a shadowed shim). Claim VERIFIED while
      // leaving the disclosed gaps in place. Two checks catch it independently: the
      // record id (recordId covers `evidence`, so editing the status moves the hash)
      // and the integrity-claim check, which is the one that names the lie.
      record.evidence.integrity.status = 'VERIFIED'
      const file = join(dir, 'inflated.json')
      writeFileSync(file, serializeRecord(record), 'utf8')
      const r = verify(file)
      expect(r.code).toBe(2)
      expect(r.stdout).toContain('integrity claim')
      expect(r.stdout).toContain('these bytes verify to DEGRADED')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a spliced session: foreign events fail identity even with valid chains', () => {
    const dir = tmp()
    try {
      const record = structuredClone(buildVectorRecord())
      record.observations.events[2]!.sessionId = 'some-other-session'
      const file = join(dir, 'spliced.json')
      writeFileSync(file, serializeRecord(record), 'utf8')
      const r = verify(file)
      expect(r.code).toBe(2)
      expect(r.stdout).toContain('session identity')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a non-record and an unsupported version as INVALID, exit 1', () => {
    const dir = tmp()
    try {
      const notRecord = join(dir, 'not-a-record.json')
      writeFileSync(notRecord, '{"hello":"world"}', 'utf8')
      expect(verify(notRecord).code).toBe(1)

      const future = structuredClone(buildVectorRecord()) as { formatVersion: number }
      future.formatVersion = 999
      const futureFile = join(dir, 'future.json')
      writeFileSync(futureFile, JSON.stringify(future), 'utf8')
      const r = verify(futureFile)
      expect(r.code).toBe(1)
      expect(r.stdout).toContain('not supported')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('tolerates a UTF-8 BOM — the way Windows tools re-save files', () => {
    const dir = tmp()
    try {
      const file = join(dir, 'bom.json')
      writeFileSync(file, '\u{FEFF}' + serializeRecord(buildVectorRecord()), 'utf8')
      expect(verify(file).code).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
