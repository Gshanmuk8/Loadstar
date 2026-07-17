# LODESTAR V0 — Architecture

> **Status:** source of truth for *how* V0 is built.
> What: `PRODUCT-SPEC.md`. Why: `LODESTAR-VISION.md`. Rationale: `DECISIONS.md`.

---

## 1. The Governing Constraint

**V0 is not a prototype of the Record Layer. It is the Record Layer.**

Every later layer is a capability added to the same execution path, never a rebuild
of it:

- **Explain** is a query over the record V0 already produces.
- **Gate** is a decision inserted at the boundary V0 already intercepts.
- **Prevent** is a score computed from signals V0 already captures.
- **Direct** is context injected at the point V0 already sits.

Nothing above V0 requires re-architecting *where* interception happens. **That
question gets answered exactly once, at V0, and stays answered.**

The practical consequence: **the event schema matters more than any feature in V0.**
Features are cheap and changeable. The schema is load-bearing for a decade. Get the
schema right even though V0 only uses it for one runtime and one purpose.

---

## 1a. The Execution Boundary Model

**The claim Phase 6 exists to prove:**

> LODESTAR observes reality at the execution boundary, not what the AI claims happened.

```
User
 │
 ├─ lodestar run <agent>          ← LODESTAR is the PARENT. Certain.
 │   │
 │   ├─ [installs PATH shims]     ← then MEASURES whether they win
 │   │
 │   └─ Agent runtime             ← exit code: ground truth (we are its parent)
 │        │
 │        └─ shell -c -l          ← the agent's own shell; rewrites PATH
 │             │
 │             ├─ npm  → shim → real npm     ← exit code: ground truth (shim is parent)
 │             └─ git  → /mingw64/bin/git    ← SHADOWED. Not observed. Declared.
 │
 └─ Reality record                ← hash-chained, append-only
```

### What the boundary actually owns

The OS gives exactly one guarantee: **a parent, and only a parent, learns its child's
exit status.** Everything below follows from that single fact.

| Layer | Parent? | Coverage |
|-------|---------|----------|
| The agent process | **LODESTAR** | Certain — argv, PID, exit code, duration |
| A command with a winning shim | **the shim** | Ground truth — real exit code |
| A command whose shim is shadowed | nobody we control | **Not observed, and said so** |
| File and git effects | n/a — observed directly | Ground truth, regardless of who acted |

We are the agent's parent but the *grandparent* of everything it spawns. That gap is why
shims exist, and why the coverage probe exists to bound what they actually cover.

### The trust hierarchy, restated as a rule

Facts may be computed from **`groundTruth` only** — enforced in code, not convention
(`src/facts/index.ts`, D-009). The tier is a schema field, and the fact engine's sole
query filters on it, so narration is not reachable from that module.

```
GOOD   "npm test exited with code 1"    source: process_exit    confidence: high
BAD    "Agent reported tests failed"    source: agent_message   confidence: low
```

The second form is not lower-quality. It is **impossible**: `agent_message` is not a
member of `EvidenceSource`. A hook-reported exit code would be the audited party
reporting on itself, which is the exact thing the company exists to distrust — so it is
refused even though it is the easiest thing to build (D-023).

### Coverage is measured, never assumed

A shim that loses PATH resolution emits **nothing**, and silence is indistinguishable
from "the command never ran" — the same failure shape as D-022. So before the agent
starts, LODESTAR asks *the agent's own login shell* to resolve each shimmed command and
records the answer as evidence in the session:

```
observed: npm npx node pnpm yarn python python3 pytest docker make cargo go
not observed: git (shadowed on PATH)
```

Measured on this machine — `/etc/profile` prepends `/mingw64/bin`, so `git` loses. That
is a real hole, and it is declared rather than discovered later.

### Failure behavior

The wrapper must not become a single point of failure. V0 observes; it does not govern.

| If LODESTAR fails | Then |
|---|---|
| Recording cannot start | **The agent still runs**, unrecorded, and says so |
| A recorder dies mid-session | The agent continues; the gap is recorded and coverage drops |
| A shim cannot execute a command | It exits **126**, tells the user plainly, and records a **gap — never a fake exit event** |
| The wrapper is killed | The partial chain still verifies; the session stays open rather than inventing an exit code |
| Are actions ever blocked? | **Never.** V0 has no blocking. That is V2, and it has not earned it |

Fail-open is correct for a system of record: a recorder that can stop your work is a
liability, not an asset. **This inverts at V2** — once LODESTAR gates actions, fail-open
becomes wrong for irreversible ones, and the fail-mode becomes a safety feature
(VISION §3, Layer 4). It is not one now.

---

## 2. The Two-Signal Architecture

The founding documents disagreed about where to intercept, and never surfaced the
disagreement. The Technical Blueprint wraps the agent's tool-execution layer,
catching actions *before they take effect* with resolved targets. The Strategic
Analysis watches the filesystem and process tree from outside, observing what
*actually hit the disk*, and says filesystem watching should be the primary signal.

**These were never competing architectures. They are the two halves of the
product's best feature.** See D-003.

### The trust hierarchy of signals

| Tier | Source | Trust | What it gives |
|------|--------|-------|---------------|
| 1. **Narration** | agent stdio | Lowest — the agent's *belief* | Context only. **Never used for Reality Facts.** |
| 2. **Intent** | runtime adapter hook | Medium — what the agent *requested*, resolved | Mission, resolved targets, tool-call structure. Feeds shadow-mode risk. |
| 3. **Ground truth** | filesystem + process tree | Highest — what *actually happened* | The floor. Reality Facts are computed only from here. |

**Reality Facts are computed exclusively from Tier 3.** Tier 1 is recorded for
context and never reasoned over — this is the Reality Facts Rule expressed
architecturally. Tier 2 enriches the record and builds the V2 dataset.

### Why both, not either

**Tier 2 alone has holes.** Some agents edit through APIs or run inside their own
sandboxes rather than shelling out, so a tool-call hook misses effects. A trust
product with silent holes is in trouble.

**Tier 3 alone can never become V2.** It is inherently post-hoc — you cannot block
what already happened. Gate and Prevention require pre-execution interception, so
the hook must exist from V0 even though V0 never blocks.

**Tier 3 is runtime-agnostic and buys the cross-agent pillar for free.** Filesystem
and process observation needs no adapter. The founding documents demand "depth on one
runtime" *and* claim cross-agent history as a defensive pillar — which is
contradictory, because one runtime means no cross-agent value at launch. The Tier 3
floor squares it: the adapter carries depth on Claude Code, the floor carries
degraded-but-real breadth across everything else on day one.

```
┌─────────────────────────────────────────────────────────┐
│  AI Agent (Claude Code — the wedge runtime)             │
└───────────────┬─────────────────────────┬───────────────┘
                │                         │
      Tier 2: tool calls          Tier 1: stdio
      (intent, resolved)          (narration — context only)
                │                         │
                ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│  Runtime Adapter          declares its capabilities     │
└───────────────┬─────────────────────────────────────────┘
                │
                │        ┌────────────────────────────────┐
                │        │  Tier 3: FS watcher +          │
                │        │  process tree + git            │
                │        │  (ground truth — the floor)    │
                │        └───────────────┬────────────────┘
                │                        │
                ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│  Event Collector      normalizes to ONE event schema    │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│  Local Storage        SQLite (WAL), hash-chained,       │
│                       append-only                       │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│  Analysis Engine      timeline builder                  │
│                       Reality Facts (Tier 3 only)       │
│                       shadow-mode risk (stored, hidden) │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│  Report Generator     terminal summary + static HTML    │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│  CLI + Local Dashboard (localhost)                      │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Components

### C1 — Runtime Adapter *(the hardest and most important component)*

Wraps the agent runtime so tool calls pass through LODESTAR. Its job is to **resolve
the true action**: after variable expansion, after alias resolution, against the real
path or real command that will actually run.

> **Recording what the agent said it would do is nearly worthless. Recording what the
> system is about to do is the entire value of the product.**

Adapters **declare their capabilities** so the system can report coverage honestly
rather than implying completeness it doesn't have. See `API-DESIGN.md` §3.

### C2 — Ground-Truth Observers *(the floor)*

Runtime-agnostic, always on, never trusts the agent. **Built in Phase 5** —
`src/recorder/`.

- **Filesystem watcher** (`fs-recorder.ts`) — scoped to the project directory. Every
  write detected; the prior version snapshotted. Ignores build outputs and `.git`.
  - A watcher fires *after* a change, when the previous content is already gone — so a
    **baseline pass** snapshots every watched file at session start and keeps a
    path→snapshot map. Without the baseline there is no "before", and without "before"
    there is no diff and no rollback.
  - Snapshots are **content-addressed** (`snapshots.ts`), so an identical rewrite costs
    nothing and is detectable as a non-change. Build tools touch files constantly
    without changing them.
  - **Ignore matching is a function, never glob strings** (`ignore.ts`). chokidar 4
    silently matches nothing when handed globs — see **D-022**, which caused a feedback
    loop where LODESTAR recorded its own database writes.
- **Process recorder** (`process-recorder.ts`) — exact command, **real exit code**, true
  duration, output tails. "Tests pass" becomes a checkable claim.
  - **Only records processes LODESTAR spawns**, because only a parent learns its child's
    exit status. Process-tree sampling was designed and rejected: it cannot produce exit
    codes at all, misses short processes, and costs a PowerShell launch per sample on
    Windows. **How RF-01 gets exit codes for agent-spawned children is open — D-021.**
- **Git observer** (`git-recorder.ts`) — commits, ref moves, and working-tree state at
  session boundaries. Two reads bracketing the session answer every V0 question; a
  poller we do not need is a poller that burns a developer's battery.
  - Filters `.lodestar` out of the dirty list. **The observer must not appear in its own
    record** — otherwise RF-02 fires on our own artifacts.

All three emit through one `RecordingContext` (`context.ts`). That is deliberate: it is
the only way to guarantee every event carries a correct `signalTier`, a resolved target,
and monotonic ordering. Recorders that built their own event objects would eventually get
one of those wrong, and the wrong one would be `signalTier`.

**V2 signals are derived at capture** (`classify.ts`) — `effectClass`, `blastRadius`,
`reversible`. When reversibility cannot be determined it is left **absent**, never
guessed: guessing `true` would eventually tell V2 that an irreversible action was safe to
automate.

**Known hard parts, named so they don't surprise anyone:**

1. Some agents edit through channels subprocess interception won't catch. **Filesystem
   watching is the reliable floor and is primary.**
2. Attributing a file change to the agent versus the developer's own edit versus a
   build artifact requires care. Scope to the project dir, ignore build outputs,
   correlate by timing with agent activity, and **disclose ambiguity rather than
   guessing.**
3. "Did the test really pass?" is easy when the agent shells out to `pytest`; harder
   when testing happens inside the agent's own tooling. **Start with the shell-out
   case — the common one — and be honest in the UI about what was not independently
   verified.**

### C3 — Event Collector

Normalizes every source's event shape into **one schema**, so every downstream
component understands exactly one shape of data regardless of which runtime produced
it. This is where runtime independence is enforced.

### C4 — Local Storage

A single SQLite file (WAL mode). Every event is an appended row carrying a hash of
the previous row — **a hash chain, so any later tampering is detectable.**

> **Tamper-*evident*, not tamper-proof.** The guarantee is that alteration leaves a
> mark, not that alteration is impossible. Say this plainly in the docs and the UI;
> overclaiming here is exactly the kind of thing a trust company does not survive.

No external service, no ops burden. The file is the entire record.

### C5 — Analysis Engine

Three jobs at V0:

1. **Timeline builder** — walk ordered events into mission → actions → result.
2. **Reality Facts evaluator** — run the §4 catalog from `PRODUCT-SPEC.md`. **Tier 3
   sources only.** Every fact carries evidence pointers.
3. **Shadow-mode risk scoring** — compute a verdict per action using the same signals
   the Prevention layer will use later (effect class, blast radius, reversibility,
   taint). **Stored, never displayed, never acted on.** V0 is silently building the
   dataset V2 needs to prove itself safe to enforce. See D-005.

### C6 — Report Generator

Renders timeline, diffs, command log, and Reality Facts into a terminal summary and a
**static** HTML report — no client fetch needed, so a teammate can open it having
installed nothing.

### C7 — CLI + Local Dashboard

The CLI is the primary interface. The dashboard is a thin, optional convenience layer
— a small local server reading the same SQLite file, no external network calls.

> **Design principle carried through every component:** stay local and single-process
> as long as possible. No server, no account, no dependency on LODESTAR's own
> infrastructure anywhere in this diagram. **Every piece of infrastructure is a future
> failure mode and a future bill — V0 has none.**

---

## 3a. The Evidence Pipeline — the layer model every contributor should hold

The components above arrange into six layers, and data flows through them in exactly
one direction. Every module in `src/` belongs to one layer; a change that makes data
flow the other way (a renderer computing a judgment, a recorder reading the report) is
architecturally wrong wherever it compiles.

```
Execution Boundary   →   Observation   →   Evidence    →   Evidence Record   →   Verification   →   Presentation
─────────────────        ───────────       ────────        ───────────────       ────────────        ────────────
 src/recorder/            src/types/        src/facts/      src/record/           src/core/chain.ts    src/facts/report.ts
 (shims, fs watcher,      events.ts         (RF engine,     (canonical,           verifier/            src/report/ (dashboard,
  git observer,           src/storage/       limitations,    deterministic,        lodestar-verify.mjs   HTML export)
  process wrapper)        (append-only,      interference)   content-addressed)    (standalone,          src/cli/ (terminal)
                           hash-chained)                                            zero-dep)
```

- **Execution Boundary** — where reality is intercepted: PATH shims, the filesystem
  watcher, the git observer, the process wrapper. Coverage is *measured* here, never
  assumed (D-023, D-040).
- **Observation** — one captured fact, as a `LodestarEvent`: source-tagged, tier-tagged
  (`signalTier` — the epistemic foundation), resolved targets, appended to the
  hash-chained, append-only ledger.
- **Evidence** — deterministic judgments over ground-truth observations only: Reality
  Facts with evidence pointers, limitations, interference, measured coverage (D-009).
- **Evidence Record** — the canonical, portable, content-addressed artifact bundling
  observations + evidence for one session. Deterministic from the ledger; `recordId` is
  its content address. **The single source of truth every surface derives from**
  (D-059). Specified in `RECORD-SPEC.md`, pinned by `spec/vectors/`.
- **Verification** — the pure chain walk (`verifyEvents`) shared by the store and the
  builder, and the standalone zero-dependency verifier any recipient can run without
  installing or trusting LODESTAR (D-060, D-061).
- **Presentation** — `SessionReport` derived from the record, rendered three ways
  (terminal, dashboard, export). Renderers lay out; they never compute meaning (D-049,
  D-054).

The freeze status of each layer's interfaces — what V1–V4 may rely on — is
`docs/STABILITY.md`.

---

## 4. Event Schema

**The single most consequential artifact in V0.** Canonical definition lives in
`src/types/events.ts`; this section explains the reasoning.

The schema is designed for **V2 and V3**, not for V0. V0 populates fields it does not
use, because the alternative is a migration of the immutable record later — which for
a tamper-evident log is not a migration but a credibility problem.

| Field | Purpose | Used by |
|-------|---------|---------|
| `id`, `sessionId`, `seq` | Identity and total ordering | V0 |
| `ts`, `monotonicTs` | Wall clock + monotonic (clock skew is real) | V0 |
| `source` | `adapter` / `fs` / `process` / `git` / `stdio` | V0 |
| `signalTier` | `narration` / `intent` / `groundTruth` | **V0 — enforces the Reality Facts Rule in code** |
| `kind` | `file.write`, `process.spawn`, `net.request`, … | V0 |
| `actor` | Which agent/runtime, or the human | V0 (cross-agent) |
| `target.raw` | What the agent asked for | V0 |
| `target.resolved` | What the system will actually touch | **V0 — the whole point** |
| `effectClass` | `read`/`write`/`execute`/`network`/`destroy` | V2 (computed at V0) |
| `blastRadius` | `file`/`module`/`repo`/`service`/`account` | V2 (computed at V0) |
| `reversible` | Can this be undone? | V2 + Fix layer |
| `taint` | Did untrusted content enter context this turn? | V2 (prompt-injection fingerprint) |
| `missionId` | Links action to stated mission | V2 coherence, V3 Direction |
| `snapshotRef` | Before/after blob refs for file writes | V0 diffs, Fix-layer rollback |
| `prevHash`, `hash` | The chain | V0 |

**Why `signalTier` is in the schema and not just a convention:** it makes the Reality
Facts Rule mechanically enforceable. The evaluator filters to `groundTruth` at the
query layer, so a future contributor cannot accidentally build a claim-parsing fact —
the data isn't reachable from that code path.

### Hash chain

```
hash = H( prevHash || canonicalJSON(event without hash) )
```

Plus periodic signed checkpoints — **V1, NOT BUILT.** No signing key, no checkpoint, and
no signature exists anywhere in `src/`. This paragraph previously described them in the
present tense, which claimed a property the code does not have; the audit found the claim
before a customer did.

They are the missing half of tamper-evidence and they are named honestly in
`THREAT-MODEL.md` §5: the hash chain proves *"these events are in this order and were not
edited in place"* and nothing about **who wrote them**. Signing cannot help at V0 anyway —
any key the shim can read, the agent can read first (the Same-UID Ceiling). Checkpoints
become meaningful at V1, alongside privilege separation.

Chain verification is exposed to the user directly — a trust product should let you
check its central claim yourself. In V0 it surfaces as a line in `lodestar status` and
in the dashboard footer rather than a dedicated command; the guarantee is identical and
strictly more reachable. See `DECISIONS.md` D-016.

---

## 5. Technology Stack

Chosen for simplicity, low cost, and solo-founder speed — not novelty.

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript, Node 22.5+, strict, ESM | The agent ecosystem (MCP, runtime SDKs) is TypeScript-native; one language end to end; largest contributor pool for this domain |
| CLI | Node, no TUI library yet | Zero deps beats a nicer spinner. A TUI library is Phase 10 polish; the engine must not wait on it |
| Storage | SQLite (WAL), **`node:sqlite`** (built in) | Zero-ops, **zero native dependencies**. `better-sqlite3` was specified first and rejected on evidence — see D-019 |
| FS watching | `chokidar` | Reliable cross-platform file events without OS-specific code |
| Process capture | `node:child_process` + process-tree tracking | Standard, no exotic dependencies |
| Git | `simple-git` / git CLI | Git is already on every developer machine; don't reimplement diff |
| Tamper-evidence | Hash-chained events. **Signed checkpoints are V1, not built** — see `THREAT-MODEL.md` | Detects in-place edits. Does NOT prove authorship, detect tail truncation, or survive a same-UID attacker |
| Report | Static HTML, server-side rendered | Must be viewable by a teammate who installed nothing |
| Dashboard | React + Vite, tiny local Node server | Fast dev loop; directly reusable for the V1 web app |
| Styling | Tailwind | Clean UI without hand-rolling CSS |
| Testing | Vitest | Fast, native ESM/TypeScript, no config burden |
| Distribution | npm, published as `lodestar` | Every developer already has npm — lowest-friction channel available |

**Philosophy:** stay local and single-process as long as possible; add a service only
when a team exists to justify it; add scale infrastructure only when data volume forces
it. **Every piece of infrastructure is a failure mode and a bill; earn each one.**

Nothing in this stack needs reconsidering before V1.

---

## 6. Security

- **Capture at the boundary.**
- **Secrets never enter the record.** Redaction happens at collection, before the
  event is written — not at render. An event log containing an API key is a breach
  that the hash chain then makes permanent.
- **Tamper-evident storage.**
- **No telemetry.** A trust product that phones home has not understood itself.
- **Code never leaves the machine** in V0.

---

## 7. Future Compatibility

The wedge runtime is Claude Code — chosen because it is where the founder's daily use
already lives, and because depth on one integration beats shallow support for many.

**But the architecture underneath must never assume anything Claude-Code-specific.**
If it does, "add Codex support" becomes a rewrite instead of a new adapter.

```
Claude Code   ─┐
OpenAI Codex  ─┤
Gemini        ─┼─►  Runtime Adapter  ─►  Normalized Event  ─►  Core (unchanged)
Cursor        ─┤      (per-runtime)
Open-source   ─┘
```

Each runtime gets a thin adapter whose only job is translating that runtime's
tool-call shape into the one normalized schema. **The core — storage, analysis,
reporting — never changes when a runtime is added.**

What this buys: every layer in the vision (Gate, Prevention, Fix, Direction) is a
function computed over the **normalized event record**, never over a specific
runtime's raw output. Get the schema right at V0 and every future layer becomes an
addition to the core instead of a rebuild of it.
