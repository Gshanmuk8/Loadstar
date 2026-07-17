# LODESTAR V1 — Architecture Validation Report

> **Status:** engineering-review-board gate. Subject: the reviewed V1 architecture
> (`V1-DESIGN-REVIEW.md` §12, normative). No new features were considered; no roadmap
> was redesigned. The question ruled on: **is V1 buildable as specified, and are we
> ready to write the first line of code?**
>
> **Verdict up front: VALIDATED, with ten refinements (F1–F10) that belong in
> GRAPH-SPEC Part A before code — none of which changes a primitive — and a
> conditional YES on readiness (§10).** The simulation phase found the refinements;
> the primitives survived unchanged. A validation that found nothing would mean the
> simulation wasn't run; a validation that broke a primitive would mean the review
> failed. This landed where a working process lands.

---

## 1. Primitive validation (Phase 1)

The six primitives from V1-DESIGN-REVIEW §2, each put to the five questions:

| Primitive | Why it must exist | Invariant protected | Replaceable? Removable? | Verdict |
|---|---|---|---|---|
| P1 Evidence object (record \| link) | Trust needs a unit; exchange needs a boundary | "Unaltered since sealing" is checkable per object | A stream can't be sealed; a database row can't be handed to an auditor. Two *types* tried as one (links-as-records) — rejected in review §10; retried here, still bloats claims with session frames | **Fundamental** |
| P2 Store as add-only keyspace | Accumulation across machines/years with no coordination | Objects are only ever added; presence = bytes match address | Any mutable store reintroduces merge/conflict/trust; removal = no org layer at all | **Fundamental** |
| P3 Address / Evidence URI | Answers must be checkable → citations must be stable | A citation resolves to the same bytes forever | Paths/rows change; content addresses don't. Removal makes every answer unauditable | **Fundamental** |
| P4 Identity evidence + graph-time resolution | Cross-anything requires joins; joins over guesses lie forever if baked at capture | Records never carry conclusions about identity, only observations; groupings are recomputable and correctable | Capture-time IDs (killed in review); central registry (requires the infrastructure V1 refuses); removal = no cross-session value | **Fundamental** |
| P5 Epistemic split (observed/computed/declared) | The product's only asset is that its claims hold up | Claims can never launder into facts; enforced at the query | Merging tiers is claim-parsing (banned, D-009). Removal is the trust model's death | **Fundamental** |
| P6 Disclosure rule (coverage, bases, assumptions on every output) | A graph's silence spans machines and months; unread silence = false all-clear | Absence of evidence never renders as evidence of absence | Nothing else can carry this; removal breaks the honesty invariant V0 is built on | **Fundamental** |

Reduction attempts beyond the review's: fold P3 into P1 (objects self-describe) —
fails, citations must address *into* objects (`#seq`); fold P6 into P5 — fails, P5 is
about kinds of statements, P6 about completeness of view. **No primitive removed; none
added.** Everything else (queries, GF catalog, handles, coverage map contents, CLI) is
confirmed product-on-primitives.

## 2. End-to-end construction walkthroughs (Phase 2 — simulated, not described)

Format: objects created → transformations → checks → outcome. **Findings F1–F10** are
collected in §3.

**W1 — Two agents, one repo.** Dev A (machine `m1`) runs `lodestar claude` in a clone
of `github.com/acme/payments` (origin; root commit `r0`). Session `s1` → 240 chained
events, head `h1` → `lodestar report --record` → record `R1` (recordId `a1`).
`lodestar graph add` verifies R1 (structure, recordId recompute, chain walk, tier
rule, integrity consistency), writes `records/a1[0:2]/a1….record.json` via
temp+rename, indexes: session key `(s1,h1)`, identity evidence `{origin:
acme/payments, roots:[r0], machine: m1}`. Dev B wraps Codex on `m2`, same origin →
`R2 (a2)`, session `(s2,h2)`. Reindex: both records' evidence shares an origin →
**one repo group**. `graph query file-history acme/payments src/pay.ts` → rows from
both sessions, each citing `evidence:record/a1#87`-style URIs; each row labelled with
its generator and runtime (`lodestar 0.0.x / claude-code`, `… / codex`). GF-01 fires
(same file, two agents, one window, "by stated clocks"). Investigator resolves a
citation → fetches R2 → standalone verifier → INTACT → `reportFromRecord(R2)` renders
the full V0 report from the shared artifact. *V0 code (verifier, reportFromRecord)
required zero changes to serve the graph — the strongest buildability signal in this
walkthrough.* → **F1** (how "acme/payments" resolves as a query argument).

**W2 — Fork.** Bob forks to `bob/payments`; his records carry origin `bob/payments`,
root `r0`. Different origins ⇒ distinct groups; shared root surfaces as *lineage*,
never a silent merge. Queries on `acme/payments` exclude the fork. But Bob also has
`upstream: acme/payments` configured → his records carry both remotes → naive
shared-remote merging would fold the fork into upstream. → **F2** (conservative merge
default).

**W3 — Monorepo.** 300 engineers, one group, thousands of sessions. `file-history`
stays path-scoped and useful; GF-01 scoped to path (not repo) or it is pure noise;
`repo-activity` needs limits/pagination in the query contract (implementation note,
not architecture). Service views = declared path-pattern links (V3 seam, confirmed
not needed for V1 correctness).

**W4 — Repository rename.** `acme/payments` → `acme/billing`. Old records carry the
old origin, new records the new one, roots shared, origins differ — from capture data
alone a rename is *indistinguishable from a fork* (git itself cannot tell). Under F2
the groups stay split, lineage is surfaced, and one `identity:same-repo` link merges
them — recomputable, reversible, attributed. Cost of a rename: one command. Cost of
the alternative (auto-merge on shared root): every fork in the org silently merges.
Correct trade, confirmed by simulation.

**W5 — Branch work, squash-merge.** Session on a feature branch pins `gitCommit c17`;
the branch is later squash-merged and deleted; `c17` becomes unreachable. The record
is a sealed point-in-time observation — nothing dangles, nothing rewrites.
Commit-equality joins simply stop matching (ancestry is declared out of scope);
file-level history carries the investigation instead. Validated, with the limit
stated where the join is offered.

**W6 — Production incident.** 14:02 alert. `sessions --repo acme/payments --since 24h`
→ three sessions; `divergences --repo …` → R2's RF-04 on `src/pay.ts`; investigator
verifies R2 (INTACT), reads the diff evidence, declares
`link incident: evidence:record/a2 → https://jira/INC-421` with a reason. Weeks
later `links --target INC-421` reproduces the evidence trail. Coverage map on every
output; here it noted `m3` (a machine with prior records) silent for 9 days →
**F7** (last-seen staleness, honestly worded). The graph answered *what happened and
where's the proof* in four commands and adjudicated nothing.

**W7 — Re-analysis after an engine upgrade.** 2027: engine v0.3 adds RF-08. Old
records carry their full event lists, so re-analysis needs **no original ledger**:
`evaluateEvents(record.observations.events)` → new record `R1′` (new recordId, same
`(s1,h1)` session key, generator `lodestar 0.3`, catalog now incl. RF-08). Both
records coexist; queries default to the newest generator per session, others listed.
The (sessionId, chainHead) key — a review §12 fix — is what makes this scenario
*work* instead of double-count. → **F6** (records are re-analyzable artifacts; this
is a headline platform property) and a deferred `derivedFrom` provenance field
(additive, V1.x).

**W8 — Duplicate ingestion.** Same record added twice locally: same address, no-op.
Added independently by two teammates and git-merged: identical path + identical bytes
→ trivial merge. By construction, nothing to design.

**W9 — Years-later ingestion.** A 2026 record surfaces in 2029 (laptop drawer).
Format v1 is frozen → verifier passes; index accepts; time-windowed queries place it
by stated ts; coverage retroactively improves; no ordering dependency anywhere.
Validated — *the store being unordered is doing exactly the work it was designed for.*

**W10 — A vendor emits records natively.** Codex ships `--emit-lodestar-record`.
Structural verification passes; the graph accepts. But its events' `signalTier:
groundTruth` was assigned *by the actor about itself* — the verifier checks tier
*citation* rules, and cannot check tier *honesty*. A self-emitted record is
self-report wearing the format. The graph must therefore never let provenance blur:
→ **F5** (generator provenance on every citation and aggregate; independence is a
property of *who observed*, judged by the consumer, labelled by the graph, proven
only by V2 attestation). This is WHAT-REMAINS.md's thesis, discovered independently
by simulation — a good sign both are describing the same reality.

## 3. Findings ledger (all refinements, none primitive-breaking)

| # | Finding | Disposition |
|---|---|---|
| F1 | Repo groups need stable names across reindexes; storing groupIds would break as groups merge | **Names are identity signals.** Any signal that ever identified a group (a normalized remote, a root commit) resolves to the current group at query time — refs-over-objects, stateless. GRAPH-SPEC Part A |
| F2 | Shared non-origin remotes (fork+upstream) would auto-merge fork into upstream | **Conservative default:** auto-merge on shared *origin*, or shared root with no conflicting origins; anything else is a surfaced candidate needing one link. False-split (one-command fix) chosen over false-merge (silent lie) — the honesty asymmetry, applied to identity |
| F3 | Link objects lacked self-description | Links carry `format: 'lodestar-link', formatVersion: 1` like every object. Spec requirement |
| F4 | Mixed-version clients meeting future objects/link-types | Tolerant reader: unknown link types ignored-and-counted; unreadable formatVersions counted — and **client-capability gaps join the coverage map** ("this view was computed by a client that could not read N objects") |
| F5 | Self-emitted records launder into "independently observed" | Generator provenance (name+version) labels every citation and aggregate; trust-of-generator is a consumer-side judgment; V1 labels, never judges. V2 attestation is where proof arrives |
| F6 | Engine upgrades over sealed history | Works ledger-free via `evaluateEvents` over record events; `(sessionId, chainHead)` grouping carries it; optional `derivedFrom` marker deferred (additive) |
| F7 | Coverage map and silence over time | Last-seen staleness per machine/repo derived from history — "no records received since X", never "no activity since X" |
| F8 | Team loop ergonomics: manual `graph add` per session | Validated as workable; flagged as the adoption risk it is; auto-add watcher stays deliberately in V1.x (hot path must not depend on the graph) |
| F9 | (Platform, not V1 scope) When vendors self-emit, independent capture becomes the *audit instrument*: floor-record vs self-record of the same session, compared | Named for V2+ ("dual-record correlation") — reframes capture's endgame from obsolete to auditor's tool. Recorded in §8 |
| F10 | GF windows/params and monorepo noise | GF parameters fixed in the catalog with stated clock assumptions; contention scoped to path. Catalog content, not architecture |

## 4. Failure analysis (Phase 3 — deltas beyond V1-DESIGN-REVIEW §4)

All prior failure rows re-checked and standing. New rows from simulation:

| Attack | Result |
|---|---|
| Concurrent sessions, one machine, overlapping times | Legal; no global order was ever claimed; per-session chains independent |
| Index built mid-sync (partial object set) | Answers reflect present objects; coverage map states the view; reindex converges. Torn files excluded by naming discipline |
| Hostile link flood (spam claims on a record) | Claims never reach facts (P5); filterable by author; retractions additive; blast radius = presentation |
| A future-format object lands in a v1 store | Counted, disclosed (F4), never guessed at — the RECORD-SPEC §6 verifier obligation generalized to the graph client |
| Two graphs unioned after months apart | Well-defined by construction (add-only keyspace): object union, dedupe by address, resolution recomputes over the union |
| Backdated `ts` in a forged-at-capture record (T3) | Unchanged from THREAT-MODEL: capture fidelity is not upgradable by the graph; time-window answers carry the stated-clocks assumption; provenance labels who claims the clock |

## 5. Scalability analysis (Phase 4, with arithmetic)

Assume ~5 sessions/engineer/day, ~100 KB/record raw (~20 KB zstd within the store
binding).

| Org | Volume | Store binding | Index | What changes | What does not |
|---|---|---|---|---|---|
| 10 eng | ~18 k records/yr ≈ 2 GB | directory or git repo | local SQLite per consumer | nothing | — |
| 100 | ~180 k/yr ≈ 20 GB | git (packed) or S3 | same; heavy readers add a shared read-replica index | transport choice | formats, verifier, URIs, resolution |
| 1,000 | ~1.8 M/yr ≈ 200 GB | **git retires as transport**; S3/GCS binding | server-side index (Postgres/DuckDB) behind read API; incremental indexing replaces full reindex for freshness (full rebuild stays the correctness anchor) | binding + index engine + verify-on-add → sampled continuous verify | same list |
| 10,000 | ~18 M/yr ≈ 2 TB | object storage, lifecycle tiers | partitioned indexes per domain | federation: graphs-of-graphs (union semantics already defined) | same list |
| 100,000 | ~180 M/yr ≈ 20 TB | same, multi-region | same | organizational sharding; CDN for objects (immutability makes this trivial) | same list |

Named bottlenecks and their reliefs: full `reindex` O(store) → incremental index +
periodic full rebuild as the determinism check; full `verify` O(store) → verify-on-add
plus continuous sampled verification with a stated sampling disclosure (P6 applies to
verification itself); SQLite single-writer → never shared by design; git clone-all →
binding swap at ~10³ engineers with **zero format change**. The invariant column is
the infrastructure claim: five orders of magnitude, same primitives.

## 6. Vendor neutrality review (Phase 5, brutal form)

Assume Claude Code, Codex, Cursor, Gemini CLI, Aider — and Anthropic, OpenAI, Google
directly — all emit conforming records. Is LODESTAR still needed? **Yes, and more
than before, for exactly four reasons — and if any of them ever fails, the
architecture is wrong:**

1. **Someone must be the format's steward and verifier that no producer controls.**
   Five conforming emitters still need one spec, one conformance suite, one neutral
   verifier — or "conforming" fragments into dialects within a year.
2. **Self-emitted ≠ independently observed** (W10/F5). Universal emission makes the
   *provenance* distinction the product: the graph is where self-reports and
   independent observations sit side by side, labelled, comparable — and (F9) the
   independent recorder graduates from wedge to audit instrument, spot-checking
   vendor self-records against floor observations of the same sessions.
3. **No vendor can host the cross-vendor store.** The org's corpus is defined by
   outliving vendor relationships; Copilot makes GitHub a producer, Duo makes GitLab
   a producer, Gemini makes Google one — *the platforms best positioned to add this
   layer are all disqualifying themselves by shipping agents* (see §8).
4. **Identity resolution and linkage are org-side problems** no emitter sees enough
   to solve: resolution needs all vendors' records; links need the org's context.

Neutrality audit of the design itself: no abstraction assumes Claude (checked:
identity evidence is git-derived; provenance is a string pair; the one vendor string
in the codebase remains the adapter registry entry, per the V0 audit). Records from
any conforming generator are first-class, including in GFs (catalog-conditioning) and
citations (provenance labels).

## 7. Ecosystem comparison (Phase 6 — evolution, not features)

| Platform | Primitive it owns | Why indispensable | Lock-in without proprietary formats |
|---|---|---|---|
| Git | content-addressed immutable object DAG | correctness with zero coordination | the object model became the substrate everyone's tools assume |
| GitHub | identity + collaboration *above* someone else's primitive | owns the social/org layer, not the format | network of people and process, not bytes |
| Docker→OCI | the image manifest | the format outlived the company — a warning and a lesson: **the format wins; the vendor only wins if it owns the position around the format** |
| Kubernetes | declarative object model + reconciliation | state as data; controllers replaceable | the API schema, open, became the industry's noun |
| OpenTelemetry | wire format + semantic conventions owned by no vendor | every producer emits it *because* no producer owns it | conventions, SDKs, and the collector's position |
| Terraform | provider protocol + state file | the protocol made coverage the ecosystem's job | provider network |
| Stripe / Cloudflare | an abstraction/position in a critical path | being the path, not the feature | accumulated trust + integration gravity |

LODESTAR's candidate primitive — **the sealed, portable, independently verifiable
evidence object, plus the neutral store/resolution above it** — is architecturally of
the same species as Git objects and OCI manifests: open, content-addressed, simple
enough to outlive its implementations. The honest evaluation the phase demands:
*architecturally* it qualifies; *whether it becomes fundamental is an adoption fact,
not a design fact*, and no further design work can substitute for the field evidence
gates in WHAT-REMAINS.md §7. The OCI row is the standing warning: owning the format
is necessary and insufficient — the company must also own the position (store,
verifier authority, resolution) or it has donated a spec.

## 8. Platform viability (Phase 7 — the attempted disproof)

Strongest attacks attempted against the company thesis:

- **"GitHub just adds an Evidence tab."** The structurally strongest attacker — org
  relationship, neutrality *among agent vendors*… until Copilot, which makes GitHub a
  producer with the same self-audit conflict as every model vendor. Same for GitLab
  (Duo), Google (Gemini), Microsoft (Copilot everywhere). The attack fails not
  because they lack the engineers but because **every plausible incumbent is
  becoming an agent producer**, and the layer's defining property is not being one.
  Residual risk, stated: a genuinely neutral infra player (a Cloudflare-like) could
  contest the position — the defense is the head start on format + corpus + the
  credibility discipline, which compounds in calendar time.
- **"Nobody pays until regulation forces it."** Possibly true for *attestation*
  (V2); V1's willingness-to-pay is operational (the W6 incident walkthrough is the
  buying moment: what happened, where's the proof, four commands). If even that
  fails with real teams, the kill-criterion in WHAT-REMAINS.md §7 triggers — the
  thesis is falsifiable, which is a strength, and the falsification path is written
  down.
- **"Agents get so good evidence stops mattering."** Inverted by volume: better
  agents ⇒ more unwatched work ⇒ less human attention per change ⇒ trust becomes
  *scarcer*. The 2032 test from the Blueprint holds under simulation, not just
  rhetoric: every walkthrough above gets more valuable, not less, as session counts
  grow.

**Ruling: not disproven.** The layer can exist because it is needed by everyone in
the value chain and structurally unoccupiable by its most capable potential
occupants. It remains *contingent* on the two unproven behavioral assumptions
(sharing, verification demand) — which are gated, measurable, and cheap to test with
V1's smallest milestone.

## 9. Remaining unknowns

Carried from V1-DESIGN-REVIEW §13 (all six stand), plus validation adds: (7) the
incremental-index consistency contract at 10³+ scale (what freshness the read API may
claim between full rebuilds — wording must not overclaim); (8) whether F2's
conservative default produces annoying split rates in real orgs with many mirrors
(field data; one-link fix bounds the damage); (9) record size discipline under
stdout-heavy sessions (measure before Part B profiles).

## 10. Implementation readiness checklist — and the answer

Ready when every box is checked:

- [x] Primitives validated, none removable (§1)
- [x] Ten scenarios construct end-to-end without architectural surprise (§2)
- [x] Failure modes enumerated with designed behavior (§4)
- [x] Scale path named with unchanged-core proof (§5)
- [x] Neutrality survives universal emission (§6)
- [x] V0 compatibility: no record-format change anywhere in V1; vectors stay green
- [ ] **GRAPH-SPEC Part A draft** incorporating F1–F7, F10 (object formats incl. link
      self-description, URI grammar, remote-normalization, resolution rules + F2
      default, provenance labeling, coverage-map contents incl. F4/F7)
- [ ] **Identity vectors**: the §2 stress cases (fork, upstream, rename, mirror,
      offline, shallow) as committed fixtures before resolution code exists
- [ ] **D-062 ratified** by the founder (the standing 🔶)

**Are we ready to write the first line of V1 code? — Yes, conditionally:** the
architecture is validated and stable; the three unchecked boxes are prerequisites,
and two of them are *writing*, not building. Code before the Part A draft and the
identity vectors would re-create V0's earliest mistake (invariants held by intention
instead of by committed artifacts); code before ratification violates D-062's own
terms.

**The smallest milestone that validates V1 (M-V, the validation spike):**
`lodestar graph init | add | verify` + identity resolution + exactly one query
(`repos`, with bases and coverage map) + the rebuild-determinism test — dogfooded by
backfilling **this repository's own recorded development sessions** as the first
corpus. It exercises the two genuinely novel risk areas (store discipline, identity
resolution) and the two hardest invariants (verify-on-add, determinism) while
touching zero renderers, zero servers, zero links, and zero new capture. Success =
real historical records grouped correctly with honest bases, `graph verify` INTACT,
two reindexes byte-equivalent in answers, and a git round-trip of the store between
two directories with a clean union. Everything after M-V is scheduled work;
M-V is the experiment.

*Optimizing for correctness over momentum, per the brief: the fastest thing we can do
right now is write two documents and ten test fixtures — and that is exactly what
"ready" looks like for infrastructure.*
