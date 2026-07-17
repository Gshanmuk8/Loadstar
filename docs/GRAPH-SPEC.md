# LODESTAR Evidence Graph — Format Specification (Part A, Draft 1)

**Format identifier:** `lodestar-evidence-graph`, `formatVersion: 1`
**Status:** Part A (objects, addresses, identity) is DRAFT-NORMATIVE for M-V — the
sections marked *(M-V)* are implemented and vector-pinned; sections marked
*(specified, not yet implemented)* bind future milestones and may be revised only by
a DECISIONS entry until first implementation freezes them. Part B (bindings) contains
the directory binding only.

A graph is **an add-only keyspace of typed, immutable, content-addressed evidence
objects, plus rules for deriving meaning from them**. Everything derived (indexes,
groups, queries, facts) is a pure function of the object set; nothing derived is ever
a source of truth. Two graphs union by object union; there is no merge operation
because there is nothing to merge.

---

## Part A — Objects, addresses, identity

### 1. Object types

| Type | Format marker | Spec | Status |
|---|---|---|---|
| Evidence Record | `lodestar-evidence-record` v1 | RECORD-SPEC.md, unchanged | *(M-V)* |
| Link | `lodestar-link` v1 | §5 below | *(M4)* |
| Attestation | reserved | V2 | reserved |

Every object is a single canonical-JSON value (RECORD-SPEC §2 rules) whose **object
id is the SHA-256 of its canonical form with its own id field omitted** — for records
this is exactly `recordId` (RECORD-SPEC §5.3); for links, `linkId` by the same
construction. Objects are immutable: correction is a new object, never an edit.

### 2. The store *(M-V)*

A logical keyspace `objectId → canonical bytes`. Operations: `has`, `get`, `put`
(write-once; a put of an existing id is a no-op), `list`, `verify`. A conforming
store MUST refuse to store an object whose bytes do not verify (for records: the
RECORD-SPEC §7 checks) — **verify-on-add is a store property, not a client courtesy.**
An object present under a key whose content does not hash to that key is corruption
and MUST be reported, never silently served.

Sessions may be represented by multiple records (re-analysis by newer generators):
the **session key is `(subject.sessionId, observations.head)`**; consumers MUST NOT
count records as sessions.

### 3. Addresses *(M-V minimal)*

```
evidence:record/<recordId>            one record
evidence:record/<recordId>#<seq>      one event within it
evidence:link/<linkId>                one link
evidence:repo/<signal>                one repo GROUP, named by any signal it carries   (M4)
```

Addresses are permanent: they resolve to the same bytes forever or fail loudly.
Every computed answer a graph gives MUST cite addresses.

`evidence:repo/<signal>` names a *derived* repo group by any identity signal it holds
(F1 — names are signals): a normalized origin URL, `root:<sha>`, `path:<key>`, or a
display name. It is the endpoint form for `identity:*` links (§5). Unlike the other
addresses it resolves to a group, not to fixed bytes — so it resolves to zero, one, or
(when a signal is shared) more than one group; a link author SHOULD resolve it to a
single group at authoring time, and resolution MUST disclose an endpoint that matches
none or several rather than guess (P6).

### 4. Identity *(M-V)*

#### 4.1 Identity evidence (captured, in records)

Records MAY carry, inside the `session.start` payload (payload-internal, therefore
additive under RECORD-SPEC §6 — **no record format bump**):

- `gitRemotes: [{ name, url }]` — the repo's remotes (fetch URLs), credentials
  stripped at capture. Producers MUST NOT emit userinfo/credentials.
- `gitRootCommits: [sha]` — roots of HEAD's history (`--max-parents=0`), sorted
  ascending, capped at 16 (the kept set is the 16 smallest, so the cap is
  deterministic).

Absence of these fields (older or foreign records) is legal and handled by weaker
bases below.

#### 4.2 Remote URL normalization (vector-pinned)

Input forms and rules — output is `host[:port]/path`:

1. Strip surrounding whitespace.
2. Recognize: `scheme://[userinfo@]host[:port]/path`, scp-like
   `[userinfo@]host:path`, and bare paths. `file://` URLs and bare/local paths are
   **not remote signals** (machine-local; excluded).
3. Strip userinfo entirely. Lowercase the host. Keep the port only if present and
   not the scheme default (ssh 22, https 443, http 80, git 9418; scp-form implies
   ssh).
4. Path: strip leading `/`, strip one trailing `.git`, strip trailing `/`.
   **Path case is preserved** (some hosts are case-sensitive; a case-variant split
   is visible and link-fixable — the chosen failure direction is false-split, never
   silent merge).

Golden vectors: `spec/identity-vectors.json` § `normalization`.

#### 4.3 Resolution (derived, at query time)

Per-record evidence: `origin` (the normalized URL of the remote **named** `origin`),
`remotes[]` (all normalized), `roots[]`, `pathKey` (SHA-256 of
`machineId + NUL + cwd`, first 16 hex — the weak signal).

Grouping, deterministic (union-find; representative = smallest recordId; iteration
in sorted order):

1. **Origin rule.** Records sharing an `origin` value group together.
2. **Root rule.** For each root sha: if exactly one existing group holding that root
   has any origin, origin-less holders merge into it; if none has an origin, the
   origin-less holders merge together; if two or more origin-groups share the root,
   **nothing merges across them** — a *lineage candidate* is emitted (fork and
   rename are indistinguishable from capture data; one declared
   `identity:same-repo` link resolves a rename, and its absence never silently
   merges a fork).
3. **Path rule.** Records with neither origin nor roots group by `pathKey`. The path
   signal MUST NOT bridge groups formed by stronger signals.

Shared non-origin remotes NEVER merge groups (the fork+upstream trap); they emit
candidates. Every group answer carries its **basis** (`origin` | `root` | `path` —
the strongest signal present) and its full signal set. **Names are signals** (F1):
any signal a group contains is a valid way to address the group in queries; there is
no stored group id.

Declared identity links (`identity:same-repo`, `identity:distinct-repos`) are the
correction mechanism; they enter resolution as equivalence/separation inputs when
links land (M4). Their absence today is why every automatic rule above chooses
false-split over false-merge.

Golden vectors: `spec/identity-vectors.json` § `resolution` — fork, fork+upstream,
rename, offline clones, mirror-in-one-record, subtree root collision, path fallback,
ambiguous root.

### 5. The Link object *(M4)*

```jsonc
{
  "format": "lodestar-link",
  "formatVersion": 1,
  "linkId": "<sha256 of canonical form minus linkId>",
  "author": "<claimed string — unauthenticated until V2 keys>",
  "ts": "<ISO 8601, stated clock>",
  "type": "relates-to | supersedes | mission | incident | review | identity:same-repo | identity:distinct-repos | retracts | x-<ns>:<t>",
  "from": "<evidence address>",
  "to": "<evidence address or external URL>",
  "reason": "<string>"
}
```

`linkId` is the content address — sha256 of the canonical form (RECORD-SPEC §2 rules)
with `linkId` removed — **identical construction to `recordId`**. The bytes on disk
are that canonical form. Golden vectors: `spec/link-vectors.json`.

Links are claims: labelled in every output, **never inputs to Graph Facts or to any
computed fact** (P5 — the declared layer is structurally separated from the observed
and computed ones). `from` MUST be an evidence address (record/link/repo); `to` MAY
additionally be an external URL (never fetched). Unknown `type` values — including any
`x-<ns>:<t>` — MUST be tolerated, stored, and counted (F4); only the two `identity:*`
types affect resolution and only `retracts` affects other links.

**Verify-on-add applies to links** (GRAPH-SPEC §2): a link whose bytes do not verify
(bad structure, endpoints that don't match the type, or `linkId` ≠ content) is refused
with a stated verdict, exactly as records are. Links are stored under `links/` (§B1),
share the record keyspace and every transport, and are **never deleted by sync**.

**Retraction.** A `retracts` link points `to` an `evidence:link/<id>`. A link L is
retracted **iff some `retracts` link targets L's exact `linkId`** — one level,
monotone, no fixpoint. `retracts` links are not themselves retractable; because linkId
is content-addressed, a *re-assertion* is a new link (different `ts`/`reason` ⇒
different `linkId`) that an earlier retraction does not cover. Retracted links are
excluded from resolution and from the active claim set but are **retained** (the object
is never deleted) and counted as retracted — the disagreement is preserved.

**Dangling endpoints** (a `from`/`to` record or link not present in this store) are
**non-fatal**: surfaced by `verify` and `query links`, treated by identity resolution
as an unresolvable no-op, never as corruption (a wider store may hold the referent).

**Declared identity resolution** (§4.3 correction mechanism). From the *active* link
set: each `identity:same-repo` unions the two repo groups its endpoints name; each
`identity:distinct-repos` suppresses the lineage/shared-remote *candidate* between them
(never splits an already-merged group — §4.4). Directives are applied in a
deterministic order (by linkId) after the automatic origin/root/path phases. **Only a
human's declared link ever merges or marks distinct — the automatic rules still
under-merge (F2).** A directive that changes nothing (signal matches no group, or the
two are already one group) is disclosed as unresolvable/redundant/unenforceable, never
silently obeyed or dropped (P6).

### 4.4 Group anomalies and argument resolution *(M2)*

- **Root conflict:** a group whose root-bearing members form more than one connected
  component under shared-root edges carries `rootConflict: true` — the origin URL
  has evidently pointed at more than one history (reuse, recreation, mis-set
  remote). Surfaced, never auto-split; `identity:distinct-repos` is the correction.
- **Argument resolution** (queries taking a repo): origin/display-name matches own
  the argument outright; wider signals (non-origin remotes, roots, path keys)
  resolve only when no strong match exists; a tie within a tier MUST be refused
  with all matching names — equally strong signals admit no principled choice.

### 4.5 Session-level derivations *(M2, D-066)*

One session key may carry several records (re-analysis). Session- and event-level
views MUST elect a single **primary record** per session — the lexicographic max of
`(generator.name, generator.version, recordId)` — and MUST disclose the number of
alternatives. File identity within a group is the **repo-relative path** (forward
slashes, drive letters folded, case otherwise preserved) derived from the resolved
path minus the session cwd; underivable in-scope events are excluded and counted,
never guessed.

### 6. Disclosure obligations on derived output *(M-V minimal; extended M2)*

Every query answer MUST carry: the coverage line (object counts, machines, agents,
time range of *present* records; the sentence "absence of records is not absence of
activity" or equivalent), per-group bases, and — when the reading client skipped
objects it could not read (future versions, unknown types) — the skipped count
(client-capability gaps are coverage gaps).

## Part B — Bindings

### B1. Directory binding *(M-V)*

```
<graph>/graph.json            {"format":"lodestar-evidence-graph","formatVersion":1}
<graph>/.gitignore            "index/"
<graph>/records/<2hex>/<recordId>.record.json
<graph>/links/<2hex>/<linkId>.link.json          (M4)
<graph>/index/**              derived; disposable; excluded from sync
```

Writes are temp-file-then-rename in the target directory; readers MUST ignore
filenames that do not parse as `<64hex>.<type>.json` **and MUST surface them as
anomalies rather than skip them silently**. A rename that fails because the target
exists is a successful duplicate add. Version control of the directory (git) is a
supported transport and additionally provides transport-level history of adds and
deletions; the binding itself does not require it.

*(M2 additions.)* Ingestion is bounded (64 MiB per object in this binding) — a
record carries events, never blobs. Derived indexes over this binding MUST
self-heal: implementations record the object count they were built from and rebuild
when it, the index schema, or the index's existence disagree — a consumer must never
receive a confident answer computed from fewer objects than the store holds. A
same-count substitution is out of the counter's reach and remains `verify`'s job;
implementations MUST NOT claim otherwise.

### B1a. Sharing over the directory binding *(M3, D-067)*

Synchronization between two stores is **set union**: copy objects absent on the
other side; nothing else exists to reconcile. Implementations MUST verify pulled
objects through the store gate (path transport) or by standing verification (git
transport, where bytes arrive via git); MUST write remote objects
temp-then-rename; MUST treat an unreachable share as degradation, not failure
(capture never depends on connectivity); and MUST NOT propagate deletions. Share
configuration is local to each participant and never part of the synced store.

### B2. Object-storage binding *(future)*

The keyspace maps to keys verbatim; nothing in Part A may assume a filesystem.
