# API Stability — what is frozen, what is stable, what is internal

This document is the freeze list for V0's abstractions: which interfaces V1–V4 are
**built on** and therefore must not move, which are **stable** but may grow, and which
are **internal** and may be rewritten freely. It exists because infrastructure is
defined by its primitives staying put — every layer above V0 (the fabric, attestation,
knowledge, coordination — see `LODESTAR-VISION.md` and the Second-Generation Blueprint)
is designed to *consume* these interfaces, never to rebuild them.

Rules of engagement:

- **FROZEN** — part of the record format or a load-bearing contract. Changing it is a
  format/version event: it requires a DECISIONS.md entry, a RECORD-SPEC.md update
  where applicable, a `RECORD_FORMAT_VERSION` bump where applicable, and regenerated
  golden vectors. The conformance tests (`src/record/record.test.ts`) fail on
  accidental drift — that is their job.
- **STABLE** — safe to build on; changes are additive (new optional fields, new
  members). Removing or re-typing anything requires a DECISIONS.md entry.
- **INTERNAL** — implementation detail. Change freely; nothing outside this repo, and
  nothing in V1+ designs, may depend on it.

The layer model these belong to:

```
Execution Boundary → Observation → Evidence → Evidence Record → Verification → Presentation
     recorder/        types/events    facts/       record/        core/chain,      facts/report,
                                                                   verifier/        report/, cli/
```

## FROZEN — the record format (spec-bound, vector-pinned)

| Abstraction | Where | Why frozen |
|---|---|---|
| `canonicalJSON` semantics | `src/core/hash.ts` · RECORD-SPEC §2 | Every hash is computed over it. A change invalidates every chain ever written. |
| `chainHash`, `GENESIS_HASH` | `src/core/hash.ts` · RECORD-SPEC §4 | The chain construction itself. |
| `eventHashBody` — the protected field set | `src/core/chain.ts` · RECORD-SPEC §3.2 | **The hash body IS the format.** Adding a field to events without a format bump silently un-protects it; the field set is closed per format version. |
| `verifyEvents` semantics (gapless 1-based seq, link check, recompute) | `src/core/chain.ts` · RECORD-SPEC §4 | What "intact" means. Three implementations agree today (store, record, standalone verifier); they must forever. |
| `LodestarEvent` — required fields and `SignalTier` | `src/types/events.ts` · RECORD-SPEC §3 | The Observation primitive. `narration`/`intent`/`groundTruth` is the epistemic foundation of every layer above. Open sets (`kind`, `source`) may grow without a bump; the closed sets and required fields may not. |
| `EvidenceRecord` shape, `recordId` computation, determinism rule | `src/record/types.ts`, `build.ts` · RECORD-SPEC §5 | The portable unit V1 stores, V2 attests, V3 links. Reserved top-level keys: `attestations`, `links`, `extensions`. |
| `RealityFact` + `Evidence` pointer shape | `src/facts/index.ts` · RECORD-SPEC §5.8 | The grammar every fact speaks, forever: id, neutral statement, confidence, evidence pointers. New fact IDs are additive; the shape is not negotiable. |
| `EventStore` interface (`append`/`query`/`verify`, no update/delete) | `src/types/events.ts` | V1 replaces the *implementation* (distributed fabric), never the interface. The absence of mutation is the product. |
| Standalone verifier contract (checks §7, exit codes 0/1/2, deterministic output) | `verifier/lodestar-verify.mjs` · RECORD-SPEC §7 | The seed of the open verifier. Its independence from `src/` is deliberate (D-060) — do not "deduplicate" it into an import. |
| Golden vectors | `spec/vectors/` | The format, as bytes. Regenerating them **is** changing the format (`spec/generate-vectors.ts` header). |
| `Link` shape, `linkId` computation | `src/record/link.ts` · GRAPH-SPEC §5 (M4) | The declared-layer object V1 stores and syncs. `linkId = hashOf(canonical minus linkId)`, identical to `recordId`. Types are an open set (unknown/`x-*` tolerated); the field set and id construction are frozen. Golden vectors: `spec/link-vectors.json`. |
| `evidence:record/…`, `evidence:link/…`, `evidence:repo/…` addresses | `src/record/link.ts` · GRAPH-SPEC §3 | The citation grammar. Address *forms* may be added (repo arrived in M4); existing forms never change meaning. |

## STABLE — build on these; grow them additively

| Abstraction | Where | Notes |
|---|---|---|
| `SessionReport` + `FactsVerdict`, `Verdict`, `FactView`, `FileChange`, `ContentAvailability`, `TimelineEntry`, `GitView` | `src/facts/report.ts` | The presentation model (D-049/D-054/D-058). Derived from the record — new fields fine; renderers must never compute meaning. |
| `reportFromRecord` / `buildReport` | `src/facts/report.ts` | The one derivation path. `buildReport(store, id)` ≡ `reportFromRecord(buildRecord(store, id))` — pinned by test. |
| `Integrity` / `IntegrityStatus` | `src/record/types.ts` (re-exported by report) | Three states, closed set; the *wording* of `degraded` notes may evolve. |
| `RuntimeAdapter` + `AdapterCapabilities` | `src/adapters/registry.ts` | The vendor-neutrality boundary. New capabilities: additive booleans. A runtime is one entry here and nothing else, or independence is already broken. |
| `evaluate`/`evaluateEvents`, `limitations`/`limitationsEvents`, `interference`/`interferenceEvents`, `FACT_CATALOG` | `src/facts/index.ts` | The engine's public face. The groundTruth gate at every entry is load-bearing (D-009) — no future entry point may skip it. |
| `CommandCoverage` / `ShimStatus` | `src/recorder/shims.ts` | Serialized into records (`evidence.coverage`); statuses are a closed set of four (D-040). |
| CLI surface: five commands + `report` flags (`--terminal`, `--html`, `--record`, `--open`), exit codes (`2` = BROKEN) | `src/cli/` | Five commands is a rule (D-012). Flags are additive. Exit-code meanings are contracts for CI. |
| `serializeRecord`, `recordScriptTag`, `RECORD_HTML_MARKER_ID` | `src/record/serialize.ts` | The embed marker is spec-pinned (§7); treat as frozen in practice. |

## INTERNAL — change freely

- Everything in `src/recorder/` except the two exported types above: shim templates,
  watcher configuration, snapshot store layout, ignore rules, runner scripts.
- `src/report/html.ts` and `src/report/server.ts` — renderers and the loopback server.
- `src/storage/db.ts` schema details and pragmas (the *triggers* enforce a FROZEN
  property, but their SQL text is internal), `SqliteEventStore` internals.
- `src/cli/ui.ts`, wording of terminal output (the *meanings* are model-owned).
- `src/record/vector-fixture.ts` — internal, but editing it regenerates vectors, which
  is a format event; see its header.

## The invariants behind the table, in one place

1. **Append-only is enforced three ways** (interface, triggers, chain) and all three
   stay. One lock is not enough for the only property the product sells.
2. **Anything trust-bearing reads groundTruth at its entry point** (D-009, D-053).
   Fact engines, record builders, and status computation all gate tiers structurally.
3. **Judgments are computed once, below presentation** (D-049 → D-059): ledger →
   record → report → renderers, one direction. A renderer `if` about meaning is a bug
   wherever it appears.
4. **The record is deterministic** — no clocks, no randomness, no environment in
   `buildRecord` (D-059). Every future layer that signs, stores, or links records
   depends on this.
5. **`VERIFIED` is demoted by any known gap** (D-046). New capture surfaces must add
   their failure modes to `degradations()`, not around it.
6. **Claim-parsing is banned, not deferred** (D-009). No frozen or stable interface
   accepts an agent's narration as evidence, and none ever will.
