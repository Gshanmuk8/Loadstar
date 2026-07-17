# M-V — Engineering Design (the validation spike)

> **Cycle discipline:** restate → design → attack → implement → verify → document →
> stop. This file is steps 1–3 and, at the bottom, step 7's stop-report. Architecture
> is frozen (D-062 ✅); this document designs *implementation*, and any conflict with
> `V1-DESIGN-REVIEW.md` §12 or `GRAPH-SPEC.md` is a bug here.

## 1. Restatement

**What:** `lodestar graph init | add | verify | reindex | query repos` — the object
store (P2), verify-on-add (P1), identity resolution (P4), one named query with bases
and a coverage line (P6), and the deterministic-rebuild property. Plus the one
capture enabler resolution cannot exist without: identity *evidence*
(`gitRemotes`, `gitRootCommits`) in `session.start` — payload-internal, additive,
no format bump (the RECORD-SPEC conformance vectors must not change by a byte).

**Why:** M-V is the experiment that validates V1's two novel risk areas — store
discipline and identity resolution — with the least code that can be honestly said to
exercise them (V1-VALIDATION §10).

**Which primitives:** P1 (the object), P2 (the store), P3 (addresses, minimally),
P4 (identity), P6 (disclosure). P5 (declared links) is deliberately absent — M-V
resolution is purely derived; the link hook-point is designed (§2.4) and not built.

**Why not differently:** a server, a shared database, or capture-time identity were
each rejected with reasons recorded in V1-DESIGN-REVIEW §10/§1. Not relitigated.

## 2. Design

### 2.1 Store (`src/graph/store.ts`)

Layout (GRAPH-SPEC Part A §2, Binding: directory):

```
.lodestar-graph/
  graph.json                      {"format":"lodestar-evidence-graph","formatVersion":1}
  .gitignore                      "index/"
  records/<2hex>/<recordId>.record.json    canonical bytes, write-once
  index/graph.db                  derived, disposable, never synced
```

- **init**: create dir + manifest + .gitignore; refuse a dir that already has a
  manifest. No graphId (nothing consumes one; add when federation does — "can this
  primitive disappear" applied at birth).
- **add**: read file (accepts a `.record.json` or an exported `.html`, extracting the
  embedded block) → `checkRecord` (§2.2) → refuse INVALID/ALTERED with the checker's
  wording → write `records/xx/<id>.record.json.tmp-<pid>` then rename → duplicate
  (target exists, or rename hits EEXIST from a concurrent add) is a reported no-op →
  upsert the index row if an index exists. Idempotent by construction.
  `add --from <projectRoot>` backfills: open the project ledger read-only, list
  sessions, `buildRecord` each, add each — determinism makes re-runs no-ops.
- **verify**: walk `records/**`: filename must parse; `computeRecordId(content)` must
  equal the filename; full `checkRecord`; report per-file. Also: manifest present and
  supported; leftover `.tmp-` files reported; index-vs-files drift reported with
  "run reindex". Two axes in the output (D-058 at graph scale): **store integrity**
  (INTACT / BROKEN — any object that fails is named, never amortized) and **evidence
  quality** (counts of records whose own status is DEGRADED). Exit 0 intact, 2 broken.

### 2.2 In-process record checking (`src/record/check.ts`)

`checkRecord(value: unknown)` mirrors RECORD-SPEC §7 steps 1–8: structure (lite),
recordId recompute, session-identity, chain walk, head/count, fact pointers, tier
rule, integrity-claim consistency. It **reuses** `verifyEvents`/`computeRecordId` —
it is the *same* implementation as the builder, not a third implementation of the
format; the standalone verifier remains the only independent one (D-060), and the
tests cross-pin `checkRecord` against it on identical fixtures (accept and reject).

### 2.3 Identity (`src/graph/normalize.ts`, `src/graph/identity.ts`)

**Capture** (recorder): `gitRemotes: [{name, url}]` from `git remote -v` (fetch
entries, credentials stripped at capture — adversarially tested), `gitRootCommits:
[sha]` from `git rev-list --max-parents=0 HEAD`, sorted, capped at 16 (subtree-merge
pathology; cap documented in the spec). Both optional; both absent outside a repo.

**Normalization** (graph-side, single place, vector-pinned — GRAPH-SPEC §4):
scp/ssh/http(s)/git forms → `host[:nondefault-port]/path`, userinfo stripped, host
lowercased, path case preserved, trailing `.git`/`/` stripped; `file://` and local
paths are *not* remote signals (machine-local, meaningless across machines).

**Evidence per record:** `origin` (normalized URL of the remote *named* `origin`),
`remotes[]` (all normalized), `roots[]`, `pathKey` (sha256(machineId + NUL + cwd),
16 hex) — extracted from the groundTruth `session.start` payload only.

**Resolution** (pure function of the evidence set; runs at query time — no
materialized groups, so no group-identity state to keep deterministic):

1. Union records sharing an `origin` value.
2. For each root sha (sorted): the groups containing it split into with-origin and
   origin-less. Exactly one with-origin group → origin-less ones merge into it
   (offline clones). None → origin-less ones merge together. Two or more → **no
   merge across origin groups** (fork/rename indistinguishable from capture data);
   emit a lineage *candidate* pair; origin-less holders of that root stay separate,
   flagged ambiguous.
3. Records with neither origin nor roots union by `pathKey` — and only those; the
   path signal never bridges groups that stronger signals formed (a reused directory
   must not merge two different clones across years).

Non-origin shared remotes (the fork+upstream trap, F2) never union — they emit
candidates. Representative = lexicographically smallest recordId; display name =
smallest origin, else `root:<sha12>`, else `path:<key>`; every signal a group has
ever contained resolves to it (F1 — names are signals). Output: groups (sorted by
display name) with basis, signals, member session count (distinct `(sessionId,
chainHead)` — F6), agents, machines, time range; then candidates (sorted); then the
coverage line. Complexity: O(records × signals) with union-find ~α(n); at M-V scale,
microseconds; at 10⁶ records, still sub-second in memory — and resolution moving
behind an incremental index later changes no contract.

### 2.4 Index (`src/graph/graph-index.ts`)

SQLite (node:sqlite), tables `records` (one row per record: ids, session key,
runtime/generator/machine/times/status/counts) and `signals` (record_id, kind
∈ origin|remote|root|path, value) and `meta` (schema version only — **no
timestamps**, nothing non-derivable). `reindex` drops and rebuilds from the store in
sorted-filename order. The determinism contract is on *query answers*, not database
bytes: two rebuilds must answer `query repos --json` byte-identically (pinned by
test). Links, when M4 arrives, add a `links` table and a resolution input — the
hook-point is that `resolve()` takes `(evidence[], equivalences[])` with
`equivalences = []` today.

### 2.5 CLI (`src/cli/commands/graph.ts`)

`lodestar graph <init|add|verify|reindex|query>` — the sixth command, covered by
ratified D-062. Graph discovery: `--graph <dir>`, else upward search for
`.lodestar-graph`, else (init only) `./.lodestar-graph`. `query repos [--json]`.
Renderers render; every judgment above comes from the library.

### 2.6 Failure modes designed

Concurrent adds (rename races → duplicate-success), torn writes (tmp suffix ignored
by readers, reported by verify), tampered object (name≠content, named in verify;
refused on add), unreadable future objects (counted, disclosed — F4), records from
foreign generators (catalog-conditioning ready; repos query only counts),
no-git projects (path basis, labelled weak), `machineId: 'unknown'` (collides into
one weak path group; rare, labelled), empty graph (coverage line says so; "no
divergences" language never appears here).

### 2.7 Testing strategy

Vectors first (`spec/identity-vectors.json`, committed before resolution code):
normalization table + resolution scenarios (fork, fork+upstream, rename, offline
clone, mirror-in-one-record, subtree root collision, path fallback, ambiguous root).
Then: store tests (init/add/verify/tamper/idempotence/duplicate-race), checkRecord
cross-pin vs standalone verifier (same fixtures, both directions), rebuild
determinism (reindex ×2 → identical `repos --json`), backfill dogfood (a real seeded
ledger via the existing test harness → grouped with honest bases), CLI-level smoke
through `cmdGraph`. RECORD-SPEC conformance suite must stay green untouched —
that is the no-format-change proof.

## 3. Attack (what the design review of this design found)

- **Materialized groups would have needed stable group ids** — killed by resolving at
  query time (F1 made stateless). Cost: O(records) per query, accepted and bounded.
- **`pathKey` as a bridge** would merge different clones sharing a reused directory —
  restricted to signal-less records only; the pre-git→post-git continuity case is
  knowingly lost (one future link fixes it) — conservative direction, consistent
  with F2.
- **Incremental add-to-index vs reindex divergence** — eliminated by keeping
  resolution out of the index entirely; the index stores only extractions whose
  insertion order cannot matter.
- **Windows rename-over-existing** fails where POSIX overwrites — caught: EEXIST on
  rename is duplicate-success, not error.
- **Root-cap at capture (16)** changes identity evidence for >16-root pathologies —
  documented in spec; sorted before capping so the kept set is deterministic.
- **`git remote -v` push-vs-fetch URLs** — fetch entries only, deterministic; push
  URLs add nothing for identity and can differ per workflow.
- **HTML with multiple embedded blocks** — first block wins, spec says one; add
  reports if extraction was used.

## 7. Stop-report (M-V complete)

**What held.** Every primitive as specified: verify-on-add, write-once with the
rename-race-is-success rule, query-time resolution passing all ten committed vectors
plus the order-independence property, rebuild determinism byte-for-byte, and the
zero-infrastructure sync story — a git-cloned graph, independently reindexed,
answered `query repos --json` byte-identically and verified INTACT. The record
format did not move: the RECORD-SPEC conformance vectors are untouched. Success
criteria from V1-VALIDATION §10: all four met.

**What failed and was fixed during the cycle (the attack log, honest):**
1. *Normalization fall-through:* `file:///x` has an empty authority, missed the URL
   branch, and the scp parser minted `file/home/...` as a hostname — caught by the
   committed vectors on first run, exactly what vectors-before-code is for. Fix:
   anything carrying `://` that is not a well-formed URL is not a signal.
2. *Index re-normalization:* reading signals back from the index and re-normalizing
   them would have erased every stored signal (a canonical `host/path` has no scheme
   and parses as a local path). Caught in self-review before tests; the index reader
   now reassembles literally, with the reason in a comment.
3. *CLI flag position:* `--graph` only worked after the subcommand; before it, the
   dispatcher fell through to usage — found because a smoke-test round-trip
   "passed" by comparing two usage dumps. Fixed by extracting the global flag before
   dispatch; the false positive is recorded here as a reminder that a green check
   proves what it compared, nothing more.

**What surprised.** (a) The demo corpus grouped on the *path* basis because the demo
workspace has no git remote — the weak-basis path is not an edge case, it is the
first thing a real user hits; the labelled-basis design carried it without special
cases. (b) `Select-Object -First N` kills a native process mid-pipeline on
PowerShell 5.1 — a smoke-harness artifact that briefly looked like a product bug;
worth remembering on this platform.

**Assumptions carried, unchanged.** F2's merge defaults await field data (open
question #1); the sharing assumption is untested by construction until a second
human pushes to a shared graph (open question #6). Next milestone remains M2 of the
roadmap (named queries beyond `repos`), gated on nothing new.
