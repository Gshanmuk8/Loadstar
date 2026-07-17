// A single concurrent writer. Spawned N times against ONE session.
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const dist = (p) => pathToFileURL(resolve(process.argv[2], p)).href
const { openDatabase } = await import(dist('dist/storage/db.js'))
const { SqliteEventStore } = await import(dist('dist/storage/event-store.js'))

const [, , , dbPath, sessionId, n, kind] = process.argv
const db = openDatabase(dbPath)
const store = new SqliteEventStore(db)

let ok = 0
let err = 0
const errors = []
for (let i = 0; i < Number(n); i++) {
  try {
    store.append({
      id: randomUUID(),
      sessionId,
      ts: new Date().toISOString(),
      monotonicTs: i,
      source: 'process',
      signalTier: 'groundTruth',
      kind: kind === 'file' ? 'file.write' : 'process.exit',
      actor: { kind: 'agent', runtimeId: 'stress' },
      target:
        kind === 'file'
          ? { raw: `f${i}.ts`, resolved: `/p/f${i}.ts`, kind: 'file', inScope: true }
          : undefined,
      payload:
        kind === 'file'
          ? { path: `f${i}.ts` }
          : { command: 'npm test', exitCode: i % 2, durationMs: 1 },
    })
    ok++
  } catch (e) {
    err++
    if (errors.length < 3) errors.push(String(e?.message ?? e))
  }
}
db.close()
process.stdout.write(JSON.stringify({ ok, err, errors }))
