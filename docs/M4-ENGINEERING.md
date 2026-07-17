# M4 — Engineering Design: the Link object (the declared layer)

> Cycle: restate → design → attack → implement → verify → document → stop.
> Architecture is frozen (D-062 ✅, V1-DESIGN-REVIEW §12). This file is steps 1–3 and,
> at the bottom, step 7's stop-report. Any conflict with GRAPH-SPEC §5 or
> V1-DESIGN-REVIEW §12 is a bug in this file.

## 1. Restatement

**What.** The Link object: the third leg of the epistemic split (P5 —
observed / computed / **declared**), and the identity-correction mechanism (P4).
A link is a **content-addressed, immutable, individually verifiable object in the
same store as records** — `links/<2hex>/<linkId>.link.json`. Not a per-author
ledger (that design was killed — V1-DESIGN-REVIEW §8.2); not chained; retraction is
another link.

Concretely M4 lands: the `lodestar-link` format (GRAPH-SPEC §5, already specified) +
its in-process checker + golden vectors; the store extended to hold two object types;
`identity:same-repo` / `identity:distinct-repos` wired into resolution; retraction;
`lodestar graph link` (write) and `query links` (read); links propagated by `sync`;
and the structural guarantee that **no link can ever reach a fact** (P5).

**Why now — the demonstrated need, not speculation.** This is the same
investigation-driven bar M3 held (D-068): a capability is built when the shipped
system surfaces a gap it cannot close, never because the roadmap lists it. The gap is
concrete and already in the test suite:

- **I-5** — the `acme/infra` → `acme/platform` rename surfaces as a *lineage
  candidate*, asserted to be "one link from merged." The graph says "these might be
  the same repo" and offers **no way to record the human's answer.**
- **I-6** — `contractor/web` is a genuine *fork* of `acme/web`, surfaced as a
  candidate the human should be able to mark *distinct* so the graph stops nagging.

Resolution already ships the hook: `resolveIdentities(evidence, equivalences: [] = [])`.
M-V designed the seam and left it empty on purpose (M-V-ENGINEERING §2.4). M4 fills it.
Nothing here is V2: authors are **unauthenticated claimed strings** (signing is V2);
no attestation, no gating, no HTTP, no AI. Graph Facts stay unbuilt (D-068 holds — no
investigation demands a precomputed pattern).

**Which primitives.** P1 (link is an evidence object), P2 (same store, two prefixes),
P3 (a link address; a repo address for identity endpoints), P4 (declared correction),
P5 (declared layer, structurally separated from observed/computed), P6 (every view
still discloses — now including unresolvable and retracted links).

## 2. Design

### 2.1 The Link object (`src/record/link.ts`)

Format exactly as GRAPH-SPEC §5 (no new fields invented):

```jsonc
{
  "format": "lodestar-link",
  "formatVersion": 1,
  "linkId": "<sha256 of canonical form minus linkId>",
  "author": "<claimed string — unauthenticated until V2 keys>",
  "ts": "<ISO 8601>",
  "type": "relates-to | supersedes | mission | incident | review | identity:same-repo | identity:distinct-repos | retracts | x-<ns>:<t>",
  "from": "<evidence address>",
  "to": "<evidence address or external URL>",
  "reason": "<string>"
}
```

- **`linkId` is computed exactly like `recordId`** — `hashOf(canonical form minus
  linkId)` — reusing `core/hash.ts`. One hashing discipline, no second construction.
  The serialized bytes on disk ARE the canonical form (like records, D-059).
- **`checkLink(value)`** mirrors `checkRecord`: format+version marker, structural
  field checks, then `linkId` recompute (the content address matches the content),
  then address well-formedness of `from`/`to`. Deterministic error strings. A link
  that fails is *refused on add* with its own wording — verify-on-add is a store
  property for both object types (GRAPH-SPEC §2).
- **Type is any non-empty string.** Known types are acted on; unknown `x-<ns>:<t>`
  (and, per GRAPH-SPEC §5, any unknown value) are tolerated and counted (F4). Only two
  types affect resolution; exactly one (`retracts`) affects other links; the rest are
  inert annotations.

### 2.2 Addresses (`src/record/link.ts`, GRAPH-SPEC §3 extended)

Existing: `evidence:record/<id>`, `evidence:record/<id>#<seq>`, `evidence:link/<id>`.
**Added:** `evidence:repo/<signal>` — a repo *group* named by any identity signal it
carries (F1: names are signals). `<signal>` is an origin URL, `root:<sha>`,
`path:<key>`, or a display name — the same vocabulary `resolveRepoArg` already
accepts. Identity links use repo addresses for `from`/`to`; the CLI accepts a bare
signal and wraps it, so the stored object is always a well-formed address.

`external URL` in `to` (for `review`, `incident`, `x-*`) is any non-empty string that
is not an `evidence:` address — stored verbatim, never fetched (no network, ever).

### 2.3 Retraction — one level, monotone, no fixpoint

`retracts` links point `to` an `evidence:link/<id>`. **A link L is retracted iff some
`retracts` link targets L's exact `linkId`.** `retracts` links are not themselves
retractable in V1 — and they do not need to be: because linkId is content-addressed, a
*re-assertion* is simply a new link with a different `ts`/`reason` (hence a different
linkId) that the old retraction does not cover. This is monotone (no oscillation), has
no cycle pathology, and is the graph-scale echo of the facts engine's rule that a
self-referential suppression is not evidence. Retracted links are excluded from
resolution and from `query links`' active set, but the *objects remain* (nothing is
deleted) and are counted as retracted — the record of the disagreement is preserved.

### 2.4 Identity directives (`src/record/link.ts` → `src/graph/identity.ts`)

From the **active** (non-retracted) link set, derive directives:

- each active `identity:same-repo` → `{ kind: 'merge', a, b }` (a, b = repo signals
  from the endpoints);
- each active `identity:distinct-repos` → `{ kind: 'distinct', a, b }`.

`resolveIdentities(evidence, directives)` gains a **phase 4**, after the automatic
origin/root/path phases, before materialization:

- **merge**: find records whose evidence matches signal `a` and those matching `b`;
  if both non-empty, union them (smallest-id reps, deterministic). Transitivity is
  free (union-find). A merge whose signal matches **no** record, or whose two signals
  already sit in one group, is a **no-op, recorded as `unresolvable` / `redundant`**
  and disclosed — a declared link that changed nothing must not look like it worked.
- **distinct**: does **not** split (V1-DESIGN-REVIEW §4.4 — "surfaced, never
  auto-split"; splitting an origin-merged group has no principled record assignment).
  It **suppresses the matching lineage/shared-remote candidate** (the human has
  answered the graph's question) and, if the two signals are already one group, is
  recorded as `unenforceable` (stronger evidence merged them; the claim is kept and
  disclosed, never silently obeyed or silently dropped).

Merged groups carry `declared: true` and both origins (already rendered). The
`Resolution` gains `appliedLinks` / `unresolvedLinks` for P6 disclosure. **The failure
direction is unchanged (F2): automatic rules still never merge; only a human's
declared link merges, and only a human's declared link marks distinct.**

### 2.5 Store, index, sync, CLI

- **Store** (`store.ts`): `walkStore` classifies both `records/` and `links/`;
  `addLinkValue` mirrors `addRecordValue` (checkLink → temp-then-rename → duplicate is
  success); `verifyGraph` verifies links too (linkId recompute + misfile check) and
  reports link count + dangling endpoints. `MAX_RECORD_BYTES` applies (a link is
  tiny). `initGraph` needs no change — `links/` is created on first add.
- **Index** (`graph-index.ts`): `loadDerivedState` reads links from the store (they
  are few; no SQLite table needed — read files, cheap and keeps the index a pure
  extraction of *records*), derives directives, passes them to `resolveIdentities`.
  A `links` list rides `DerivedState` for `query links` and disclosure. Determinism
  holds: directives are sorted by linkId; the rebuild test extends to cover links.
- **Sync** (`sync.ts`): `objectIdsOf` and the copy path generalize to both prefixes;
  pull routes each incoming object to the right checker by filename suffix; a hostile
  link is refused exactly like a hostile record. Sync still never deletes.
- **CLI** (`graph.ts`): `graph link <type> <from> <to> [--reason R] [--author A]`
  (write) and `graph query links [--repo R] [--json]` (read). `repos` marks a
  candidate `resolved`/`marked-distinct` when a link covers it, and lists unresolvable
  declared links. **This is the 8th `graph` subcommand** — V1-DESIGN-REVIEW open
  question #5 fires at ~7, so D-070 makes the count an explicit decision (write verbs:
  init, add, link, share, sync; maintenance: verify, reindex; one read verb: query
  with a growable name registry — the sprawl containment is that reads stay under one
  verb).

### 2.6 The P5 gate (the load-bearing guarantee)

**No link can create or alter a fact.** Facts are computed in `src/facts/index.ts`
from a record's groundTruth events only; the graph's fact view (`divergences`) reads
the `facts` table, populated solely from `record.evidence.facts`. Links are a separate
object type the fact path never reads. The gate is therefore *structural* — but M4
pins it with a test: adding non-identity links leaves `divergences --json`
**byte-identical**, and adding an `identity:same-repo` link changes only *repo
grouping/labels*, never any fact's id, statement, ts, or citations. That test draws
the exact P5 line: declared claims may re-group (P4); they may never touch an
observation or a computed fact.

## 3. Attack (pre-implementation)

- **Dangling endpoint** — a link `from`/`to` a record/link/repo that isn't present.
  Non-fatal (GRAPH-SPEC §5): identity merge whose signal matches nothing is an
  `unresolvable` no-op, disclosed; `query links` flags dangling; `verify` counts them.
  Never throws, never silently vanishes.
- **Retraction of a nonexistent link** — no-op, tolerated.
- **Mutual retraction (A retracts B, B retracts A)** — cannot arise from the monotone
  rule (retraction keys on target linkId only; retracts links aren't retractable), so
  there is no oscillation to resolve. Documented.
- **Merge signal matches two groups (ambiguous)** — union both into one is *correct*
  for `same-repo` (that is what the human asserted); but a signal that matches groups
  the human did not intend is a mis-merge. Mitigation: the CLI resolves the endpoint
  through `resolveRepoArg` at authoring time and refuses an ambiguous endpoint with
  both names, so the stored link names a signal that identified one group when
  written. At resolution time, a signal matching ≥2 groups still merges them (honoring
  the claim) and the merge is disclosed with the signals it touched.
- **A `same-repo` link between a fork and upstream (mis-merge attempt)** — merges
  them; this is a *human claim*, visible, attributed, and reversible by a `retracts`
  link. Unlike an automatic merge, a wrong declared merge is someone's name on a
  reversible object — exactly the T2-grade, correctable posture the review specified.
- **Link spam** — thousands of links. They are labelled claims, never inputs to facts
  (P5), filterable by author in `query links`; blast radius is presentation, not
  evidence (V1-DESIGN-REVIEW §3).
- **Injection via author/reason/to** — opaque strings, never executed, never
  network-fetched, rendered as data. HTML export escapes as records do.
- **Misfiled link (linkId ≠ filename)** — `verify` reports it (parallel to records).
- **Hostile link in a share** — pull verifies through `checkLink`; refused, named,
  local store intact; the file stays (sync never deletes) and is renamed every sync.
- **Determinism under links** — directives sorted by linkId; retraction set is a pure
  function of the link set; two rebuilds → byte-identical answers, extended test.
- **A link that would change a fact** — impossible by construction (§2.6); pinned.
- **Non-identity link changing identity** — a `relates-to` between two records must
  not merge their repos. Only the two identity types feed phase 4; test asserts a
  `relates-to` leaves `repos --json` unchanged.

## 4. Failure modes designed

| Failure | Behavior |
|---|---|
| Link bytes ≠ its address | refused on add; named by `verify` (misfiled) |
| Dangling `from`/`to` | non-fatal; disclosed in `links`/`verify`; identity no-op |
| Retracts a missing link | no-op, tolerated |
| Unknown / `x-*` type | stored, verified, counted, inert to identity+facts (F4) |
| Merge signal matches nothing | `unresolvable`, disclosed, no grouping change |
| Distinct on already-merged group | `unenforceable`, disclosed, not split (§4.4) |
| Two rebuilds | byte-identical (directives sorted; retraction pure) |
| Link in `records/` or record in `links/` | refused by the wrong-type checker, named |

## 5. Testing strategy

Vectors first (`spec/link-vectors.json`, committed before code): a canonical link and
its `linkId`; retraction resolution; identity-directive derivation; resolution-with-
links scenarios that **resolve I-5** (merge infra+platform → one group, candidate
gone) and **honor I-6** (distinct marks contractor/web, candidate suppressed). Then:
`checkLink` accept/reject, store add/verify/dedupe/misfile/wrong-type, the P5 gate
(non-identity links leave `divergences --json` byte-identical; identity link changes
only grouping), hostile-link sync refusal with intact local store, rebuild determinism
across all queries **including a graph with links**, and a new investigation **I-12**
("we confirmed the rename — do infra and platform now read as one repo?") end-to-end
through the CLI-facing queries. Full gate + stress.
