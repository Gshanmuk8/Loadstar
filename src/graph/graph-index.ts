/**
 * LODESTAR — the derived graph index and the named queries.
 *
 * ---------------------------------------------------------------------------
 * DERIVED, DISPOSABLE, SELF-HEALING — never trusted, never stale — D-066
 * ---------------------------------------------------------------------------
 *
 * Everything in `index/graph.db` is a pure function of the object store. Deleting
 * it loses nothing; corrupting it loses nothing; `reindex` rebuilds it, and — the
 * M2 fix for M-V's worst bug — **every query checks freshness first and rebuilds
 * automatically** when the store's object count, the index schema version, or the
 * index's very existence disagree. After a `git pull`, the next query answers from
 * the pulled truth, not from a confident stale cache. Residual, stated: a
 * same-count byte swap escapes the counter — that is `graph verify`'s job, and
 * nothing here claims otherwise.
 *
 * Freshness is never IN a report (reports are byte-deterministic functions of the
 * object set); the CLI calls `indexFreshness()` separately to tell the human a
 * rebuild happened.
 *
 * The index stores EXTRACTIONS only — per-record columns, identity signals, file
 * events, facts. Resolution and grouping run at query time; the primary-record
 * election (D-066: one session may carry several records after re-analysis; rows
 * must not double-count) runs at query time; nothing materialized can drift.
 */

import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { canonicalJSON } from '../core/hash.js'
import { checkRecord } from '../record/check.js'
import type { FileChangePayload, LodestarEvent } from '../types/events.js'
import {
  evidenceOfRecord,
  pathKeyOf,
  resolveIdentities,
  type IdentityEvidence,
  type RepoGroup,
  type Resolution,
} from './identity.js'
import { normalizeRemoteUrl } from './normalize.js'
import { listRecordFiles, readLinks, type Graph } from './store.js'
import {
  activeLinks,
  deriveIdentityDirectives,
  linkTargetOf,
  addressKind,
  type Link,
} from '../record/link.js'

const INDEX_SCHEMA_VERSION = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  record_id         TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,
  chain_head        TEXT NOT NULL,
  runtime_id        TEXT NOT NULL,
  machine_id        TEXT,
  cwd               TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  generator_name    TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  integrity_status  TEXT NOT NULL,
  event_count       INTEGER NOT NULL,
  fact_count        INTEGER NOT NULL,
  catalog_json      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  record_id TEXT NOT NULL,
  kind      TEXT NOT NULL,   -- origin | remote | root
  value     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_events (
  record_id        TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  ts               TEXT NOT NULL,
  occurred_ts      TEXT NOT NULL,
  occurred_source  TEXT NOT NULL,  -- mtime | event  (D-044: occurrence vs observation)
  kind             TEXT NOT NULL,  -- file.write | file.delete
  rel_path         TEXT,           -- repo-relative, forward slashes; NULL when not derivable
  abs_path         TEXT NOT NULL,
  in_scope         INTEGER NOT NULL,
  bytes_before     INTEGER,
  bytes_after      INTEGER,
  content_withheld TEXT
);
CREATE TABLE IF NOT EXISTS facts (
  record_id     TEXT NOT NULL,
  ord           INTEGER NOT NULL,
  fact_id       TEXT NOT NULL,
  statement     TEXT NOT NULL,
  ts            TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_record ON signals (record_id);
CREATE INDEX IF NOT EXISTS idx_file_events_record ON file_events (record_id);
CREATE INDEX IF NOT EXISTS idx_file_events_rel ON file_events (rel_path);
CREATE INDEX IF NOT EXISTS idx_facts_record ON facts (record_id);
`

// ---------------------------------------------------------------------------
// Extraction.
// ---------------------------------------------------------------------------

/**
 * Repo-relative path with forward slashes, or null when not derivable.
 *
 * Same rule as the report's displayPath, plus one Windows accommodation: drive
 * letters compare case-insensitively (`C:\work` vs `c:\work` are one prefix). A
 * failed prefix is NULL — a guessed relative path would be a fabricated join
 * (M2 §3), so the event keeps only its absolute path and is counted as excluded.
 */
function relPathOf(cwd: string, abs: string): string | null {
  const norm = (p: string): string => {
    let n = p.replace(/\\/g, '/')
    if (/^[A-Za-z]:\//.test(n)) n = n[0]!.toLowerCase() + n.slice(1)
    return n
  }
  const c = norm(cwd).replace(/\/+$/, '')
  const a = norm(abs)
  if (a === c) return null
  if (!a.startsWith(c + '/')) return null
  const rel = a.slice(c.length + 1)
  return rel === '' ? null : rel
}

function occurredOf(e: LodestarEvent): { ts: string; source: 'mtime' | 'event' } {
  const mtime = (e.payload as FileChangePayload | undefined)?.mtimeMs
  if (typeof mtime === 'number' && Number.isFinite(mtime)) {
    return { ts: new Date(mtime).toISOString(), source: 'mtime' }
  }
  return { ts: e.ts, source: 'event' }
}

export interface ReindexResult {
  records: number
  /** Objects the index pass could not read — a coverage gap, disclosed, never dropped silently (F4). */
  unreadable: number
}

/**
 * Rebuild the index from the store, from zero, deterministically: files in sorted
 * order, extractions only. Always safe; the only cost is time.
 */
export function reindex(graph: Graph): ReindexResult {
  try {
    rmSync(graph.indexDb, { force: true })
    rmSync(`${graph.indexDb}-wal`, { force: true })
    rmSync(`${graph.indexDb}-shm`, { force: true })
  } catch {
    /* a locked index fails loudly on open below */
  }

  mkdirSync(graph.indexDir, { recursive: true })
  const db = new DatabaseSync(graph.indexDb)
  db.exec(SCHEMA)

  const objectFiles = listRecordFiles(graph)
  let records = 0
  let unreadable = 0

  try {
    db.exec('BEGIN')
    const insertRecord = db.prepare(
      `INSERT OR REPLACE INTO records
       (record_id, session_id, chain_head, runtime_id, machine_id, cwd, started_at, ended_at,
        generator_name, generator_version, integrity_status, event_count, fact_count, catalog_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertSignal = db.prepare('INSERT INTO signals (record_id, kind, value) VALUES (?, ?, ?)')
    const insertFileEvent = db.prepare(
      `INSERT INTO file_events
       (record_id, seq, ts, occurred_ts, occurred_source, kind, rel_path, abs_path, in_scope,
        bytes_before, bytes_after, content_withheld)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertFact = db.prepare(
      'INSERT INTO facts (record_id, ord, fact_id, statement, ts, evidence_json) VALUES (?, ?, ?, ?, ?, ?)',
    )

    for (const file of objectFiles) {
      let check: ReturnType<typeof checkRecord>
      try {
        check = checkRecord(JSON.parse(readFileSync(file, 'utf8')))
      } catch {
        unreadable++
        continue
      }
      if (!check.record) {
        unreadable++
        continue
      }
      const r = check.record
      const evidence = evidenceOfRecord(r)

      insertRecord.run(
        r.recordId,
        r.subject.sessionId,
        r.observations.head,
        r.subject.runtimeId,
        evidence.machineId,
        evidence.cwd,
        r.subject.startedAt,
        r.subject.endedAt,
        r.generator.name,
        r.generator.version,
        r.evidence.integrity.status,
        r.observations.count,
        r.evidence.facts.length,
        canonicalJSON(r.evidence.catalog),
      )
      if (evidence.origin) insertSignal.run(r.recordId, 'origin', evidence.origin)
      for (const url of evidence.remotes) insertSignal.run(r.recordId, 'remote', url)
      for (const root of evidence.roots) insertSignal.run(r.recordId, 'root', root)

      for (const e of r.observations.events) {
        if (e.signalTier !== 'groundTruth') continue
        if (e.kind !== 'file.write' && e.kind !== 'file.delete') continue
        const p = e.payload as FileChangePayload | undefined
        const abs = e.target?.resolved ?? p?.path
        if (!abs) continue
        const inScope = e.target?.inScope === true
        const rel = inScope ? relPathOf(evidence.cwd, abs) : null
        const occurred = occurredOf(e)
        insertFileEvent.run(
          r.recordId,
          e.seq,
          e.ts,
          occurred.ts,
          occurred.source,
          e.kind,
          rel,
          abs,
          inScope ? 1 : 0,
          p?.bytesBefore ?? null,
          p?.bytesAfter ?? null,
          p?.contentWithheld ?? null,
        )
      }

      r.evidence.facts.forEach((f, ord) => {
        insertFact.run(r.recordId, ord, f.id, f.statement, f.ts, canonicalJSON(f.evidence))
      })

      records++
    }

    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(INDEX_SCHEMA_VERSION),
    )
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'unreadable_objects',
      String(unreadable),
    )
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'object_files',
      String(objectFiles.length),
    )
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* original error wins */
    }
    db.close()
    throw err
  }

  db.close()
  return { records, unreadable }
}

// ---------------------------------------------------------------------------
// Freshness — the index self-heals; the human is told separately.
// ---------------------------------------------------------------------------

export interface Freshness {
  fresh: boolean
  reason?: string
}

/** Check only — no healing. The CLI calls this to narrate; queries heal themselves. */
export function indexFreshness(graph: Graph): Freshness {
  if (!existsSync(graph.indexDb)) return { fresh: false, reason: 'no index' }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(graph.indexDb)
  } catch {
    return { fresh: false, reason: 'index unreadable' }
  }
  try {
    const meta = new Map(
      (db.prepare('SELECT key, value FROM meta').all() as unknown as Array<{ key: string; value: string }>).map(
        (r) => [r.key, r.value],
      ),
    )
    if (meta.get('schema_version') !== String(INDEX_SCHEMA_VERSION)) {
      return { fresh: false, reason: 'index schema changed' }
    }
    const indexed = Number(meta.get('object_files') ?? -1)
    const actual = listRecordFiles(graph).length
    if (indexed !== actual) {
      return {
        fresh: false,
        reason: `store has ${actual} object(s), index was built from ${indexed} — records arrived out of band`,
      }
    }
    return { fresh: true }
  } catch {
    return { fresh: false, reason: 'index unreadable' }
  } finally {
    db.close()
  }
}

/** Heal: rebuild when anything disagrees. Every query calls this first. */
export function ensureFreshIndex(graph: Graph): { rebuilt: boolean; reason?: string } {
  const f = indexFreshness(graph)
  if (f.fresh) return { rebuilt: false }
  reindex(graph)
  return { rebuilt: true, ...(f.reason ? { reason: f.reason } : {}) }
}

// ---------------------------------------------------------------------------
// Shared derived views.
// ---------------------------------------------------------------------------

interface RecordRow {
  record_id: string
  session_id: string
  chain_head: string
  runtime_id: string
  machine_id: string | null
  cwd: string
  started_at: string
  ended_at: string | null
  generator_name: string
  generator_version: string
  integrity_status: string
  event_count: number
  fact_count: number
  catalog_json: string
}

interface DerivedState {
  rows: RecordRow[]
  byRecordId: Map<string, RecordRow>
  evidence: IdentityEvidence[]
  resolution: Resolution
  /** Per session key, the elected primary record id and how many alternatives exist (D-066). */
  primaries: Map<string, { recordId: string; reanalyses: number }>
  primaryRecordIds: Set<string>
  unreadable: number
  /** All stored links (records the graph's declared layer). Verified only. */
  links: Link[]
  /** Links that could not be read — a disclosed coverage gap (F4). */
  linksUnreadable: number
}

function sessionKeyOf(r: RecordRow): string {
  return `${r.session_id}\0${r.chain_head}`
}

/**
 * Primary election, D-066: lexicographic max of (generatorName, generatorVersion,
 * recordId). Arbitrary tiebreak, deterministic, disclosed via `reanalyses`.
 */
function electPrimaries(rows: RecordRow[]): Map<string, { recordId: string; reanalyses: number }> {
  const bySession = new Map<string, RecordRow[]>()
  for (const r of rows) {
    const key = sessionKeyOf(r)
    const list = bySession.get(key) ?? []
    list.push(r)
    bySession.set(key, list)
  }
  const out = new Map<string, { recordId: string; reanalyses: number }>()
  for (const [key, list] of bySession) {
    const sorted = [...list].sort((a, b) => {
      return (
        a.generator_name.localeCompare(b.generator_name) ||
        a.generator_version.localeCompare(b.generator_version) ||
        a.record_id.localeCompare(b.record_id)
      )
    })
    out.set(key, { recordId: sorted[sorted.length - 1]!.record_id, reanalyses: list.length - 1 })
  }
  return out
}

function loadDerivedState(graph: Graph): DerivedState {
  ensureFreshIndex(graph)
  const db = new DatabaseSync(graph.indexDb)
  try {
    const rows = db.prepare('SELECT * FROM records ORDER BY record_id').all() as unknown as RecordRow[]
    const signalRows = db
      .prepare('SELECT record_id, kind, value FROM signals')
      .all() as unknown as Array<{ record_id: string; kind: string; value: string }>
    const unreadableRow = db
      .prepare("SELECT value FROM meta WHERE key = 'unreadable_objects'")
      .get() as { value: string } | undefined

    const byRecord = new Map<string, { origin: string | null; remotes: string[]; roots: string[] }>()
    for (const s of signalRows) {
      const entry = byRecord.get(s.record_id) ?? { origin: null, remotes: [], roots: [] }
      if (s.kind === 'origin') entry.origin = s.value
      else if (s.kind === 'remote') entry.remotes.push(s.value)
      else if (s.kind === 'root') entry.roots.push(s.value)
      byRecord.set(s.record_id, entry)
    }

    // Signal values are ALREADY normalized (reindex ran buildEvidence). Reassemble
    // literally — a second normalization pass would erase canonical `host/path`
    // values as local paths (M-V stop-report, failure 2).
    const evidence = rows.map((r): IdentityEvidence => {
      const sig = byRecord.get(r.record_id) ?? { origin: null, remotes: [], roots: [] }
      return {
        recordId: r.record_id,
        sessionId: r.session_id,
        chainHead: r.chain_head,
        machineId: r.machine_id,
        cwd: r.cwd,
        runtimeId: r.runtime_id,
        origin: sig.origin,
        remotes: [...new Set(sig.remotes)].sort(),
        roots: [...new Set(sig.roots)].sort(),
        pathKey: pathKeyOf(r.machine_id, r.cwd),
      }
    })

    const primaries = electPrimaries(rows)
    // The declared layer (M4): links live in the store beside records, not in the
    // index (the index is a pure extraction of RECORDS; links are few and read
    // directly so nothing about the declared layer can drift into the derived cache).
    // Directives are derived from the ACTIVE link set and fed to resolution — the only
    // place a human's claim ever re-groups repos.
    const { links, unreadable: linksUnreadable } = readLinks(graph)
    const directives = deriveIdentityDirectives(links)
    return {
      rows,
      byRecordId: new Map(rows.map((r) => [r.record_id, r])),
      evidence,
      resolution: resolveIdentities(evidence, directives),
      primaries,
      primaryRecordIds: new Set([...primaries.values()].map((p) => p.recordId)),
      unreadable: unreadableRow ? Number(unreadableRow.value) : 0,
      links,
      linksUnreadable,
    }
  } finally {
    db.close()
  }
}

/**
 * Resolve a repo argument — any identity signal names its group (F1). The user may
 * pass a raw remote URL (normalized here), a canonical `host/path`, a root sha, or a
 * display name.
 *
 * Two tiers, by signal strength — refined by its own test during M2: a flat "any
 * signal matches" rule made `github.com/acme/payments` ambiguous the moment any
 * fork carried it as `upstream`, refusing the single most common query. So:
 * a group whose ORIGIN (or display name) is the argument owns it outright; wider
 * signals (non-origin remotes, roots, path keys) resolve only when the strong tier
 * is empty. A tie WITHIN a tier is still refused with both names — same-strength
 * matches admit no principled choice (a root shared by fork and upstream names
 * both, and picking would be a silent judgment).
 */
function resolveRepoArg(resolution: Resolution, arg: string): RepoGroup {
  const forms = new Set<string>([arg])
  const normalized = normalizeRemoteUrl(arg)
  if (normalized) forms.add(normalized)

  const strong = resolution.groups.filter(
    (g) => forms.has(g.displayName) || [...forms].some((f) => g.origins.includes(f)),
  )
  const pick = (matches: RepoGroup[]): RepoGroup => {
    if (matches.length === 1) return matches[0]!
    throw new Error(
      `"${arg}" matches ${matches.length} repository groups (${matches
        .map((g) => g.displayName)
        .join(', ')}) — equally strong signals admit no choice; name one by its display name`,
    )
  }
  if (strong.length) return pick(strong)

  const wide = resolution.groups.filter((g) =>
    [...forms].some(
      (f) =>
        g.remotes.includes(f) ||
        g.roots.includes(f) ||
        (f.startsWith('root:') && g.roots.some((r) => r.startsWith(f.slice(5)))) ||
        (f.startsWith('path:') && (g.pathKeys ?? []).includes(f.slice(5))),
    ),
  )
  if (wide.length) return pick(wide)

  throw new Error(`no repository matches "${arg}" — try: lodestar graph query repos`)
}

/**
 * Resolve a repo argument to its canonical display name (M4 — link authoring). Throws
 * with `resolveRepoArg`'s own wording when the argument names no group or names more
 * than one (an ambiguous endpoint must never be silently baked into a stored claim).
 * Storing the display name makes the link name a signal that identified exactly one
 * group at authoring time.
 */
export function resolveRepoDisplayName(graph: Graph, arg: string): string {
  const state = loadDerivedState(graph)
  return resolveRepoArg(state.resolution, arg).displayName
}

interface CoverageBlock {
  records: number
  sessions: number
  machines: string[]
  agents: string[]
  earliest: string | null
  latest: string | null
  unreadableObjects: number
  /** Times come from the session frame — stated clocks, not chained evidence. */
  clockNote: string
  note: string
}

function coverageOf(state: DerivedState, rows: RecordRow[]): CoverageBlock {
  const starts = rows.map((r) => r.started_at).sort()
  return {
    records: rows.length,
    sessions: new Set(rows.map(sessionKeyOf)).size,
    machines: [...new Set(rows.map((r) => r.machine_id ?? 'unknown'))].sort(),
    agents: [...new Set(rows.map((r) => r.runtime_id))].sort(),
    earliest: starts[0] ?? null,
    latest: starts[starts.length - 1] ?? null,
    unreadableObjects: state.unreadable + state.linksUnreadable,
    clockNote: 'times are stated by each machine’s clock, not proven by the chain',
    note: 'absence of records is not absence of activity',
  }
}

function cite(recordId: string, seq?: number): string {
  return seq === undefined ? `evidence:record/${recordId}` : `evidence:record/${recordId}#${seq}`
}

/** The deterministic wire form of a report — what the rebuild tests compare. */
export function reportJson(report: unknown): string {
  return canonicalJSON(report)
}

// ---------------------------------------------------------------------------
// Query: repos.
// ---------------------------------------------------------------------------

export interface ReposReport {
  groups: Array<{
    displayName: string
    basis: 'origin' | 'root' | 'path'
    origins: string[]
    remotes: string[]
    roots: string[]
    ambiguous?: boolean
    rootConflict?: boolean
    /** Enlarged/created by a declared `identity:same-repo` link (M4) — a human's claim. */
    declared?: boolean
    sessions: number
    records: number
    machines: string[]
    agents: string[]
    firstStartedAt: string
    lastStartedAt: string
  }>
  candidates: Array<{
    kind: string
    between: [string, string]
    via: string
    /** A human marked this pair distinct (M4) — suppressed as an open question, attributed. */
    declared?: 'distinct'
    declaredBy?: string
  }>
  /** Declared merges now in effect — identity corrections applied (P4, M4). */
  appliedMerges: Array<{ a: string; b: string; author: string; cite: string }>
  /** Declared directives that changed nothing — disclosed, never dropped (P6). */
  unresolved: Array<{ kind: string; a: string; b: string; reason: string; author: string; cite: string }>
  coverage: CoverageBlock & { groups: number }
}

export function queryRepos(graph: Graph): ReposReport {
  const state = loadDerivedState(graph)

  const groups = state.resolution.groups.map((g) => {
    const rows = g.members
      .map((m) => state.byRecordId.get(m.recordId))
      .filter((r): r is RecordRow => r !== undefined)
    const starts = rows.map((r) => r.started_at).sort()
    return {
      displayName: g.displayName,
      basis: g.basis,
      origins: g.origins,
      remotes: g.remotes,
      roots: g.roots,
      ...(g.ambiguous ? { ambiguous: true } : {}),
      ...(g.rootConflict ? { rootConflict: true } : {}),
      ...(g.declared ? { declared: true } : {}),
      sessions: g.sessionCount,
      records: g.members.length,
      machines: g.machines,
      agents: g.runtimes,
      firstStartedAt: starts[0] ?? '',
      lastStartedAt: starts[starts.length - 1] ?? '',
    }
  })

  return {
    groups,
    candidates: state.resolution.candidates.map((c) => ({
      kind: c.kind,
      between: c.between,
      via: c.via,
      ...(c.declared ? { declared: c.declared } : {}),
      ...(c.declaredBy ? { declaredBy: c.declaredBy } : {}),
    })),
    appliedMerges: state.resolution.appliedMerges.map((d) => ({
      a: d.a,
      b: d.b,
      author: d.author,
      cite: `evidence:link/${d.linkId}`,
    })),
    unresolved: state.resolution.unresolved.map((u) => ({
      kind: u.directive.kind,
      a: u.directive.a,
      b: u.directive.b,
      reason: u.reason,
      author: u.directive.author,
      cite: `evidence:link/${u.directive.linkId}`,
    })),
    coverage: { ...coverageOf(state, state.rows), groups: groups.length },
  }
}

// ---------------------------------------------------------------------------
// Query: repo-history.
// ---------------------------------------------------------------------------

export interface RepoHistoryReport {
  repo: { displayName: string; basis: string; rootConflict?: boolean }
  sessions: Array<{
    startedAt: string
    endedAt: string | null
    agent: string
    machine: string
    generator: string
    integrityStatus: string
    events: number
    facts: number
    /** Alternative records for this session (re-analysis by other engines), disclosed. */
    reanalyses: number
    cite: string
  }>
  coverage: CoverageBlock
}

export function queryRepoHistory(graph: Graph, repoArg: string): RepoHistoryReport {
  const state = loadDerivedState(graph)
  const group = resolveRepoArg(state.resolution, repoArg)

  const memberRows = group.members
    .map((m) => state.byRecordId.get(m.recordId))
    .filter((r): r is RecordRow => r !== undefined)

  const sessions = memberRows
    .filter((r) => state.primaryRecordIds.has(r.record_id))
    .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.record_id.localeCompare(b.record_id))
    .map((r) => ({
      startedAt: r.started_at,
      endedAt: r.ended_at,
      agent: r.runtime_id,
      machine: r.machine_id ?? 'unknown',
      generator: `${r.generator_name} ${r.generator_version}`,
      integrityStatus: r.integrity_status,
      events: r.event_count,
      facts: r.fact_count,
      reanalyses: state.primaries.get(sessionKeyOf(r))?.reanalyses ?? 0,
      cite: cite(r.record_id),
    }))

  return {
    repo: {
      displayName: group.displayName,
      basis: group.basis,
      ...(group.rootConflict ? { rootConflict: true } : {}),
    },
    sessions,
    coverage: coverageOf(state, memberRows),
  }
}

// ---------------------------------------------------------------------------
// Query: file-history.
// ---------------------------------------------------------------------------

export interface FileHistoryReport {
  repo: { displayName: string; basis: string }
  path: string
  changes: Array<{
    occurredAt: string
    /** `mtime` = filesystem occurrence time; `event` = observation time (D-044). */
    occurredSource: 'mtime' | 'event'
    kind: string
    agent: string
    machine: string
    sessionStartedAt: string
    bytesBefore: number | null
    bytesAfter: number | null
    contentWithheld: string | null
    cite: string
  }>
  /** In-scope file events whose repo-relative path could not be derived — excluded,
   *  counted, never guessed into the history (M2 §3). */
  excludedUnrelatable: number
  coverage: CoverageBlock
}

interface FileEventRow {
  record_id: string
  seq: number
  ts: string
  occurred_ts: string
  occurred_source: string
  kind: string
  rel_path: string | null
  abs_path: string
  in_scope: number
  bytes_before: number | null
  bytes_after: number | null
  content_withheld: string | null
}

export function queryFileHistory(graph: Graph, repoArg: string, pathArg: string): FileHistoryReport {
  const state = loadDerivedState(graph)
  const group = resolveRepoArg(state.resolution, repoArg)
  const wanted = pathArg.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')

  const memberRows = group.members
    .map((m) => state.byRecordId.get(m.recordId))
    .filter((r): r is RecordRow => r !== undefined)
  const memberPrimaryIds = memberRows
    .filter((r) => state.primaryRecordIds.has(r.record_id))
    .map((r) => r.record_id)

  const db = new DatabaseSync(graph.indexDb)
  try {
    const all = db
      .prepare('SELECT * FROM file_events ORDER BY record_id, seq')
      .all() as unknown as FileEventRow[]
    const inGroup = all.filter((f) => memberPrimaryIds.includes(f.record_id))

    const changes = inGroup
      .filter((f) => f.rel_path === wanted)
      .sort(
        (a, b) =>
          a.occurred_ts.localeCompare(b.occurred_ts) ||
          a.record_id.localeCompare(b.record_id) ||
          a.seq - b.seq,
      )
      .map((f) => {
        const r = state.byRecordId.get(f.record_id)!
        return {
          occurredAt: f.occurred_ts,
          occurredSource: f.occurred_source as 'mtime' | 'event',
          kind: f.kind,
          agent: r.runtime_id,
          machine: r.machine_id ?? 'unknown',
          sessionStartedAt: r.started_at,
          bytesBefore: f.bytes_before,
          bytesAfter: f.bytes_after,
          contentWithheld: f.content_withheld,
          cite: cite(f.record_id, f.seq),
        }
      })

    const excludedUnrelatable = inGroup.filter((f) => f.in_scope === 1 && f.rel_path === null).length

    return {
      repo: { displayName: group.displayName, basis: group.basis },
      path: wanted,
      changes,
      excludedUnrelatable,
      coverage: coverageOf(state, memberRows),
    }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Query: divergences.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Query: timeline (M3, D-068 — discovered by the cross-repository investigations:
// "what happened this week / on this machine / by this agent" has no per-repo
// answer, and composing repo-history N times loses the interleaving that IS the
// answer).
// ---------------------------------------------------------------------------

export interface TimelineReport {
  filters: { machine?: string; agent?: string; since?: string; until?: string }
  sessions: Array<{
    startedAt: string
    endedAt: string | null
    repo: string
    agent: string
    machine: string
    generator: string
    integrityStatus: string
    events: number
    facts: number
    factIds: string[]
    reanalyses: number
    cite: string
  }>
  coverage: CoverageBlock
}

export function queryTimeline(
  graph: Graph,
  filters: { machine?: string; agent?: string; since?: string; until?: string } = {},
): TimelineReport {
  const state = loadDerivedState(graph)

  const repoOf = new Map<string, string>()
  for (const g of state.resolution.groups) {
    for (const m of g.members) repoOf.set(m.recordId, g.displayName)
  }

  const rows = state.rows.filter((r) => {
    if (!state.primaryRecordIds.has(r.record_id)) return false
    if (filters.machine && (r.machine_id ?? 'unknown') !== filters.machine) return false
    if (filters.agent && r.runtime_id !== filters.agent) return false
    if (filters.since && r.started_at < filters.since) return false
    if (filters.until && r.started_at > filters.until) return false
    return true
  })

  const db = new DatabaseSync(graph.indexDb)
  try {
    const factRows = db
      .prepare('SELECT record_id, fact_id FROM facts ORDER BY record_id, ord')
      .all() as unknown as Array<{ record_id: string; fact_id: string }>
    const factsByRecord = new Map<string, string[]>()
    for (const f of factRows) {
      const list = factsByRecord.get(f.record_id) ?? []
      list.push(f.fact_id)
      factsByRecord.set(f.record_id, list)
    }

    const sessions = rows
      .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.record_id.localeCompare(b.record_id))
      .map((r) => ({
        startedAt: r.started_at,
        endedAt: r.ended_at,
        repo: repoOf.get(r.record_id) ?? 'unknown',
        agent: r.runtime_id,
        machine: r.machine_id ?? 'unknown',
        generator: `${r.generator_name} ${r.generator_version}`,
        integrityStatus: r.integrity_status,
        events: r.event_count,
        facts: r.fact_count,
        factIds: factsByRecord.get(r.record_id) ?? [],
        reanalyses: state.primaries.get(sessionKeyOf(r))?.reanalyses ?? 0,
        cite: cite(r.record_id),
      }))

    const filters2: TimelineReport['filters'] = {}
    if (filters.machine) filters2.machine = filters.machine
    if (filters.agent) filters2.agent = filters.agent
    if (filters.since) filters2.since = filters.since
    if (filters.until) filters2.until = filters.until

    return { filters: filters2, sessions, coverage: coverageOf(state, rows) }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Query: coverage (M3, D-068 — discovered by the visibility investigations:
// "which machines/agents/repos does this graph even see, since when, until when").
// Deliberately renders NO staleness judgment: last-seen is evidence; "too quiet"
// requires an expected cadence nobody has declared. The human judges.
// ---------------------------------------------------------------------------

export interface CoverageReport {
  machines: Array<{ machineId: string; firstSeen: string; lastSeen: string; sessions: number; records: number }>
  agents: Array<{ agent: string; firstSeen: string; lastSeen: string; sessions: number; records: number }>
  repos: Array<{ displayName: string; basis: string; firstSeen: string; lastSeen: string; sessions: number }>
  degradedSessions: number
  coverage: CoverageBlock
}

export function queryCoverage(graph: Graph): CoverageReport {
  const state = loadDerivedState(graph)

  const tally = <K extends string>(
    key: (r: RecordRow) => K,
  ): Array<{ id: K; firstSeen: string; lastSeen: string; sessions: Set<string>; records: number }> => {
    const map = new Map<K, { firstSeen: string; lastSeen: string; sessions: Set<string>; records: number }>()
    for (const r of state.rows) {
      const k = key(r)
      const entry = map.get(k) ?? {
        firstSeen: r.started_at,
        lastSeen: r.started_at,
        sessions: new Set<string>(),
        records: 0,
      }
      if (r.started_at < entry.firstSeen) entry.firstSeen = r.started_at
      if (r.started_at > entry.lastSeen) entry.lastSeen = r.started_at
      entry.sessions.add(sessionKeyOf(r))
      entry.records++
      map.set(k, entry)
    }
    return [...map.entries()]
      .map(([id, e]) => ({ id, ...e }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  const degraded = new Set(
    state.rows
      .filter((r) => state.primaryRecordIds.has(r.record_id) && r.integrity_status === 'DEGRADED')
      .map(sessionKeyOf),
  )

  return {
    machines: tally((r) => (r.machine_id ?? 'unknown') as string).map((m) => ({
      machineId: m.id,
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen,
      sessions: m.sessions.size,
      records: m.records,
    })),
    agents: tally((r) => r.runtime_id).map((a) => ({
      agent: a.id,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      sessions: a.sessions.size,
      records: a.records,
    })),
    repos: state.resolution.groups.map((g) => {
      const starts = g.members
        .map((m) => state.byRecordId.get(m.recordId)?.started_at)
        .filter((s): s is string => Boolean(s))
        .sort()
      return {
        displayName: g.displayName,
        basis: g.basis,
        firstSeen: starts[0] ?? '',
        lastSeen: starts[starts.length - 1] ?? '',
        sessions: g.sessionCount,
      }
    }),
    degradedSessions: degraded.size,
    coverage: coverageOf(state, state.rows),
  }
}

export interface DivergencesReport {
  repo: { displayName: string; basis: string } | null
  divergences: Array<{
    ts: string
    factId: string
    statement: string
    repo: string
    agent: string
    machine: string
    generator: string
    citations: string[]
  }>
  /** Which fact ids each generator evaluated — silence from a generator that never
   *  evaluated a fact is not absence of the condition (D-048 at graph scale). */
  catalogs: Record<string, string[]>
  /** Present only with --rf: sessions whose generator did not evaluate that fact. */
  rfNotEvaluated?: { factId: string; sessions: number; note: string }
  coverage: CoverageBlock
}

interface FactRow {
  record_id: string
  ord: number
  fact_id: string
  statement: string
  ts: string
  evidence_json: string
}

export function queryDivergences(
  graph: Graph,
  repoArg?: string,
  rfFilter?: string,
): DivergencesReport {
  const state = loadDerivedState(graph)
  const group = repoArg ? resolveRepoArg(state.resolution, repoArg) : null

  const groupOf = new Map<string, string>()
  for (const g of state.resolution.groups) {
    for (const m of g.members) groupOf.set(m.recordId, g.displayName)
  }

  const scopeRows = (
    group
      ? group.members
          .map((m) => state.byRecordId.get(m.recordId))
          .filter((r): r is RecordRow => r !== undefined)
      : state.rows
  ).filter((r) => state.primaryRecordIds.has(r.record_id))
  const scopeIds = new Set(scopeRows.map((r) => r.record_id))

  const db = new DatabaseSync(graph.indexDb)
  try {
    const factRows = (
      db.prepare('SELECT * FROM facts ORDER BY record_id, ord').all() as unknown as FactRow[]
    ).filter((f) => scopeIds.has(f.record_id))

    const filtered = rfFilter ? factRows.filter((f) => f.fact_id === rfFilter) : factRows

    const divergences = filtered
      .sort(
        (a, b) =>
          a.ts.localeCompare(b.ts) || a.record_id.localeCompare(b.record_id) || a.ord - b.ord,
      )
      .map((f) => {
        const r = state.byRecordId.get(f.record_id)!
        const pointers = JSON.parse(f.evidence_json) as Array<{ eventSeq: number }>
        return {
          ts: f.ts,
          factId: f.fact_id,
          statement: f.statement,
          repo: groupOf.get(f.record_id) ?? 'unknown',
          agent: r.runtime_id,
          machine: r.machine_id ?? 'unknown',
          generator: `${r.generator_name} ${r.generator_version}`,
          citations: pointers.map((p) => cite(f.record_id, p.eventSeq)),
        }
      })

    const catalogs: Record<string, string[]> = {}
    for (const r of scopeRows) {
      const key = `${r.generator_name} ${r.generator_version}`
      if (!(key in catalogs)) catalogs[key] = JSON.parse(r.catalog_json) as string[]
    }

    const report: DivergencesReport = {
      repo: group ? { displayName: group.displayName, basis: group.basis } : null,
      divergences,
      catalogs,
      coverage: coverageOf(state, scopeRows),
    }

    if (rfFilter) {
      const notEvaluated = scopeRows.filter(
        (r) => !(JSON.parse(r.catalog_json) as string[]).includes(rfFilter),
      ).length
      if (notEvaluated) {
        report.rfNotEvaluated = {
          factId: rfFilter,
          sessions: notEvaluated,
          note: `${notEvaluated} session(s) were analyzed by a generator that never evaluates ${rfFilter} — their silence is not absence`,
        }
      }
    }

    return report
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Query: links (M4) — the declared layer, listed and attributed. These are CLAIMS,
// labelled as such, filterable by author; they never enter a fact (P5). Retracted and
// dangling links are shown, not hidden — the record of a disagreement is evidence too.
// ---------------------------------------------------------------------------

export interface LinkView {
  linkId: string
  type: string
  author: string
  ts: string
  from: string
  to: string
  reason: string
  /** A `retracts` link targets this link's id (§2.3). The object remains; it is inert. */
  retracted: boolean
  /** A record/link endpoint is absent from this store — non-fatal (GRAPH-SPEC §5). */
  dangling: boolean
}

export interface LinksReport {
  repo: { displayName: string; basis: string } | null
  links: LinkView[]
  /** Declared merges that took effect, attributed (identity correction, P4). */
  appliedMerges: Array<{ a: string; b: string; author: string; cite: string }>
  /** Declared directives that changed nothing, with why — disclosed, never dropped (P6). */
  unresolved: Array<{ kind: string; a: string; b: string; reason: string; author: string; cite: string }>
  coverage: CoverageBlock
}

export function queryLinks(graph: Graph, repoArg?: string): LinksReport {
  const state = loadDerivedState(graph)
  const group = repoArg ? resolveRepoArg(state.resolution, repoArg) : null

  const { retractedIds } = activeLinks(state.links)
  const presentRecordIds = new Set(state.rows.map((r) => r.record_id))
  const presentLinkIds = new Set(state.links.map((l) => l.linkId))

  const isDangling = (l: Link): boolean =>
    [l.from, l.to].some((addr) => {
      const kind = addressKind(addr)
      if (kind === 'record') {
        const id = /^evidence:record\/([0-9a-f]{64})/.exec(addr)?.[1]
        return id ? !presentRecordIds.has(id) : false
      }
      if (kind === 'link') {
        const id = linkTargetOf(addr)
        return id ? !presentLinkIds.has(id) : false
      }
      return false
    })

  // Repo filter: a link belongs to a repo group if either endpoint's repo signal
  // resolves to it, or a cited record is one of its members. Minimal and honest —
  // an unmatched filter yields an empty list, not an error.
  const memberIds = group ? new Set(group.members.map((m) => m.recordId)) : null
  const touchesRepo = (l: Link): boolean => {
    if (!group || !memberIds) return true
    for (const addr of [l.from, l.to]) {
      const kind = addressKind(addr)
      if (kind === 'repo') {
        const sig = addr.slice('evidence:repo/'.length)
        if (group.displayName === sig || group.origins.includes(sig) || group.remotes.includes(sig) || group.roots.includes(sig)) {
          return true
        }
      } else if (kind === 'record') {
        const id = /^evidence:record\/([0-9a-f]{64})/.exec(addr)?.[1]
        if (id && memberIds.has(id)) return true
      }
    }
    return false
  }

  const links: LinkView[] = state.links
    .filter(touchesRepo)
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.linkId.localeCompare(b.linkId))
    .map((l) => ({
      linkId: l.linkId,
      type: l.type,
      author: l.author,
      ts: l.ts,
      from: l.from,
      to: l.to,
      reason: l.reason,
      retracted: retractedIds.has(l.linkId),
      dangling: isDangling(l),
    }))

  return {
    repo: group ? { displayName: group.displayName, basis: group.basis } : null,
    links,
    appliedMerges: state.resolution.appliedMerges.map((d) => ({
      a: d.a,
      b: d.b,
      author: d.author,
      cite: `evidence:link/${d.linkId}`,
    })),
    unresolved: state.resolution.unresolved.map((u) => ({
      kind: u.directive.kind,
      a: u.directive.a,
      b: u.directive.b,
      reason: u.reason,
      author: u.directive.author,
      cite: `evidence:link/${u.directive.linkId}`,
    })),
    coverage: coverageOf(state, state.rows),
  }
}
