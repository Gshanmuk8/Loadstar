#!/usr/bin/env node
/**
 * lodestar-verify — standalone verifier for LODESTAR Evidence Records.
 *
 *   node lodestar-verify.mjs <record.json | report.html>
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 *
 * One file, zero dependencies, nothing imported but node built-ins. A recipient of an
 * exported Evidence Record — a teammate, an auditor, a future you — runs this against
 * the file and learns whether the record has been altered since it was produced,
 * WITHOUT installing LODESTAR and without trusting the sender's rendering of it.
 *
 * It is deliberately an INDEPENDENT implementation of the record format
 * (docs/RECORD-SPEC.md): canonicalization, hashing, and the chain walk are
 * reimplemented here rather than imported from src/. That makes this file the format's
 * second implementation — the golden vectors in spec/vectors/ pin both against the
 * same bytes, so if the primary implementation drifts from the spec, this file breaks
 * the build instead of quietly following it. (D-060)
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PROVES, AND WHAT IT CANNOT — printed in every run, never implied
 * ---------------------------------------------------------------------------
 *
 * Proves: the record is internally consistent and unaltered — every event hash
 * recomputes, the chain links from genesis to the stated head, the record's content
 * address matches its content, every fact's evidence pointers resolve into the
 * verified chain, and no fact cites narration.
 *
 * Cannot prove: that the events faithfully describe what happened on the machine
 * (capture ran as the same OS user as the agent — THREAT-MODEL.md), that facts were
 * CORRECTLY computed from the events (that requires the fact engine; this checks the
 * pointers, not the computation), or the session frame (`subject`), which is context
 * read from a mutable table, not chained evidence.
 *
 * Output is byte-deterministic for a given input: no timestamps, no locale, no color,
 * no absolute paths. Two people verifying the same record see the same bytes.
 *
 * Exit codes:
 *   0  INTACT   — the record verifies.
 *   1  INVALID  — not a record, unreadable, or structurally malformed. Also usage errors.
 *   2  ALTERED  — the record parses but does not verify: a hash, link, id, pointer, or
 *                 stated status contradicts the bytes.
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// The format, reimplemented. Must match docs/RECORD-SPEC.md exactly — the golden
// vectors (spec/vectors/) assert that it does.
// ---------------------------------------------------------------------------

const GENESIS_HASH = '0'.repeat(64)
const RECORD_FORMAT = 'lodestar-evidence-record'
const SUPPORTED_FORMAT_VERSION = 1
const HTML_MARKER =
  /<script type="application\/json" id="lodestar-evidence-record">([\s\S]*?)<\/script>/

/** Deterministic JSON: object keys sorted recursively; undefined dropped; null kept. */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue
    out[key] = canonicalize(value[key])
  }
  return out
}

function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256hex(...utf8Parts) {
  const h = createHash('sha256')
  for (const p of utf8Parts) h.update(p, 'utf8')
  return h.digest('hex')
}

/** The chain link: H(prevHash || canonicalJSON(body)). RECORD-SPEC.md §4. */
function chainHash(prevHash, body) {
  return sha256hex(prevHash, canonicalJSON(body))
}

/**
 * The hashed event body — the exact field set the chain protects. RECORD-SPEC.md §3.
 * A field absent from this list could be altered without breaking the chain, which is
 * why the list is closed and versioned.
 */
function eventHashBody(e) {
  return {
    id: e.id,
    sessionId: e.sessionId,
    seq: e.seq,
    ts: e.ts,
    monotonicTs: e.monotonicTs,
    source: e.source,
    signalTier: e.signalTier,
    kind: e.kind,
    actor: e.actor,
    target: e.target ?? null,
    effectClass: e.effectClass ?? null,
    blastRadius: e.blastRadius ?? null,
    reversible: e.reversible ?? null,
    taint: e.taint ?? null,
    missionId: e.missionId ?? null,
    payload: e.payload,
    snapshotRef: e.snapshotRef ?? null,
    prevHash: e.prevHash,
  }
}

function computeRecordId(record) {
  const body = { ...record }
  delete body.recordId
  return sha256hex(canonicalJSON(body))
}

// ---------------------------------------------------------------------------
// Structural validation. Every check is a named expectation with a path, so a
// malformed record fails with "where and what", never with a stack trace.
// ---------------------------------------------------------------------------

const isStr = (v) => typeof v === 'string'
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isBool = (v) => typeof v === 'boolean'
const isArr = Array.isArray
const isObj = (v) => v !== null && typeof v === 'object' && !isArr(v)
const isHex64 = (v) => isStr(v) && /^[0-9a-f]{64}$/.test(v)
const orNull = (pred) => (v) => v === null || pred(v)

const SIGNAL_TIERS = new Set(['narration', 'intent', 'groundTruth'])
const INTEGRITY_STATUSES = new Set(['VERIFIED', 'DEGRADED', 'BROKEN'])
const CONFIDENCES = new Set(['high', 'medium', 'low'])

function validateStructure(r) {
  const errs = []
  const need = (cond, path, expected) => {
    if (!cond) errs.push(`${path}: expected ${expected}`)
    return cond
  }

  if (!need(isObj(r), '$', 'an object')) return errs

  need(r.format === RECORD_FORMAT, 'format', `"${RECORD_FORMAT}"`)
  need(isNum(r.formatVersion), 'formatVersion', 'a number')
  need(isHex64(r.recordId), 'recordId', '64 lowercase hex characters')

  if (need(isObj(r.generator), 'generator', 'an object')) {
    need(isStr(r.generator.name), 'generator.name', 'a string')
    need(isStr(r.generator.version), 'generator.version', 'a string')
  }

  if (need(isObj(r.subject), 'subject', 'an object')) {
    const s = r.subject
    need(isStr(s.sessionId), 'subject.sessionId', 'a string')
    need(isNum(s.sessionNumber), 'subject.sessionNumber', 'a number')
    need(isStr(s.runtimeId), 'subject.runtimeId', 'a string')
    need(orNull(isStr)(s.mission), 'subject.mission', 'a string or null')
    need(isStr(s.startedAt), 'subject.startedAt', 'a string')
    need(orNull(isStr)(s.endedAt), 'subject.endedAt', 'a string or null')
    need(orNull(isNum)(s.exitCode), 'subject.exitCode', 'a number or null')
    need(isStr(s.cwd), 'subject.cwd', 'a string')
  }

  need(isObj(r.identity), 'identity', 'an object')

  if (need(isObj(r.observations), 'observations', 'an object')) {
    const o = r.observations
    need(o.genesis === GENESIS_HASH, 'observations.genesis', `"${GENESIS_HASH}"`)
    need(isHex64(o.head), 'observations.head', '64 lowercase hex characters')
    need(isNum(o.count), 'observations.count', 'a number')
    if (need(isArr(o.events), 'observations.events', 'an array')) {
      o.events.forEach((e, i) => {
        const p = `observations.events[${i}]`
        if (!need(isObj(e), p, 'an object')) return
        need(isStr(e.id), `${p}.id`, 'a string')
        need(isStr(e.sessionId), `${p}.sessionId`, 'a string')
        need(isNum(e.seq), `${p}.seq`, 'a number')
        need(isStr(e.ts), `${p}.ts`, 'a string')
        need(isNum(e.monotonicTs), `${p}.monotonicTs`, 'a number')
        need(isStr(e.source), `${p}.source`, 'a string')
        need(SIGNAL_TIERS.has(e.signalTier), `${p}.signalTier`, 'narration|intent|groundTruth')
        need(isStr(e.kind), `${p}.kind`, 'a string')
        need(isObj(e.actor), `${p}.actor`, 'an object')
        need('payload' in e, `${p}.payload`, 'to be present')
        need(isHex64(e.prevHash) || e.prevHash === GENESIS_HASH, `${p}.prevHash`, '64 hex characters')
        need(isHex64(e.hash), `${p}.hash`, '64 lowercase hex characters')
      })
    }
  }

  if (need(isObj(r.evidence), 'evidence', 'an object')) {
    const ev = r.evidence
    need(isArr(ev.catalog) && ev.catalog.every(isStr), 'evidence.catalog', 'an array of strings')
    need(isArr(ev.limitations) && ev.limitations.every(isStr), 'evidence.limitations', 'an array of strings')
    need(isArr(ev.interference) && ev.interference.every(isStr), 'evidence.interference', 'an array of strings')
    need(isArr(ev.recorderErrors) && ev.recorderErrors.every(isStr), 'evidence.recorderErrors', 'an array of strings')
    need(isArr(ev.coverage), 'evidence.coverage', 'an array')
    need(isBool(ev.closed), 'evidence.closed', 'a boolean')
    if (need(isArr(ev.facts), 'evidence.facts', 'an array')) {
      ev.facts.forEach((f, i) => {
        const p = `evidence.facts[${i}]`
        if (!need(isObj(f), p, 'an object')) return
        need(isStr(f.id), `${p}.id`, 'a string')
        need(isStr(f.statement), `${p}.statement`, 'a string')
        need(CONFIDENCES.has(f.confidence), `${p}.confidence`, 'high|medium|low')
        need(isStr(f.ts), `${p}.ts`, 'a string')
        if (need(isArr(f.evidence), `${p}.evidence`, 'an array')) {
          f.evidence.forEach((ptr, j) => {
            const q = `${p}.evidence[${j}]`
            if (!need(isObj(ptr), q, 'an object')) return
            need(isStr(ptr.source), `${q}.source`, 'a string')
            need(isStr(ptr.eventId), `${q}.eventId`, 'a string')
            need(isNum(ptr.eventSeq), `${q}.eventSeq`, 'a number')
            need(isStr(ptr.ts), `${q}.ts`, 'a string')
          })
        }
      })
    }
    if (need(isObj(ev.integrity), 'evidence.integrity', 'an object')) {
      need(INTEGRITY_STATUSES.has(ev.integrity.status), 'evidence.integrity.status', 'VERIFIED|DEGRADED|BROKEN')
      need(isObj(ev.integrity.chain), 'evidence.integrity.chain', 'an object')
      need(
        isArr(ev.integrity.degraded) && ev.integrity.degraded.every(isStr),
        'evidence.integrity.degraded',
        'an array of strings',
      )
    }
  }

  return errs
}

// ---------------------------------------------------------------------------
// Verification proper. Pure functions over the parsed record.
// ---------------------------------------------------------------------------

/** Walk the chain: gapless seq from 1, prevHash links, every hash recomputes. */
function verifyChain(events) {
  let prevHash = GENESIS_HASH
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (e.seq !== i + 1) {
      return { intact: false, checked: i, brokenAt: e.seq, reason: `sequence gap: expected ${i + 1}, found ${e.seq}` }
    }
    if (e.prevHash !== prevHash) {
      return { intact: false, checked: i, brokenAt: e.seq, reason: 'prevHash does not match the previous event' }
    }
    const body = eventHashBody(e)
    if (chainHash(prevHash, body) !== e.hash) {
      return { intact: false, checked: i, brokenAt: e.seq, reason: 'event content does not match its hash' }
    }
    prevHash = e.hash
  }
  return { intact: true, checked: events.length }
}

function run(record) {
  const checks = []
  let worst = 'ok' // ok < altered
  const report = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    if (!ok) worst = 'altered'
  }

  // 1. record id — the content address matches the content.
  const expectedId = computeRecordId(record)
  report(
    'record id',
    expectedId === record.recordId,
    expectedId === record.recordId
      ? 'recomputes from canonical content'
      : `stated ${record.recordId}, canonical content hashes to ${expectedId}`,
  )

  const events = record.observations.events

  // 2. every event belongs to the subject session. A record spliced together from two
  //    sessions must not verify just because each fragment's chain is self-consistent.
  const foreign = events.filter((e) => e.sessionId !== record.subject.sessionId).length
  report(
    'session identity',
    foreign === 0,
    foreign === 0
      ? `all ${events.length} events carry the subject session id`
      : `${foreign} event(s) carry a different sessionId than the subject`,
  )

  // 3. the chain.
  const chain = verifyChain(events)
  report(
    'hash chain',
    chain.intact,
    chain.intact
      ? `${chain.checked}/${events.length} event hashes recompute; links intact from genesis`
      : `event ${chain.brokenAt}: ${chain.reason} (${chain.checked} verified before the break)`,
  )

  // 4. the stated frame matches the events.
  const head = events.length ? events[events.length - 1].hash : GENESIS_HASH
  report(
    'chain head',
    head === record.observations.head,
    head === record.observations.head
      ? 'observations.head matches the last event'
      : `observations.head states ${record.observations.head}, events end at ${head}`,
  )
  report(
    'event count',
    events.length === record.observations.count,
    events.length === record.observations.count
      ? `observations.count matches (${events.length})`
      : `observations.count states ${record.observations.count}, record carries ${events.length}`,
  )

  // 5. fact evidence pointers resolve into the verified chain, exactly.
  const byId = new Map(events.map((e) => [e.id, e]))
  let pointers = 0
  let broken = []
  for (const f of record.evidence.facts) {
    for (const ptr of f.evidence) {
      pointers++
      const e = byId.get(ptr.eventId)
      if (!e) broken.push(`${f.id}: cites event ${ptr.eventId}, which is not in the record`)
      else if (e.seq !== ptr.eventSeq) broken.push(`${f.id}: cites seq ${ptr.eventSeq}, event has seq ${e.seq}`)
      else if (e.ts !== ptr.ts) broken.push(`${f.id}: cites ts ${ptr.ts}, event has ts ${e.ts}`)
    }
  }
  report(
    'fact evidence',
    broken.length === 0,
    broken.length === 0 ? `${pointers}/${pointers} evidence pointers resolve to recorded events` : broken[0],
  )

  // 6. the Reality Facts Rule, checked mechanically: no fact cites narration or intent.
  //    (Facts are computed from groundTruth only — D-009. A record violating this was
  //    not produced by a conforming generator, whatever its hashes say.)
  let tierViolations = []
  for (const f of record.evidence.facts) {
    for (const ptr of f.evidence) {
      const e = byId.get(ptr.eventId)
      if (e && e.signalTier !== 'groundTruth') {
        tierViolations.push(`${f.id}: cites a ${e.signalTier}-tier event (${ptr.eventId})`)
      }
    }
  }
  report(
    'fact tier rule',
    tierViolations.length === 0,
    tierViolations.length === 0 ? 'no fact cites narration or intent' : tierViolations[0],
  )

  // 7. the stated integrity is consistent with what these bytes actually verify to.
  //    BROKEN must mean the chain does not recompute; VERIFIED must mean intact with
  //    no stated gaps. A record claiming more than its bytes support is altered or
  //    non-conforming, and either way it must not pass.
  const stated = record.evidence.integrity
  const expectedStatus = !chain.intact ? 'BROKEN' : stated.degraded.length ? 'DEGRADED' : 'VERIFIED'
  report(
    'integrity claim',
    stated.status === expectedStatus,
    stated.status === expectedStatus
      ? `${stated.status}, consistent with recomputation`
      : `record states ${stated.status}; these bytes verify to ${expectedStatus}`,
  )

  return { checks, altered: worst !== 'ok', chainIntact: chain.intact }
}

// ---------------------------------------------------------------------------
// Input handling and deterministic output.
// ---------------------------------------------------------------------------

function extractRecordText(raw, path) {
  // A UTF-8 BOM is how Windows editors and shells routinely re-save a file. It changes
  // no JSON value, so tolerating it costs nothing; rejecting it would fail real records
  // for a reason no user could see. (Hashing is over parsed VALUES — RECORD-SPEC.md §5 —
  // so a BOM cannot affect verification either way.)
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const looksHtml = /\.html?$/i.test(path) || /^\s*</.test(raw)
  if (!looksHtml) return raw
  const m = HTML_MARKER.exec(raw)
  if (!m) return null
  return m[1]
}

function main(argv) {
  const args = argv.filter((a) => a !== '--quiet')
  const quiet = argv.includes('--quiet')
  const path = args[0]

  // Everything printed after this point interpolates record-controlled strings
  // (runtimeId, generator, degraded notes). This verifier's verdict is the single
  // most trusted line LODESTAR ever prints, and it emits no styling of its own —
  // so no escape or control byte in a record may reach the terminal. Stripped, not
  // executed; the record's bytes are still verified exactly as read.
  const sanitize = (s) =>
    // eslint-disable-next-line no-control-regex
    String(s).replace(/[\0-\x08\x0b-\x1f\x7f-\u009f]/g, '')
  const print = (line = '') => {
    if (!quiet) process.stdout.write(sanitize(line) + '\n')
  }

  if (!path) {
    process.stderr.write(
      'usage: lodestar-verify <record.json | report.html> [--quiet]\n' +
        '       verifies a LODESTAR evidence record. exit 0 intact, 1 invalid, 2 altered.\n',
    )
    return 1
  }

  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    process.stderr.write(`lodestar-verify: cannot read ${path}: ${err.code ?? err.message}\n`)
    return 1
  }

  const text = extractRecordText(raw, path)
  if (text === null) {
    process.stderr.write(
      'lodestar-verify: this HTML file carries no embedded evidence record\n' +
        '(expected a <script type="application/json" id="lodestar-evidence-record"> block)\n',
    )
    return 1
  }

  let record
  try {
    record = JSON.parse(text)
  } catch {
    process.stderr.write('lodestar-verify: not valid JSON\n')
    return 1
  }

  print('lodestar-verify · standalone verifier for LODESTAR evidence records')
  print()

  if (!isObj(record) || record.format !== RECORD_FORMAT) {
    print('result INVALID · not a LODESTAR evidence record (missing format marker)')
    return 1
  }
  if (record.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    print(
      `result INVALID · format version ${record.formatVersion} is not supported by this ` +
        `verifier (supports ${SUPPORTED_FORMAT_VERSION}). A newer verifier may exist.`,
    )
    return 1
  }

  const structural = validateStructure(record)
  if (structural.length) {
    print('checks')
    print('  [FAIL] structure')
    for (const e of structural.slice(0, 10)) print(`         ${e}`)
    if (structural.length > 10) print(`         … ${structural.length - 10} more`)
    print()
    print('result INVALID · structurally malformed; verification did not run')
    return 1
  }

  print(`record    ${record.recordId}`)
  print(
    `subject   session #${String(record.subject.sessionNumber).padStart(3, '0')} · ` +
      `${record.subject.runtimeId} · ${record.observations.count} events`,
  )
  print(`generator ${record.generator.name} ${record.generator.version}`)
  print()

  const { checks, altered } = run(record)

  print('checks')
  const width = Math.max(...checks.map((c) => c.name.length))
  for (const c of checks) {
    print(`  [${c.ok ? 'ok' : 'FAIL'}]${c.ok ? '  ' : ''} ${c.name.padEnd(width)}  ${c.detail}`)
  }
  print()
  print('what this verifier proves')
  print('  - the record has not been altered since it was produced')
  print('  - every fact points at events inside the verified chain, at ground-truth tier')
  print()
  print('what it cannot prove')
  print('  - that the events faithfully describe what happened on the machine')
  print('    (capture ran as the same OS user as the agent; see THREAT-MODEL.md)')
  print('  - that the facts were correctly computed from the events')
  print('    (evidence pointers are checked; the computation is not re-run)')
  print('  - the session frame (subject) — context, not chained evidence')
  print()

  if (altered) {
    print('result ALTERED · this record does not verify; treat nothing in it as evidence')
    return 2
  }

  print(
    `result INTACT · session status ${record.evidence.integrity.status} (as stated and ` +
      'consistent with these bytes)',
  )
  return 0
}

process.exit(main(process.argv.slice(2)))
