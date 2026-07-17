/**
 * STRESS 2 — the vectors most likely to break a hash-chained record.
 *
 * Each case tries to make LODESTAR either lose data, lie, or fall over.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../dist/storage/db.js'
import { SqliteEventStore } from '../dist/storage/event-store.js'
import { paths } from '../dist/core/project.js'
import { canonicalJSON, chainHash, GENESIS_HASH } from '../dist/core/hash.js'
import { evaluate } from '../dist/facts/index.js'
import { makeIgnoreMatcher, isLodestarPath } from '../dist/recorder/ignore.js'
import { classifyCommand } from '../dist/recorder/classify.js'
import { SnapshotStore, looksBinary } from '../dist/recorder/snapshots.js'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  PASS' : '  FAIL <<<'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function project() {
  const root = mkdtempSync(join(tmpdir(), 'stress-adv-'))
  mkdirSync(paths(root).sessions, { recursive: true })
  writeFileSync(paths(root).config, JSON.stringify({ version: 1, recording: true, watch: [], ignore: [], maxOutputBytes: 8192, sessionEndSummary: false }))
  return root
}
function store(root) {
  const db = openDatabase(paths(root).db)
  return { db, s: new SqliteEventStore(db) }
}
const ev = (sessionId, over = {}) => ({
  id: randomUUID(), sessionId, ts: new Date().toISOString(), monotonicTs: 0,
  source: 'process', signalTier: 'groundTruth', kind: 'process.exit',
  actor: { kind: 'agent', runtimeId: 'stress' },
  payload: { command: 'npm test', exitCode: 1, durationMs: 1 }, ...over,
})

// ===========================================================================
console.log('\n=== UNICODE / HOSTILE STRINGS ===')
// ===========================================================================
{
  const root = project()
  const { db, s } = store(root)
  const sess = s.createSession({ runtimeId: 'x', cwd: root })

  const nasty = [
    'файл.ts', '文件.ts', '🔥emoji🔥.ts', 'a\u0000b.ts', "it's.ts", 'sp ace.ts',
    'quote".ts', 'back\\slash.ts', 'new\nline.ts', 'tab\there.ts', 'a'.repeat(300) + '.ts',
    '../escape.ts', '%2e%2e.ts', '$(whoami).ts', '`id`.ts', '‮reversed.ts',
  ]
  let ok = true, why = ''
  for (const n of nasty) {
    try {
      s.append(ev(sess.id, {
        kind: 'file.write', source: 'fs',
        target: { raw: n, resolved: `/p/${n}`, kind: 'file', inScope: true },
        payload: { path: n },
      }))
    } catch (e) { ok = false; why = `${n}: ${e.message}`; break }
  }
  const v = s.verify(sess.id)
  check('hostile filenames survive the chain', ok && v.intact, why || v.reason || '')

  // Round-trip fidelity: what went in must come out byte-identical, or the hash lied.
  const read = s.query({ sessionId: sess.id }).filter(e => e.kind === 'file.write')
  const roundTrip = read.every((e, i) => e.payload.path === nasty[i])
  check('hostile filenames round-trip byte-identical', roundTrip)
  db.close()
}
{
  // Canonicalization must be stable for unicode and key order, or old chains stop verifying.
  const a = canonicalJSON({ b: '文件', a: '🔥', c: { z: 1, y: 'ß' } })
  const b = canonicalJSON({ c: { y: 'ß', z: 1 }, a: '🔥', b: '文件' })
  check('canonicalJSON stable across key order + unicode', a === b)

  const h1 = chainHash(GENESIS_HASH, { x: 'é' })
  const h2 = chainHash(GENESIS_HASH, { x: 'é' })
  check('chainHash deterministic for unicode', h1 === h2)

  // A one-character change must change the hash. If not, tampering is undetectable.
  const h3 = chainHash(GENESIS_HASH, { x: 'e' })
  check('chainHash sensitive to 1-char change', h1 !== h3)
}

// ===========================================================================
console.log('\n=== TAMPER DETECTION AT VOLUME ===')
// ===========================================================================
{
  const root = project()
  const { db, s } = store(root)
  const sess = s.createSession({ runtimeId: 'x', cwd: root })
  const N = 2000
  for (let i = 0; i < N; i++) s.append(ev(sess.id, { monotonicTs: i }))

  const t0 = Date.now()
  const clean = s.verify(sess.id)
  const verifyMs = Date.now() - t0
  check(`${N}-event chain verifies`, clean.intact && clean.eventsChecked === N, `${verifyMs}ms`)
  // status runs verify on every invocation; if this is slow the command feels broken.
  check('verify at 2k events is fast enough for `status`', verifyMs < 2000, `${verifyMs}ms`)

  // Tamper deep in the middle where it is least likely to be noticed.
  db.exec('DROP TRIGGER events_no_update')
  db.prepare('UPDATE events SET payload = ? WHERE seq = ?').run(JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 1 }), 1000)
  const broken = s.verify(sess.id)
  check('tamper at event 1000/2000 detected', !broken.intact && broken.brokenAt === 1000, broken.reason ?? '')
  db.close()
}
{
  // The subtle attack: rewrite the event AND recompute its own hash so it is
  // self-consistent. The chain must still break at the NEXT link.
  const root = project()
  const { db, s } = store(root)
  const sess = s.createSession({ runtimeId: 'x', cwd: root })
  for (let i = 0; i < 50; i++) s.append(ev(sess.id, { monotonicTs: i }))

  const victim = s.query({ sessionId: sess.id })[24]
  const forged = { ...victim, payload: { command: 'npm test', exitCode: 0, durationMs: 1 } }
  const { hash: _drop, ...body } = forged
  const selfConsistent = chainHash(victim.prevHash, {
    id: body.id, sessionId: body.sessionId, seq: body.seq, ts: body.ts, monotonicTs: body.monotonicTs,
    source: body.source, signalTier: body.signalTier, kind: body.kind, actor: body.actor,
    target: body.target ?? null, effectClass: body.effectClass ?? null, blastRadius: body.blastRadius ?? null,
    reversible: body.reversible ?? null, taint: body.taint ?? null, missionId: body.missionId ?? null,
    payload: body.payload, snapshotRef: body.snapshotRef ?? null, prevHash: body.prevHash,
  })
  db.exec('DROP TRIGGER events_no_update')
  db.prepare('UPDATE events SET payload = ?, hash = ? WHERE seq = ?').run(JSON.stringify(forged.payload), selfConsistent, 25)
  const r = s.verify(sess.id)
  check('self-consistent forgery still breaks the chain', !r.intact, r.reason ?? '')
  db.close()
}

// ===========================================================================
console.log('\n=== SNAPSHOT STORE ===')
// ===========================================================================
{
  const root = project()
  const snaps = new SnapshotStore(paths(root).sessions, 1024)

  const big = join(root, 'big.bin')
  writeFileSync(big, Buffer.alloc(5 * 1024 * 1024, 7))
  const s1 = snaps.putFile(big)
  check('5MB file recorded as oversized, no blob', s1?.oversized === true && !s1?.ref)

  const bin = join(root, 'x.bin')
  writeFileSync(bin, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  const s2 = snaps.putFile(bin)
  check('binary detected', s2?.binary === true)

  const empty = join(root, 'empty.ts')
  writeFileSync(empty, '')
  const s3 = snaps.putFile(empty)
  check('empty file handled', s3?.bytes === 0 && !!s3?.ref)

  check('missing file returns null, not a lie', snaps.putFile(join(root, 'nope.ts')) === null)
  check('binary heuristic ignores pure text', looksBinary(Buffer.from('const x = 1')) === false)

  // Dedup: same content stored twice must not double the disk.
  const r1 = snaps.putContent(Buffer.from('same'))
  const r2 = snaps.putContent(Buffer.from('same'))
  check('content-addressed dedup', r1 === r2)
}

// ===========================================================================
console.log('\n=== IGNORE MATCHER (the feedback-loop guard) ===')
// ===========================================================================
{
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj'
  const m = makeIgnoreMatcher(root, [])
  // If ANY of these regress, LODESTAR records its own DB writes and loops forever.
  check('.lodestar/lodestar.db ignored', m(join(root, '.lodestar', 'lodestar.db')))
  check('.lodestar/*-wal ignored', m(join(root, '.lodestar', 'lodestar.db-wal')))
  check('.lodestar/shims ignored', m(join(root, '.lodestar', 'shims', 'npm')))
  check('deep .lodestar ignored', m(join(root, 'a', 'b', '.lodestar', 'x')))
  check('real source NOT ignored', !m(join(root, 'src', 'auth.ts')))
  check('unicode source NOT ignored', !m(join(root, 'src', '文件.ts')))
  check('lookalike NOT ignored', !m(join(root, 'src', 'distributed.ts')))
  check('outside root ignored', m(join(root, '..', 'other', 'x.ts')))
  check('isLodestarPath is segment-exact', isLodestarPath('.lodestar/db') && !isLodestarPath('src/my.lodestar.ts'))
}

// ===========================================================================
console.log('\n=== CLASSIFIER: unknown must stay unknown ===')
// ===========================================================================
{
  check('rm -rf irreversible', classifyCommand('rm -rf /tmp/x').reversible === false)
  check('git push --force irreversible', classifyCommand('git push --force').reversible === false)
  check('npm test reversibility UNKNOWN', classifyCommand('npm test').reversible === undefined)
  check('gibberish reversibility UNKNOWN', classifyCommand('frobnicate --wibble').reversible === undefined)
  check('empty command does not throw', (() => { try { classifyCommand(''); return true } catch { return false } })())
  check('1MB command string does not hang', (() => {
    const t = Date.now(); classifyCommand('x '.repeat(500_000)); return Date.now() - t < 3000
  })())
}

// ===========================================================================
console.log('\n=== FACTS: no false positives ===')
// ===========================================================================
{
  const root = project()
  const { db, s } = store(root)
  const sess = s.createSession({ runtimeId: 'x', cwd: root })

  // 500 passing runs, zero failures. Must produce zero facts.
  for (let i = 0; i < 500; i++) s.append(ev(sess.id, { payload: { command: 'npm test', exitCode: 0, durationMs: 1 } }))
  check('500 passing runs produce NO facts', evaluate(s, sess.id).length === 0)

  // Narration screaming failure must still produce nothing.
  s.append(ev(sess.id, { source: 'stdio', signalTier: 'narration', kind: 'agent.output', payload: { text: 'TESTS FAILED! Everything is broken! exit code 1!' } }))
  check('narration cannot create a fact', evaluate(s, sess.id).length === 0)

  // A real failure must produce exactly one.
  s.append(ev(sess.id, { payload: { command: 'pytest', exitCode: 2, durationMs: 1 } }))
  const facts = evaluate(s, sess.id)
  check('one real failure -> exactly one fact', facts.length === 1 && facts[0].id === 'RF-01', `${facts.length} facts`)
  check('fact evidence is never agent_message', facts.every(f => f.evidence.every(e => e.source !== 'agent_message')))
  db.close()
}

// ===========================================================================
console.log('\n=== MANY SESSIONS ===')
// ===========================================================================
{
  const root = project()
  const { db, s } = store(root)
  const ids = []
  for (let i = 0; i < 200; i++) {
    const sess = s.createSession({ runtimeId: 'x', cwd: root })
    ids.push(sess.id)
    for (let j = 0; j < 5; j++) s.append(ev(sess.id))
  }
  check('200 sessions numbered uniquely', new Set(s.listSessions(500).map(x => x.number)).size === 200)
  check('every session chain independently intact', ids.every(id => s.verify(id).intact))
  // Chains must not bleed into each other.
  const first = s.query({ sessionId: ids[0] })
  check('sessions isolated (each starts at genesis)', first[0].prevHash === GENESIS_HASH && first[0].seq === 1)
  db.close()
}

// ===========================================================================
const failed = results.filter(r => !r.pass)
console.log(`\n${'='.repeat(60)}`)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
}
process.exit(failed.length ? 1 : 0)
