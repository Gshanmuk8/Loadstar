/**
 * `lodestar report` — the magic moment.
 *
 * ---------------------------------------------------------------------------
 * THREE RENDERERS, ONE MODEL — D-049, D-054
 * ---------------------------------------------------------------------------
 *
 * Terminal, browser, and static file all call `buildReport()` and render what it returns.
 * Every judgment — which facts fired, what is degraded, why a diff is missing — is decided
 * in `facts/report.ts`. These files choose colours and line breaks.
 *
 * If you find yourself writing an `if` about *meaning* in a renderer, it belongs in the
 * model. That is not a style preference: three renderers with independent opinions is
 * three different answers to the only question this product exists to answer, and the one
 * the user believes is whichever they happened to open.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEFAULT DEPENDS ON WHETHER A HUMAN IS WATCHING — D-055
 * ---------------------------------------------------------------------------
 *
 * USER-FLOW §6 says this command opens a browser. PRODUCT-SPEC §5 says it prints a
 * terminal summary. Both are right, for different callers, and the caller tells us which
 * it is: `process.stdout.isTTY`.
 *
 *   A human at a terminal  → the dashboard. "Nobody wants to read terminal output daily."
 *   A pipe, a script, CI   → the terminal report, and a meaningful exit code.
 *
 * The alternative was a sixth command, which the five-command rule forbids without a
 * decision, and which would have made the browser — the actual magic moment — the thing
 * you have to know a second command to find.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findProjectRoot, paths } from '../../core/project.js'
import { openDatabase } from '../../storage/db.js'
import { SqliteEventStore } from '../../storage/event-store.js'
import { buildReport, type SessionReport } from '../../facts/report.js'
import { buildRecord, serializeRecord } from '../../record/index.js'
import { serveReport, exportHtml } from '../../report/server.js'
import { out, errOut, dim, bold, warn, red, yellow, green, cyan, formatWhen } from '../ui.js'
import { plural, wrapText, renderChanges, renderCommands, renderLimitations, renderOutcome, renderIntegrity } from '../render.js'
import { requireProject } from './shared.js'

export async function cmdReport(args: string[]): Promise<number> {
  const root = findProjectRoot()
  if (!root) return requireProject()

  const wanted = args.find((a) => /^\d+$/.test(a))
  const sessionNumber = wanted ? Number(wanted) : undefined

  // ---- canonical export: the Evidence Record itself, no rendering at all ----
  //
  // `--record` writes the artifact every surface derives from (D-059): canonical JSON,
  // content-addressed, verifiable by the standalone verifier with no LODESTAR installed.
  // This is a flag on `report`, not a sixth command — same rule as `--html` (D-012).
  const recIdx = args.indexOf('--record')
  if (recIdx !== -1) {
    const target = args[recIdx + 1] && !args[recIdx + 1]!.startsWith('-') ? args[recIdx + 1]! : null
    const db = openDatabase(paths(root).db)
    try {
      const store = new SqliteEventStore(db)
      const session =
        sessionNumber !== undefined ? store.getSessionByNumber(sessionNumber) : store.latestSession()
      if (!session) {
        errOut()
        errOut(warn(sessionNumber !== undefined ? `No session #${sessionNumber}.` : 'No sessions recorded yet.'))
        errOut()
        return 1
      }
      const record = buildRecord(store, session.id)
      if (!record) {
        errOut()
        errOut(warn('That session could not be read.'))
        errOut()
        return 1
      }
      const path = resolve(
        target ?? `lodestar-session-${String(session.number).padStart(3, '0')}.record.json`,
      )
      writeFileSync(path, serializeRecord(record), 'utf8')
      out()
      out(`  ${green('✓')} Evidence record written to ${bold(path)}`)
      out(dim(`    record ${record.recordId}`))
      out(dim('    Canonical, content-addressed, self-describing. Verify it anywhere with the'))
      // Point at what an npm user actually has: the verifier ships in the package; the
      // spec lives in the repo. `docs/RECORD-SPEC.md` is a path only a repo clone has.
      out(dim('    standalone verifier that ships with this package (verifier/lodestar-verify.mjs).'))
      out(dim('    Spec: https://github.com/Gshanmuk8/Loadstar'))
      out()
      // Same contract as the terminal report: a broken chain must be visible to scripts.
      return record.evidence.integrity.status === 'BROKEN' ? 2 : 0
    } finally {
      db.close()
    }
  }

  // ---- static export: same model, same renderer, no server ------------------
  const htmlIdx = args.indexOf('--html')
  if (htmlIdx !== -1) {
    const target = args[htmlIdx + 1] && !args[htmlIdx + 1]!.startsWith('-') ? args[htmlIdx + 1]! : null
    const result = exportHtml(root, sessionNumber)
    if (!result) {
      errOut()
      errOut(warn(sessionNumber ? `No session #${sessionNumber}.` : 'No sessions recorded yet.'))
      errOut()
      return 1
    }
    const path = resolve(target ?? `lodestar-session-${String(result.number).padStart(3, '0')}.html`)
    writeFileSync(path, result.html, 'utf8')
    out()
    out(`  ${green('✓')} Report written to ${bold(path)}`)
    out(dim('    Self-contained. Anyone can open it — no install, no server, no network.'))
    out()
    return 0
  }

  const wantsTerminal = args.includes('--terminal') || args.includes('-t')
  const wantsBrowser = args.includes('--open')

  // A TTY means a human is watching, so give them the dashboard. A pipe means a program is
  // reading, so give it the terminal report and an exit code it can branch on. `--terminal`
  // and `--open` override in either direction.
  const useBrowser = wantsBrowser || (!wantsTerminal && Boolean(process.stdout.isTTY))

  if (useBrowser) return serve(root, sessionNumber)

  return terminalReport(root, sessionNumber)
}

async function serve(root: string, sessionNumber?: number): Promise<number> {
  try {
    const { url } = await serveReport({ root, open: true })
    out()
    out(`  ${bold('LODESTAR')} report`)
    out()
    out(`  ${cyan(sessionNumber !== undefined ? `${url}/session/${sessionNumber}` : url)}`)
    out()
    out(dim('  Opening your browser. Press Ctrl-C to stop.'))
    out(dim('  Piping this command instead prints a terminal report: lodestar report --terminal'))
    out()

    // Hold the process open. The server dies with the command — there is no daemon here,
    // and there is not going to be one.
    await new Promise<void>(() => {})
    return 0
  } catch (err) {
    errOut()
    errOut(warn(`Could not start the report server: ${err instanceof Error ? err.message : String(err)}`))
    errOut(dim('  Falling back to the terminal report.'))
    return terminalReport(root, sessionNumber)
  }
}

function terminalReport(root: string, sessionNumber?: number): number {
  const db = openDatabase(paths(root).db)
  try {
    const store = new SqliteEventStore(db)
    const wanted = sessionNumber !== undefined ? String(sessionNumber) : undefined
    const session = wanted ? store.getSessionByNumber(Number(wanted)) : store.latestSession()

    if (!session) {
      out()
      out(warn(wanted ? `No session #${wanted}.` : 'No sessions recorded yet.'))
      out()
      out(dim('  Record one:'))
      out(dim('    lodestar claude'))
      out()
      return 1
    }

    const report = buildReport(store, session.id)
    if (!report) {
      out()
      out(warn('That session could not be read.'))
      out()
      return 1
    }

    render(report)

    // A broken chain is not a successful report. Anything scripting this command must be
    // able to learn that from the exit code alone, without parsing our prose.
    return report.integrity.status === 'BROKEN' ? 2 : 0
  } finally {
    db.close()
  }
}

function render(r: SessionReport): void {
  const { session } = r

  out()
  out(
    `${bold('LODESTAR')}  session #${String(session.number).padStart(3, '0')}  ${dim('·')}  ` +
      `${session.runtimeId}  ${dim('·')}  ${formatWhen(session.startedAt)}`,
  )
  if (session.mission) out(dim(`  ${session.mission}`))
  out()
  out(
    dim(
      `  ${plural(r.counts.events, 'event')}  ·  ${plural(r.counts.commands, 'command')}  ·  ` +
        `${plural(r.counts.filesChanged, 'file')} changed`,
    ),
  )

  renderVerdict(r)
  renderFacts(r)
  renderCommands(r)
  renderChanges(r)
  renderLimitations(r)
  renderInterference(r)
  renderOutcome(r)
  renderIntegrity(r)

  out()
  out(dim('  lodestar report --open      browse this in a dashboard'))
  out(dim('  lodestar report --html      export a shareable, self-contained file'))
  out(dim('  lodestar report --record    export the canonical evidence record (verifiable JSON)'))
  out(dim('  lodestar status             verify the record'))
  out()
}

/**
 * The verdict line — the same two-axis answer the dashboard shows (D-058), from the same
 * model. Terminal and browser must never word the verdict differently, so both read
 * `r.verdict`; neither composes its own.
 */
function renderVerdict(r: SessionReport): void {
  const { finding, coverage } = r.verdict
  const paint = (tone: string, s: string) =>
    tone === 'bad' ? red(s) : tone === 'warn' ? yellow(s) : green(s)
  const mark = finding.tone === 'bad' ? '✗' : finding.tone === 'warn' ? '▪' : '✓'
  out()
  out(`  ${paint(finding.tone, `${mark} ${bold(finding.text)}`)}`)
  if (coverage) out(`    ${paint(coverage.tone, coverage.text)}`)
  else out(`    ${yellow('This record was altered after it was written.')}`)
}

/**
 * Reality Facts lead the report. PRODUCT-SPEC §4: "Reality Facts lead — terminal summary
 * and HTML, top of the page."
 *
 * The empty case is the one that matters most and is the easiest to get wrong. "No
 * divergences observed" is a true sentence; "everything is fine" is not one we can say,
 * because we only ever saw what the boundary let us see. The wording keeps the subject as
 * *what LODESTAR observed*, never as *what happened* — and the limitations block that
 * follows is what stops the distinction from being a word game.
 */
function renderFacts(r: SessionReport): void {
  out()

  // Switch on the verdict, never on `facts.length` (D-053). An empty list means two
  // opposite things — "we looked and found nothing" and "this record was rewritten, so the
  // list is meaningless" — and only the model knows which. This block used to print a
  // green all-clear for both, so a successful forgery was greeted with a ✓.
  if (r.factsVerdict === 'record-untrustworthy') {
    out(`  ${red('✗')} ${bold('No facts can be reported from this record.')}`)
    out(dim('    The chain does not verify — see BROKEN below. Any fact computed from these'))
    out(dim('    bytes would be a claim about a record that was altered after it was written.'))
    out()
    return
  }

  if (r.factsVerdict === 'none-observed') {
    out(`  ${green('✓')} No divergences observed.`)
    if (r.limitations.length || r.integrity.degraded.length) {
      out(dim('    Read the limitations below before treating that as all-clear.'))
    }
    out()
    return
  }

  out(bold(`  Divergences (${r.facts.length})`))
  out()
  for (const v of r.views) {
    // The title, then the statement, then the chain — the same shape the dashboard uses,
    // because it comes from the same `views` (D-056). When this file rendered
    // `f.statement` and the browser rendered `v.title`, the two surfaces gave the same
    // session two different headlines. That is the drift D-049 exists to prevent, and it
    // took one afternoon to appear.
    out(`  ${yellow('▪')} ${bold(v.title)}`)
    out(dim(`    ${v.fact.statement}`))
    out()
    for (const s of v.steps) {
      const glyph =
        s.state === 'consequence'
          ? yellow('⚠')
          : /exited with code [1-9]|terminated by/.test(s.text)
            ? red('✗')
            : green('✓')
      const text = s.state === 'consequence' ? yellow(s.text) : s.text
      const at = s.ts ? dim(`  ${new Date(s.ts).toLocaleTimeString()}`) : ''
      out(`      ${glyph} ${text}${at}`)
    }
    out()
    // Evidence, always. A fact without a visible pointer is an assertion, and this
    // product does not make assertions. PRODUCT-SPEC §4, bar 4.
    out(dim(`    ${v.fact.id} · confidence: ${v.fact.confidence} · ${formatWhen(v.fact.ts)}`))
    for (const ev of v.fact.evidence) {
      const resolved = r.evidence[ev.eventId]
      out(
        dim(
          resolved
            ? `      └ ${cyan(`#${resolved.seq}`)} ${resolved.summary}`
            : `      └ ${cyan(`#${ev.eventSeq}`)} ${ev.source} (event not found in record)`,
        ),
      )
    }
    // Assumptions travel WITH the fact (D-058), the same as on the dashboard card. A caveat
    // in a distant block reads as boilerplate; here it qualifies the conclusion it belongs to.
    for (const a of v.assumptions) out(dim(`    ${yellow('assumes')} ${a}`))
    out()
  }
}

// renderLimitations moved to ../render.ts (D-073): the DEGRADED integrity line points
// at the Limitations block, so every command that prints one must print the other.

/** LODESTAR's own footprint, surfaced beside the facts and never subtracted from them (D-039). */
function renderInterference(r: SessionReport): void {
  if (!r.interference.length) return

  out(bold('  LODESTAR interference'))
  out(dim('  We changed this session. Failures caused by us are not the agent\'s.'))
  out()
  for (const n of r.interference) out(`  ${yellow('!')} ${wrapText(n, 4)}`)
  out()
}

// renderIntegrity, plural, and wrapText moved to ../render.ts (D-073): replay and
// explain print the same sections, and two wordings of one judgment is the drift
// D-049 exists to prevent.
