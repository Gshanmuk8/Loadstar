/**
 * `lodestar graph` — the sixth command (D-062 ratified; D-012's rule satisfied by
 * decision, not exception).
 *
 * Subcommands: init · add · verify · reindex · query. This file renders; every
 * judgment — what verifies, how records group, what the coverage is — comes from
 * `src/graph/` and is shown verbatim. A renderer `if` about meaning is a bug here
 * exactly as it is in the session report (D-049).
 *
 * Simplicity choice, documented (M-V engineering §2.4): `add` ends with a FULL
 * reindex rather than an incremental insert. At validation-spike scale a rebuild is
 * milliseconds, and it makes "the index equals a rebuild" true by construction —
 * incremental indexing arrives later behind the same contract, proven by the same
 * determinism test.
 */

import { resolve } from 'node:path'
import {
  addFromProject,
  addLinkValue,
  addRecordFile,
  configureShare,
  findGraphRoot,
  GRAPH_DIRNAME,
  indexFreshness,
  initGraph,
  openGraph,
  queryCoverage,
  queryDivergences,
  queryFileHistory,
  queryLinks,
  queryRepoHistory,
  queryRepos,
  queryTimeline,
  reindex,
  reportJson,
  resolveRepoDisplayName,
  syncGraph,
  verifyGraph,
  type AddResult,
  type Graph,
} from '../../graph/index.js'
import { makeLink, repoAddress, KNOWN_LINK_TYPES } from '../../record/link.js'
import { userInfo } from 'node:os'
import { out, errOut, dim, bold, warn, fail, green, red, yellow, cyan } from '../ui.js'

function usage(): number {
  out()
  out(bold('lodestar graph') + ' — the organizational evidence graph (V1)')
  out()
  out('  lodestar graph init [dir]                create a graph (default ./.lodestar-graph)')
  out('  lodestar graph add <file...>             add exported records (.record.json or .html)')
  out('  lodestar graph add --from <project>      backfill every session of a V0 project')
  out('  lodestar graph verify                    verify every stored object; exit 2 on any failure')
  out('  lodestar graph reindex                   rebuild the derived index (always safe)')
  out('  lodestar graph query repos [--json]                     repo groups, bases, candidates, coverage')
  out('  lodestar graph query repo-history <repo> [--json]       every session in a repo, with citations')
  out('  lodestar graph query file-history <repo> <path> [--json] every observed change to one file')
  out('  lodestar graph query divergences [repo] [--rf RF-xx] [--json]  the fact timeline')
  out('  lodestar graph query timeline [--machine M] [--agent A] [--since ISO] [--until ISO] [--json]')
  out('  lodestar graph query coverage [--json]                  what this graph sees: first/last seen per machine, agent, repo')
  out('  lodestar graph query links [repo] [--json]              declared links (claims), attributed; retracted/dangling shown')
  out('  lodestar graph link <type> <from> <to> [--reason R] [--author A]   record a claim (identity:same-repo, relates-to, …)')
  out('  lodestar graph share <dir> [--create] | --git            configure the team share (local config)')
  out('  lodestar graph sync [--include-open]                     collect + pull + push, one command')
  out()
  out(dim('  --graph <dir>   use a specific graph instead of searching upward'))
  out()
  return 1
}

/**
 * `--graph <dir>` is a global flag: `graph --graph X verify` and
 * `graph verify --graph X` must both work — a positional-only global flag is a
 * usage papercut that reads as a broken tool. Extracted before dispatch.
 */
function extractGraphFlag(args: string[]): { rest: string[]; graphDir: string | null } {
  const rest: string[] = []
  let graphDir: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--graph' && args[i + 1]) {
      graphDir = args[i + 1]!
      i++
      continue
    }
    rest.push(args[i]!)
  }
  return { rest, graphDir }
}

function requireGraph(graphDir: string | null): Graph | null {
  try {
    if (graphDir) return openGraph(graphDir)
    const found = findGraphRoot(process.cwd())
    if (!found) {
      errOut()
      errOut(warn('No evidence graph found (searched upward for .lodestar-graph).'))
      errOut(dim('  Create one:  lodestar graph init'))
      errOut()
      return null
    }
    return openGraph(found)
  } catch (err) {
    errOut(fail(err instanceof Error ? err.message : String(err)))
    return null
  }
}

export async function cmdGraph(args: string[]): Promise<number> {
  const { rest, graphDir } = extractGraphFlag(args)
  const [sub, ...subArgs] = rest
  switch (sub) {
    case 'init':
      return init(subArgs, graphDir)
    case 'add':
      return add(subArgs, graphDir)
    case 'link':
      return link(subArgs, graphDir)
    case 'share':
      return share(subArgs, graphDir)
    case 'sync':
      return sync(subArgs, graphDir)
    case 'verify':
      return verify(graphDir)
    case 'reindex':
      return doReindex(graphDir)
    case 'query':
      return query(subArgs, graphDir)
    default:
      return usage()
  }
}

function share(args: string[], graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1
  const wantsGit = args.includes('--git')
  const target = wantsGit ? '--git' : args.find((a) => !a.startsWith('-'))
  if (!target) return usage()
  try {
    const cfg = configureShare(graph, target, { create: args.includes('--create') })
    out()
    out(
      `  ${green('✓')} Sharing configured: ` +
        (cfg.type === 'path' ? `path share at ${bold(cfg.target)}` : `git remote ${bold(cfg.remote)}`),
    )
    out(dim('    One command from now on:  lodestar graph sync'))
    out(dim('    The share target is local configuration — teammates set their own.'))
    out()
    return 0
  } catch (err) {
    errOut(fail(err instanceof Error ? err.message : String(err)))
    return 1
  }
}

function sync(args: string[], graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1
  const report = syncGraph(graph, args.includes('--include-open') ? { includeOpen: true } : {})

  out()
  if (report.collectedFrom) {
    const added = report.collected.filter((r) => r.status === 'added').length
    const dup = report.collected.filter((r) => r.status === 'duplicate').length
    const open = report.collected.filter((r) => r.status === 'skipped-open').length
    out(
      `  ${green('✓')} collected from ${dim(report.collectedFrom)} — ${added} sealed, ${dup} already present` +
        (open ? dim(`, ${open} still-open session(s) skipped (--include-open to seal anyway)`) : ''),
    )
    for (const r of report.collected.filter((x) => x.status === 'refused')) renderAddResult(r)
  } else {
    out(dim('  no V0 project here — nothing to collect'))
  }

  if (report.transport !== 'none') {
    out(`  ${green('✓')} pulled ${report.pulled.length} · pushed ${report.pushed.length} ${dim(`via ${report.transport}`)}`)
  }
  for (const r of report.refusedFromRemote) {
    out(`  ${red('✗')} refused from share ${dim(r.source)}`)
    for (const e of r.errors ?? []) out(dim(`      ${e}`))
  }
  for (const w of report.warnings) out(warn(`  ${w}`))
  out()
  return report.ok ? 0 : 1
}

function init(args: string[], graphDir: string | null): number {
  const target = resolve(graphDir ?? args.find((a) => !a.startsWith('-')) ?? GRAPH_DIRNAME)
  try {
    const graph = initGraph(target)
    out()
    out(`  ${green('✓')} Evidence graph created at ${bold(graph.root)}`)
    out(dim('    Add records:      lodestar graph add <file.record.json | report.html>'))
    out(dim('    Backfill history: lodestar graph add --from <project>'))
    out(dim('    The graph is a plain directory — sync it with git, a share, anything.'))
    out()
    return 0
  } catch (err) {
    errOut(fail(err instanceof Error ? err.message : String(err)))
    return 1
  }
}

function renderAddResult(r: AddResult): void {
  if (r.status === 'added') out(`  ${green('✓')} added     ${cyan(r.recordId!.slice(0, 16))}…  ${dim(r.source)}`)
  else if (r.status === 'duplicate')
    out(`  ${dim('=')} duplicate ${cyan(r.recordId!.slice(0, 16))}…  ${dim(r.source)}`)
  else if (r.status === 'skipped-open')
    out(`  ${dim('…')} still open ${dim(`${r.source} — session has no end event; --include-open seals it anyway`)}`)
  else {
    out(`  ${red('✗')} refused   ${dim(r.source)}`)
    for (const e of r.errors ?? []) out(dim(`      ${e}`))
  }
}

function add(args: string[], graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1

  const fromIdx = args.indexOf('--from')
  const results: AddResult[] = []

  out()
  if (fromIdx !== -1) {
    const project = args[fromIdx + 1]
    if (!project) {
      errOut(fail('--from needs a project directory'))
      return 1
    }
    try {
      results.push(...addFromProject(graph, project))
    } catch (err) {
      errOut(fail(err instanceof Error ? err.message : String(err)))
      return 1
    }
    if (!results.length) out(warn('  No sessions found in that project.'))
  } else {
    const files = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '--from')
    if (!files.length) return usage()
    for (const f of files) results.push(addRecordFile(graph, resolve(f)))
  }

  for (const r of results) renderAddResult(r)

  const added = results.filter((r) => r.status === 'added').length
  const dup = results.filter((r) => r.status === 'duplicate').length
  const refused = results.filter((r) => r.status === 'refused').length
  out()
  out(dim(`  ${added} added · ${dup} duplicate · ${refused} refused`))

  if (added) {
    // Full rebuild on purpose — see the file header. The index can never drift from
    // "what a rebuild would say" because it always IS a rebuild.
    const { records, unreadable } = reindex(graph)
    out(dim(`  index rebuilt · ${records} records${unreadable ? ` · ${unreadable} unreadable (disclosed in queries)` : ''}`))
  }
  out()
  return refused ? 1 : 0
}

/**
 * `graph link <type> <from> <to>` — record a declared claim (M4).
 *
 * A link is a CLAIM, never an observation: it re-groups repos (identity types) or
 * organizes evidence (the rest), and it can never enter a fact (P5). The author is
 * an unauthenticated string (signing is V2). Identity endpoints are resolved to a
 * single repo group at authoring time, so an ambiguous or unknown endpoint is
 * refused here rather than baked into a stored, misleading object.
 */
function link(args: string[], graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1

  const flagValue = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }
  const VALUE_FLAGS = ['--reason', '--author']
  const positional = args.filter(
    (a, i) => !a.startsWith('-') && !VALUE_FLAGS.includes(args[i - 1] ?? ''),
  )
  const [type, from, to] = positional
  if (!type || !from || !to) {
    errOut(fail('usage: lodestar graph link <type> <from> <to> [--reason R] [--author A]'))
    errOut(dim(`  known types: ${KNOWN_LINK_TYPES.join(', ')} (or x-<ns>:<type>)`))
    errOut(dim('  identity:same-repo / identity:distinct-repos take two repo signals;'))
    errOut(dim('  retracts takes a link address (evidence:link/<id>) as <to>.'))
    return 1
  }

  let author = flagValue('--author')
  if (!author) {
    try {
      author = userInfo().username || 'unknown'
    } catch {
      author = 'unknown'
    }
  }
  const reason = flagValue('--reason') ?? ''
  // A real wall clock — a link is a human act, stated, never proven (like a record's ts).
  const ts = new Date().toISOString()

  const isIdentity = type === 'identity:same-repo' || type === 'identity:distinct-repos'
  let fromAddr = from
  let toAddr = to
  if (isIdentity) {
    try {
      fromAddr = repoAddress(resolveRepoDisplayName(graph, from))
      toAddr = repoAddress(resolveRepoDisplayName(graph, to))
    } catch (err) {
      errOut(fail(err instanceof Error ? err.message : String(err)))
      return 1
    }
  }

  const built = makeLink({ author, ts, type, from: fromAddr, to: toAddr, reason })
  const result = addLinkValue(graph, built, 'graph link')

  out()
  if (result.status === 'refused') {
    out(`  ${red('✗')} refused`)
    for (const e of result.errors ?? []) out(dim(`      ${e}`))
    out()
    return 1
  }
  if (result.status === 'duplicate') {
    out(`  ${dim('=')} already recorded ${cyan(built.linkId.slice(0, 16))}…  ${dim(type)}`)
  } else {
    out(`  ${green('✓')} link recorded ${cyan(built.linkId.slice(0, 16))}…  ${bold(type)}  ${dim(`by ${author}`)}`)
  }
  out(dim(`      ${fromAddr}  →  ${toAddr}`))
  if (isIdentity) {
    out(dim('      re-run `lodestar graph query repos` to see the regrouping (a claim, not an observation)'))
  }
  out()
  return 0
}

function verify(graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1

  const result = verifyGraph(graph)
  out()
  out(bold('  Evidence graph verification'))
  out()

  for (const o of [...result.objects, ...result.links].filter((x) => !x.ok)) {
    out(`  ${red('✗')} ${o.file}`)
    for (const e of o.errors) out(dim(`      ${e}`))
  }

  const linkNote = result.linkCount ? `, ${result.linkCount} link(s)` : ''
  if (result.storeIntact) {
    out(`  ${green('INTACT')}    ${dim(`every object verifies · ${result.recordCount} records${linkNote}, each filed under its content address`)}`)
  } else {
    const bad = [...result.objects, ...result.links].filter((o) => !o.ok).length
    out(`  ${red('BROKEN')}    ${bold(`${bad} object(s) fail verification`)}`)
    out(dim('            a failing object was altered, corrupted, or misfiled after it was stored'))
  }

  // Evidence quality is the OTHER axis — reported beside store integrity, never
  // averaged into it (D-058 at graph scale).
  if (result.degradedRecords) {
    out(dim(`            evidence quality: ${result.degradedRecords} record(s) declare DEGRADED sessions — their own coverage gaps, stated inside them`))
  }
  // Dangling links are a claim about something this store does not hold — non-fatal
  // (GRAPH-SPEC §5), disclosed here so it is neither hidden nor mistaken for corruption.
  if (result.danglingLinks) {
    out(dim(`            ${result.danglingLinks} link(s) reference a record/link not present here — a wider store may hold it; not corruption`))
  }
  for (const t of result.tempFiles) out(dim(`            stray temp file (interrupted add, safe to delete): ${t}`))
  for (const u of result.unrecognized) out(`  ${yellow('?')} unrecognized file in store: ${u}`)
  out()
  return result.storeIntact ? 0 : 2
}

function doReindex(graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1
  const { records, unreadable } = reindex(graph)
  out()
  out(`  ${green('✓')} Index rebuilt from the store · ${records} records`)
  if (unreadable) out(warn(`    ${unreadable} object(s) could not be read — disclosed as a coverage gap in queries`))
  out(dim('    The index is derived and disposable; this operation is always safe.'))
  out()
  return 0
}

/** The coverage footer every query renders identically. */
function renderCoverage(c: {
  earliest: string | null
  latest: string | null
  unreadableObjects: number
  clockNote: string
  note: string
}): void {
  out()
  out(dim(`  coverage: records ${c.earliest?.slice(0, 10) ?? '—'} → ${c.latest?.slice(0, 10) ?? '—'} · ${c.clockNote}`))
  if (c.unreadableObjects) out(warn(`  ${c.unreadableObjects} object(s) unreadable by this client — a coverage gap`))
  out(dim(`  ${c.note}`))
  out()
}

function query(args: string[], graphDir: string | null): number {
  const graph = requireGraph(graphDir)
  if (!graph) return 1

  const flagValue = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }
  const VALUE_FLAGS = ['--rf', '--machine', '--agent', '--since', '--until']
  const positional = args.filter(
    (a, i) => !a.startsWith('-') && !VALUE_FLAGS.includes(args[i - 1] ?? ''),
  )
  const name = positional[0]
  const json = args.includes('--json')
  const rf = flagValue('--rf')

  // The index self-heals inside every query; the human is told here, out of band,
  // so report bytes stay a pure function of the object set (D-066).
  const freshness = indexFreshness(graph)

  let report: unknown
  try {
    switch (name) {
      case 'repos':
        report = queryRepos(graph)
        break
      case 'repo-history': {
        if (!positional[1]) return usage()
        report = queryRepoHistory(graph, positional[1])
        break
      }
      case 'file-history': {
        if (!positional[1] || !positional[2]) return usage()
        report = queryFileHistory(graph, positional[1], positional[2])
        break
      }
      case 'divergences':
        report = queryDivergences(graph, positional[1], rf)
        break
      case 'timeline': {
        const f: Parameters<typeof queryTimeline>[1] = {}
        const machine = flagValue('--machine')
        const agent = flagValue('--agent')
        const since = flagValue('--since')
        const until = flagValue('--until')
        if (machine) f.machine = machine
        if (agent) f.agent = agent
        if (since) f.since = since
        if (until) f.until = until
        report = queryTimeline(graph, f)
        break
      }
      case 'coverage':
        report = queryCoverage(graph)
        break
      case 'links':
        report = queryLinks(graph, positional[1])
        break
      default:
        errOut(
          fail(
            `unknown query: ${String(name)} — repos · repo-history · file-history · divergences · timeline · coverage · links`,
          ),
        )
        return 1
    }
  } catch (err) {
    errOut(fail(err instanceof Error ? err.message : String(err)))
    return 1
  }

  if (json) {
    out(reportJson(report))
    return 0
  }

  if (!freshness.fresh) out(dim(`  index was stale (${freshness.reason ?? 'unknown'}) — rebuilt`))

  switch (name) {
    case 'repos':
      renderRepos(report as ReturnType<typeof queryRepos>)
      break
    case 'repo-history':
      renderRepoHistory(report as ReturnType<typeof queryRepoHistory>)
      break
    case 'file-history':
      renderFileHistory(report as ReturnType<typeof queryFileHistory>)
      break
    case 'divergences':
      renderDivergences(report as ReturnType<typeof queryDivergences>)
      break
    case 'timeline':
      renderTimeline(report as ReturnType<typeof queryTimeline>)
      break
    case 'coverage':
      renderCoverageReport(report as ReturnType<typeof queryCoverage>)
      break
    case 'links':
      renderLinks(report as ReturnType<typeof queryLinks>)
      break
  }
  return 0
}

function renderLinks(report: ReturnType<typeof queryLinks>): void {
  out()
  out(
    bold('  Declared links') +
      dim(
        `  ·  ${report.links.length} claim(s)${report.repo ? ` touching ${report.repo.displayName}` : ''}` +
          ' — claims, not observations; they never enter a fact (P5)',
      ),
  )
  out()
  if (!report.links.length) {
    out(dim('  No links recorded. A link is a human claim — a rename confirmed, an incident tag, a review.'))
    out(dim('  Record one:  lodestar graph link identity:same-repo <repoA> <repoB> --reason "rename"'))
  }
  for (const l of report.links) {
    const flags = [
      l.retracted ? red('retracted') : '',
      l.dangling ? yellow('dangling endpoint') : '',
    ]
      .filter(Boolean)
      .map((f) => `  ${f}`)
      .join('')
    const body = l.retracted ? dim(l.type) : bold(l.type)
    out(`  ${yellow('▪')} ${body}  ${dim(`by ${l.author} · ${l.ts.slice(0, 10)}`)}${flags}`)
    out(dim(`      ${l.from}  →  ${l.to}`))
    if (l.reason) out(dim(`      “${l.reason}”`))
    out(dim(`      ${cyan(`evidence:link/${l.linkId}`)}`))
  }

  if (report.appliedMerges.length) {
    out()
    out(bold('  Applied merges') + dim('  — declared identity corrections now in effect (P4)'))
    for (const m of report.appliedMerges) {
      out(`  ${green('✓')} ${m.a} ${dim('≡')} ${m.b}  ${dim(`by ${m.author} · ${cyan(m.cite)}`)}`)
    }
  }
  if (report.unresolved.length) {
    out()
    out(bold('  Declared but not in effect') + dim('  — disclosed, never silently dropped'))
    for (const u of report.unresolved) {
      out(`  ${yellow('?')} ${u.kind}: ${u.a} ⇄ ${u.b}  ${dim(`${u.reason} · by ${u.author} · ${cyan(u.cite)}`)}`)
    }
  }
  renderCoverage(report.coverage)
}

function renderTimeline(report: ReturnType<typeof queryTimeline>): void {
  const f = report.filters
  const scope = [
    f.machine ? `machine ${f.machine}` : '',
    f.agent ? `agent ${f.agent}` : '',
    f.since ? `since ${f.since.slice(0, 10)}` : '',
    f.until ? `until ${f.until.slice(0, 10)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  out()
  out(bold('  Timeline') + dim(`  ·  ${report.sessions.length} session(s)${scope ? ` · ${scope}` : ''}`))
  out()
  for (const s of report.sessions) {
    const facts = s.factIds.length ? `  ${yellow(s.factIds.join(' '))}` : ''
    out(
      `  ${yellow('▪')} ${s.startedAt.slice(0, 16).replace('T', ' ')}  ${bold(s.repo)}  ${dim(`${s.agent} on ${s.machine}`)}${facts}`,
    )
    out(dim(`      ${s.events} event(s) · ${s.integrityStatus} · ${cyan(s.cite)}`))
  }
  renderCoverage(report.coverage)
}

function renderCoverageReport(report: ReturnType<typeof queryCoverage>): void {
  out()
  out(bold('  Coverage — what this graph sees') + dim('  ·  no staleness judgment is made; last-seen is evidence, quiet is yours to judge'))
  out()
  out(bold('  machines'))
  for (const m of report.machines) {
    out(
      `  ${yellow('▪')} ${m.machineId}  ${dim(
        `${m.sessions} session(s) · first ${m.firstSeen.slice(0, 10)} · last ${m.lastSeen.slice(0, 10)}`,
      )}`,
    )
  }
  out(bold('  agents'))
  for (const a of report.agents) {
    out(
      `  ${yellow('▪')} ${a.agent}  ${dim(
        `${a.sessions} session(s) · first ${a.firstSeen.slice(0, 10)} · last ${a.lastSeen.slice(0, 10)}`,
      )}`,
    )
  }
  out(bold('  repositories'))
  for (const r of report.repos) {
    out(
      `  ${yellow('▪')} ${r.displayName}  ${dim(
        `${r.sessions} session(s) · first ${r.firstSeen.slice(0, 10)} · last ${r.lastSeen.slice(0, 10)}`,
      )}`,
    )
  }
  if (report.degradedSessions) {
    out()
    out(dim(`  ${report.degradedSessions} session(s) declare DEGRADED evidence — their own stated gaps`))
  }
  renderCoverage(report.coverage)
}

function renderRepos(report: ReturnType<typeof queryRepos>): void {
  const c = report.coverage
  out()
  out(
    bold(`  Repositories`) +
      dim(
        `  ·  ${c.groups} group(s) · ${c.sessions} session(s) in ${c.records} record(s) · ` +
          `${c.machines.length} machine(s) · ${c.agents.length} agent(s)`,
      ),
  )
  out()

  for (const g of report.groups) {
    const flags = [
      g.ambiguous ? yellow('ambiguous: roots reach multiple origin groups') : '',
      g.rootConflict ? yellow('root conflict: members share no common history — origin URL may be reused') : '',
      g.declared ? cyan('merged by a declared link') : '',
    ]
      .filter(Boolean)
      .map((f) => `  ${f}`)
      .join('')
    out(`  ${yellow('▪')} ${bold(g.displayName)}${flags}`)
    out(
      dim(
        `      basis ${g.basis} · ${g.sessions} session(s) · agents ${g.agents.join(', ')} · ` +
          `machines ${g.machines.join(', ')} · ${g.firstStartedAt.slice(0, 10)} → ${g.lastStartedAt.slice(0, 10)}`,
      ),
    )
    if (g.origins.length > 1) out(dim(`      origins: ${g.origins.join(' · ')}`))
    if (g.roots.length) out(dim(`      roots: ${g.roots.map((r) => r.slice(0, 12)).join(', ')}`))
  }

  if (report.candidates.length) {
    out()
    out(bold('  Candidates') + dim('  — surfaced, never merged; a declared link resolves each'))
    for (const cand of report.candidates) {
      const mark = cand.declared === 'distinct'
        ? `  ${green('marked distinct')}${cand.declaredBy ? dim(` by ${cand.declaredBy}`) : ''}`
        : ''
      out(`  ${yellow('?')} ${cand.between[0]} ${dim('⇄')} ${cand.between[1]}  ${dim(`(${cand.kind} via ${cand.via})`)}${mark}`)
    }
  }

  if (report.appliedMerges.length) {
    out()
    out(bold('  Declared merges in effect') + dim('  — human identity corrections (P4); a claim, reversible by retracts'))
    for (const m of report.appliedMerges) {
      out(`  ${green('≡')} ${m.a} and ${m.b}  ${dim(`by ${m.author} · ${cyan(m.cite)}`)}`)
    }
  }
  if (report.unresolved.length) {
    out()
    out(bold('  Declared but not in effect') + dim('  — disclosed, never silently obeyed or dropped'))
    for (const u of report.unresolved) {
      out(`  ${yellow('?')} ${u.kind}: ${u.a} ⇄ ${u.b}  ${dim(`${u.reason} · by ${u.author} · ${cyan(u.cite)}`)}`)
    }
  }

  renderCoverage(c)
}

function renderRepoHistory(report: ReturnType<typeof queryRepoHistory>): void {
  out()
  out(
    bold(`  ${report.repo.displayName}`) +
      dim(`  ·  ${report.sessions.length} session(s) · basis ${report.repo.basis}`),
  )
  if (report.repo.rootConflict) {
    out(`  ${yellow('root conflict: members share no common history — origin URL may be reused')}`)
  }
  out()
  for (const s of report.sessions) {
    const reanalyzed = s.reanalyses ? dim(`  (+${s.reanalyses} re-analysis)`) : ''
    out(
      `  ${yellow('▪')} ${s.startedAt.slice(0, 16).replace('T', ' ')}  ${bold(s.agent)} ${dim(`on ${s.machine}`)}` +
        `  ${s.integrityStatus === 'VERIFIED' ? green(s.integrityStatus) : yellow(s.integrityStatus)}${reanalyzed}`,
    )
    out(
      dim(
        `      ${s.events} event(s) · ${s.facts} fact(s) · ${s.generator} · ${cyan(s.cite)}`,
      ),
    )
  }
  renderCoverage(report.coverage)
}

function renderFileHistory(report: ReturnType<typeof queryFileHistory>): void {
  out()
  out(
    bold(`  ${report.path}`) +
      dim(`  in ${report.repo.displayName} · ${report.changes.length} observed change(s)`),
  )
  out()
  if (!report.changes.length) {
    out(dim('  No changes to this path were observed in the graph.'))
    out(dim('  That is a statement about the evidence, not about the file.'))
  }
  for (const ch of report.changes) {
    const size =
      ch.bytesBefore !== null || ch.bytesAfter !== null
        ? dim(`  ${ch.bytesBefore ?? '?'} → ${ch.bytesAfter ?? '?'} bytes`)
        : ''
    const withheld = ch.contentWithheld ? yellow(`  content withheld: ${ch.contentWithheld}`) : ''
    out(
      `  ${yellow('▪')} ${ch.occurredAt.slice(0, 19).replace('T', ' ')} ${dim(`(${ch.occurredSource})`)}` +
        `  ${ch.kind === 'file.delete' ? red('deleted') : 'wrote'} ${dim(`by ${ch.agent} on ${ch.machine}`)}${size}${withheld}`,
    )
    out(dim(`      ${cyan(ch.cite)}`))
  }
  if (report.excludedUnrelatable) {
    out()
    out(
      warn(
        `  ${report.excludedUnrelatable} in-scope change(s) could not be related to a repo path — excluded, not guessed`,
      ),
    )
  }
  renderCoverage(report.coverage)
}

function renderDivergences(report: ReturnType<typeof queryDivergences>): void {
  out()
  out(
    bold(`  Divergences`) +
      dim(
        `  ·  ${report.divergences.length} across ${report.coverage.sessions} session(s)` +
          (report.repo ? ` in ${report.repo.displayName}` : ' (all repositories)'),
      ),
  )
  out()
  for (const d of report.divergences) {
    out(
      `  ${yellow('▪')} ${d.ts.slice(0, 16).replace('T', ' ')}  ${bold(d.factId)}  ${d.statement}`,
    )
    out(
      dim(
        `      ${d.repo} · ${d.agent} on ${d.machine} · ${d.generator} · ${d.citations.map((c) => cyan(c)).join(' ')}`,
      ),
    )
  }
  const generators = Object.keys(report.catalogs)
  if (generators.length > 1) {
    out()
    out(dim('  catalogs (what each generator evaluated — silence from an unevaluated fact is not absence):'))
    for (const g of generators) out(dim(`    ${g}: ${report.catalogs[g]!.join(', ')}`))
  }
  if (report.rfNotEvaluated) out(warn(`  ${report.rfNotEvaluated.note}`))
  renderCoverage(report.coverage)
}
