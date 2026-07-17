/**
 * LODESTAR — the local report server.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND EVERY THING IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * It is `node:http`, it binds to **127.0.0.1**, it lives exactly as long as the command
 * you typed, and it serves HTML that was rendered before the request arrived.
 *
 * It is NOT a daemon, NOT a service, NOT an API, and NOT a step toward one. The V0
 * do-not-build list bans all three, and this file must never become the place they sneak
 * in. If you are about to add an endpoint that returns JSON for a client to interpret,
 * stop: that is a second renderer with its own opinions, which is D-049's whole subject.
 *
 * **Loopback only, and that is a security decision, not a default.** `server.listen(port,
 * '127.0.0.1')` — binding 0.0.0.0 would publish a developer's source diffs, command lines,
 * and file paths to every machine on the coffee-shop wifi. The report contains the
 * project's contents by construction; there is no version of exposing it that is safe.
 *
 * Rendering happens per request, from the ledger, so the page is never stale — a session
 * recorded in another terminal shows up on refresh.
 */

import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { SnapshotStore } from '../recorder/snapshots.js'
import { buildIndex, reportFromRecord, resolveDiff } from '../facts/report.js'
import { buildRecord, recordScriptTag, type EvidenceRecord } from '../record/index.js'
import { renderHtml, esc } from './html.js'
import { paths } from '../core/project.js'

/**
 * Carry the Evidence Record inside the page, inert.
 *
 * Every HTML surface embeds the canonical record it was rendered from (D-059): the
 * shared export becomes independently verifiable — the standalone verifier extracts
 * this block — and a saved dashboard page is the same artifact as an export. The
 * rendering above it is a courtesy; the record is the evidence.
 */
function withRecord(html: string, record: EvidenceRecord): string {
  const tag = recordScriptTag(record)
  const i = html.lastIndexOf('</body>')
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i)
}

export interface ServeOptions {
  root: string
  /** First port to try. Incremented on conflict — never fail with "port in use". */
  port?: number
  open?: boolean
}

export interface RunningServer {
  url: string
  close: () => Promise<void>
  server: Server
}

/**
 * Render one session's page, from the ledger, right now.
 *
 * The database is opened and closed per request. That is not an oversight: the recorder is
 * a separate process appending to the same file, and holding a long-lived handle here
 * risks lock contention with the thing whose job actually matters. A report server must
 * never be able to interfere with a recording session — that would be LODESTAR changing
 * the execution it exists to observe.
 */
function page(root: string, sessionNumber?: number): { status: number; html: string } {
  const db = openDatabase(paths(root).db)
  try {
    const store = new SqliteEventStore(db)
    const session =
      sessionNumber === undefined ? store.latestSession() : store.getSessionByNumber(sessionNumber)

    if (!session) {
      return {
        status: 404,
        html: shell(
          sessionNumber === undefined
            ? 'No sessions recorded yet.'
            : `No session #${esc(sessionNumber)}.`,
          'Record one with <code>lodestar claude</code>, then refresh.',
        ),
      }
    }

    const snapshots = new SnapshotStore(paths(root).sessions)
    const record = buildRecord(store, session.id)
    if (!record) return { status: 404, html: shell('That session could not be read.', '') }
    const report = reportFromRecord(record, { snapshots })

    return {
      status: 200,
      html: withRecord(
        renderHtml(report, {
          mode: 'server',
          index: buildIndex(store),
          diff: (c) => resolveDiff(c, snapshots),
          generatedAt: new Date().toISOString(),
        }),
        record,
      ),
    }
  } finally {
    db.close()
  }
}

/** The one page that is not a report: an error, in the same voice. */
function shell(headline: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>LODESTAR</title>
<style>body{background:#0f1115;color:#e6e9ef;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}
code{background:#1c212b;padding:2px 6px;border-radius:4px;font-size:13px}
p{color:#98a2b3;font-size:14px}</style></head>
<body><div><h1>${esc(headline)}</h1><p>${detail}</p></div></body></html>`
}

/** Open the user's browser. Best-effort: a failure here must never fail the command. */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // The URL is printed regardless. A browser that will not open is an inconvenience;
    // a crashed report command is a broken product.
  }
}

/**
 * Start the server.
 *
 * Port conflicts increment rather than fail. USER-FLOW §6 is explicit about this: the
 * magic moment must not open with "EADDRINUSE".
 */
export function serveReport(opts: ServeOptions): Promise<RunningServer> {
  const startPort = opts.port ?? 3000

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')

      // No route takes user input into the filesystem — there is no static directory to
      // traverse. Everything served is rendered from the ledger.
      const m = /^\/session\/(\d+)$/.exec(url.pathname)
      const wanted = m ? Number(m[1]) : undefined

      if (url.pathname !== '/' && !m) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
        res.end(shell('Not found.', 'Try <code>/</code>.'))
        return
      }

      try {
        const { status, html } = page(opts.root, wanted)
        res.writeHead(status, {
          'content-type': 'text/html; charset=utf-8',
          // The report is regenerated per request; a cached page would show a developer
          // a session state that is no longer true.
          'cache-control': 'no-store',
          // The page is entirely self-contained, so it needs nothing external. Saying so
          // costs one header and turns "we do not load remote code" from a claim into an
          // enforced property.
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
          'x-content-type-options': 'nosniff',
        })
        res.end(html)
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
        res.end(shell('The report could not be built.', esc(err instanceof Error ? err.message : String(err))))
      }
    })

    let port = startPort
    const tryListen = (): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 50) {
          port++
          tryListen()
          return
        }
        reject(err)
      })
      // 127.0.0.1, never 0.0.0.0. See the header.
      server.listen(port, '127.0.0.1', () => {
        const url = `http://localhost:${port}`
        if (opts.open !== false) openBrowser(url)
        resolve({
          url,
          server,
          close: () => new Promise<void>((r) => server.close(() => r())),
        })
      })
    }
    tryListen()
  })
}

/**
 * Render one session to a self-contained file — the growth loop (D-014).
 *
 * Same renderer, same model, same judgments. The only difference is `mode: 'export'`,
 * which drops links to sessions that no server will serve.
 */
export function exportHtml(root: string, sessionNumber?: number): { html: string; number: number } | null {
  const db = openDatabase(paths(root).db)
  try {
    const store = new SqliteEventStore(db)
    const session =
      sessionNumber === undefined ? store.latestSession() : store.getSessionByNumber(sessionNumber)
    if (!session) return null

    const snapshots = new SnapshotStore(paths(root).sessions)
    const record = buildRecord(store, session.id)
    if (!record) return null
    const report = reportFromRecord(record, { snapshots })

    return {
      html: withRecord(
        renderHtml(report, {
          mode: 'export',
          index: buildIndex(store),
          diff: (c) => resolveDiff(c, snapshots),
          generatedAt: new Date().toISOString(),
        }),
        record,
      ),
      number: session.number,
    }
  } finally {
    db.close()
  }
}
