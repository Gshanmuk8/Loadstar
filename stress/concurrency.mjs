/**
 * STRESS 1 — many OS processes appending to ONE hash chain simultaneously.
 *
 * This is the Phase 6 `BEGIN IMMEDIATE` path. Shims are separate processes; if this is
 * wrong, the chain forks or events vanish, and both failures are silent.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase } from '../dist/storage/db.js'
import { SqliteEventStore } from '../dist/storage/event-store.js'
import { paths } from '../dist/core/project.js'

const REPO = resolve(import.meta.dirname, '..')
const WORKERS = Number(process.argv[2] ?? 12)
const PER_WORKER = Number(process.argv[3] ?? 40)

const root = mkdtempSync(join(tmpdir(), 'stress-conc-'))
mkdirSync(paths(root).sessions, { recursive: true })
writeFileSync(
  paths(root).config,
  JSON.stringify({ version: 1, recording: true, watch: [], ignore: [], maxOutputBytes: 8192, sessionEndSummary: false }),
)

const db = openDatabase(paths(root).db)
const session = new SqliteEventStore(db).createSession({ runtimeId: 'stress', cwd: root })
db.close()

console.log(`${WORKERS} concurrent processes x ${PER_WORKER} appends = ${WORKERS * PER_WORKER} events on one chain`)

const t0 = Date.now()
const procs = Array.from({ length: WORKERS }, (_, i) =>
  spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      join(REPO, 'stress', 'worker.mjs'),
      REPO,
      paths(root).db,
      session.id,
      String(PER_WORKER),
      i % 2 ? 'file' : 'proc',
    ],
    { encoding: 'utf8' },
  ),
)
const elapsed = Date.now() - t0

let ok = 0
let err = 0
let crashed = 0
const samples = []
for (const p of procs) {
  if (p.status !== 0) {
    crashed++
    if (samples.length < 2) samples.push((p.stderr || '').split('\n').slice(0, 3).join(' | '))
    continue
  }
  try {
    const r = JSON.parse(p.stdout)
    ok += r.ok
    err += r.err
    if (r.errors?.length && samples.length < 2) samples.push(...r.errors)
  } catch {
    crashed++
  }
}

const db2 = openDatabase(paths(root).db)
const s2 = new SqliteEventStore(db2)
const events = s2.query({ sessionId: session.id })
const verify = s2.verify(session.id)
db2.close()

const seqs = events.map((e) => e.seq)
const gapless = seqs.every((v, i) => v === i + 1)
const unique = new Set(seqs).size === seqs.length
const hashesUnique = new Set(events.map((e) => e.hash)).size === events.length

const pass =
  verify.intact && gapless && unique && hashesUnique && crashed === 0 && events.length === ok

console.log(
  JSON.stringify(
    {
      expected: WORKERS * PER_WORKER,
      appended_ok: ok,
      append_errors: err,
      crashed_workers: crashed,
      events_in_db: events.length,
      seq_gapless: gapless,
      seq_unique: unique,
      hashes_unique: hashesUnique,
      CHAIN_INTACT: verify.intact,
      verify_detail: verify.reason ?? 'ok',
      ms: elapsed,
      throughput_per_sec: Math.round((events.length / elapsed) * 1000),
      error_samples: samples,
    },
    null,
    2,
  ),
)
console.log(pass ? 'PASS' : 'FAIL <<<<<<<<<<')
process.exit(pass ? 0 : 1)
