# LODESTAR V1 — The Evidence Graph

> **⚠ Amended by review.** This proposal was adversarially stress-tested in
> [`V1-DESIGN-REVIEW.md`](V1-DESIGN-REVIEW.md), and four load-bearing pieces did not
> survive: per-author chained link ledgers (→ links are content-addressed objects in
> one unified store), capture-time `repoId` (→ identity *evidence* at capture,
> resolution at derive time), recordId as session identity (→ session key =
> `(sessionId, chainHead)`), and Graph Facts assuming LODESTAR's fact catalog
> (→ catalog-conditioning). **Where the two documents differ, the review's §12 is
> normative.** This document remains the narrative rationale and roadmap.
>
> **Status:** design, awaiting founder ratification (DECISIONS.md D-062 🔶).
> **Supersedes:** the V1 framings in `LODESTAR-VISION.md` §4 ("Team visibility, deeper
> explanation") and the Second-Generation Blueprint's V1 ("Evidence Fabric") — not in
> mission, which both got right, but in architecture, which building V0 corrected.
> **Prerequisites:** `RECORD-SPEC.md` (the artifact V1 is built from), `STABILITY.md`
> (the interfaces V1 may rely on), `THREAT-MODEL.md` (the claims V1 may not exceed).

**Mission: turn isolated evidence into organizational engineering intelligence.**
The customer's question moves from *"what did my agent actually do?"* to *"what has
actually happened across my engineering organization — every repo, every agent, every
machine — and can I check any answer I'm given?"*

"Intelligence" is defined operationally, because the word invites exactly the failure
V0 banned: **intelligence here means deterministic aggregation, linkage, and query over
verifiable evidence, with a citation on every answer.** It never means model-generated
narrative about the corpus. An LLM summary of the graph is the agent-reporting-on-itself
problem at organizational scale, and it stays on the do-not-build list.

---

## Part 0 — Reconcile reality: what building V0 taught us

### 0.1 What V0 is today

Not a recorder. V0 is an **Evidence Engine** whose output is a **sealed, portable,
self-verifying artifact** — the Evidence Record: deterministic from the ledger,
content-addressed (`recordId`), canonical (RECORD-SPEC v1), vector-pinned, verifiable
by a zero-dependency verifier that is deliberately a second implementation. The
reports, dashboard, and exports are renderings of that artifact. The five-command CLI
and the capture engine are how records get *made*; the record is what V0 *is*.

### 0.2 Assumptions that changed — the load-bearing discovery

**The Blueprint's "hard V1 problem" dissolved.** It named V1's core challenge as
*"tamper-evident merge from thousands of untrusted collectors"* — merging hash chains
from many machines while keeping them verifiable. Building V0 removed the problem
instead of solving it:

- Chains are **per-session**, not per-database. A session is an independently
  verifiable unit with its own genesis and head.
- A record **seals** one session: complete event list, chain frame, computed evidence,
  content address.

Therefore the organizational store never merges a chain. It **collects sealed
artifacts** and verifies each one independently. Two records can never conflict — they
are immutable values with content addresses. This is git's architecture, used as
architecture rather than analogy: git never merges object databases; it transfers
immutable content-addressed objects and builds cheap references over them. **V1 is
seal-and-collect, not stream-and-merge.**

Three consequences follow, each reversing a Blueprint implementation assumption:

1. **Ingestion is record-level, not observation-level.** Streaming raw observations
   org-wide would re-open the merge problem, couple capture internals to the org
   store, and move the trust boundary mid-flight. The record is the trust boundary;
   ship the sealed unit. (The "ingestion protocol" the Blueprint wanted as a standard
   already shipped: it is RECORD-SPEC.)
2. **No service is required for correctness.** Immutable record files plus per-author
   append-only link ledgers mean the org store can be a directory synced by any dumb
   transport — a network share, rsync, S3, **or a git repository**. A server is
   porcelain (convenience, read API, UI), never the root of trust. V0's "every piece
   of infrastructure is a future failure mode and a future bill" survives into V1
   longer than anyone expected.
3. **Backfill is free.** `buildRecord` is deterministic over any historical ledger, so
   an organization's existing V0 history seeds the graph with zero migration.

### 0.3 Assumptions that strengthened

- **Evidence over record.** The audit trail (D-045: evidence is contextualized, never
  cancelled; D-053: unknown never collapses into a claim) generalizes cleanly to graph
  scale and dictates the graph's central design rule (§4.2: derived vs declared).
- **Vendor neutrality turned cross-agent from a milestone into a dimension.** Records
  already carry `runtimeId`, `runtimeVersion`, `model`. The moment two records sit in
  one store, cross-agent queries exist. No "cross-agent phase" is needed — the
  Blueprint's coverage network effect starts at the second record.
- **Determinism keeps paying.** Idempotent ingestion (recordId dedupe), rebuildable
  indexes, byte-stable conformance tests, and free historical backfill are all the
  same property spent four ways.
- **The schema-designed-for-later bet.** `machineId`, `model`, `gitCommit`,
  `missionId` were captured "for V2/V3." V1 is where they start earning.

### 0.4 Assumptions disproven or corrected

- **"A record the acting party cannot edit"** — falsified by V0's own adversarial
  audit (THREAT-MODEL §0–§1, the Same-UID Ceiling). V1 must not quietly re-promise it
  at graph scale: *a graph of records is exactly as forgeable-at-capture as its
  records.* Graph integrity (nothing altered since sealing; every answer re-derivable)
  is a real and valuable claim; capture fidelity remains bounded by T1/T2 until
  privilege separation, and every graph surface says so.
- **"V1 = team visibility / shared session viewer"** (Vision ladder) — too small. A
  viewer is a renderer, and renderers are the commodity slice. The unit of team value
  is the queryable, linked, verifiable corpus. The viewer falls out of it.
- **"Chain merge is the hard part"** — replaced by the real hard part building exposed:
  **identity** (§5). Which repository is this? Which agent? Same file across machines?
  Identity, stated with honest confidence, is V1's genuinely difficult problem.

### 0.5 New primitives V0 created that V1 builds on

`EvidenceRecord` + `recordId` (the object and its address) · per-session chains (the
sharding unit) · the chain head (address of an observation set) · the standalone
verifier contract (exit 0/1/2, states what it cannot prove) · `catalog` + `limitations`
(interpretable silence) · reserved keys `links`/`attestations`/`extensions` (the seams
V1 and V2 plug into, already in the wire format).

### 0.6 Verdict on the proposed direction

The Organizational Evidence Graph is the correct V1, with three corrections to the
proposed evolution ladder:

1. **Cross-agent is not a stage** — it is a query dimension present from the first two
   records (§0.3). The real staging is: identity → store → index/query → graph facts →
   links. Cross-team is deployment topology, not architecture.
2. **"Intelligence" is defined operationally** (see mission statement) — aggregation,
   linkage, query, citations. Never narrative generation.
3. **The graph is two layers or it is nothing** (§4.2). Derived edges (recomputed from
   record contents, disposable) and declared links (authored claims, append-only) must
   never blur. Blurring them is claim-parsing at graph scale — the exact failure the
   Reality Facts Rule exists to prevent.

---

## 1. Executive summary

V1 adds one new composite primitive — the **Evidence Graph** — built entirely from
V0's sealed Evidence Records plus one new atom, the **Link**. A graph is a directory:

```
.lodestar-graph/
  graph.json                     # identity + format version + policy
  records/ab/<recordId>.record.json   # immutable, content-addressed, verifier-checkable
  links/<author>.links.jsonl     # per-author append-only, hash-chained claims
  index/graph.db                 # DERIVED — disposable, rebuildable, never synced
```

Records are added idempotently (`lodestar graph add`), verified individually and in
bulk (`lodestar graph verify`), indexed into a rebuildable SQLite database
(`lodestar graph reindex`), queried through named, citation-bearing queries
(`lodestar graph query`), and connected by authored links (`lodestar graph link`).
Deterministic **Graph Facts** (GF catalog) surface cross-session divergences with the
same four-rule honesty bar as Reality Facts, and a mandatory **coverage map** states
what the graph does *not* contain, so absence of records can never masquerade as
absence of activity.

Because every stored object is either immutable or per-author append-only, the graph
syncs over any dumb transport — including a plain git repository — and needs no server
to be correct. It is Team Intelligence delivered as infrastructure: the Blueprint's
Evidence Fabric mission, implemented as **a graph over sealed records** instead of a
merged-chain service.

## 2. Why V1 must evolve from V0

V0 answers "what happened in this session, on this machine, and can I check it?" The
question every team hits within weeks of running agents is the plural: *what touched
this file this week, by any agent, on any machine? Has this failure happened before?
Which sessions changed the payments service and were any of them test-observed? Is any
record in our history broken?* V0 has the evidence and no way to hold it together. The
records are sealed exactly so they can travel; V1 is where they arrive.

Strategically (Blueprint, Missing 10%): the fabric's compounding — every record makes
the corpus more complete and the store more indispensable — only begins when records
accumulate in one place. The graph is that place, and shipping it local-first keeps the
wedge discipline: a single developer gets cross-session/cross-repo value alone, a team
gets it by pointing the graph directory at a shared transport, and no one buys
infrastructure to start.

## 3. Updated architecture

The V0 pipeline gains one layer and changes nothing beneath it:

```
Execution Boundary → Observation → Evidence → Evidence Record → Verification → Presentation   (V0, untouched)
                                                    │
                                                    ▼
                                          ┌──────────────────┐
                                          │  EVIDENCE GRAPH  │            (V1)
                                          │  records + links │
                                          │  derived index   │
                                          └──────────────────┘
                                                    │
                              graph verification · named queries · Graph Facts
                                                    │
                                        graph presentation (CLI, serve)
```

Layering rules, extending D-049/D-059 upward:

- **Records are the only source of observed truth.** The graph never modifies,
  re-hashes, or partially stores a record. Store the sealed artifact byte-for-byte.
- **The index is derived and disposable, by contract.** `reindex` is a first-class,
  always-safe operation; the index is never synced and never trusted — any answer it
  gives is re-derivable and spot-checkable against records. (The Kubernetes principle,
  translated: immutable declarative objects are truth; everything else is a
  controller's reconcilable view. `graph.db` is our etcd-*cache*, not our etcd.)
- **Links are evidence of organizational context, not observations.** They get V0's
  integrity machinery (append-only, hash-chained, per-author) and narration's
  epistemic treatment (claims, labelled, never inputs to facts).
- **Graph presentation renders one `GraphReport` model** — the D-049 contract at graph
  scale. The CLI and any future server/UI render the same computed model.

## 4. Core primitives

### 4.1 Fundamental vs implementation detail

| Primitive | Status | Why |
|---|---|---|
| Evidence Record | **fundamental (exists)** | The object. V1 adds nothing to it. |
| Evidence URI | **fundamental (new)** | Stable citation: `evidence:<recordId>` / `evidence:<recordId>#<seq>`. Every graph answer cites these; V2 attestations will reference them. |
| Link | **fundamental (new)** | The authored edge — the only new atom in V1, and the seed of V3's Knowledge Links (the reserved `links` key finds its meaning). |
| Identity (repo / agent / machine) | **fundamental (new)** | The join keys, each carrying its derivation basis and confidence (§5.2). |
| Graph store layout | **fundamental (new, GRAPH-SPEC)** | The portable contract: what a graph *is* on disk, so second implementations and dumb transports work. |
| Coverage map | **fundamental (new)** | Honest silence at graph scale. A graph without it is a lie by omission. |
| Graph Facts catalog | fundamental in *shape*, growable in members | Same rule-of-four as RF; graph-scale inputs. |
| Derived index schema (SQLite) | implementation detail | Explicitly out of GRAPH-SPEC. Rebuildable → replaceable. |
| Query engine internals | implementation detail | The *named query contract* is stable; SQL is not exposed as API. |
| `serve` UI | implementation detail | Porcelain. |

### 4.2 The graph's SignalTier: derived vs declared

Every edge in the graph is exactly one of:

- **Derived** — computed deterministically from record contents alone (same repoId,
  same file path within a repo, same agent, same machine, temporal adjacency, same
  gitCommit). Recomputable by anyone from the records; carries the record fields it
  was derived from. Lives only in the disposable index.
- **Declared** — asserted by an author ("this record relates to incident-421", "this
  session supersedes that one"). A claim with provenance: author, time, reason,
  hash-chained in that author's ledger. Never an input to a Graph Fact; always
  labelled in output.

This is the same epistemic split as `groundTruth` vs `narration`, and it is enforced
the same way: Graph Facts are computed from derived data only, at the query, so a
declared link cannot reach the fact engine. (D-009's mechanism, third use.)

## 5. Data model

### 5.1 Objects

```
Graph            { graphId, format: 'lodestar-evidence-graph', formatVersion: 1, policy? }
StoredRecord     the Evidence Record, verbatim (RECORD-SPEC v1) — keyed by recordId
Link             { id, author, ts, type, from: EvidenceURI, to: EvidenceURI | URL,
                   reason, prevHash, hash }          — chained per author ledger
RepoIdentity     { repoId, basis: 'remote' | 'root-commit' | 'machine-path', display }
AgentIdentity    { runtimeId, runtimeVersion?, model? }
MachineIdentity  { machineId }                        — already a stable hash (V0)
CoverageMap      { repos[], machines[], agents[], timeSpans[], knownGaps[] }  — derived
GraphReport      the computed model every graph surface renders
```

Link types v1 (closed set, namespaced extensions allowed as `x-<ns>:<type>`):
`relates-to`, `supersedes`, `mission`, `incident`, `review`.

### 5.2 Identity, with honest bases — V1's hard problem

Identity is where cross-anything either works or silently lies, so every identity
carries **how it was derived**:

- **RepoIdentity.** Preferred basis: SHA-256 of the *normalized* git remote URL
  (scheme/credentials/`.git` stripped — credentials must never reach the record;
  normalization is specified in GRAPH-SPEC). Fallback: root-commit hash (clones with
  no remote). Last resort: `machineId + cwd` hash, basis `machine-path`, which the
  coverage map flags as weak. Requires one additive, optional capture:
  `gitRemote` in the `session.start` payload — payload-internal, therefore **no
  record-format bump** (RECORD-SPEC §6 additive rule).
- **AgentIdentity** is *claimed at wrap time* (the wrapper was told `claude`), with the
  argv observed by the parent as supporting ground truth. Stated as such.
- **MachineIdentity** exists (hashed, non-reversible).
- **PersonIdentity is deliberately absent from V1.0.** A link's `author` is an
  unauthenticated claimed string until V2 keys exist — the Same-UID Ceiling means V1
  could not *prove* authorship anyway, and pretending otherwise would be the overclaim
  THREAT-MODEL exists to prevent. Engineer-level analytics are therefore also out
  (privacy posture + provable-identity gap, one decision).
- **Mission** stays what it is in V0: a *stated* intention (narration-adjacent).
  Grouping by mission is offered as a declared/weak-basis view, never a fact input.

### 5.3 The store, on disk (GRAPH-SPEC v1, to be written as part of M5)

As in §1. Properties that make it infrastructure rather than an app's data folder:

- Records: write-once files named by recordId (2-hex fanout). Re-adding is a no-op
  (dedupe by name); a file whose content does not hash to its name is a detected
  corruption, not a mystery.
- Link ledgers: append-only JSONL, one per author, each line chained with the same
  `canonicalJSON`/`chainHash` machinery (genesis per ledger). Multi-writer safety by
  construction: **nobody ever appends to someone else's chain** — the same
  seal-and-collect move as records, applied to authors.
- `index/` is listed in the graph's own ignore file by `graph init`; syncing it is
  harmless but pointless.
- Sync = any transport that can move files. Git works and is documented as the
  zero-infrastructure team deployment: immutable adds and per-author appends make
  merges trivial by construction.

## 6. Evidence Graph design (how the pieces interact)

**Ingestion** (`graph add`): verify the record (the verifier's checks, §7 of
RECORD-SPEC — structural, recordId, chain, tiers, integrity-claim consistency) →
refuse ALTERED/INVALID artifacts with the verifier's own wording → store bytes
verbatim → update index. Idempotent by content address. `--from <project>` backfills
every session of an existing V0 ledger.

**Verification** (`graph verify`): re-verify every stored record independently, check
every link ledger's chain, confirm the index is consistent with the store (or offer
`reindex`). Output ends in the graph's three words: `INTACT` (all records verify,
ledgers verify) / `DEGRADED` (verifiable, but the coverage map names gaps — e.g.
records whose own status is DEGRADED, or known-missing spans) / `BROKEN` (any stored
artifact fails verification — named individually). The graph never averages integrity:
one broken record is listed, not amortized.

**Indexing** (`graph reindex`): deterministic pass over records + ledgers → SQLite.
Rebuild-determinism is a conformance test: two rebuilds must answer every named query
identically.

**Query** (`graph query <name> [args]`): named queries only (§10); every row cites
Evidence URIs; every result carries the coverage map header; `--json` for tooling.

**Linking** (`graph link <type> <from> <to> --reason`): appends to the caller's
ledger. Links never delete or suppress anything (D-041's rule, graph scale).

## 7. Repository relationships

Derived, from identity + record contents: *contains-session* (repoId → records),
*same-file* (repoId + normalized path across sessions), *commit-lineage*
(`gitCommit` equality across records; full ancestry requires the repo itself and is
declared out of scope for the graph — basis honesty), *cross-repo same-machine* (a
machine's activity across repos). Declared, via links: *depends-on*, *supersedes*,
service/incident/review associations — organizational meaning that no record can
observe, which is exactly why it must arrive as an authored claim.

## 8. Cross-session reasoning

Deterministic joins over derived edges, surfaced as **Graph Facts** (rule-of-four plus
the graph rule: *derived inputs only*), for example:

- **GF-01 — Contention:** file F in repo R was modified in N sessions within window W,
  by ≥2 distinct agents or machines. (Evidence: the file.write events, cited.)
- **GF-02 — Recurrence:** the same RF fired on the same target across ≥N sessions.
  ("This is the third session that left payments.mjs modified after its last observed
  test run.")
- **GF-03 — Unobserved-verification concentration:** sessions changing repo R whose
  own records declare no observed test command — aggregating each record's
  *limitations honestly*: the GF quotes the per-record limitation; it never upgrades
  "not observed" into "not run".
- **GF-04 — Integrity:** any BROKEN record, or any session whose record is absent from
  a span the coverage map expects (stated as a gap, not an accusation).
- **GF-05 — Coverage divergence:** a command observed on machine A and shadowed on
  machine B — the org-scale version of D-023's honesty.

Every GF carries Evidence URIs down to the event level. None consumes a declared link.

## 9. Cross-agent reasoning

A dimension, not a subsystem: every query and GF groups by `AgentIdentity` for free.
What V1 deliberately does **not** ship is an agent benchmark or reliability score —
The Missing 10% is explicit that the benchmark/reputation effect is emergent-only and
is destroyed by forcing it early; a per-team sample would be noise sold as measurement.
V1 outputs neutral counts with citations ("agent X: 14 sessions, 3 with divergences —
here they are"), states the sample, and draws no conclusion. The corpus design
(anonymized aggregatability) is preserved for the day scale exists; the scoring is not
built.

## 10. Organizational queries (the named-query contract, v1)

`file-history <repo> <path>` · `repo-activity <repo> [--since]` ·
`sessions [--agent|--machine|--repo|--since|--mission]` · `divergences [--rf|--repo]` ·
`record <recordId>` (fetch + verify one) · `resolve <evidence-uri>` (citation → event) ·
`coverage` (the map itself) · `links [--author|--type|--target]` (declared layer,
labelled) · `agents` / `machines` / `repos` (identity inventories with bases).

Contract: stable names, stable argument semantics, additive growth, `--json` shapes
versioned with the graph format. Raw SQL is never API.

## 11. Public APIs

- **Library (`src/graph/`)**: `openGraph`, `addRecord`, `verifyGraph`, `reindex`,
  `query(name, args)`, `appendLink`, `coverage()` — the same functions the CLI calls;
  STABLE per STABILITY.md rules from first release.
- **CLI**: one new top-level command, `lodestar graph <sub>` (requires a D-entry —
  the sixth command rule, D-012). Five-plus-one, not fifty.
- **Formats (the real API)**: RECORD-SPEC v1 (unchanged) + GRAPH-SPEC v1 (store
  layout, link format, Evidence URI, normalization rules, named-query JSON shapes),
  each with golden vectors and conformance tests, each independently implementable.
- **HTTP read API: deferred to V1.x**, contract-first when it comes; the library and
  formats are the durable surface. (OpenTelemetry's lesson applied: win by being what
  everyone can emit and read, not by owning a server.)

## 12. Extension points

- **Link-type namespaces** (`x-<ns>:<type>`) — third parties add semantics without
  format changes.
- **Named-query registry** — extensions may register read-only queries over the
  derived index.
- **Analyzers** — may read records and *declare links* (claims, in their own authored
  ledger). The 10%'s rule, enforced structurally: **extensions analyze; they never
  assert observations** — nothing an extension writes can enter `records/` except a
  conforming, verifier-passing record, and nothing it writes can enter a Graph Fact.
- **Reserved seams honored**: record-level `attestations`/`links`/`extensions` keys
  stay reserved; V2 attestation will attach to recordIds and Evidence URIs without
  touching V1's store layout.

## 13. Migration from V0

**None required, by design.** No ledger schema change; no record format bump
(`gitRemote` is payload-optional; old records fall back to weaker repo-identity bases,
visibly). V0 workflows continue byte-identically; the graph is purely additive.
Backfill: `lodestar graph add --from <project>` builds records from every existing
session. The only compatibility obligation V1 accepts: the golden vectors of
RECORD-SPEC v1 must remain green through the entire V1 series — asserted in CI by the
existing conformance tests.

## 14. Risks and tradeoffs

- **Privacy is the sharpest edge.** Records carry command lines and paths
  (capture-time redaction is best-effort, D-028). Pushing to a shared graph is a
  disclosure act. Mitigations: `graph add` prints what will be shared (`--review`),
  graph policy in `graph.json` (e.g. minimum generator version, required-redaction),
  docs that say "a graph is as sensitive as your terminal history" in those words.
  Residual risk accepted and stated.
- **Perceived as centralized logging** → undersold (Blueprint's named failure mode).
  Mitigation: every surface leads with verifiability and Graph Facts, never "search
  your logs"; the verifier works on any record pulled *from* the graph.
- **Link spam / wrong links** — authored claims are filterable by author and never
  contaminate facts; a bad link is visible, attributed, and non-destructive.
- **Identity mistakes** (fork vs clone, remote rewrites, path collisions) — bases and
  confidence are carried everywhere; wrong-basis grouping is inspectable rather than
  silent. Remote-URL normalization is specified and vector-tested.
- **SQLite index at scale** — fine for orders of magnitude beyond a team; because the
  index is disposable by contract, outgrowing it is an implementation swap, not a
  format event.
- **Same-UID Ceiling at graph scale** — restated on every graph surface: the graph
  proves records unaltered since sealing; it cannot upgrade what capture could prove.
  The graph's value against T1/T2 (the market) is real; T3 remains V2's
  privilege-separation and attestation work.
- **Tradeoff accepted:** no real-time org view in V1.0 (records land at session end;
  live streaming is a V2+ concern gated on the fabric earning adoption). Chosen
  because live ingestion is precisely the coupling that re-opens every dissolved
  problem in §0.2.

## 15. What intentionally belongs in V2 instead

Signing, attestation, external anchoring, revocation (the trust-crossing layer);
privilege separation and checkpoints (THREAT-MODEL C1–C7); person-identity proof;
verification-network relationships (auditor-facing); the agent benchmark (emergent
only); real-time gating/prevention; HTTP write APIs and multi-tenant service; any
model-generated summarization (never, in this form).

---

# Implementation roadmap

Evolutionary; every milestone compiles, ships, keeps V0 byte-compatible (vectors stay
green), carries tests, and needs no migration. Order chosen so each milestone is
independently valuable — stopping after any of them leaves a coherent product.

> **Shipped status (V1 core complete).** The milestone *labels* below are the original
> proposal; **V1-DESIGN-REVIEW §12 is the normative spec and reshaped several of them.**
> As built: **M0** identity evidence + resolution (D-063/D-064), **M1** the object store
> (M-V), **M2** derived index + six named queries (D-066), **M3** sharing + corpus +
> investigations (D-067/D-068), **M4** the Link object — declared layer P5, identity
> correction P4, retraction, the P5 gate (D-070). Note M4 is **not** the "per-author
> chained ledger" described below: that design was killed (§8.2) and links are
> content-addressed objects in the one store. **M5** GRAPH-SPEC v1 (Part A + directory
> binding + link format) with golden vectors is written and green; the optional
> `graph serve` porcelain is deliberately deferred to V1.x with HTTP. What remains for
> V1 is not construction but **exposure** — the WHAT-REMAINS §7 field gates (real teams
> sharing; a human declaring a link because they needed to; an outside verification).

**M0 — Identity foundations** *(small)*
Capture normalized, credential-stripped `gitRemote` in `session.start` (additive,
payload-internal); `src/graph/identity.ts` deriving Repo/Agent/Machine identities with
bases from any record (old records → fallback bases). Decisions: D-063 (gitRemote
capture + normalization), D-064 (identity bases). Tests: normalization vectors
(credentials stripped is adversarially tested), basis fallbacks. Releasable: V0
behavior unchanged; record format unbumped (conformance suite proves it).

**M1 — The graph store** *(the primitive lands)*
`src/graph/store.ts`: `init` / `add` (verify-then-store, idempotent, `--from`
backfill) / `verify` (per-record + store consistency, INTACT/DEGRADED/BROKEN). CLI
`lodestar graph` (D-062 ratified; sixth command logged). Tests: dedupe, refusal of
ALTERED records with verifier wording, backfill of a real historical ledger, tamper of
a stored file detected by name-vs-content.

**M2 — Derived index + named queries**
`reindex` (deterministic, disposable), query engine, first eight named queries with
`--json` and Evidence-URI citations; `resolve`. Tests: rebuild-determinism (two
rebuilds ≡ identical answers), every citation resolves into a verified record.

**M3 — Graph Facts + coverage map**
GF-01…GF-05, `GraphReport` (one computed model; CLI renders it — D-049 at graph
scale), coverage map mandatory on every output; the empty-graph and sparse-graph
honesty cases pinned by tests (absence never renders as all-clear).

**M4 — The link ledger**
Per-author chained ledgers, `graph link`, link queries, derived/declared labelling
everywhere; conformance vectors for link chains. Tests: ledger verification, the
"links never reach facts" gate (structural, D-009-style), multi-author union.

**M5 — GRAPH-SPEC v1 + sync story**
Write the spec (layout, Link format, Evidence URI, normalization, query JSON shapes)
with golden vectors + conformance tests; document git-as-transport end to end
(init → add → push → teammate pulls → `graph verify` INTACT). Optional porcelain:
read-only `graph serve` rendering `GraphReport`.

**V1.x (post-1.0, gated on adoption):** HTTP read API (contract-first), auto-add
watcher, graph policy enforcement, index-engine swap if scale demands.

---

*The one-sentence test this design was written against: in 2032, an organization that
assumes LODESTAR exists is assuming a directory of sealed, individually verifiable
evidence objects and an append-only ledger of authored claims — things simple enough
to outlive every server, vendor, and index built on top of them.*
