# LODESTAR V1 — Adversarial Design Review

> **Status:** design-phase gate. No V1 code exists; none is authorized by this document.
> **Subject:** `V1-DESIGN.md` (the Evidence Graph proposal, D-062 🔶).
> **Method:** rebuild from first principles, then attack every primitive until further
> removal breaks correctness. Findings that killed or reshaped parts of the proposal
> are marked **[BROKE]**; survivals are marked **[HELD]**. The rewritten V1 is §12.
>
> The review's own standard, applied to itself: a review that validates everything it
> was asked to attack has not reviewed anything. Four load-bearing pieces of the
> proposal did not survive. That is the review working.

---

## 1. Architecture critique (summary of what broke and what held)

**[HELD] Seal-and-collect.** The core move — the org store collects sealed,
content-addressed, individually verifiable records and never merges chains — survived
every attack in this document. It is the design's inevitable part: immutable objects
cannot conflict, arrive in any order, dedupe by name, and sync over anything.

**[BROKE] Per-author chained link ledgers.** The proposal stored declared links as
per-author append-only JSONL chains, reusing V0's chain machinery "for symmetry."
Three independent attacks kill it (§8.2): an author with two machines forks their own
chain on a dumb transport (the exact conflict class records were designed to avoid);
a chained claim can never be deleted without breaking the whole ledger (re-creating
the deletability-vs-integrity tension D-037 already solved the other way); and it
introduces a second storage discipline where one suffices. **Links become
content-addressed immutable objects in the same store as records.** One object model.
The symmetry was convenient; the unification is inevitable.

**[BROKE] Capture-time repository identity.** The proposal computed `repoId` at
capture with fallback bases. Phase-3 stress (forks, mirrors, renames, multi-remote,
shallow clones, history rewrites — §6) shows *no single basis survives*, and baking a
resolution guess into an immutable record preserves the guess forever. **Records carry
identity *evidence* (all normalized remotes, root commit(s), path, machine); identity
*resolution* happens in the graph at derive time — plural, recomputable, and
correctable by declared equivalence links.** Identity is an entity-resolution problem,
not a field.

**[BROKE] recordId as session identity.** The same session re-exported by a newer
generator produces a *different* recordId over the *same* observations (the computed
evidence layer changed). A graph keyed on recordId double-counts every re-export.
**The chain head is the session key** (it addresses the observation set); recordId is
the artifact key. One session → many records is a legal, useful state (engine
upgrades re-analyze history) that the proposal would have counted as many sessions.

**[BROKE] Graph Facts assuming LODESTAR's catalog.** If a second generator emits
conforming records (the explicit goal of RECORD-SPEC), its `evidence.catalog` may not
include RF-03/RF-04. A GF that reads "no RF-03 present" as "verification observed"
fabricates a claim from a foreign generator's silence. **Every GF conditions on the
record's declared catalog** — the graph-scale form of "a missed matcher must be
declared, never silent" (D-048).

**[HELD, reframed] The store.** "A directory" is a binding, not the model. The spec
must define **a logical keyspace of content-addressed objects plus a manifest**;
directory, git repo, and object storage are transports/bindings of it (§9). This is
what lets 50-engineer and 5,000-engineer deployments be the same architecture.

**[HELD, demoted] Queries, Graph Facts, coverage map.** Real product, not primitives.
The primitives are the *rules* they obey (derived-only inputs; mandatory coverage
disclosure); the catalogs and named queries are growable product surface (§3).

## 2. Primitive inventory (after the attack)

What remains when everything removable is removed:

| # | Primitive | Kind | Would Git/K8s/OTel have it? |
|---|---|---|---|
| P1 | **Evidence object** — `record` \| `link` (later `attestation`): immutable, content-addressed, self-describing, individually verifiable | the atom | Git objects (blob/tree/commit are typed objects in one store) |
| P2 | **The object store** — a logical keyspace `objectId → bytes`, add-only, dedup-by-address, transport-agnostic | the substrate | Git's ODB; OCI registries; K8s would call it the API server's storage, minus mutation |
| P3 | **The address** — `evidence:record/<id>`, `evidence:record/<id>#<seq>`, `evidence:link/<id>` | the citation | Git SHAs; OTel trace/span ids |
| P4 | **Identity evidence + resolution rule** — records carry observed identity signals; grouping is derived, plural, basis-labelled, correctable by equivalence links | the join | Git deliberately has none (identity is social) — which is *why* the layer above Git (GitHub) owns it; K8s: UID vs name |
| P5 | **The epistemic split** — observed (chained events) / computed (generator claims) / declared (authored links); consumers of each are structurally separated | the trust model | This is LODESTAR's own; the nearest analog is K8s spec vs status |
| P6 | **The disclosure rule** — any computed view states its inputs' known gaps (coverage map) and its assumptions (clocks, bases); silence never renders as all-clear | the honesty contract | OTel's sampling metadata, done seriously |

Everything else in the proposal — named queries, GF catalog, GraphReport, `graph.json`
manifest, CLI verbs, `serve` — is product built *on* these six. If all of it vanished,
the six primitives plus the specs would let anyone rebuild it. That is the
infrastructure test passing.

Merged/removed by this review: the per-author ledger (merged into P1/P2), capture-time
repoId (dissolved into P4), "coverage map as stored object" (it is derived; P6 is the
rule), Evidence URI and link-id schemes (unified in P3).

## 3. Threat analysis (what the graph adds to THREAT-MODEL.md)

The Same-UID Ceiling is unchanged and restated on every graph surface: the graph
proves objects unaltered since sealing; it cannot upgrade capture fidelity.

New at graph scale:

- **Provenance of submission.** Without V2 signing, "who put this record in the store"
  is answered by the *transport's* access control and history (git commits attribute
  adds; a dumb share attributes nothing). Stated per deployment; never implied
  stronger. A forged-at-capture record that verifies (T3) pollutes the graph exactly
  as far as the store's write ACL allows — the graph's write ACL is therefore a
  first-class deployment concern, documented, not solved in software.
- **Identity pollution.** A record claiming another repo's remote joins that repo's
  view. Mitigations: bases are always visible; equivalence/distinction links are
  authored and reversible; resolution never destroys (regroup, don't rewrite). Not
  prevented — attributed and correctable, T2-grade.
- **Deletion.** Objects can be removed from a dumb store silently. Git transport makes
  deletion visible in history; share/S3 deployments cannot detect absence of what was
  never pinned. **Accepted and stated in V1; properly closed by V2 anchoring**
  (checkpointed manifests) — the gap and its owner are named now so V2 consumes V1
  instead of retrofitting it.
- **Link spam / claim conflicts.** Links are labelled claims; conflicting claims
  coexist visibly (like diverged branches), filterable by author; retraction links
  supersede without erasing. Claims never reach facts (P5), so the blast radius of a
  malicious link is presentation, not evidence.

## 4. Failure analysis

| Failure | Behavior (by design) |
|---|---|
| Object bytes ≠ its address | Detected on read/verify; quarantined; named in `graph verify` output |
| Record deleted | Dangling citations fail loudly on resolve; coverage shrinks visibly only under git transport (see §3 deletion) |
| Link deleted | A claim disappears; claims were never facts; git transport shows who/when |
| Index corrupt / disagrees | `reindex` — the index is disposable by contract; rebuild-determinism is a conformance test |
| Ingestion twice / out of order / years late | No-ops / legal / legal — the store is unordered by construction; ordering is a *query* property using stated clocks |
| Clocks skewed across machines | Cross-machine ordering is approximate and every time-windowed view says "by stated clocks" — the graph-scale RF-04 assumption discipline |
| Two stores merged | Union of objects; identical objects dedupe; resolution recomputes — no merge step exists to fail |
| Half-written object mid-sync | Write-temp-then-rename in the binding spec; readers ignore names that don't parse/verify |
| Empty-session records | chainHead = genesis for all of them — session key is (sessionId, chainHead); empty records are flagged, not conflated |

## 5. Scalability analysis

| Scale | Store | Index | Transport |
|---|---|---|---|
| 1–50 eng | directory / git repo | local SQLite per consumer (never shared, never synced) | git push/pull |
| ~500 | git with packing, or S3 bucket; records zstd-compress well | same; heavy readers move to a server-side index | git partial clone or S3 sync |
| ~5,000 | object storage; the keyspace maps 1:1 to S3 keys because P2 was defined transport-agnostic | server-side index (Postgres/DuckDB) behind the read API — legal because the index is out-of-spec | HTTP read API + local caches; immutability makes CDN trivial |
| ~50,000 | federated graphs (union of stores is well-defined — §4 "two stores merged") | per-domain indexes | same |

SQLite fails first at concurrent network-share access — which the design already
forbids (index is local-only). Git fails as transport around the mid hundreds of
engineers by volume, not by correctness; the binding swap to object storage changes
zero formats. Records stay immutable forever except legal/secret removal: delete the
object, add a `retracts`-type tombstone link carrying the reason but not the content
— dangling references stay detectable, the *why* is preserved, the bytes are gone
(the D-037 posture, graph-scale). Indexes are regenerable always, from objects alone;
anything not regenerable from objects is by definition misplaced.

## 6. Identity model (Phase 3, the hardest problem)

**Rule zero: records carry evidence, the graph resolves, humans correct, nothing is
destroyed.**

Capture (additive, payload-internal, no format bump): `session.start` gains
`gitRemotes: [{name, url-normalized}]` (credentials stripped at capture,
adversarially tested), `gitRootCommits: [sha]` (all roots of HEAD's history —
orphan-branch and multi-root safe), alongside existing `cwd`, `machineId`,
`gitCommit`. Normalization canonicalizes ssh/https/scp forms to `host/path` with
`.git` stripped — specified with vectors.

Resolution (derived, at index time): identity signals cluster records into repo
groups. Precedence when signals conflict inside one record's own evidence: any shared
normalized remote ⇒ same group; else shared root commit ⇒ same group; else
machine+path ⇒ weak singleton group. Every group answer carries its basis.

Correction (declared): `identity:same-repo` and `identity:distinct-repos` links merge
or split groups. Applied at derive time; recomputable; reversible by retraction.

The stress table:

| Case | Outcome |
|---|---|
| Fork | Different remote ⇒ distinct repo (correct for evidence); shared root commit is surfaced as *lineage*, never silently merged |
| Mirror (two remotes, one repo) | Both remotes in one record's evidence ⇒ merged automatically the first time any session sees both; else one `same-repo` link |
| Hosting rename | Old and new remote URLs bridge through sessions that observed the transition, or one link |
| Multiple remotes (origin+upstream) | All captured; upstream-sharing forks *would* wrongly merge — precedence therefore uses remotes a repo *pushes* to when observable, else all remotes, and the coverage/basis label makes the wrong merge visible and one `distinct-repos` link fixes it |
| SSH vs HTTPS forms | Normalization (vector-pinned) |
| Detached HEAD / branches / rebase / squash / cherry-pick | Irrelevant to identity: records pin `gitCommit` as a point-in-time observation; history rewrites after the fact cannot alter sealed evidence |
| Shallow clone (no root commit) | Remote basis carries it; else weak basis, labelled |
| History rewrite changing roots | Remote basis carries it; else the split is visible and linkable |
| Brand-new repo, no commit, no remote | Weak basis, upgraded automatically when later sessions add signals — identity evidence *accumulates* |
| Monorepo | Repo identity + path; service = declared link type mapping path patterns (V3 seam, not V1 machinery) |
| Offline work | No remote reachable ⇒ root-commit basis; merges up when connectivity returns in later records |
| Renamed/migrated repository | The rename is data (two signals, one continuity link), never a loss |

What identity V1 refuses to model: person identity (unauthenticatable under the
Same-UID Ceiling until V2 keys; privacy decision bundled with it) and cross-commit
*ancestry* (requires the repo, not the record; equality only, stated).

## 7. Storage model

One sentence: **an add-only logical keyspace of typed, content-addressed, immutable
objects, with bindings (directory, git, object storage) defined separately from the
model.** The GRAPH-SPEC therefore has two parts: Part A, objects and addresses
(stable for a decade); Part B, bindings (evolve freely). The proposal's §5.3 layout
becomes Binding 1 (directory), with the write-temp-rename rule, fanout, and the
`index/` exclusion. Git-as-transport is Binding 1 under version control — documented,
including what its history does and does not attest (§3).

## 8. Graph model

### 8.1 Nodes and edges, final

Nodes: evidence objects (records, links). Derived views additionally materialize:
sessions (keyed by `(sessionId, chainHead)`), repo groups (P4), agents, machines,
files (repo-group + normalized path).

Edges: **derived** (recomputed: same-group, same-file, same-agent, same-machine,
same-commit, temporal adjacency *by stated clocks*) and **declared** (links:
`relates-to`, `supersedes`, `mission`, `incident`, `review`, `identity:same-repo`,
`identity:distinct-repos`, `retracts`; namespaced `x-<ns>:<type>` for extensions).
Multi-membership everywhere (a record in many missions/incidents; RF-07 out-of-scope
writes let one record touch several repo groups' *file* views while belonging to one
session). Cycles in declared links are legal (claims may disagree; conflicting
`supersedes` chains render as conflicts with authors, like diverged branches — the
graph surfaces disagreement, it does not adjudicate).

### 8.2 Why links are objects, not ledgers (the killed design, recorded)

Chained per-author ledgers failed three ways: multi-device authors fork their own
chain on dumb transports (self-conflict); a single claim can never be deleted
(legal/secret removal breaks the author's whole history — the exact tension D-037
resolved by *not* chaining blobs); and it duplicated storage disciplines. As
immutable objects: no conflicts, dedupe by address, retraction is additive, deletion
degrades one claim not a ledger, and V2 attestations join the same store as a third
object type with zero new machinery. Cost, accepted and stated: the claim *set* has
no self-integrity — tamper-evidence of set membership comes from the transport (git)
or V2 anchoring, not from V1 software.

### 8.3 Rebuildability

Everything derived — indexes, groups, coverage, GFs, every query answer — is a pure
function of the object set. `reindex` from an empty index is always safe and its
determinism is a conformance test. Graph "migrations" do not exist: new object format
versions live beside old ones; derive-time code understands both; nothing is ever
rewritten in place.

## 9. API philosophy

The API is not the architecture. If every endpoint and CLI verb disappeared, the
objects, addresses, and specs would remain sufficient to rebuild them — that is the
test each surface must keep passing. Order of durability: **formats** (RECORD-SPEC,
GRAPH-SPEC Part A — decade-stable) → **operations** (put/get/has/list/verify/resolve/
derive — the primitive verbs, stable) → **named queries and GF catalog** (additive
product) → **CLI/HTTP bindings** (porcelain). HTTP arrives in V1.x as a *read binding
of the same operations*, never as a place where new semantics live.

## 10. Alternative architectures considered (and why not)

- **Central service first** (Blueprint's fabric-as-service): rejected — re-introduces
  the merge/trust/availability problems seal-and-collect dissolved; violates the
  V0 no-infrastructure discipline that is still paying.
- **One global chain / chain-of-chains, or DAG-linked records** (each record cites
  prior heads, Merkle-forest style): genuinely attractive for deletion-detection, but
  it makes ingestion order-dependent and turns late/parallel arrivals into forks to
  manage — importing git's *hardest* semantics (merge) to get a property V2 anchoring
  provides cleanly. Deferred to V2, deliberately.
- **Event streaming into an org store (OTel-style collector)**: maximal freshness,
  but it moves the trust boundary off the sealed artifact, re-opens merge, couples
  capture to network availability, and makes the agent's hot path depend on
  infrastructure. Rejected for V1; reconsidered only as a *transport* for sealed
  records later.
- **Everything-in-SQLite (one shared database as the store)**: simplest single-team
  option; fails multi-writer over shares immediately, makes the store un-diffable and
  transport-bound, and turns the index into the source of truth — the exact inversion
  P2/P6 forbid.
- **Links as records** (one primitive only): considered seriously; rejected because a
  claim is not an observation — forcing links through the record format would either
  bloat them with session frames or dilute what "record" means. Two object *types*,
  one object *model* is the resting point.

## 11. Tradeoffs accepted

- No real-time org view (records land at session end). Freshness traded for the trust
  boundary staying on the sealed artifact.
- No claim-set integrity without git transport or V2 (stated per deployment).
- No person identity, no agent benchmark (honesty and emergence, respectively).
- Wrong automatic identity merges are possible (upstream-remote case) — visible,
  basis-labelled, one link to fix; traded against capture-time identity's permanent
  baked guesses.
- Generator diversity means uneven evidence quality — handled by catalog-conditioning
  and per-record generator provenance, not by gatekeeping who may emit.

## 12. Final V1 specification (the rewrite, superseding V1-DESIGN.md where they differ)

**V1 is the Evidence Graph: an add-only store of typed, immutable, content-addressed
evidence objects — records and links — with graph-time identity resolution, derived
disposable indexes, citation-bearing queries, catalog-conditioned Graph Facts, and
mandatory coverage disclosure; synced over dumb transports; specified for independent
implementation.**

Deltas from `V1-DESIGN.md`, normative:

1. **One object model** (P1/P2): `records/` and `links/` are two prefixes of one
   content-addressed keyspace; links are unchained immutable objects; retraction is a
   link type; per-author ledgers are removed.
2. **Identity evidence at capture, resolution at derive time** (P4, §6): capture-time
   `repoId` is removed; `gitRemotes[]` + `gitRootCommits[]` are captured;
   `identity:*` link types are normative.
3. **Session key = `(sessionId, chainHead)`;** recordId keys the artifact. Multiple
   records per session (re-analysis by newer generators) are first-class and
   labelled by generator.
4. **GFs condition on each record's `evidence.catalog`** and carry clock/basis
   assumptions in their output (P6).
5. **GRAPH-SPEC is split**: Part A objects/addresses/resolution (decade-stable, with
   vectors), Part B bindings (directory, git, object-storage; evolvable).
6. Unchanged from the proposal: derived/declared separation enforced at the query
   (P5); index disposable by contract; named-query surface; coverage map on every
   output; `lodestar graph` as the sixth command; no HTTP until V1.x; RECORD-SPEC
   untouched (all V1 capture additions are payload-internal).

Milestone deltas: M0 captures identity *evidence* (not repoId); M4 (links) merges
into M1's object store with link types arriving where GF/queries need them; a new
M-explicit item lands identity resolution + its vectors before queries ship, because
every query depends on it.

## 13. Open questions (genuinely unresolved — carried, not hidden)

1. **Multi-root and upstream-remote precedence** — the automatic-merge rules need
   field data; shipped behind basis labels so early wrong answers are visible and
   correctable, but the defaults may need reversal after real monorepo/fork corpora.
2. **Coverage expectations** — should a graph let a machine/team *declare* expected
   cadence ("sessions land daily") so absence becomes a flagged gap rather than mere
   smaller coverage? Powerful honesty, easy bureaucracy. Undecided; a link type
   sketch exists; needs a real team's pull.
3. **Record size discipline** — stdout tails at org scale may dominate storage;
   whether V1 needs a size-bounding profile in GRAPH-SPEC Part B or leaves it to
   compression is unmeasured.
4. **How much of `graph verify` runs on `add` at scale** — full verification per add
   is O(record); at S3-binding scale a verify-on-read/quarantine posture may be
   needed; contract wording must not overpromise either way.
5. **The sixth command's surface area** — `graph` subcommand sprawl is the D-012
   failure mode returning through a side door; the named-query contract is the
   containment, but the line needs a decision when subcommands exceed ~7.
6. **Whether anyone shares** — the entire team layer rests on the unproven assumption
   that developers will push evidence to a common store (see WHAT-REMAINS.md §6 for
   the evidence plan). If they don't, V1 still serves solo cross-session/cross-repo,
   but the compounding thesis needs its first real datapoint.
