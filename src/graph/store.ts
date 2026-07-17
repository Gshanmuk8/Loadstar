/**
 * LODESTAR — the Evidence Graph store: an add-only keyspace of verified objects.
 *
 * GRAPH-SPEC Part B, Binding 1 (directory). Three properties carry everything:
 *
 *   - **write-once**: an object is written under its content address via
 *     temp-then-rename; a name collision IS success (same address, same bytes).
 *   - **verify-on-add**: nothing enters the store unchecked (GRAPH-SPEC §2 — a store
 *     property, not a client courtesy). A record that fails RECORD-SPEC §7 is
 *     refused with the checker's own wording.
 *   - **nothing derived lives here**: `index/` is excluded from sync by the
 *     .gitignore this module writes at init, and deleting it loses nothing.
 *
 * The store never mutates and never deletes. There is no update path to get wrong.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { checkRecord } from '../record/check.js'
import { computeRecordId } from '../record/build.js'
import { serializeRecord, extractRecordJsonFromHtml } from '../record/serialize.js'
import { buildRecord } from '../record/build.js'
import type { EvidenceRecord } from '../record/types.js'
import {
  checkLink,
  computeLinkId,
  serializeLink,
  addressKind,
  type Link,
} from '../record/link.js'
import { openDatabase } from '../storage/db.js'
import { SqliteEventStore } from '../storage/event-store.js'
import { paths as projectPaths } from '../core/project.js'

export const GRAPH_DIRNAME = '.lodestar-graph'
export const GRAPH_FORMAT = 'lodestar-evidence-graph'
export const GRAPH_FORMAT_VERSION = 1

/**
 * Ingestion bound (M2 §2.6, GRAPH-SPEC Part B). A record is a session's events, not
 * its blobs; nothing legitimate approaches this, and an unbounded JSON.parse on a
 * hostile path is a free denial of service. Binding property, not format property.
 */
export const MAX_RECORD_BYTES = 64 * 1024 * 1024

export interface Graph {
  root: string
  recordsDir: string
  /** Links live beside records — one store, two prefixes (V1-DESIGN-REVIEW §12 delta 1). */
  linksDir: string
  indexDir: string
  indexDb: string
}

const RECORD_FILE = /^([0-9a-f]{64})\.record\.json$/
const LINK_FILE = /^([0-9a-f]{64})\.link\.json$/

function manifestPath(root: string): string {
  return join(root, 'graph.json')
}

/** Create a graph at `dir` (the `.lodestar-graph` directory itself). */
export function initGraph(dir: string): Graph {
  const root = resolve(dir)
  if (existsSync(manifestPath(root))) {
    throw new Error(`a graph already exists at ${root}`)
  }
  mkdirSync(join(root, 'records'), { recursive: true })
  mkdirSync(join(root, 'links'), { recursive: true })
  mkdirSync(join(root, 'index'), { recursive: true })
  // Key order fixed by hand — the manifest is tiny and diffs should never churn.
  writeFileSync(
    manifestPath(root),
    `{"format":"${GRAPH_FORMAT}","formatVersion":${GRAPH_FORMAT_VERSION}}\n`,
    'utf8',
  )
  // The derived index must never ride the transport (GRAPH-SPEC B1).
  writeFileSync(join(root, '.gitignore'), 'index/\n', 'utf8')
  return openGraph(root)
}

/** Open an existing graph, validating its manifest. */
export function openGraph(dir: string): Graph {
  const root = resolve(dir)
  let manifest: { format?: unknown; formatVersion?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath(root), 'utf8')) as typeof manifest
  } catch {
    throw new Error(`no graph at ${root} (missing or unreadable graph.json)`)
  }
  if (manifest.format !== GRAPH_FORMAT) {
    throw new Error(`${root} is not an evidence graph (format: ${String(manifest.format)})`)
  }
  if (manifest.formatVersion !== GRAPH_FORMAT_VERSION) {
    throw new Error(
      `graph format version ${String(manifest.formatVersion)} is not supported ` +
        `(supports ${GRAPH_FORMAT_VERSION}); a newer LODESTAR may exist`,
    )
  }
  return {
    root,
    recordsDir: join(root, 'records'),
    linksDir: join(root, 'links'),
    indexDir: join(root, 'index'),
    indexDb: join(root, 'index', 'graph.db'),
  }
}

/** Walk upward from `start` looking for a `.lodestar-graph` with a manifest. */
export function findGraphRoot(start: string): string | null {
  let dir = resolve(start)
  for (;;) {
    const candidate = join(dir, GRAPH_DIRNAME)
    if (existsSync(manifestPath(candidate))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export interface AddResult {
  status: 'added' | 'duplicate' | 'refused' | 'skipped-open'
  recordId?: string
  /** Set instead of `recordId` when the object added was a link. */
  linkId?: string
  source: string
  /** The checker's wording, verbatim, when refused. */
  errors?: string[]
}

function recordPath(graph: Graph, recordId: string): string {
  return join(graph.recordsDir, recordId.slice(0, 2), `${recordId}.record.json`)
}

function linkPath(graph: Graph, linkId: string): string {
  return join(graph.linksDir, linkId.slice(0, 2), `${linkId}.link.json`)
}

/**
 * Add one verified record value to the store. Idempotent: the same record twice is
 * a reported no-op, including when two processes race — a rename that loses because
 * the target appeared is a success (same address means same bytes).
 */
export function addRecordValue(graph: Graph, value: unknown, source: string): AddResult {
  const check = checkRecord(value)
  if (!check.ok || !check.record) {
    const errors = [...check.errors]
    // A record that HONESTLY seals a broken session fails the chain walk too. The
    // refusal is deliberate (D-065): without signatures, an honest broken-session
    // record and a forged one restated as BROKEN are byte-indistinguishable, and
    // admitting the class would let an attacker mint verifying "evidence of
    // tampering". What must never happen is refusing it SILENTLY — say why.
    const stated = (check.record as { evidence?: { integrity?: { status?: unknown } } } | undefined)
      ?.evidence?.integrity?.status
    if (stated === 'BROKEN') {
      errors.push(
        'note: this record states its own session chain is broken. Sealed broken-session ' +
          'records are refused by design (D-065) — under the V0 threat model they are ' +
          'indistinguishable from forgeries. Keep the file; V2 signatures revisit this.',
      )
    }
    return { status: 'refused', source, errors }
  }
  const record = check.record
  const target = recordPath(graph, record.recordId)

  const bytes0 = serializeRecord(record)
  if (bytes0.length > MAX_RECORD_BYTES) {
    return {
      status: 'refused',
      source,
      errors: [`record is ${bytes0.length} bytes; the ingestion bound is ${MAX_RECORD_BYTES} (M2 §2.6)`],
    }
  }

  if (existsSync(target)) return { status: 'duplicate', recordId: record.recordId, source }

  // Canonical bytes on disk — the file IS the hash input modulo recordId (D-059).
  const bytes = bytes0
  mkdirSync(dirname(target), { recursive: true })
  const temp = join(dirname(target), `.tmp-${record.recordId.slice(0, 8)}-${process.pid}-${Math.floor(Math.random() * 1e9)}`)
  writeFileSync(temp, bytes, 'utf8')
  try {
    renameSync(temp, target)
  } catch (err) {
    try {
      rmSync(temp, { force: true })
    } catch {
      /* best effort — verify reports stray temps */
    }
    // Windows refuses rename-over-existing where POSIX overwrites. Either way, if
    // the target now exists it holds these exact bytes (same content address):
    // the concurrent add won, and winning is indistinguishable from success.
    if (existsSync(target)) return { status: 'duplicate', recordId: record.recordId, source }
    throw err
  }
  return { status: 'added', recordId: record.recordId, source }
}

/**
 * Add one verified link object to the store. Same discipline as records: verify-on-add
 * (checkLink), write-once via temp-then-rename, a name collision is duplicate-success.
 * A link is a claim, so it never touches a fact — it is stored beside records, never
 * inside the fact path (P5).
 */
export function addLinkValue(graph: Graph, value: unknown, source: string): AddResult {
  const check = checkLink(value)
  if (!check.ok || !check.link) {
    return { status: 'refused', source, errors: [...check.errors] }
  }
  const link = check.link
  const bytes = serializeLink(link)
  if (bytes.length > MAX_RECORD_BYTES) {
    return {
      status: 'refused',
      source,
      errors: [`link is ${bytes.length} bytes; the ingestion bound is ${MAX_RECORD_BYTES} (M2 §2.6)`],
    }
  }

  const target = linkPath(graph, link.linkId)
  if (existsSync(target)) return { status: 'duplicate', linkId: link.linkId, source }

  mkdirSync(dirname(target), { recursive: true })
  const temp = join(
    dirname(target),
    `.tmp-${link.linkId.slice(0, 8)}-${process.pid}-${Math.floor(Math.random() * 1e9)}`,
  )
  writeFileSync(temp, bytes, 'utf8')
  try {
    renameSync(temp, target)
  } catch (err) {
    try {
      rmSync(temp, { force: true })
    } catch {
      /* best effort — verify reports stray temps */
    }
    if (existsSync(target)) return { status: 'duplicate', linkId: link.linkId, source }
    throw err
  }
  return { status: 'added', linkId: link.linkId, source }
}

/** Add from a `.record.json` export or an exported `.html` carrying an embedded record. */
export function addRecordFile(graph: Graph, filePath: string): AddResult {
  try {
    const size = statSync(filePath).size
    if (size > MAX_RECORD_BYTES) {
      return {
        status: 'refused',
        source: filePath,
        errors: [`file is ${size} bytes; the ingestion bound is ${MAX_RECORD_BYTES} (M2 §2.6)`],
      }
    }
  } catch {
    /* unreadable falls through to the read below, which reports properly */
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    return {
      status: 'refused',
      source: filePath,
      errors: [`cannot read: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)

  let text = raw
  if (/\.html?$/i.test(filePath) || /^\s*</.test(raw)) {
    const embedded = extractRecordJsonFromHtml(raw)
    if (embedded === null) {
      return {
        status: 'refused',
        source: filePath,
        errors: ['this HTML file carries no embedded evidence record'],
      }
    }
    text = embedded
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { status: 'refused', source: filePath, errors: ['not valid JSON'] }
  }
  return addRecordValue(graph, value, filePath)
}

export interface AddFromProjectOptions {
  /**
   * Include sessions with no recorded end. Off by default (M3, D-067): a
   * mid-session snapshot seals a *shorter chain* than the finished session will,
   * so the two records carry different chainHeads and count as two sessions —
   * true (the observation sets genuinely differ) but noisy on the common path
   * where sync runs while an agent is still working. Skipped sessions are
   * returned as `skipped-open`, never silently dropped.
   */
  includeOpen?: boolean
}

/**
 * Backfill every session of an existing V0 project — determinism makes re-runs
 * no-ops, so pointing this at the same project twice is safe by construction.
 */
export function addFromProject(
  graph: Graph,
  projectRoot: string,
  opts: AddFromProjectOptions = {},
): AddResult[] {
  const db = openDatabase(projectPaths(resolve(projectRoot)).db)
  try {
    const store = new SqliteEventStore(db)
    const sessions = store.listSessions(Number.MAX_SAFE_INTEGER)
    const results: AddResult[] = []
    // Oldest first, purely for readable output — order cannot matter to the store.
    for (const session of [...sessions].sort((a, b) => a.number - b.number)) {
      const source = `${projectRoot} session #${session.number}`
      if (!session.endedAt && !opts.includeOpen) {
        results.push({ status: 'skipped-open', source })
        continue
      }
      const record = buildRecord(store, session.id)
      if (!record) continue
      results.push(addRecordValue(graph, record, source))
    }
    return results
  } finally {
    db.close()
  }
}

export interface StoreWalk {
  /** Well-named object files (`<2hex>/<64hex>.record.json`), sorted. */
  objectFiles: string[]
  /** Interrupted-add leftovers (`.tmp-*`) anywhere under records/. */
  tempFiles: string[]
  /** Everything else — files at the top level, misnamed files, foreign directories.
   *  NEVER silently skipped: the M-V review found a stray file at the top level was
   *  invisible to verify because a readdir throw was swallowed. Every entry the
   *  walk cannot classify as an object lands here, by construction. */
  strays: string[]
}

/** One walk over one object prefix, three classifications, zero silence. */
function walkObjectDir(dir: string, fileRegex: RegExp): StoreWalk {
  const walk: StoreWalk = { objectFiles: [], tempFiles: [], strays: [] }
  if (!existsSync(dir)) return walk

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name)
    if (!entry.isDirectory()) {
      if (entry.name.startsWith('.tmp-')) walk.tempFiles.push(full)
      else walk.strays.push(full)
      continue
    }
    if (!/^[0-9a-f]{2}$/.test(entry.name)) {
      walk.strays.push(full)
      continue
    }
    for (const inner of readdirSync(full, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const innerFull = join(full, inner.name)
      if (!inner.isFile()) walk.strays.push(innerFull)
      else if (inner.name.startsWith('.tmp-')) walk.tempFiles.push(innerFull)
      else if (fileRegex.test(inner.name)) walk.objectFiles.push(innerFull)
      else walk.strays.push(innerFull)
    }
  }
  return walk
}

/** The record prefix. */
export function walkStore(graph: Graph): StoreWalk {
  return walkObjectDir(graph.recordsDir, RECORD_FILE)
}

/** The link prefix. */
export function walkLinks(graph: Graph): StoreWalk {
  return walkObjectDir(graph.linksDir, LINK_FILE)
}

/** Every stored record file, sorted — the deterministic iteration order for derives. */
export function listRecordFiles(graph: Graph): string[] {
  return walkStore(graph).objectFiles
}

/** Every stored link file, sorted. */
export function listLinkFiles(graph: Graph): string[] {
  return walkLinks(graph).objectFiles
}

/** Read one stored link by id. Returns null when absent or unreadable. */
export function readLink(graph: Graph, linkId: string): Link | null {
  const file = linkPath(graph, linkId)
  if (!existsSync(file)) return null
  try {
    return checkLink(JSON.parse(readFileSync(file, 'utf8'))).link ?? null
  } catch {
    return null
  }
}

/**
 * Every verified link in the store, plus the count that could not be read.
 *
 * Verified only: an unreadable or malformed link is not a claim we can act on, so it
 * is excluded from resolution and counted as a disclosed gap (F4) — never dropped
 * silently, never allowed to silently become a directive.
 */
export function readLinks(graph: Graph): { links: Link[]; unreadable: number } {
  const links: Link[] = []
  let unreadable = 0
  for (const file of listLinkFiles(graph)) {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      unreadable++
      continue
    }
    const check = checkLink(value)
    if (check.ok && check.link) links.push(check.link)
    else unreadable++
  }
  // Deterministic order regardless of filesystem enumeration.
  links.sort((a, b) => a.linkId.localeCompare(b.linkId))
  return { links, unreadable }
}

export interface ObjectReport {
  file: string
  recordId?: string
  ok: boolean
  errors: string[]
}

export interface GraphVerifyResult {
  /** Every object (record AND link) verifies and is filed under its own content address. */
  storeIntact: boolean
  objects: ObjectReport[]
  /** Link objects, verified the same way — linkId recompute + misfile check. */
  links: ObjectReport[]
  /** Records whose own evidence declares DEGRADED — evidence quality, not store damage. */
  degradedRecords: number
  /**
   * Links whose record/link endpoint is absent from this store. Non-fatal by design
   * (GRAPH-SPEC §5): a claim about something not present is a claim about what a wider
   * store may hold — surfaced, never treated as corruption. Repo/external endpoints
   * cannot dangle (they name signals/URLs, resolved elsewhere).
   */
  danglingLinks: number
  /** Stray temp files: an interrupted add, harmless, worth cleaning. */
  tempFiles: string[]
  /** Files whose names are not objects and not temps. Never silently ignored. */
  unrecognized: string[]
  recordCount: number
  linkCount: number
}

/**
 * Verify the whole store: every object against its format §7 checks AND against its
 * own filename, across both prefixes. Two axes, kept apart the way D-058 keeps them
 * apart: store integrity (were the bytes altered?) is the verdict; per-record DEGRADED
 * counts and dangling link endpoints are reported alongside, never averaged in.
 */
export function verifyGraph(graph: Graph): GraphVerifyResult {
  const recordWalk = walkStore(graph)
  const linkWalk = walkLinks(graph)
  const objects: ObjectReport[] = []
  const links: ObjectReport[] = []
  const tempFiles = [...recordWalk.tempFiles, ...linkWalk.tempFiles]
  const unrecognized = [...recordWalk.strays, ...linkWalk.strays]
  let degradedRecords = 0

  const presentRecordIds = new Set<string>()
  const presentLinkIds = new Set<string>()

  for (const file of recordWalk.objectFiles) {
    const base = file.split(/[\\/]/).pop()!
    const nameId = RECORD_FILE.exec(base)![1]!

    let value: unknown
    try {
      value = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      objects.push({ file, ok: false, errors: ['not valid JSON'] })
      continue
    }

    const check = checkRecord(value)
    const errors = [...check.errors]
    if (check.record) {
      // Filed under the wrong address is corruption even when the record itself
      // verifies — a store must never serve object X when asked for object Y.
      const actual = computeRecordId(check.record)
      if (actual !== nameId) {
        errors.push(`misfiled: content hashes to ${actual}, filed as ${nameId}`)
      } else {
        presentRecordIds.add(nameId)
      }
      if (check.ok && check.record.evidence.integrity.status === 'DEGRADED') degradedRecords++
    }

    objects.push({
      file,
      ...(check.record ? { recordId: check.record.recordId } : {}),
      ok: check.ok && errors.length === 0,
      errors,
    })
  }

  const linkValues: Array<{ link: Link | undefined }> = []
  for (const file of linkWalk.objectFiles) {
    const base = file.split(/[\\/]/).pop()!
    const nameId = LINK_FILE.exec(base)![1]!

    let value: unknown
    try {
      value = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      links.push({ file, ok: false, errors: ['not valid JSON'] })
      linkValues.push({ link: undefined })
      continue
    }

    const check = checkLink(value)
    const errors = [...check.errors]
    if (check.link) {
      const actual = computeLinkId(check.link)
      if (actual !== nameId) errors.push(`misfiled: content hashes to ${actual}, filed as ${nameId}`)
      else presentLinkIds.add(nameId)
    }
    links.push({
      file,
      ...(check.link ? { recordId: check.link.linkId } : {}),
      ok: check.ok && errors.length === 0,
      errors,
    })
    linkValues.push({ link: check.link })
  }

  // Dangling endpoints — computed after both id sets are known.
  let danglingLinks = 0
  for (const { link } of linkValues) {
    if (!link) continue
    const endpoints = [link.from, link.to]
    const dangles = endpoints.some((addr) => {
      const kind = addressKind(addr)
      if (kind === 'record') {
        const id = /^evidence:record\/([0-9a-f]{64})/.exec(addr)?.[1]
        return id ? !presentRecordIds.has(id) : false
      }
      if (kind === 'link') {
        const id = /^evidence:link\/([0-9a-f]{64})/.exec(addr)?.[1]
        return id ? !presentLinkIds.has(id) : false
      }
      return false // repo / external endpoints cannot dangle
    })
    if (dangles) danglingLinks++
  }

  return {
    storeIntact: objects.every((o) => o.ok) && links.every((o) => o.ok),
    objects,
    links,
    degradedRecords,
    danglingLinks,
    tempFiles,
    unrecognized,
    recordCount: objects.length,
    linkCount: links.length,
  }
}

/** Read one stored record by id. Returns null when absent. */
export function readRecord(graph: Graph, recordId: string): EvidenceRecord | null {
  const file = recordPath(graph, recordId)
  if (!existsSync(file)) return null
  const check = checkRecord(JSON.parse(readFileSync(file, 'utf8')))
  return check.record ?? null
}
