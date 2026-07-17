/**
 * LODESTAR — one-command organizational sharing: `lodestar graph sync`.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL: STORE UNION OVER DUMB TRANSPORTS — D-067
 * ---------------------------------------------------------------------------
 *
 * Objects are immutable and content-addressed, so synchronization has no
 * conflicts, no ordering, and no protocol: sync is set union, executed as file
 * copies. One command runs three phases, each independently useful:
 *
 *   1. COLLECT — if the working directory is inside a V0 project, seal and add its
 *      finished sessions (idempotent, so it is free to run every time).
 *   2. PULL    — copy remote objects absent locally, EACH THROUGH verify-on-add:
 *      a shared folder is precisely where a tampered object arrives from, and the
 *      store's gate does not open for a colleague's mount point.
 *   3. PUSH    — copy local objects absent remotely, temp-then-rename on the
 *      remote side too, verbatim canonical bytes.
 *
 * Offline-first: an unreachable share degrades to collect with a stated warning
 * and a success exit — capture must never depend on connectivity. Sync never
 * deletes, anywhere: deletion stays a transport-level act (GRAPH-SPEC B1), because
 * a deletion-propagation protocol is a distributed-consensus problem wearing a
 * convenience feature's clothes.
 *
 * Transports: a PATH share (any reachable directory holding a graph) and GIT (the
 * graph directory itself is a clone; sync pulls, collects, commits, pushes with the
 * user's own credentials — nothing resembling auth is built here). The share target
 * is LOCAL configuration (`local.json`, gitignored): every teammate's remote
 * differs, and a shared file naming one person's mount point would be config
 * masquerading as truth.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { findProjectRoot } from '../core/project.js'
import {
  addFromProject,
  addLinkValue,
  addRecordValue,
  initGraph,
  openGraph,
  walkLinks,
  walkStore,
  type AddResult,
  type Graph,
} from './store.js'

export type ShareConfig =
  | { type: 'path'; target: string }
  | { type: 'git'; remote: string }

interface LocalConfig {
  share?: ShareConfig
}

function localConfigPath(graph: Graph): string {
  return join(graph.root, 'local.json')
}

export function readShare(graph: Graph): ShareConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(localConfigPath(graph), 'utf8')) as LocalConfig
    return cfg.share ?? null
  } catch {
    return null
  }
}

/** Ensure local.json never rides the transport. Append-if-missing, idempotent. */
function gitignoreLocal(graph: Graph): void {
  const path = join(graph.root, '.gitignore')
  let current = ''
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    /* create below */
  }
  if (!current.split(/\r?\n/).includes('local.json')) {
    writeFileSync(path, current + (current.endsWith('\n') || current === '' ? '' : '\n') + 'local.json\n', 'utf8')
  }
}

export interface ConfigureShareOptions {
  /** Create the remote graph when the path exists but holds no graph yet. */
  create?: boolean
}

/**
 * Point this graph at a share. Path mode validates (or with `create` initializes)
 * the remote graph — a mistyped path must never be silently blessed as a share.
 * Git mode requires the graph root to already be a git repository; the remote name
 * defaults to `origin` and credentials remain git's problem, not ours.
 */
export function configureShare(
  graph: Graph,
  target: string,
  opts: ConfigureShareOptions = {},
): ShareConfig {
  let share: ShareConfig
  if (target === '--git' || target === 'git') {
    if (!existsSync(join(graph.root, '.git'))) {
      throw new Error(
        'git sharing needs the graph directory to be a git repository — ' +
          `run git init/clone in ${graph.root} first`,
      )
    }
    share = { type: 'git', remote: 'origin' }
  } else {
    const remoteRoot = resolve(target)
    if (!existsSync(join(remoteRoot, 'graph.json'))) {
      if (!opts.create) {
        throw new Error(
          `${remoteRoot} holds no evidence graph — re-run with --create to initialize one there`,
        )
      }
      initGraph(remoteRoot)
    } else {
      openGraph(remoteRoot) // validates format/version; throws with its own wording
    }
    share = { type: 'path', target: remoteRoot }
  }

  const cfg: LocalConfig = { share }
  writeFileSync(localConfigPath(graph), JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  gitignoreLocal(graph)
  return share
}

export interface SyncReport {
  transport: 'path' | 'git' | 'none'
  /** Collect phase — sealed from the surrounding project, when there is one. */
  collected: AddResult[]
  collectedFrom: string | null
  /** Pull phase — every incoming object went through verify-on-add. */
  pulled: AddResult[]
  /** Push phase — recordIds copied to the remote. */
  pushed: string[]
  /** Objects the remote holds that failed verification — named every sync until removed. */
  refusedFromRemote: AddResult[]
  warnings: string[]
  /** False only when the transport itself failed hard (config error, push exhaustion). */
  ok: boolean
}

export interface SyncOptions {
  /** Where to look for a surrounding V0 project. Defaults to process.cwd(). */
  cwd?: string
  /** Seal sessions that have not ended (off by default — D-067). */
  includeOpen?: boolean
}

type ObjKind = 'record' | 'link'
interface StoredObject {
  file: string
  kind: ObjKind
}

/**
 * Every object in a store, keyed by content-address id, across BOTH prefixes. Records
 * and links share one keyspace (V1-DESIGN-REVIEW §12) — an id is a content hash, so a
 * cross-type collision is cryptographically impossible; the kind rides along so the
 * pull side routes each object to the right checker.
 */
function objectIdsOf(graph: Graph): Map<string, StoredObject> {
  const out = new Map<string, StoredObject>()
  for (const file of walkStore(graph).objectFiles) out.set(basename(file).slice(0, 64), { file, kind: 'record' })
  for (const file of walkLinks(graph).objectFiles) out.set(basename(file).slice(0, 64), { file, kind: 'link' })
  return out
}

/** Copy one object file into a store verbatim, temp-then-rename, duplicate-safe. */
function copyObjectInto(target: Graph, kind: ObjKind, id: string, bytes: string): void {
  const baseDir = kind === 'record' ? target.recordsDir : target.linksDir
  const dest = join(baseDir, id.slice(0, 2), `${id}.${kind}.json`)
  if (existsSync(dest)) return
  mkdirSync(dirname(dest), { recursive: true })
  const temp = join(
    dirname(dest),
    `.tmp-${id.slice(0, 8)}-${process.pid}-${Math.floor(Math.random() * 1e9)}`,
  )
  writeFileSync(temp, bytes, 'utf8')
  try {
    renameSync(temp, dest)
  } catch (err) {
    try {
      rmSync(temp, { force: true })
    } catch {
      /* remote verify reports strays */
    }
    if (!existsSync(dest)) throw err
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })
}

/**
 * The one command. Phases are independent; a phase that cannot run degrades with a
 * stated warning rather than blocking the ones that can.
 */
export function syncGraph(graph: Graph, opts: SyncOptions = {}): SyncReport {
  const report: SyncReport = {
    transport: 'none',
    collected: [],
    collectedFrom: null,
    pulled: [],
    pushed: [],
    refusedFromRemote: [],
    warnings: [],
    ok: true,
  }

  // ---- 1. collect --------------------------------------------------------------
  const projectRoot = findProjectRoot(opts.cwd ?? process.cwd())
  if (projectRoot) {
    report.collectedFrom = projectRoot
    const collectOpts = opts.includeOpen === true ? { includeOpen: true as const } : {}
    report.collected = addFromProject(graph, projectRoot, collectOpts)
  }

  const share = readShare(graph)
  if (!share) {
    report.warnings.push('no share configured — evidence collected locally only (lodestar graph share <target>)')
    return report
  }

  // ---- 2 + 3. pull / push -------------------------------------------------------
  if (share.type === 'path') {
    report.transport = 'path'
    if (!existsSync(join(share.target, 'graph.json'))) {
      report.warnings.push(
        `share unreachable (${share.target}) — evidence collected locally; sync again when it is available`,
      )
      return report
    }
    let remote: Graph
    try {
      remote = openGraph(share.target)
    } catch (err) {
      report.warnings.push(err instanceof Error ? err.message : String(err))
      report.ok = false
      return report
    }

    const localIds = objectIdsOf(graph)
    const remoteIds = objectIdsOf(remote)

    for (const [id, obj] of remoteIds) {
      if (localIds.has(id)) continue
      let value: unknown
      try {
        let raw = readFileSync(obj.file, 'utf8')
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
        value = JSON.parse(raw)
      } catch {
        report.refusedFromRemote.push({ status: 'refused', source: obj.file, errors: ['not valid JSON'] })
        continue
      }
      // Route to the right checker by prefix — a link is verified on pull exactly
      // like a record; a shared folder is where a tampered object of either type
      // arrives from, and the store gate opens for neither unverified.
      const added =
        obj.kind === 'record'
          ? addRecordValue(graph, value, obj.file)
          : addLinkValue(graph, value, obj.file)
      if (added.status === 'refused') report.refusedFromRemote.push(added)
      else report.pulled.push(added)
    }

    for (const [id, obj] of localIds) {
      if (remoteIds.has(id)) continue
      copyObjectInto(remote, obj.kind, id, readFileSync(obj.file, 'utf8'))
      report.pushed.push(id)
    }
    return report
  }

  // ---- git transport -------------------------------------------------------------
  report.transport = 'git'
  const before = objectIdsOf(graph)
  try {
    git(graph.root, 'pull', '--no-rebase', '--quiet', share.remote)
  } catch (err) {
    report.warnings.push(
      `git pull failed — evidence collected locally; sync again when the remote is reachable ` +
        `(${(err as { stderr?: string }).stderr?.trim().split('\n')[0] ?? 'git error'})`,
    )
    return report
  }
  // Everything the pull brought in is treated as pulled; verification of foreign
  // objects is graph verify's standing job under git transport (bytes arrive via
  // git, not via the store gate) — stated in D-067, checked by `graph verify`.
  for (const [id] of objectIdsOf(graph)) {
    if (!before.has(id)) report.pulled.push({ status: 'added', recordId: id, source: 'git pull' })
  }

  // `--untracked-files=all`: porcelain collapses new directories to `?? records/ab/`
  // by default, which hides every filename this parse needs — found by the M3 sync
  // tests, where the commit said "0 record(s)" while shipping one. Both prefixes are
  // scanned and committed: links ride the same transport as records (one store). A
  // pre-M4 graph may have no `links/` yet — a missing pathspec would fail git, so
  // only existing prefixes are passed.
  const prefixes = ['records', 'links'].filter((p) => existsSync(join(graph.root, p)))
  const status = git(graph.root, 'status', '--porcelain', '--untracked-files=all', ...prefixes)
  if (status.trim()) {
    // `?? records/ab/<64hex>.record.json` (or `links/ab/<64hex>.link.json`) — the
    // untracked objects this commit ships.
    const committedIds = status
      .split('\n')
      .map((l) => /([0-9a-f]{64})\.(?:record|link)\.json$/.exec(l.trim())?.[1])
      .filter((id): id is string => Boolean(id))
    git(graph.root, 'add', ...prefixes)
    git(graph.root, 'commit', '--quiet', '-m', `lodestar sync: ${committedIds.length} object(s)`)
    let pushed = false
    for (let attempt = 0; attempt < 3 && !pushed; attempt++) {
      try {
        git(graph.root, 'push', '--quiet', share.remote)
        pushed = true
      } catch {
        try {
          git(graph.root, 'pull', '--no-rebase', '--quiet', share.remote)
        } catch {
          break
        }
      }
    }
    if (!pushed) {
      report.warnings.push(
        'git push did not succeed after retries — nothing was lost; the commit is local and sync is safe to rerun',
      )
      report.ok = false
    } else {
      report.pushed = committedIds.sort()
    }
  }
  return report
}
