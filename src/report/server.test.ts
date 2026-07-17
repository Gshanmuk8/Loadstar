/**
 * The local report server — D-054, D-055.
 *
 * These run a real HTTP server and make real requests. A mocked server would prove nothing
 * about the two properties that matter here, both of which are about the *socket*:
 *
 *   1. It binds **127.0.0.1** and nothing else.
 *   2. It never fails with "port in use" at the magic moment.
 *
 * The first is a security property. The report contains the developer's source diffs,
 * command lines, file paths, and mission text — by construction, since that is the
 * product. Binding 0.0.0.0 would publish all of it to every machine on the network, and
 * "the report server was only meant for localhost" is not a sentence a trust company
 * survives saying.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { writeConfig } from '../core/config.js'
import { paths } from '../core/project.js'
import { serveReport, exportHtml, type RunningServer } from './server.js'
import { buildReport } from '../facts/report.js'
import { esc } from './html.js'
import type { EventKind, EventTarget } from '../types/events.js'

let root: string
let running: RunningServer | null = null
let clock = 0

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lodestar-serve-'))
  const p = paths(root)
  mkdirSync(p.sessions, { recursive: true })
  writeConfig(p.config)
  openDatabase(p.db).close()
  clock = 0
})

afterEach(async () => {
  if (running) await running.close()
  running = null
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* windows handles */
  }
})

function withStore<T>(fn: (s: SqliteEventStore) => T): T {
  const db = openDatabase(paths(root).db)
  try {
    return fn(new SqliteEventStore(db))
  } finally {
    db.close()
  }
}

function seed(): string {
  return withStore((store) => {
    const s = store.createSession({ runtimeId: 'claude-code', cwd: root, mission: 'Build auth' })
    const app = (kind: EventKind, payload: unknown, target?: EventTarget): void => {
      store.append({
        id: randomUUID(),
        sessionId: s.id,
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
        monotonicTs: clock * 1000,
        source: 'process',
        signalTier: 'groundTruth',
        kind,
        actor: { kind: 'agent', runtimeId: 'claude-code' },
        payload,
        ...(target ? { target } : {}),
      })
    }
    app('session.start', { runtimeId: 'claude-code', cwd: root, argv: [] })
    app('process.exit', { command: 'npm test', exitCode: 1, durationMs: 5 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    app('session.end', { exitCode: 0, durationMs: 10 })
    return s.id
  })
}

const get = async (url: string): Promise<{ status: number; body: string; headers: Headers }> => {
  const res = await fetch(url)
  return { status: res.status, body: await res.text(), headers: res.headers }
}

describe('the report server', () => {
  it('serves the latest session at /', async () => {
    const sessionId = seed()
    running = await serveReport({ root, open: false })

    const { status, body } = await get(running.url)
    expect(status).toBe(200)

    // The page says exactly what the model says — no more, no less.
    const expected = withStore((s) => buildReport(s, sessionId)!)
    for (const f of expected.facts) expect(body).toContain(esc(f.statement))
    expect(body).toContain(expected.integrity.status)
  })

  /**
   * The security property. Loopback, not "localhost resolves to loopback anyway".
   *
   * A server bound to 0.0.0.0 in a coffee shop hands the developer's source diffs to the
   * room. This asserts the actual bound address, because that is the only thing that
   * decides it.
   */
  it('binds 127.0.0.1 and nothing else', async () => {
    seed()
    running = await serveReport({ root, open: false })
    const addr = running.server.address() as AddressInfo
    expect(addr.address).toBe('127.0.0.1')
  })

  it('serves a specific session by number', async () => {
    seed()
    running = await serveReport({ root, open: false })
    const { status, body } = await get(`${running.url}/session/1`)
    expect(status).toBe(200)
    expect(body).toContain('session #001')
  })

  it('404s a session that does not exist, without inventing an empty report', async () => {
    seed()
    running = await serveReport({ root, open: false })
    const { status, body } = await get(`${running.url}/session/999`)
    expect(status).toBe(404)
    expect(body).toContain('No session #999')
    // A missing session must not render as a clean one.
    expect(body).not.toContain('No divergences observed')
  })

  it('404s an unknown path', async () => {
    seed()
    running = await serveReport({ root, open: false })
    expect((await get(`${running.url}/../../etc/passwd`)).status).toBe(404)
    expect((await get(`${running.url}/admin`)).status).toBe(404)
  })

  /**
   * USER-FLOW §6 is explicit: the magic moment must not open with EADDRINUSE. So the
   * server increments instead of failing — proven by occupying the port first.
   */
  it('increments the port rather than failing when one is taken', async () => {
    seed()
    const blocker = createServer(() => {})
    await new Promise<void>((r) => blocker.listen(3999, '127.0.0.1', r))
    try {
      running = await serveReport({ root, port: 3999, open: false })
      expect(running.url).toBe('http://localhost:4000')
      expect((await get(running.url)).status).toBe(200)
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()))
    }
  })

  it('sends headers that match the page it serves', async () => {
    seed()
    running = await serveReport({ root, open: false })
    const { headers } = await get(running.url)

    // Regenerated per request: a cached page shows a state that is no longer true.
    expect(headers.get('cache-control')).toBe('no-store')
    // The page loads nothing external. The header turns that from a claim into a rule the
    // browser enforces.
    expect(headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('reflects a session recorded after the server started', async () => {
    seed()
    running = await serveReport({ root, open: false })
    expect((await get(running.url)).body).toContain('session #001')

    // The report is built per request from the ledger, so a session recorded in another
    // terminal appears on refresh. A snapshot taken at startup would go stale silently.
    withStore((store) => {
      const s = store.createSession({ runtimeId: 'claude-code', cwd: root, mission: null })
      store.append({
        id: randomUUID(),
        sessionId: s.id,
        ts: new Date().toISOString(),
        monotonicTs: 1,
        source: 'process',
        signalTier: 'groundTruth',
        kind: 'session.start',
        actor: { kind: 'agent', runtimeId: 'claude-code' },
        payload: { runtimeId: 'claude-code', cwd: root, argv: [] },
      })
    })

    expect((await get(running.url)).body).toContain('session #002')
  })

  it('serves a page with no sessions without pretending there is one', async () => {
    running = await serveReport({ root, open: false })
    const { status, body } = await get(running.url)
    expect(status).toBe(404)
    expect(body).toContain('No sessions recorded yet')
  })
})

describe('static export', () => {
  it('produces the same judgments as the server', async () => {
    const sessionId = seed()
    const exported = exportHtml(root)!
    const expected = withStore((s) => buildReport(s, sessionId)!)

    for (const f of expected.facts) expect(exported.html).toContain(esc(f.statement))
    expect(exported.html).toContain(expected.integrity.status)
    expect(exported.number).toBe(1)
  })

  it('is self-contained — no network, no server, no install', () => {
    seed()
    const { html } = exportHtml(root)!
    expect(html).not.toMatch(/src="https?:|href="https?:|@import|fetch\(/)
    // D-014: it must not link to a server that will not be there.
    expect(html).not.toContain('href="/session/')
  })

  it('returns null rather than an empty report when there is no session', () => {
    expect(exportHtml(root)).toBeNull()
  })
})
