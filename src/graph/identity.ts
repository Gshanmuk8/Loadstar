/**
 * LODESTAR — repository identity: evidence extraction and graph-time resolution.
 *
 * GRAPH-SPEC §4. Records carry identity EVIDENCE (remotes, roots, machine+path);
 * this module turns a set of evidence into repo GROUPS — at query time, statelessly,
 * with a basis on every answer. There are no stored group ids: names are signals
 * (F1), and any signal a group contains addresses it.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE DIRECTION IS FIXED: FALSE-SPLIT, NEVER SILENT MERGE — F2
 * ---------------------------------------------------------------------------
 *
 * Fork and rename are indistinguishable from capture data (git itself cannot tell),
 * so every automatic rule here under-merges and surfaces a labelled candidate
 * instead. A wrong split is visible and one declared `identity:same-repo` link
 * (M4) fixes it; a wrong merge is a silent lie in every query built on it.
 *
 * ---------------------------------------------------------------------------
 * ORDER INDEPENDENCE — the attack the first design did not survive
 * ---------------------------------------------------------------------------
 *
 * An incremental root rule ("merge origin-less holders as each root is processed")
 * gives different answers depending on root iteration order when one origin-less
 * group reaches different origin groups through different roots. So the root rule
 * runs against the PHASE-1 STATE as connected components: origin-less groups link
 * to each other and to origin groups by shared roots; each origin-less component
 * unions internally, then attaches to an origin group iff EXACTLY ONE is adjacent —
 * zero adjacent leaves it standing on root basis, two or more leaves it standing
 * AND flagged ambiguous. Same input set, same answer, any order.
 */

import { createHash } from 'node:crypto'
import type { EvidenceRecord } from '../record/types.js'
import type { SessionStartPayload } from '../types/events.js'
import { normalizeRemoteUrl } from './normalize.js'

export interface IdentityEvidence {
  recordId: string
  sessionId: string
  chainHead: string
  machineId: string | null
  cwd: string
  runtimeId: string
  /** Normalized URL of the remote NAMED `origin`, when present. The only auto-merge remote. */
  origin: string | null
  /** All normalized remote URLs, sorted, deduped. Candidates only — never auto-merge. */
  remotes: string[]
  /** Root commit shas, sorted. */
  roots: string[]
  /** The weak signal: sha256(machineId NUL cwd), 16 hex. */
  pathKey: string
}

export interface RepoGroup {
  /** Smallest origin, else `root:<sha12>`, else `path:<key>`. A signal, not an id. */
  displayName: string
  basis: 'origin' | 'root' | 'path'
  /** Sorted by recordId. */
  members: IdentityEvidence[]
  origins: string[]
  remotes: string[]
  roots: string[]
  /** Present only for path-basis groups — the weak signal is noise elsewhere. */
  pathKeys?: string[]
  /** Distinct (sessionId, chainHead) pairs — records are artifacts, sessions are sessions (F6). */
  sessionCount: number
  machines: string[]
  runtimes: string[]
  /** Origin-less group whose roots reach two or more origin groups: fork-or-rename territory. */
  ambiguous?: boolean
  /**
   * The group's root-bearing members split into disconnected history components —
   * the origin URL may have been REUSED for a different repository (deleted and
   * recreated, or a mis-set remote). Derived, surfaced, never auto-split: the shared
   * origin is real evidence too, and `identity:distinct-repos` (M4) is the
   * correction path. M2 §2.5.
   */
  rootConflict?: boolean
  /**
   * This group exists (or is this large) because a declared `identity:same-repo`
   * link merged what the automatic rules kept apart (M4). A human's claim, attributed
   * in `Resolution.appliedMerges`, reversible by a `retracts` link — never an
   * automatic merge.
   */
  declared?: boolean
}

export interface IdentityCandidate {
  kind: 'lineage' | 'shared-remote'
  /** Display names, sorted. */
  between: [string, string]
  via: string
  /**
   * A human answered this candidate with a declared link (M4). `resolved` — a
   * `same-repo` link merged the groups, so this candidate no longer appears at all;
   * `distinct` — a `distinct-repos` link marked them genuinely different, so the
   * candidate is suppressed but retained here, attributed. Absent = still open.
   */
  declared?: 'distinct'
  declaredBy?: string
}

/**
 * A declared identity directive derived from an active link (M4). Merge unions two
 * repo groups named by signal; distinct suppresses the candidate between them. The
 * failure direction is unchanged (F2): only a human's link ever merges or marks
 * distinct — the automatic rules still under-merge.
 *
 * The shape is defined once, in the record layer (`record/link.ts`, which derives
 * directives from links); this is a type-only import, so resolution stays free of any
 * runtime coupling to the record layer.
 */
export type { IdentityDirective } from '../record/link.js'
import type { IdentityDirective } from '../record/link.js'

/** A directive that changed nothing — disclosed, never silently dropped (P6). */
export interface UnresolvedDirective {
  directive: IdentityDirective
  reason: 'unresolvable' | 'redundant' | 'unenforceable'
}

export interface Resolution {
  groups: RepoGroup[]
  candidates: IdentityCandidate[]
  /** Declared merges that took effect — attributed, for disclosure. */
  appliedMerges: IdentityDirective[]
  /** Declared directives that changed nothing, with why (P6). */
  unresolved: UnresolvedDirective[]
}

/** Inputs for evidence construction — the shape tests and vectors share. */
export interface EvidenceInput {
  recordId: string
  sessionId: string
  chainHead?: string
  machineId?: string | null
  cwd: string
  runtimeId?: string
  gitRemotes?: Array<{ name: string; url: string }>
  gitRootCommits?: string[]
}

/** The weak identity signal: machine + working directory, hashed. */
export function pathKeyOf(machineId: string | null, cwd: string): string {
  return createHash('sha256')
    .update(`${machineId ?? 'unknown'}\0${cwd}`, 'utf8')
    .digest('hex')
    .slice(0, 16)
}

export function buildEvidence(input: EvidenceInput): IdentityEvidence {
  const normalized = new Map<string, string | null>()
  for (const r of input.gitRemotes ?? []) normalized.set(r.name, normalizeRemoteUrl(r.url))

  const remotes = [...new Set([...normalized.values()].filter((u): u is string => u !== null))].sort()
  const machineId = input.machineId ?? null

  return {
    recordId: input.recordId,
    sessionId: input.sessionId,
    chainHead: input.chainHead ?? '',
    machineId,
    cwd: input.cwd,
    runtimeId: input.runtimeId ?? 'unknown',
    origin: normalized.get('origin') ?? null,
    remotes,
    roots: [...new Set(input.gitRootCommits ?? [])].sort(),
    pathKey: pathKeyOf(machineId, input.cwd),
  }
}

/** Extract identity evidence from a verified record's chained session.start event. */
export function evidenceOfRecord(record: EvidenceRecord): IdentityEvidence {
  const start = record.observations.events.find(
    (e) => e.kind === 'session.start' && e.signalTier === 'groundTruth',
  )
  const p = (start?.payload ?? {}) as Partial<SessionStartPayload>

  return buildEvidence({
    recordId: record.recordId,
    sessionId: record.subject.sessionId,
    chainHead: record.observations.head,
    machineId: p.machineId ?? record.identity.machineId ?? null,
    cwd: typeof p.cwd === 'string' ? p.cwd : record.subject.cwd,
    runtimeId: record.subject.runtimeId,
    gitRemotes: Array.isArray(p.gitRemotes) ? p.gitRemotes : [],
    gitRootCommits: Array.isArray(p.gitRootCommits) ? p.gitRootCommits : [],
  })
}

// ---------------------------------------------------------------------------
// Resolution.
// ---------------------------------------------------------------------------

/** Deterministic union-find: the representative is always the smallest key. */
class UnionFind {
  private parent = new Map<string, string>()

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key)
  }

  find(key: string): string {
    let root = key
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // Path compression — pure speed, no semantic weight.
    let cursor = key
    while (cursor !== root) {
      const next = this.parent.get(cursor)!
      this.parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // Smaller string wins as representative: same inputs, same reps, any order.
    if (ra < rb) this.parent.set(rb, ra)
    else this.parent.set(ra, rb)
  }
}

/**
 * Do the root-bearing members of one group form a single connected history?
 *
 * Edges are shared roots. Two members whose root sets never connect — directly or
 * through other members — have provably disjoint histories, which inside an
 * origin-merged group means the origin URL has pointed at more than one repository
 * over time. A monorepo with subtree roots stays connected (A={r1,r2}, B={r2,r3}
 * share r2) and is NOT flagged; only genuinely severed histories are.
 */
function rootBearingMembersDisconnected(members: IdentityEvidence[]): boolean {
  const withRoots = members.filter((m) => m.roots.length)
  if (withRoots.length < 2) return false

  const uf = new UnionFind()
  for (const m of withRoots) uf.add(m.recordId)
  const byRoot = new Map<string, string[]>()
  for (const m of withRoots) {
    for (const root of m.roots) {
      const list = byRoot.get(root) ?? []
      list.push(m.recordId)
      byRoot.set(root, list)
    }
  }
  for (const ids of byRoot.values()) for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!)

  const components = new Set(withRoots.map((m) => uf.find(m.recordId)))
  return components.size > 1
}

/**
 * Which records does a declared signal name? Any record whose evidence carries the
 * signal as an origin, a remote, a root (raw or `root:`-prefixed), a `path:`-prefixed
 * path key, or its own display value. This is the evidence-level twin of the query
 * layer's `resolveRepoArg` — F1, "names are signals," applied to link endpoints.
 */
function recordsMatchingSignal(evidence: IdentityEvidence[], signal: string): string[] {
  const ids: string[] = []
  for (const e of evidence) {
    const hit =
      e.origin === signal ||
      e.remotes.includes(signal) ||
      e.roots.includes(signal) ||
      (signal.startsWith('root:') && e.roots.some((r) => r.startsWith(signal.slice(5)))) ||
      (signal.startsWith('path:') && e.pathKey === signal.slice(5)) ||
      e.pathKey === signal
    if (hit) ids.push(e.recordId)
  }
  return ids.sort()
}

/**
 * Resolve evidence into repo groups. Pure and deterministic: same evidence set and
 * same directives, same groups, same candidates, byte for byte.
 *
 * `directives` are declared identity links (M4), already reduced to active,
 * deterministically-ordered merge/distinct claims. `merge` unions two groups named by
 * signal; `distinct` suppresses the candidate between them. Only a human's directive
 * ever merges or marks distinct — the automatic phases still under-merge (F2). A
 * directive that changes nothing is disclosed in `unresolved`, never dropped (P6).
 */
export function resolveIdentities(
  evidenceIn: IdentityEvidence[],
  directives: IdentityDirective[] = [],
): Resolution {
  const evidence = [...evidenceIn].sort((a, b) => a.recordId.localeCompare(b.recordId))
  const uf = new UnionFind()
  for (const e of evidence) uf.add(e.recordId)

  // Phase 1 — the origin rule: records sharing an origin value group together.
  const byOrigin = new Map<string, string[]>()
  for (const e of evidence) {
    if (!e.origin) continue
    const list = byOrigin.get(e.origin) ?? []
    list.push(e.recordId)
    byOrigin.set(e.origin, list)
  }
  for (const ids of byOrigin.values()) for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!)

  // Phase-1 snapshot: which groups exist, and which have any origin.
  const phase1Rep = new Map<string, string>() // recordId -> phase-1 representative
  const groupHasOrigin = new Map<string, boolean>()
  for (const e of evidence) {
    const rep = uf.find(e.recordId)
    phase1Rep.set(e.recordId, rep)
    groupHasOrigin.set(rep, (groupHasOrigin.get(rep) ?? false) || e.origin !== null)
  }

  // Root adjacency against the phase-1 snapshot (order independence — see header).
  const rootHolders = new Map<string, Set<string>>() // root sha -> set of phase-1 reps
  for (const e of evidence) {
    const rep = phase1Rep.get(e.recordId)!
    for (const root of e.roots) {
      const set = rootHolders.get(root) ?? new Set<string>()
      set.add(rep)
      rootHolders.set(root, set)
    }
  }

  // Connected components among ORIGIN-LESS phase-1 groups, edges = shared roots.
  const componentUf = new UnionFind()
  const originlessReps = [...groupHasOrigin.entries()]
    .filter(([, has]) => !has)
    .map(([rep]) => rep)
    .sort()
  for (const rep of originlessReps) componentUf.add(rep)
  for (const [, holders] of [...rootHolders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const originless = [...holders].filter((r) => !groupHasOrigin.get(r)).sort()
    for (let i = 1; i < originless.length; i++) componentUf.union(originless[0]!, originless[i]!)
  }

  // Each component: adjacent origin groups (via any member root, phase-1 state).
  const componentMembers = new Map<string, string[]>()
  for (const rep of originlessReps) {
    const c = componentUf.find(rep)
    const list = componentMembers.get(c) ?? []
    list.push(rep)
    componentMembers.set(c, list)
  }
  const ambiguousReps = new Set<string>()
  for (const [, members] of [...componentMembers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Union the component internally: origin-less groups sharing roots are each
    // other's best evidence, whatever happens with origins.
    for (let i = 1; i < members.length; i++) uf.union(members[0]!, members[i]!)

    const adjacentOrigins = new Set<string>()
    for (const rep of members) {
      for (const [, holders] of rootHolders) {
        if (!holders.has(rep)) continue
        for (const h of holders) if (groupHasOrigin.get(h)) adjacentOrigins.add(h)
      }
    }
    if (adjacentOrigins.size === 1) {
      uf.union(members[0]!, [...adjacentOrigins][0]!)
    } else if (adjacentOrigins.size >= 2) {
      for (const rep of members) ambiguousReps.add(rep)
    }
  }

  // Phase 3 — the path rule, for records with NO stronger signal. The path signal
  // must never bridge groups formed by origins or roots (a reused directory is not
  // repo identity), so only signal-less records participate.
  const byPath = new Map<string, string[]>()
  for (const e of evidence) {
    if (e.origin || e.roots.length || e.remotes.length) continue
    const list = byPath.get(e.pathKey) ?? []
    list.push(e.recordId)
    byPath.set(e.pathKey, list)
  }
  for (const ids of byPath.values()) for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!)

  // Phase 4 — declared merges (M4). A human's `identity:same-repo` link unions two
  // groups the automatic rules kept apart (the rename, the offline pre-git clone, a
  // fork the team decided to treat as one). Directives arrive already active and
  // deterministically ordered, so applying them in order is deterministic. A merge
  // whose signal names nothing, or whose endpoints already share a group, changes
  // nothing and is disclosed rather than silently obeyed (P6).
  const appliedMerges: IdentityDirective[] = []
  const unresolved: UnresolvedDirective[] = []
  const distinctDirectives: IdentityDirective[] = []
  const declaredMemberIds = new Set<string>()
  for (const d of directives) {
    if (d.kind === 'distinct') {
      distinctDirectives.push(d)
      continue
    }
    const idsA = recordsMatchingSignal(evidence, d.a)
    const idsB = recordsMatchingSignal(evidence, d.b)
    if (!idsA.length || !idsB.length) {
      unresolved.push({ directive: d, reason: 'unresolvable' })
      continue
    }
    if (uf.find(idsA[0]!) === uf.find(idsB[0]!)) {
      unresolved.push({ directive: d, reason: 'redundant' })
      continue
    }
    uf.union(idsA[0]!, idsB[0]!)
    appliedMerges.push(d)
    declaredMemberIds.add(idsA[0]!)
    declaredMemberIds.add(idsB[0]!)
  }

  // ---- Materialize final groups -------------------------------------------------
  const byGroup = new Map<string, IdentityEvidence[]>()
  for (const e of evidence) {
    const rep = uf.find(e.recordId)
    const list = byGroup.get(rep) ?? []
    list.push(e)
    byGroup.set(rep, list)
  }

  const groups: RepoGroup[] = []
  for (const [, members] of byGroup) {
    const origins = [...new Set(members.map((m) => m.origin).filter((o): o is string => o !== null))].sort()
    const remotes = [...new Set(members.flatMap((m) => m.remotes))].sort()
    const roots = [...new Set(members.flatMap((m) => m.roots))].sort()
    const basis: RepoGroup['basis'] = origins.length ? 'origin' : roots.length ? 'root' : 'path'
    const displayName =
      origins[0] ?? (roots[0] ? `root:${roots[0].slice(0, 12)}` : `path:${members[0]!.pathKey}`)

    const group: RepoGroup = {
      displayName,
      basis,
      members,
      origins,
      remotes,
      roots,
      sessionCount: new Set(members.map((m) => `${m.sessionId}\0${m.chainHead}`)).size,
      machines: [...new Set(members.map((m) => m.machineId ?? 'unknown'))].sort(),
      runtimes: [...new Set(members.map((m) => m.runtimeId))].sort(),
    }
    if (basis === 'path') group.pathKeys = [...new Set(members.map((m) => m.pathKey))].sort()
    if (ambiguousReps.has(phase1Rep.get(members[0]!.recordId)!) && basis !== 'origin') {
      group.ambiguous = true
    }
    if (rootBearingMembersDisconnected(members)) group.rootConflict = true
    if (members.some((m) => declaredMemberIds.has(m.recordId))) group.declared = true
    groups.push(group)
  }
  groups.sort((a, b) => a.displayName.localeCompare(b.displayName))

  // ---- Candidates: surfaced, never merged ---------------------------------------
  const candidates: IdentityCandidate[] = []
  const nameOfFinalRep = new Map<string, string>()
  for (const g of groups) nameOfFinalRep.set(uf.find(g.members[0]!.recordId), g.displayName)

  // Lineage: a root held by two or more final groups that each carry an origin.
  const finalRootHolders = new Map<string, Set<string>>()
  for (const g of groups) {
    if (!g.origins.length) continue
    const rep = uf.find(g.members[0]!.recordId)
    for (const root of g.roots) {
      const set = finalRootHolders.get(root) ?? new Set<string>()
      set.add(rep)
      finalRootHolders.set(root, set)
    }
  }
  for (const [root, holders] of [...finalRootHolders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const names = [...holders].map((h) => nameOfFinalRep.get(h)!).sort()
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        candidates.push({ kind: 'lineage', between: [names[i]!, names[j]!], via: `root ${root}` })
      }
    }
  }

  // Shared remote: a normalized URL known to two or more final groups.
  const remoteHolders = new Map<string, Set<string>>()
  for (const g of groups) {
    const rep = uf.find(g.members[0]!.recordId)
    for (const url of new Set([...g.remotes, ...g.origins])) {
      const set = remoteHolders.get(url) ?? new Set<string>()
      set.add(rep)
      remoteHolders.set(url, set)
    }
  }
  for (const [url, holders] of [...remoteHolders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (holders.size < 2) continue
    const names = [...holders].map((h) => nameOfFinalRep.get(h)!).sort()
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        candidates.push({ kind: 'shared-remote', between: [names[i]!, names[j]!], via: `remote ${url}` })
      }
    }
  }

  candidates.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.between[0].localeCompare(b.between[0]) ||
      a.between[1].localeCompare(b.between[1]) ||
      a.via.localeCompare(b.via),
  )

  // Declared distinctness (M4) — the human answered "no, these are different repos"
  // (the fork case, I-6). We never SPLIT an already-merged group (§4.4: surfaced,
  // never auto-split); instead the matching candidate is annotated so the graph stops
  // asking, attributed to its author, and RETAINED (the disagreement is preserved).
  // A distinct claim naming two signals already in one group is `unenforceable`
  // (stronger evidence merged them) and one naming a missing group is `unresolvable`
  // — both disclosed, never silently obeyed or dropped (P6).
  const groupNameOfSignal = (signal: string): string | null => {
    const ids = recordsMatchingSignal(evidence, signal)
    if (!ids.length) return null
    return nameOfFinalRep.get(uf.find(ids[0]!)) ?? null
  }
  for (const d of distinctDirectives) {
    const nameA = groupNameOfSignal(d.a)
    const nameB = groupNameOfSignal(d.b)
    if (!nameA || !nameB) {
      unresolved.push({ directive: d, reason: 'unresolvable' })
      continue
    }
    if (nameA === nameB) {
      unresolved.push({ directive: d, reason: 'unenforceable' })
      continue
    }
    const pair = [nameA, nameB].sort() as [string, string]
    const match = candidates.find(
      (c) => !c.declared && c.between[0] === pair[0] && c.between[1] === pair[1],
    )
    if (match) {
      match.declared = 'distinct'
      match.declaredBy = d.author
    } else {
      // No open candidate to answer — the claim still stands as a recorded human
      // judgment, disclosed rather than dropped.
      unresolved.push({ directive: d, reason: 'unresolvable' })
    }
  }

  return { groups, candidates, appliedMerges, unresolved }
}
