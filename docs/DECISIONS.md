# LODESTAR — Decision Record

Why things are the way they are. Read this before re-litigating a settled decision or
acting on an unsettled one.

**Sources reconciled here:**
- `LODESTAR — Product Vision` (founding, 20pp) — hereafter **Vision**
- `LODESTAR V0 — Product Blueprint & Strategic Analysis` (founding) — hereafter **Strategic**
- `LODESTAR V0 — Technical Blueprint` (founding) — hereafter **Technical**
- Founder's company vision + V0 ladder (2026-07-16) — hereafter **Founder**

**Status legend:** ✅ Settled · 🔶 Open — needs a founder decision · ⏸ Deferred

---

## D-001 — V0 positioning is discrepancy-led, not report-led ✅

**Conflict.** Vision defines V0 as "The Agent Change Ledger." Technical defines it as
an "AI Flight Recorder" with six features, none of which surface divergence. Strategic
directly rebuts both: it labels that product "A. Session report (*your current idea*)",
rates its advantage as "prettier formatting only," and says **do not ship this alone**
— it dies the day Claude Code adds a summarize button.

**Decision.** Strategic wins. V0 positioning is **"Know what your AI actually did,"**
with unreported reality as the hook.

**Why.** Strategic isn't offering a competing opinion — it is applying Vision's *own*
standard to Vision's own V0. Vision's critique section already says "Record + Explain
alone is the most commoditized part of the product" and "if the company is ever
perceived as 'an agent logger,' it has already lost." Then its V0 section proposes an
agent logger. Strategic caught the contradiction.

The deeper argument: a summarize button is the agent reporting on itself. If V0 is a
pretty rendering of the agent's own account, **V0 contradicts the company's founding
thesis** — that the actor must not be the auditor.

**Confirmed by Founder.**

---

## D-002 — Architecture and positioning are decoupled ✅

**Problem.** D-001 makes the product depend on divergences being common — an unmeasured
assumption. Betting the architecture on it is reckless; ignoring the sharper
positioning is cowardly.

**Decision.** **Build the Flight Recorder. Market the discrepancy. Let Week 0 decide
only the marketing.**

The architecture is Record-Layer-first and schema-driven, exactly as Vision and
Technical specify. The positioning is discrepancy-led, exactly as Strategic argues.
Reality Facts are a *consumer* of the schema and never shape it.

**Why.** The founding documents conflate these, but they are separable, and separating
them is free. If Week 0 shows divergences are rare, positioning falls back to
history-and-search and **the architecture does not change** — a landing page rewrite,
not a rebuild. This is the cheapest insurance available on the riskiest assumption.

**Consequence.** Nothing in `src/` may branch on the positioning. If Reality Facts were
deleted tomorrow, the record would be unaffected.

---

## D-003 — Two-signal architecture: adapter hook *and* ground-truth floor ✅

**Conflict — never surfaced in the founding documents.** Technical intercepts at the
agent's tool-execution layer (pre-execution, resolved targets). Strategic watches the
filesystem and process tree from outside and says FS watching "should be the primary
signal" because subprocess interception won't catch everything. These are different
architectures with different properties, presented by each document as *the* approach.

**Decision.** Both. Ground truth (Tier 3) is the floor and is primary. The adapter hook
(Tier 2) enriches and builds the V2 dataset. Narration (Tier 1) is recorded as context
and never reasoned over.

**Why — three reasons, each sufficient.**

1. **The hook alone has holes.** Agents that edit through APIs or sandboxes evade it.
2. **The floor alone can never become V2.** You cannot block what already happened;
   Gate needs pre-execution interception, so the hook must exist at V0 even though V0
   never blocks.
3. **The discrepancy feature *is* the delta between the tiers.** You cannot detect
   divergence from one source. Technical had the claim side; Strategic had the reality
   side. They were never competing — each had half of the product's best feature.

**Bonus.** The floor is runtime-agnostic, which resolves a contradiction neither
document acknowledged — see D-004.

---

## D-004 — The ground-truth floor resolves "depth on one" vs. "cross-agent" ✅

**Conflict.** All three founding documents insist on depth on one runtime before
breadth. But Strategic's *second* defensive pillar is cross-agent history — which is
worth nothing at launch if only one runtime is supported. Both claims appear in the
same document, unreconciled.

**Decision.** The Tier 3 floor needs no adapter, so any agent's disk and process effects
are recorded from day one. The Claude Code adapter carries **depth**; the floor carries
**degraded-but-real breadth**.

**Why.** This makes the cross-agent pillar real at V0 at ~zero marginal cost, without
violating depth-on-one. Strategic proposes the FS floor but never makes this argument
for it — it is the strongest available argument for its own architecture.

**Consequence.** `lodestar <unknown-agent>` must work, recording floor-only with
honest coverage reporting.

---

## D-005 — Shadow-mode risk verdicts are stored, never displayed ✅

**Conflict.** Technical says V0 reports include "shadow-mode risk indicators (computed,
**shown**, never enforced)." Vision says shadow mode is "one **invisible** thing —
computing risk verdicts and recording them, blocking nothing."

**Decision.** Vision is right. Compute and store; never render.

**Why.** Two reasons. Showing risk scores nobody acts on trains users to ignore them —
the same "manufactured consent" failure Vision warns about for Prevention. Worse, they
compete for attention with Reality Facts, the one signal V0 needs read. A V0 report has
exactly one job.

The data still accrues silently, which is the entire point: V2 must prove its
false-positive rate against real traffic before it earns the right to enforce.

---

## D-006 — Deterministic replay demoted to nice-to-have ✅

**Conflict.** Vision lists deterministic replay as a V0 must-have. Strategic demotes
session replay to nice-to-have.

**Decision.** Strategic. Replay is a V0 nice-to-have and becomes real at V1.

**Why.** Replay is expensive and the timeline covers most of the need. It is exactly
the kind of polish that becomes a way to avoid the interception problem — which
Technical's Part 8 warns about by name: *"do not let dashboard polish become a way to
avoid the hard interception problem."*

**Note.** Founder's spec lists replay under Explain. That describes the *layer*, not V0.

---

## D-007 — The operating ladder drops Fix and Direction 🔶

**This is the most consequential open item in this document.**

**Conflict.** Founder's ladder: V0 Record+Explain · V1 Team · V2 Gate+Prevention ·
V3 Policy enforcement and org control · V4 Autonomous AI governance infrastructure.
Founder's Core Product Principles list three layers: Record, Explain, Gate.

The founding documents specify **six** layers, and place **Direction at V3** — where
Founder places policy/org control, which is Gate-family work.

**What this drops:**

- **Direction (Vision's V3)** — Vision calls it *"the most defensible layer"* and *"the
  deepest moat of the six,"* because its quality is a direct function of accumulated
  organizational history. *"A competitor can copy the algorithm; they cannot copy your
  five years of recorded decisions and incidents."*
- **Fix / Recovery (Vision's V2/V3)** — *"Explanation without recovery leaves the user
  informed and still broken."*

**Why this matters.** Vision's argument is that Record/Explain/Gate/Prevent are the
*copyable* layers — a determined competitor could build them. Direction is the one that
cannot be copied. A ladder that ends at governance ends on the commoditized side of
Vision's own analysis, which is precisely the "positioning drift" Vision names as the
company's #1 self-inflicted risk.

**Two readings, both plausible:**

1. **Deliberate.** Governance is the enterprise buyer's language and the revenue path;
   Direction is speculative and Vision itself calls it *"genuinely hard and genuinely
   risky."* Cutting it is a real strategic choice.
2. **Drift.** Direction was dropped because it is the least concrete layer, not because
   it was judged and rejected.

**Current handling.** `CLAUDE.md` uses Record/Explain/Gate as the **V0–V2 operating
filter** — correct either way, since Fix and Direct aren't reachable until the record
exists. The full six-layer arc lives in `LODESTAR-VISION.md`. Nothing is lost yet, and
nothing is decided.

**What is needed.** A founder decision, before V2 planning. **It does not block V0** —
no V0 code depends on it. But the V0 event schema already carries `missionId` and
`taint` specifically so Direction remains buildable; if Direction is deliberately cut,
say so and those fields become dead weight worth reconsidering.

---

## D-008 — Reality Facts ship before search ✅

**Conflict.** Strategic's roadmap: storage/history (Week 5) → dashboard/report
(Weeks 6–7). This spec: Reality Facts + report (Phase 3) → storage/search (Phase 4).

**Decision.** Reality Facts first.

**Why.** Reality Facts are the install trigger and the thing Week 0 measures — get them
in front of a human as early as possible, because they carry the riskiest assumption
in the product. Search is retention, and retention has no one to retain until people
install. Ordering follows risk, not data flow.

---

## D-009 — Claim-parsing is banned, not deferred ✅

**Refines Strategic.** Strategic's discrepancy examples are not equally safe. "Session
ended with three files half-edited" is deterministic. "Agent claimed tests passed"
requires extracting a claim from natural-language narration — fuzzy, therefore
false-positive-prone, therefore capable of **falsely accusing the agent of lying**.

**Decision.** Reality Facts are computed from ground-truth signals only. Claim-parsing
is banned outright — not deferred, not gated behind a confidence threshold.

**Why.** Vision warns that a prevention layer's credibility dies if it cries wolf.
Identical logic, worse consequences: a trust company whose headline feature wrongly
calls the agent a liar has spent the only asset it has. Vision is explicit that trust
is *"spent in an instant and rebuilt over years."*

**The inversion that makes the ban free.** You never need to prove the agent *claimed*
tests passed. `"npm test exited with code 1"` is the same signal to the developer,
needs zero inference, and cannot be wrong. The ban costs nothing.

**Enforced in code, not convention.** `signalTier` is a schema field; the evaluator
queries `groundTruth` only. Narration is unreachable from that code path.

**Confirmed by Founder** — this matches the Reality Facts Rule verbatim.

---

## D-010 — Week 0 answers two questions ✅

**Conflict.** Vision and Technical's Phase 0 asks: what fraction of agent actions are
cleanly classifiable versus opaque? Strategic's Week 0 asks: how often does the agent's
claim differ from reality? **The documents present these as the same gate. They are not.**

**Decision.** Run both. They gate different decisions:

- **Classification rate** → gates the event schema and adapter approach.
- **Reality Fact fire rate** → gates the positioning only (per D-002).

**Proposed bar for the second:** a material Reality Fact fires in roughly **1 session in
10**. **This is a judgment call, not derived from the founding documents** — flagged so
it is not mistaken for received wisdom. Rationale: a developer running agents several
times a day feels it every couple of days, which is enough to build a habit. Rarer than
~1 in 20 and it is a novelty.

**Neither document may be skipped to feel productive.** Both say so; both are right.

---

## D-012 — The V0 CLI is five commands ✅

**Decision.** `init`, `claude`, `report`, `sessions`, `status`. Nothing else ships in
V0.

Deferred with reasons: **`doctor`** (nothing to diagnose until installs fail in ways
support can't guess), **`config`** (`init` writes sensible defaults; editing
`config.json` is enough for one developer on one machine), **`export`** (the dashboard
button covers it), **`search`** (D-013), **`verify`** (D-016).

**Why.** Surface area is a tax on the magic loop. Every command in `--help` is a thing
the user must decide not to read. `init → claude → report` is the product; the other
two are support.

**Confirmed by Founder.**

---

## D-013 — Search lives in the dashboard, not the CLI ✅

**Conflict.** `PRODUCT-SPEC.md` §2 lists cross-session search as a must-have and calls
it "the retention engine." Founder's minimal CLI has no `search` command.

**Decision.** Both are right. **Search ships in V0 — in the dashboard, not the CLI.**

**Why.** Search is a browsing activity: you refine, scan results, click through to
evidence. That is a UI, not a flag. Putting it in the dashboard keeps the CLI at five
commands *and* keeps the retention engine — the two goals were never in conflict once
the surface was separated from the capability.

---

## D-014 — The shareable export is the growth loop, not a convenience ✅

**Conflict — nearly lost in the CLI trim.** Founder's `report` starts a local server
and opens a browser. But Strategic is explicit that the shareable report is what
spreads: *"a teammate sees it and wants their own."* **A localhost dashboard is not
shareable.** Trimming `export` from the CLI risked deleting the growth mechanism by
accident.

**Decision.** `report` = local server + browser (personal inspection). The **dashboard's
Export button** writes a fully self-contained static HTML file — no server, no client
fetch, openable by someone who installed nothing.

**Why.** Both needs are real and they are different surfaces of the same record.
Keeping export as a dashboard button rather than a CLI command preserves the five-command
budget while keeping the loop that acquires users.

**Consequence.** The static report's portability is a **requirement**, not a nice-to-have.
If it needs a server to render, the growth loop is broken.

---

## D-015 — Global install does not create a database ✅

**Conflict.** Founder's install output reads `✓ Local database created`, but the same
flow has `lodestar init` creating `.lodestar/lodestar.db`. A global npm install has no
project to create a database for.

**Decision.** `npm install -g` installs the CLI and the runtime detector. **`init`
creates the database.** Install output says `✓ CLI installed` / `✓ Runtime detector
ready`.

**Why.** Beyond correctness: npm `postinstall` scripts that write files trip
security-conscious developers, and that is precisely the wrong first impression for a
product whose entire pitch is trust. The first thing LODESTAR does should not be the
thing careful developers audit installers for.

---

## D-016 — Chain verification surfaces in `status`, not its own command ✅

**Conflict.** `API-DESIGN.md` originally specified `lodestar verify` as user-facing, on
the argument that a trust product must let you check its central claim yourself.
Founder's five-command CLI has no `verify`.

**Decision.** Keep the guarantee, drop the command. Integrity appears as a line in
`lodestar status` and in the dashboard footer.

**Why.** The argument for `verify` was about *reachability*, not about having a command
— and a line in `status` is strictly more reachable than a command nobody runs. The
verification code exists either way; only the entry point changes. `verify` returns as
a command in V1, when chains merge across machines and integrity becomes a real
question rather than a reassurance.

---

## D-017 — Sessions carry human-readable numbers ✅

**Decision.** Sessions get sequential display IDs (`#001`, `#124`) alongside internal
UUIDs. The UUID never appears in the UI.

**Why.** A developer should be able to say "session 124" out loud, to a teammate or to
themselves. `4a91c2` is unsayable. The UUID stays in the schema for chain identity and
future sync; the display number is a UX affordance, not an identifier — do not key
anything on it.

---

## D-018 — Session-end auto-summary 🔶

**Conflict.** The founding Technical Blueprint specifies "a concise terminal summary
printed immediately after the session ends." Founder's user flow goes from session end
straight to `lodestar report` with nothing in between.

**Question.** Should Reality Facts print automatically when a session exits, or wait
for `lodestar report`?

**The case for auto-print.** The magic moment arrives at zero commands, in the terminal
the developer is already staring at, at the exact moment they are deciding whether to
trust the agent's "done." That is the highest-intent instant in the entire product.

**The case against.** It is unrequested output in someone's terminal, and the founder's
flow deliberately makes `report` the moment. A tool that prints things you didn't ask
for is a tool people learn to ignore.

**Current handling.** Specified in `API-DESIGN.md` §4a, shipping behind a config flag,
defaulting on. Cheap to build, trivial to remove. **Does not block anything** — worth a
founder ruling once it can be felt on a real session rather than reasoned about.

---

## D-019 — `node:sqlite` replaces `better-sqlite3` ✅

**Reverses `ARCHITECTURE.md` as originally written, on measured evidence.**

**What happened.** The stack table specified `better-sqlite3` — the boring, proven
choice, per the founding Technical Blueprint. On a stock Windows 11 machine with Node
24, `npm install` failed:

```
gyp ERR! stack Error: Could not find any Visual Studio installation to use
```

No prebuilt binary exists for current Node, so it falls back to compiling from source,
which requires Visual Studio build tools.

**Why this is decisive, not an inconvenience.** `PRODUCT-SPEC.md` §5 makes "under three
minutes from install to first value" a requirement, and `USER-FLOW.md` §2 makes "zero
permission required to start" **the single most important product decision in V0**. A
native module that demands a C++ toolchain breaks both — on the founder's own machine,
before a single external user has tried it. The wedge is *"install in one command and
see what your agent did."* A tool that opens with a compiler error has no wedge.

**Decision.** Use `node:sqlite`, built into Node 22.5+. Zero native dependencies, zero
build tools, no install step that can fail.

**Verified before adopting**, not assumed: WAL mode, prepared statements, transactions,
and `json_extract` all work. 24 storage tests pass against it, including the full
hash-chain tamper-detection suite.

**The cost, stated honestly.** `node:sqlite` is flagged experimental and prints an
`ExperimentalWarning` on import. Two consequences:

1. **Suppressed in the CLI** — but *only that one warning*, matched by name and message,
   in `src/cli/suppress-warnings.ts`. Never `NODE_NO_WARNINGS`, which would hide real
   warnings. The experimental status is not hidden from *this decision*; it is hidden
   from every run of a CLI where the user cannot act on it.
2. **The API may change.** Mitigated by `EventStore` being an interface: the storage
   engine is swappable without touching the schema, the chain, or anything above it.
   If `node:sqlite` breaks, we swap the implementation, not the record.

**Trade accepted:** an experimental-but-working built-in beats a proven-but-uninstallable
native module, when installability *is* the product's first promise.

> **Note for the reader.** This is the first decision here driven by measurement rather
> than reasoning, and it went against the document. That is the intended behavior —
> `ARCHITECTURE.md` chose `better-sqlite3` for good reasons that turned out to be wrong
> in this environment. Record what happened, change the doc, move on.

---

## D-020 — Vitest 4 required for `node:sqlite` ✅

**Context.** Vitest 2 (Vite 5) could not load `node:sqlite` at all:

```
Error: Failed to load url sqlite (resolved id: sqlite)
```

**Cause — a genuine quirk worth writing down.** `node:sqlite` is the only Node builtin
importable *solely* with the `node:` prefix: `require('module').builtinModules` contains
`node:sqlite` but **not** bare `sqlite`. Vite strips the prefix before checking its
builtin list, fails to find `sqlite`, and tries to resolve it as a package on disk.

**Decision.** Vitest 4 / Vite 8, which handle it natively. A `vitest.config.ts`
externalization workaround was tried first and did **not** work — the resolution happens
before user config applies. The config file is retained with the reason documented.

**Bonus.** The upgrade also cleared 5 npm vulnerabilities (1 critical) that came in
through Vite 5's dependency chain.

---

## D-021 — Process-tree sampling rejected; exit-code coverage deferred to Phase 6 ✅

> **Answered by D-023.** Phase 6 measured it: shims are real ground truth where they win,
> and coverage is now probed per-command instead of assumed. Kept for the reasoning.

**The constraint.** `ARCHITECTURE.md` C2 asks for "every process the agent spawns, with
argv, **exit code**, and duration." Exit codes are the hard half: **only a parent
process learns its child's exit status.** RF-01 — *"npm test exited with code 1"* — is
the headline Reality Fact, so this is not a detail.

**Sampling the OS process tree was designed and rejected.** Three costs, zero exit codes:

1. **It cannot produce exit codes at all.** A sampler sees a PID appear and later
   vanish; the status was reaped by the real parent and is gone. RF-01 is unreachable.
2. **It misses anything shorter than the poll interval**, so the record silently gains
   holes — the worst failure mode available to a trust product.
3. **On Windows, dependency-free enumeration means shelling out to PowerShell** (~200ms
   startup, per sample). Polling that at a useful rate burns CPU on the developer's
   machine, violating "the developer does not change workflow" (USER-FLOW.md §4).

**Decision for Phase 5.** `ProcessRecorder` records only processes LODESTAR itself
spawns — exact command, real exit code, true duration. This is the mechanism Phase 6
uses for the agent, and the mechanism any shim would call into.

**The open question, stated plainly:** LODESTAR spawns the agent, but the agent spawns
`npm test` itself. We are the *grandparent*, and Node does not surface a grandchild's
exit status. So how does RF-01 fire on a real session?

Two candidates, and the choice is architectural, not cosmetic:

| | **PATH shims** | **Runtime adapter (Claude Code hooks)** |
|---|---|---|
| How | Prepend `.lodestar/shims` to PATH; each shim records and execs the real binary | `PostToolUse` hook reports the Bash tool's exit code |
| Signal tier | **groundTruth** — we are the parent | **intent** — the audited party reporting on itself |
| Coverage | Any agent, any runtime | Claude Code only |
| Risk | Can break the agent if a shim misbehaves; Windows needs `.cmd` shims | Trivial to build |

**The tier is what makes this hard, and it is not a technicality.** Reality Facts may be
computed from `groundTruth` only (D-009, enforced in code). A hook-reported exit code is
the *runtime* telling us how it went — the audited party auditing itself, which is the
exact thing LODESTAR exists to distrust (LODESTAR-VISION.md §1). Taking hook exit codes
as ground truth would quietly hollow out the product's central claim while every test
still passed.

So the honest reading: **shims are how RF-01 stays true.** But shims are real work and
carry a real risk of breaking the agent, which is a hard constraint.

**Not decided now, deliberately.** Phase 5's job was proving observation works; it does.
This gets decided at Phase 6 with the wrapper in hand, where the risk can be measured
instead of guessed. **Coverage reports `processExitCodes: true` only for processes we
launched** — it does not imply coverage of agent-spawned children, because it does not
have it.

---

## D-022 — chokidar 4 silently dropped glob support ✅

**Found by a failing test, not by reading the docs. Worth recording because the failure
mode is invisible.**

chokidar 4 **removed glob support from `ignored`**. It still accepts an array of glob
strings without error, at both the type level and at runtime — and matches **nothing**.
Passing `['**/.lodestar/**']` is indistinguishable from passing nothing.

**What that actually caused.** LODESTAR watched its own database. Every `emit()` wrote to
`.lodestar/lodestar.db`; the watcher saw the write; that emitted an event; which wrote to
the database. **An unbounded feedback loop, snapshotting a growing SQLite file every
turn.** The test suite survived only because `awaitWriteFinish` debounced it and the
tests called `stop()`. A real session would have spun until the machine noticed.

It also meant `node_modules` and `dist` flooded the record, and RF-02 fired on
LODESTAR's own artifacts — a **false positive on a Reality Fact, caused by the act of
observing**.

**Decision.** Ignore matching moves into `src/recorder/ignore.ts`, using `picomatch`
explicitly, with a matcher function passed to chokidar. Verified by tests that assert the
loop guard specifically.

**Two invariants fall out of this, and both are structural rather than configurable:**

1. **`ALWAYS_IGNORE` cannot be overridden by config.** `.lodestar` and `.git` are always
   ignored. A `config.json` that could disable this could hang the developer's machine.
   Config may only *add*.
2. **The observer must not appear in its own record.** The git recorder filters
   `.lodestar` paths out of the dirty list for the same reason — `init` gitignores it,
   but a user may not have run `init`, or may have removed the line.

**The transferable lesson:** an ignore rule that silently matches nothing looks exactly
like one that works, right up until something recurses. Filters that protect an
invariant need tests that assert the invariant, not the filter.

---

## D-023 — Execution boundary strategy ✅

**Supersedes the tentative conclusion in D-021.** D-021 guessed that PATH shims were
"the honest answer" for exit codes. Measurement says that is **half true on this
machine and unknowable in general**. This record is what the investigation found.

### The five questions, answered by measurement

**Q1 — How does the agent runtime launch child processes?**

Claude Code 2.1.210 is a Bun-compiled native binary (`claude.exe`, 252 MB); the JS is
embedded, so its behavior is observable via `strings`. It does not spawn commands
directly — it maintains a **persistent shell** and feeds commands to it:

```js
getSpawnArgs(s) { let a = o !== undefined;
  if (a) w("Spawning shell without login (-l flag skipped)");
  return ["-c", ...a ? [] : ["-l"], s] }
```

Two facts follow, and both matter:

1. **Commands are resolved through a shell, so PATH resolution applies.** Shims are
   mechanically possible.
2. **The shell is a LOGIN shell by default** (`-l`). This is the finding that changes
   everything.

**Q2 — Which processes can LODESTAR become the parent of?**

Exactly one: **the agent itself**. LODESTAR spawns `claude`; `claude` spawns the shell;
the shell spawns `npm`. We are the grandparent of everything that matters, and Node does
not surface a grandchild's exit status. This is an OS constraint, not a design gap.

**Q3 — What can be captured with certainty?**

| Capture | Mechanism | Tier | Certain? |
|---|---|---|---|
| Agent lifecycle, argv, PID, exit code, duration | We are the parent | groundTruth | **Yes** |
| File contents before/after, creations, deletions | FS watcher + snapshots | groundTruth | **Yes** |
| Commits, ref moves, dirty tree | git recorder reads the repo | groundTruth | **Yes** |
| Command exit codes | PATH shim — **only where verified** | groundTruth | **Per-command; measured, not assumed** |

**Q4 — What remains outside observation?** Stated plainly, because this list is the
product's honesty:

- Commands whose shim is **shadowed** on PATH (see below).
- Commands invoked by absolute path (`/usr/bin/git`), which never consult PATH.
- Builtins (`cd`, `echo`) — no process is created.
- Anything the agent does **in-process**: an HTTP call from the runtime's own code, a
  file edit through its own APIs rather than a subprocess. The FS watcher catches the
  *effect* of the latter; nothing catches the former.
- Commands run outside a LODESTAR session entirely.

**Q5 — Which mechanism gives the highest confidence at the lowest risk?**

### The measurement that decided it

PATH shims work — in isolation. Verified: a shim intercepts, the real binary still
executes, and the exit code passes through byte-exact (real git's `129` survived).

**But Claude Code spawns a *login* shell, and `/etc/profile` rewrites PATH:**

```sh
# Git for Windows /etc/profile, line 52
PATH="${MINGW_MOUNT_POINT}/bin:${MSYS2_PATH}${ORIGINAL_PATH:+:${ORIGINAL_PATH}}"
```

Our shim directory is not erased — it is **demoted** below `/mingw64/bin` and
`/usr/bin`. So a shim wins only if the command does not also exist in those directories.
Measured on this machine, under the login shell the agent actually uses:

| Command | Resolves to | Shim |
|---|---|---|
| `git` | `/mingw64/bin/git` | **MISS** |
| `npm` | our shim | HIT |
| `node` | our shim | HIT |
| `python` | our shim | HIT |
| `docker` | our shim | HIT |

**Coverage is per-command and environment-dependent.** It depends on the user's shell,
their profile, and what their platform ships in `/usr/bin`. It cannot be predicted from
this codebase.

**And here is the trap:** a bypassed shim emits *nothing*. Silence. Which is
indistinguishable from "the command never ran." That is precisely the D-022 failure —
a filter that silently matches nothing looks exactly like one that works.

### Alternatives considered

| | Verdict | Why |
|---|---|---|
| **A. Agent hooks** (`PostToolUse` exit codes) | **REJECTED** | The audited party reporting on itself. A hook-reported exit code is the runtime telling us how it went — the exact thing LODESTAR exists to distrust (VISION §1). It would be `intent`, never `groundTruth`, so D-009 forbids computing Reality Facts from it. Trivial to build, and it would hollow out the central claim while every test still passed. **This is the approach that must be refused even though it is the easiest.** |
| **B. PATH shims alone** | **Insufficient alone** | Real ground truth where they land, but coverage is partial, environment-dependent, and silently incomplete. |
| **C. Process spawning wrapper** | **Necessary, not sufficient** | Certain ground truth for the agent process itself — argv, PID, exit code, duration. Sees nothing below it. |
| **D. OS-level observation** (ptrace/eBPF/WMI) | **REJECTED** | Cannot produce exit codes without being the parent or holding privileges; needs root/admin; per-platform; and on Windows the dependency-free path costs a PowerShell launch per sample (D-021). High cost, low certainty, and it would make install require elevation — destroying "zero permission required to start" (USER-FLOW §2). |
| **E. Combination** | **CHOSEN** | See below. |

### Decision

**C + B, with measured coverage. A is refused on principle; D on cost.**

1. **Wrapper (C)** — LODESTAR spawns the agent. Its lifecycle and exit code are
   `groundTruth` and **certain**, because we are genuinely the parent.
2. **Shims (B)** — installed for high-value commands, giving real `groundTruth` exit
   codes where they land.
3. **A coverage probe — the part that makes (2) honest.** Before the agent starts,
   LODESTAR asks *the same login shell the agent will use* to resolve each shimmed
   command. If `command -v npm` returns our shim, npm is observed. If `command -v git`
   returns `/mingw64/bin/git`, **git is not observed, and we say so** — per command, in
   the session record and in coverage.

The probe converts an unknowable silent hole into a **measured, declared** one. We never
claim coverage we have not verified *on this machine, in this shell, this session*.

This is the difference between "we install shims and hope" and a trust claim with a
measurable implementation behind it.

### Limitations, stated rather than buried

- Shim coverage is **per-command and per-environment**. Git is unobserved on this
  machine. That is a real hole; it is declared, not hidden.
- The shim adds a process launch (~30–50 ms) per intercepted command.
- `git` being a common MISS is partially — **not fully** — compensated by the git
  recorder, which observes commits, ref moves, and tree state directly from the repo.
  That covers git's *effects*, not its exit codes.
- A shim must never break a command. Every shim `exec`s the real binary and propagates
  its exit code verbatim; if the shim's own recording fails, the command still runs.

### Future migration path

- **Non-login shell.** The strings show `-l` is skipped when an internal variable is
  set. Relying on an undocumented internal of the audited runtime would be fragile and
  runtime-specific — exactly the coupling the adapter boundary exists to prevent. Not
  taken.
- **`$HOME/bin`.** Measured: `/etc/profile` puts it *first*, so shims there would win
  even under a login shell. **Rejected as dangerous** — it is global and persistent,
  affecting every shell on the machine forever, and a shim left behind by a crash would
  silently intercept the user's commands outside any LODESTAR session. A local tool must
  not leave global traps.
- **Per-runtime cooperation** (a documented flag to run a command through a recorder) is
  the real long-term fix and belongs in the standard-position bet (VISION §2, asset 3).
- **V2 Gate** needs pre-execution interception, which shims already provide structurally
  — a shim can refuse to exec. Nothing here forecloses that.

---

## D-024 — `lodestar run <agent>` added; `lodestar claude` kept ✅

**Conflict.** `USER-FLOW.md` §7 fixes the CLI at **five commands** and `CLAUDE.md` says
adding a sixth requires a decision here. Phase 6 asks for `lodestar run <agent>`, which
is a sixth — and `USER-FLOW.md` §4 is explicit that the flow is `lodestar claude`, whose
whole point is to feel like `claude`. Adding `run` makes the wedge command *longer*.

**Decision.** Ship both. `lodestar run <agent>` is the canonical, explicit form;
`lodestar claude` stays as sugar for the wedge runtime and remains what the docs and
landing page show.

**Why both, rather than picking.** Bare dispatch cannot be extended safely. D-004
requires `lodestar <unknown-agent>` to work floor-only for cross-agent coverage — but if
any unrecognized word launches an agent, then `lodestar reprot` (a typo) tries to launch
an agent named `reprot` instead of saying "unknown command". `run` removes the ambiguity
for the general case, while the sugar keeps the wedge's ergonomics.

Count is now six. The constraint was never "five" for its own sake — it is that every
command must earn its place, and this one carries D-004.

---

## D-026 — The shim fork bomb, and why the shim dir is baked in ✅

**Found by stress testing. Would have hung a user's machine. Unit tests were green.**

The shim finds the real binary by scanning PATH and **skipping its own directory**. That
skip is the most dangerous line in the codebase: if it fails, the shim finds itself,
execs itself, and recurses without bound.

It failed. The runner inferred its directory as:

```ts
const shimDir = process.env[ENV_SHIM_DIR] ?? dirname(process.argv[1])
```

`argv[1]` is `dist/recorder/shim-entry.js`, so the fallback resolved to
`dist/recorder/` — **not the shim directory**. With `LODESTAR_SHIM_DIR` unset or wrong,
nothing was excluded, the shim found itself first on PATH, and recursed. Measured: a
10-second hang, terminated only by SIGKILL. On a real machine there is no SIGKILL
waiting.

Env vars are not a safe channel for this. A login shell, a `sudo`, a sandbox, or a
`env -i` can strip them — and the failure mode of a stripped variable was catastrophic
rather than degraded.

**Decision — two layers:**

1. **The shim directory is baked into the shim script at install time**
   (`--shim-dir "<abs>"`). A shim's own location is a fact known at write time; it must
   never be inferred at run time. If the flag is missing, the runner **refuses to run**
   (exit 126) rather than scanning a PATH it cannot safely exclude itself from.
2. **A recursion depth guard** (`LODESTAR_SHIM_DEPTH`, max 3). Pure safety net. The
   baked path should make recursion impossible — but "should" is what the previous
   version implied too. If self-exclusion ever breaks again, this turns a machine-hang
   into one loud error. Depth 3 because depth 2 is legitimate: `npm test` spawns `node`,
   and both are shimmed.

**Regression-tested in both places:** `stress/forkbomb.mjs` (5 hostile env
configurations, hard timeouts — a hang IS the failure) and `shims.test.ts`.

**The pattern, third occurrence.** This is the same shape as D-022 (chokidar globs
matching nothing) and D-019 (ESM hoisting): *a mechanism that silently does nothing,
or the wrong thing, while looking correct.* All three passed review. All three were
caught only by running the real thing under stress. Unit tests verify what you thought
of; stress tests find what you didn't.

---

## D-027 — Test files were never typechecked ✅

**The cause of the "red errors" reported across `ignore.test.ts`, `recorder.test.ts`,
and `shims.test.ts` — and they were not phantom.**

`tsconfig.json` carried `"exclude": ["**/*.test.ts"]`. Two consequences, both bad:

1. **`npm run typecheck` silently skipped every test file.** It checked 31 files and
   reported success; there were 36. Five files of test code had never been typechecked.
2. **The editor had no config for those files**, so it fell back to inferred defaults —
   no `types: node`, no module resolution — and painted errors across all of them. The
   errors looked like stale cache. They were a real config hole.

**Decision.** Standard split:

- `tsconfig.json` — includes **everything**, `noEmit`. What the editor and
  `npm run typecheck` use.
- `tsconfig.build.json` — extends it, emits, excludes tests and `stress/`. What
  `npm run build` uses.

**It paid immediately**: the first run with tests included found a real type error in
`shims.test.ts` that had been invisible.

**The lesson worth keeping:** excluding files from tsconfig does not merely skip
checking them — it removes their configuration, and an editor with no config invents
errors. If a file is in `src/`, the typechecker should see it. Control emit through the
build config, never through the checker's file list.

---

## D-028 — Redaction is a store property, not a render property ✅

**`API-DESIGN.md` §5 promised "secrets are redacted before the event is constructed,
never at render" for two phases. Nothing redacted anything.** Found by reading the docs
against the code, which is the method §8 of the session log recommended and which worked.

Every command the agent ran went into the record verbatim: `curl -H "Authorization:
Bearer …"`, `psql postgres://user:pass@host`, `npm publish --token …`.

**Why this was the highest-severity gap in the codebase**, and not merely a missing
feature: the store is append-only and hash-chained *on purpose*. `EventStore` has no
`update`/`delete`, triggers reject both, and the chain makes out-of-band edits
detectable. Those properties compose into something nobody had stated:

> **A secret that reaches the record can never be removed from it.**

The routine remedy for a leaked credential — delete the log line — is unavailable by
construction. The only way to excise it breaks the chain, making an honest cleanup
indistinguishable from tampering. **Our central security property converts a survivable
incident into an unrecoverable one.** That is why redaction had to be at construction,
and why "redact at render" was never a weaker version of the same thing — it is no
protection at all, since the plaintext is already durable on disk.

**Decision.** `core/redact.ts`, called at every ingress before an event exists:
`ProcessRecorder` (spawn argv, exit command, captured stdout/stderr tails) and the shim
runner (the agent's own commands — the highest-value point).

**Constraints it holds, and why each is load-bearing:**

- **Deterministic** — or Reality Facts stop being reproducible (PRODUCT-SPEC §4 rule 2).
- **Structure-preserving** — `npm test` survives byte-identical, or RF-01's command
  grouping and RF-04's test-shape matching break silently.
- **Never widening** — argv length is preserved exactly; redaction only replaces a span.
- **Execution is never redacted** — `spawn` gets the real argv. Only the record is
  filtered. Redacting the exec path would break the developer's command.

**Structure beats text**, which is why `redactArgs` is argv-aware: in `--token s3cr3t`,
the secret matches no vendor shape and is indistinguishable from an ordinary argument.
Only its *position* gives it away.

**What it is not.** A best-effort filter over known secret shapes — not a guarantee. It
is described that way everywhere it surfaces: "known secret patterns are redacted", never
"the record contains no secrets". Overclaiming here would be worse than not shipping it,
because a developer who believes the record is clean will paste it into an issue tracker.
The real mitigation for what it misses is `.lodestar/` staying local and git-ignored.

**Deliberately conservative.** Patterns are prefix-anchored on vendor shapes. Matching
"long random-looking string" would eat commit SHAs, content hashes, and UUIDs — all
load-bearing evidence. `GIT_AUTHOR_NAME` contains "auth" and is excluded. `-p` is not a
secret flag, because `mkdir -p` and `docker run -p` are not secrets. **A false positive
destroys evidence; a redactor that eats the record has broken it as thoroughly as one
that leaks.**

---

## D-029 — `\"` was the wrong escape, and it was arbitrary code execution ✅

`cmdQuote` emitted `"${token.replace(/"/g, '\\"')}"`. **`\"` is the MSVCRT escape** —
correct for a C program parsing its own argv, and meaningless to cmd.exe, which tracks
quote state by counting `"` and ignores the backslash.

```
arg:  x"&echo PWNED&"y
line: npm.cmd "x\"&echo PWNED&\"y"
      → quote closes after `x\`, `echo PWNED` runs as its own command
```

Reachable for every `.cmd`/`.bat` target — on Windows that is `npm`, `npx`, `pnpm`,
`yarn`, `tsc`: **the common case, not an edge case.** An agent passing a crafted argument
could execute arbitrary commands *because LODESTAR was watching*. **A recorder that
creates the vulnerability it exists to observe is the worst failure available to this
product.**

**Decision.** `"` → `""`, the correct cmd.exe escape, which also survives the batch `%*`
splice and the final MSVCRT parse. This is where Rust's standard library landed for
`make_bat_command_line` after CVE-2024-24576 ("BatBadBut"); we follow it rather than
invent a scheme, in a place where being clever has already cost us once. The
quote-forcing charclass also gained `,` `;` `=` `!`, all of which cmd treats specially
when unquoted.

**And `%VAR%` is refused, not best-efforted.** `%` expansion happens during cmd's parse
and has no escape on a `/c` line (`%%` is batch-file-only). Three options existed:

- Expand silently → the command runs with arguments the developer did not write, and
  LODESTAR records the pre-expansion argv. **The record disagrees with reality**, which
  is the one unrecoverable failure.
- Strip or mangle → same, quieter.
- **Refuse, loudly, and say why.** ✅

Rust rejects `%` in batch args outright. We are narrower: only variable-shaped `%NAME%`
can expand, so `50% done`, `%20` in a URL, and a bare `%` all still work.

This does break a command, which `shim-runner.ts`'s governing rule forbids — **but that
rule is about *recording* failure, where execution is still correct.** Here execution
itself cannot be made faithful. Refusing is the honest failure; running something the
developer did not write is not.

**Tested by execution, not inspection**, and the test was verified to fail against the
old escape before being kept. The bug was *a quoting scheme that looked correct* —
reading the code is exactly what let it ship.

---

## D-030 — The wrapper invented success for killed sessions ✅

`run.ts` ended with `return exitCode ?? 0`, three lines below a comment reading "a
wrapper that invents its own status breaks every one of them."

`exitCode` is null **exactly when the child was killed by a signal** — Ctrl-C, a CI
timeout's SIGTERM, an OOM kill. So `lodestar claude` reported **success** for a session
that was killed mid-work, and any script wrapping the agent saw 0 and carried on.

`recorder.stop(exitCode)` was already recording the null honestly, which made it worse
rather than better: **the ledger said "killed, no exit code" while the process told the
shell "fine".** The record and the wrapper disagreed, and automation trusts the wrapper.

Same bug in the shim (`exitCode === null → return 1`), whose comment claimed the signal
number was "not portably available" — it is, via `os.constants.signals`. A Ctrl-C'd
`npm test` reported 1 (assertion failure) instead of 130 (interrupted), so
`cmd || fallback` behaved differently under LODESTAR than without it.

**Decision.** 128 + signal, the shell convention, in both places. Fall back to 1 only
when the platform does not name the signal — a coarse non-zero is honest; a zero is not.

---

## D-031 — The depth guard fired on real work ✅

`MAX_SHIM_DEPTH = 3`, justified by "`npm test` runs `node`, so depth 2 is normal". Depth
is inherited through the whole process tree and never resets. **This repository's own
`package.json` blew through it:**

```
npm run check → npm run stress → npm run build → tsc → tsc.cmd → node   (depth 4)
```

Two consequences, both disqualifying: the agent's command **broke under LODESTAR and
worked without it** (the wedge cannot survive that), and LODESTAR then recorded the
non-zero exit as `groundTruth` — **a Reality Fact that is literally true, caused entirely
by LODESTAR, and reported as the agent's failure.** The recorder would have been
manufacturing the evidence it exists to observe.

**Decision.** 12. The guard exists for the fork-bomb class, where depth climbs without
bound in milliseconds; it does not need a tight limit to catch that, and the tight limit
is precisely what made it fire on real work.

---

## D-032 — sh expansion in the shim template: D-026, reached through the path ✅

The POSIX shim interpolated into `"..."`, where sh still expands `$`, backticks, and `\`.
Nothing escaped them, so **the project's own path was executable text**.

The quiet variant is the dangerous one. A path containing a plain `$` (`/home/u/foo$bar/`)
expands to nothing → `--shim-dir` arrives wrong → `findReal` excludes the wrong directory
→ **the shim finds itself and recurses.** That is D-026 again: same fork bomb, same root
cause (the shim's location must never be re-interpreted at runtime), reached through the
path instead of argv.

**Decision.** Single quotes — the only sh form with no expansion at all — via `shQuote`.
`probeCoverage()` already did this correctly at the line below; the install path did not.
The `.cmd` template got `%%` escaping for the same reason (`%` is legal in Windows
directory names). The coverage probe's `${r#$SHIM/}` also had `$SHIM` sitting in glob
position, so a path with `[` or `*` silently under-reported coverage.

**The test that guarded D-026 asserted the mechanism** — it hard-coded
`--shim-dir "…"` and failed on the quoting change while the invariant it protected was
intact. Rewritten to assert the invariant: the directory is baked in. This is §8 of the
session log ("assert the invariant it protects, not the mechanism") catching itself.

---

## D-033 — File contents are withheld, not redacted, for credential paths ✅

D-028 redacted the *process* path. An audit of every remaining ingress found a larger
one: `SnapshotStore.putFile()` reads and stores the **full content of any watched file**,
and `DEFAULT_CONFIG` watches `**/*` with no entry for `.env`, `id_rsa`, or `*.pem`. An
agent editing `.env` copied the developer's credentials into `.lodestar/sessions/blobs/`
in plaintext.

**Why `redactText` is the wrong tool here.** A `.env` is not text that *contains* a
secret — it is a file that is *entirely* secrets, in arbitrary formats, many of which
match no pattern. Redacting it yields a blob that looks scrubbed and is not, which is
worse than storing nothing, because it invites trust.

**Decision.** `isSensitivePath()` is checked *before the file is opened*, so the bytes
never enter the process. The `file.write` event is still recorded — "`.env` changed at
14:32" is real evidence, arguably among the most interesting a session produces — and it
declares `contentWithheld: 'sensitive'`. That is the existing `oversized` shape, which
already records metadata and skips bytes for large files.

**Adding `.env` to `ignore` would have been the wrong fix**: it drops the *event*, losing
the evidence that `.env` changed at all. Record the event, withhold the bytes.

**Deliberately over-broad, inverting D-028's rule**, and the asymmetry is the point:

| | False positive costs |
|---|---|
| `redactText` | **Destroyed evidence** — a mangled command string is gone forever |
| `isSensitivePath` | **A diff.** Event, path, timing, size all survive |

So `*.key` is withheld even though many `.key` files are harmless. `.env.example` and
`id_rsa.pub` are excluded — templates and public keys are published by convention.

**`contentWithheld` exists because absence is ambiguous.** No `snapshotRef` could mean
unchanged, unreadable, oversized, or withheld. A record that cannot distinguish those has
an undeclared hole. Related: a sensitive file has no ref, so it can never hit the
"identical content, skip" branch — we cannot know whether a `.env` rewrite changed
anything, and claiming "unchanged" from absent evidence is exactly the inference this
product forbids.

---

## D-025 — One cause must not produce two facts ✅ → resolved by D-034

*Recorded retroactively under D-052: the code cites D-025 in four places and this file had
no entry for it — it existed only as a "Resolves D-025" line inside D-034.*

**The problem.** `npm test` spawning `node` produces **two true, independently-observed
failures for one underlying cause.** Both are real; both satisfy every Reality Facts rule.
Reporting both is crying wolf, and a trust product that cries wolf is finished.

**Why it was hard.** The obvious fix — dedupe by timestamp proximity or command similarity
— is *guessing*, and a fact built on a guess is exactly what the rule bans. So the noise
could not be fixed by suppressing facts; it had to be fixed by **observing the
relationship** between them.

**Resolved by D-034** (process ancestry, observed at spawn by the parent, carried in the
schema). The rule that came out of it: a failure with a *failing ancestor* is subsumed by
it and attached as evidence rather than raised as a second alarm — and unknown ancestry
never suppresses anything.

D-041 and D-045 later constrained the same mechanism further: agent-controlled values may
annotate but never suppress, and later evidence may qualify but never delete.

---

## D-034 — Process ancestry is observed, not inferred ✅

**Resolves D-025.** `npm test` spawning `node` produced two true, independently-observed
failures for one cause, and RF-01 reported both.

The tempting fix — dedupe by timestamp proximity or command similarity — is **guessing**,
and a fact built on a guess is what the Reality Facts Rule bans. The noise had to be
fixed with evidence.

**PIDs cannot express this.** They are reused by the OS, meaningless after exit, and
reading them later infers parentage rather than observing it.

**Decision.** Each shim invocation mints an `execId` and publishes it via `LODESTAR_EXEC_ID`
before exec'ing. Any shimmed descendant reads it as `parentExecId`. **The relationship is
therefore recorded by the only party that witnessed it — the parent, at the moment of the
spawn.** `Recorder` roots the tree at the agent process, the one execution LODESTAR is
genuinely the parent of (D-023 Q2). Walking that chain is reading the record, not
interpreting it — which is the whole distinction the product sells.

**The rule.** A failure with a *failing* ancestor is subsumed by it: `npm test exited 1`
is what a developer acts on, and the `node` beneath is attached as **evidence**, not
raised as a second alarm. Three cases resolve the other way, all in the same direction:

- **Ancestor succeeded** → still report. `npm test || true` genuinely failed; a parent
  swallowing the code does not unmake it, and suppressing would infer intent.
- **Ancestry unknown** (shadowed shim, stripped env) → still report. Absence of a
  `parentExecId` is not absence of a parent.
- **Chain is cyclic** → still report. See below.

**The asymmetry that decides every one of them: over-reporting is a nuisance; silently
dropping a real failure is a lie.**

**The adversarial tests found a real bug in the first version**, which searched for a
failing ancestor *while* walking:

- **Self-parent** — `execId === parentExecId` matched itself on hop one and suppressed
  its own fact. One forged field, one silenced failure.
- **Cycle** — with `a→b→c→a`, every node found a failing "ancestor" and **all three facts
  disappeared.**

Both are reachable from a record an agent partly influences, and both hide failures —
the one thing a trust record must never do. The walk now reaches the root *before*
suppression is considered, and a cycle anywhere means ancestry is not evidence.

This is why the tests are adversarial rather than confirmatory. "Does it work?" passed on
the buggy version.

---

## D-035 — There are two append paths, and the floor must cover both ✅

`RecordingContext.emit()` applies `redactDeep` to every payload as a floor. The class
already existed because "a recorder that built its own event objects would eventually get
one of the invariants wrong" — secrets are now one of those invariants, with a stronger
argument: the store is append-only, so a payload is unremovable the instant `append`
returns. "Remember to redact in your recorder" held for **zero of the four event paths**
that existed when it was written.

**But the shim is a separate process and cannot use `RecordingContext`.** It builds
`DraftEvent`s by hand and calls `store.append` directly — and it is the *highest-traffic*
path in the product, carrying the agent's own commands. A floor with a hole in that path
is not a floor. So `safeAppend` re-establishes it there.

**Structure-aware redaction stays where it is.** `redactArgs` knows the token after
`--token` is a secret from *position*; no generic pass can. The precise passes are the
quality, the floor is the guarantee, and `redactText`'s idempotence lets them compose.

**Keys are never redacted, only values** — a key is schema, and redacting one would
corrupt the event's shape rather than protect anything. The walk is depth-bounded, since
an unbounded recursion over payload data would be a denial of service on the recorder.

**The generalizable lesson:** an invariant enforced at a choke point is only as good as
the claim that the choke point is the *only* path. That claim must be checked, not
assumed — it was false here, and the counter-example was the most important path.

---

## D-036 — `existsSync` is not an executability check ✅

`findReal` accepted any path that existed. On POSIX `exts` is `['']`, so a **directory**
named `node` earlier on PATH — or a non-`+x` file named `go` — was returned as "the real
binary". `spawnSync` then failed EACCES/EISDIR and the shim reported "the command did NOT
run", exit 126.

A real shell skips the entry and keeps scanning. So the command **worked without LODESTAR
and broke with it** — the asymmetry the wedge cannot afford, and the same failure shape as
D-031.

**Decision.** `isExecutableFile()` asks what the shell asks: is it a regular file, and can
this process execute it (`X_OK`)? On Windows `X_OK` is meaningless — `accessSync` reports
every readable file as executable — which is fine, because there the *extension* is the
executability contract and PATHEXT has already filtered for it. Errors resolve to `false`:
an unreadable candidate is not a binary we can run, and guessing otherwise re-creates the
bug.

---

## D-037 — The ledger and the blob store have different rules, on purpose ✅

**Found by an end-to-end session that 173 unit tests missed**, which is the point of
running the real thing (§8 of session 1). A session was driven with real credentials in
`.env` and a hardcoded token in the agent's source. Result:

| Store | Secrets found | Why |
|---|---|---|
| Hash-chained event ledger | **0** | D-028/D-033/D-035 hold |
| Content-addressed blob store | **yes** — `agent.mjs`, verbatim | A source file with a hardcoded token |

`.env` behaved exactly as designed: `contentWithheld: 'sensitive'`, no blob, event
recorded. The blob was an ordinary source file that happened to contain a secret.

**Decision: this is correct, and the two stores are governed differently.** The reasoning
that forces construction-time redaction on the ledger does **not** transfer to blobs, and
conflating them would produce a worse product:

- **The ledger is immutable.** No `update`/`delete`, triggers reject both, and excision
  breaks the chain — so an honest cleanup is indistinguishable from tampering. A secret
  there is unremovable. Hence D-028.
- **Blobs are not chained.** *Verified*: deleting a blob leaves the chain
  `✓ verified (8 events)` with a dangling ref. **Blobs are removable, so the argument
  that forces redaction on the ledger simply does not apply to them.**

**Why blobs are not redacted.** A blob is the *content of the developer's own file*,
already sitting unredacted on their disk. Redacting it would destroy the before/after
diff — the core evidence V0 produces — and produce something actively misleading: a
record showing `[REDACTED]` where the real file says `hunter3`. The record would then
disagree with reality, which is the one unrecoverable failure.

**The mitigations, each verified rather than assumed:**

- `.lodestar/` is git-ignored by `init` (`git check-ignore` confirms the rule resolves).
- Blobs are deletable without breaking integrity — the remediation path the ledger lacks.
- Credential-shaped files are never snapshotted at all (D-033).

**The honest statement**, which is now what the README says: *the immutable ledger cannot
contain known secret shapes; the blob store contains copies of your project files and is
exactly as sensitive as your project.* Not "LODESTAR contains no secrets" — that would be
overclaiming, and the whole company rests on not doing that.

**Known gap, accepted:** `ensureGitignore` returns early when the project is not a git
repo, so `lodestar init` run *before* `git init` never adds the rule. Small, and the
alternative — writing a `.gitignore` into a non-repo — is worse.

---

## D-038 — Fidelity beats coverage: no `.cmd` in front of a native binary ✅

A `.cmd` shim is a batch file, so reaching it routes arguments through cmd.exe. For a
target that is *already* a batch file (`npm.cmd`), the caller's baseline goes through
cmd.exe anyway — we add nothing. For a **native** target (`node.exe`, `git.exe`),
PowerShell's baseline is a direct `CreateProcess` with **no cmd.exe at all**, and we were
inserting one. Measured:

```
$env:MYSECRET = "leaked-value"
  without lodestar: ["%MYSECRET%"]      ← what the agent typed
  with lodestar:    ["leaked-value"]    ← what actually ran
  without: ["a^b"]     with: ["ab"]
```

Three failures in one, none disclosed by the record:

1. **It changed what executed.** The wedge's first rule is that it must not.
2. **It recorded the post-expansion form as the agent's argument** — the ledger
   attributing to the agent something it never typed.
3. **It laundered secrets past D-028.** cmd.exe expanded `%MYSECRET%` *before any LODESTAR
   code ran*, so `redactCommand` saw a plain string, and the **value** landed permanently
   in an append-only ledger. Secret-named env vars are exactly what D-028 targets; this
   was the one path around it.

`BATCH_UNSAFE_ARG` (D-029) could not catch it: expansion happened upstream so no `%NAME%`
survived to match, **and** the guard only runs for `isBatchTarget(real)`, which a `.exe`
is not. D-029 guarded the wrong layer.

Same root cause imposed cmd.exe's 8191-char limit where the native baseline allows
32767 — breaking long commands, recording **nothing**, and returning exit 1,
indistinguishable from a genuine assertion failure.

**Decision.** Install a `.cmd` only on Windows, only where the command already resolves to
a batch file. Elsewhere the command resolves past us untouched and the probe reports it
`shadowed`.

> **Fidelity beats coverage. If observing a command requires changing how it executes, do
> not observe it — and disclose the hole.**

Coverage bought by rewriting the agent's command is not coverage; it is fabrication. A
declared hole is worth more. Git Bash picks the extensionless POSIX shim and was clean
throughout — verified against `%MYSECRET%`, `a^b`, and `x"&echo PWNED&"y`.

**Accepted cost:** PowerShell/cmd.exe users lose exit-code observation for native
binaries. That loss is measured and printed, which is the whole point.

---

## D-039 — LODESTAR must not blame the agent for its own refusals ✅

Every refusal path — depth guard (D-031), unknown shim dir, `%VAR%` (D-029) — returned
126 and recorded **nothing**. The damage is not the missing event; it is who gets blamed.

The refusing shim exits 126 → its **parent** (`npm run check`) inherits it and exits
non-zero → the parent's shim records that honestly as `groundTruth` → RF-01 reports
`npm run check exited with code 2`. Computable, reproducible, neutrally stated,
evidence-linked — **all four Reality Facts rules satisfied, and a false accusation.**

**The rules assume LODESTAR is not a participant. The shim makes it one.** So
`PRODUCT-SPEC.md` §4 gains a fifth rule:

> **5. A fact must not report a failure LODESTAR caused.**

**Decision.** Each refusal records a `lodestarInterference` event, surfaced in the
session's limitations block. D-031 fixed this bug's *trigger* (depth 3→12) and left the
*mechanism*; this fixes the mechanism.

**Deliberately NOT suppression — see D-041.**

---

## D-040 — `absent` was two states, and the probe was inflating coverage ✅

`ShimStatus` had three values and `absent` meant both *"not installed on this machine"*
and *"the probe failed, we have no idea"*. Two opposite claims behind one word.

**Failure 1 — the probe reported `absent` for everything, silently.**
`detectProbeShell` liveness-checked with `-c 'exit 0'`. **`powershell.exe` and `cmd.exe`
both accept that and return 0.** Both were accepted as POSIX shells; the real `-l -c <sh
script>` probe then failed into a catch that returned `absent` for every command — a
confident claim that nothing was installed, from a shell that never ran a line of our
script. And `printProbe` rendered only `observed`/`shadowed`, so the CLI printed **no
coverage line at all** while the ledger filled with real events.

**Failure 2 — `absent` was structurally unreachable, so coverage inflated.**
`command -v` always finds our own shim, so the `absent` branch could never fire. Measured
against a clean PATH:

```
actually installed:  git npm npx node python python3          (5)
probeCoverage said:  ...pnpm yarn pytest docker make cargo go (12 "observed")
```

**LODESTAR claimed to observe `docker`, `cargo`, and `go` on a machine where none were
installed** — and printed that claim to the developer. The mechanism built to make
coverage honest (D-023) was inflating it. The `shims.ts` header comment "Measured on this
machine: npm, node, python, **docker** HIT" was an artifact of this bug, not a
measurement; it is deleted rather than corrected.

**Decision.**

- Four states: `observed` / `shadowed` / `absent` (**measured**) / `unknown` (**we
  failed**), with a `reason` on `unknown`.
- Resolve each command **twice** — once as the agent's shell sees it, once with the shim
  dir stripped from PATH — so `absent` means measured-absent. BARE is built inside the
  shell, because the login shell rewrites PATH and that is the entire reason D-023 exists.
- `detectProbeShell` probes with the **exact** invocation it will use (`-l -c`) and checks
  for **output**, not the absence of failure. An exit code of 0 is not proof a POSIX shell
  ran.
- Every state is printed, `unknown` most loudly.

**The generalizable lessons**, both of which this codebase had already learned and
re-broke: test the thing you will actually do (`-c` is not `-l -c`), and check for
evidence of success rather than the absence of failure.

---

## D-041 — Agent-controlled values may annotate, never suppress ✅

D-034 used `parentExecId` to *delete* RF-01 facts, and called the relationship "observed
by the only party that witnessed it". **The witness is `LODESTAR_EXEC_ID` — an environment
variable the agent writes.** The audit demonstrated suppression with **zero forgery in the
ledger**: run a throwaway failing command, read its `execId` (the shim publishes it into
every child), set `LODESTAR_EXEC_ID=<decoy>`, then run `npm test` for real. Every event is
genuine, the chain is intact, and the failure disappears.

D-034's adversarial tests caught self-parent and cycles. They never tested a **well-formed
forged chain**, which is the easy one to build.

**Decision.** No fact may be suppressed on the basis of an agent-controlled value.

- Ancestry may **nest** or **annotate** facts in presentation. It must never remove one.
- D-039's interference is **reported alongside** facts, not subtracted from them —
  otherwise an agent could trigger a refusal on purpose (any `%VAR%` argument) and forge
  `parentExecId` to make a real failure vanish.

> **Over-reporting is a nuisance. Silently dropping a real failure is a lie.**

The D-025 duplicate-fact problem was always a *presentation* problem, and D-034 solved it
in the fact engine by discarding evidence. Nesting solves it without giving an
agent-controlled value the power to hide anything.

---

## D-042 — Two redaction gaps the floor could not cover ✅

**`argv` needed the structural pass.** `emit()` applies `redactDeep`, which runs
`redactText` per string. In `["--password", "s3cr3t"]` the secret matches no vendor shape
and is indistinguishable from an ordinary argument — only its **position** gives it away,
and only `redactArgs` reads position. Measured:

```
redactDeep(["--password","s3cr3t-db-pw"])  →  ["--password","s3cr3t-db-pw"]   LEAKS
redactArgs(["--password","s3cr3t-db-pw"])  →  ["--password","[REDACTED]"]
```

`redact.ts` explains exactly why structure beats text for argv, and session-start was the
one argv in the codebase that did not get it — landing in the append-only ledger, where it
can never be removed. **The floor is a floor, not a substitute.**

**The `sessions` table bypasses the floor entirely.** `createSession` is raw SQL called
*before* `RecordingContext` exists, so `mission` and `cwd` were stored unredacted while
the chained `mission.stated` copy was redacted — two copies of one string, one scrubbed,
one not. Mitigating: that table is mutable (no triggers), so it is remediable.

**Sensitive-path holes.** `terraform.tfstate` (stores provider secrets in plaintext *by
design*), `credentials.json` (Google OAuth's literal default filename), `kubeconfig`,
`.pypirc`, `.dockercfg`, `.docker/config.json`, `.envrc`, `.tfvars` — all returned `false`
and were snapshotted verbatim.

**The lesson generalizes past this fix:** D-035 argued that a choke point makes an
invariant structural. It does — but only for the paths that go through it, and only for
the *kind* of check it performs. A text pass at the choke point cannot do a structural
job, and a choke point installed after the first write cannot cover it.

---

## D-043 — `cwd` and `resolvedPath`: observed, then thrown away ✅

**`cwd`.** RF-01 grouped on `command.trim()` alone. In a monorepo an agent runs `npm test`
in `packages/api` (exit 1), then `packages/web` (exit 0) — one group, last run wins, and
**the api failure was silently deleted.** Two directories are two histories.

The galling part: `ProcessSpawnPayload` carried `cwd` all along. It was observed at spawn
and dropped before exit, and RF-01 reads exits. **We could see it; the schema discarded
it.**

**`resolvedPath`.** `findReal()` resolves the actual binary and `execute(real, args)` runs
it — and `real` was never recorded. The ledger said `npm`; it never said *what `npm`
actually was*. Those differ exactly when it matters: a shadowing `npm` earlier on PATH is
invisible in the name and obvious in the path. **Recording the name and not the resolved
target is the mistake this product exists to avoid** — it is the same error as trusting
`target.raw` over `target.resolved`, which `events.ts` calls "the entire value of the
product."

Both now on spawn and exit.

---

## D-044 — RF-04's "after" was inferred from append order, and was a live false positive ✅

RF-04 sliced `events.slice(lastTestIdx + 1)` — everything appended after the test event.
**`seq` orders observations, not occurrences**, and the fs recorder observes late *by
design*: `awaitWriteFinish` waits 120 ms for writes to settle, then hashes the file before
emitting, while process events emit immediately.

So fs events are systematically back-dated in `seq`, and the most ordinary sequence an
agent performs — **edit a file, then run the tests** — recorded as:

```
seq=3  process.exit  node -e ...     ← recorded first
seq=4  file.write    auth.ts         ← HAPPENED first, recorded 83ms later
```

RF-04 then announced *"auth.ts modified after the last test run."* False, on the most
common thing an agent does, **with no adversary present**. The function's own comment said
ordering "comes from `seq`, never from wall clocks" — technically true and substantively
wrong, because `seq` was never the clock that mattered.

Two tells it was known-but-unnamed: every timing test was padded with `settle(400)`, and
**no test fired RF-04 from a real recorded session** — the passing ones hand-appended
synthetic events in the desired order, assuming away the broken thing.

**Decision.** Record `mtimeMs` (free — `statSync` is already called) and compare it against
the test's exit time. Both come from the same wall clock on the same machine, so the
comparison is a **measurement**, not an inference.

**The tradeoff, stated honestly.** The old test defended a real concern: a clock resyncing
mid-session could sort `mtime` before the test even though the write came after. That
trade is deliberate — `seq` is *systematically* wrong on every edit-then-test, while
`mtime` is wrong only on a rare backward clock jump, **and it fails toward a miss rather
than a false accusation.** For a product whose stated bar is "false-positive target:
zero", a rare miss beats a routine accusation.

**A write with no `mtimeMs` never fires RF-04.** Unknown stays unknown; a fact built on a
missing field is precisely the guess the rule forbids.

`PRODUCT-SPEC.md:155` called RF-04 "the sleeper… fully deterministic." It *was*
deterministic. It was not correct, and the two got conflated.

---

## D-045 — New evidence may qualify old evidence. It may never delete it ✅

RF-01's rule was "take the last run; if it passed, report nothing." **That cancellation
was the C2 vulnerability**, not the forgery itself: last-write-wins means the attacker
writes last, so one appended `npm test exit 0` erased a real failure while `verify()` still
reported `intact`.

**Decision.** A failure that was later fixed is reported as exactly that:
`npm test exited with code 1, then passed on a later run`.

This inverts the attack. A forged pass no longer removes anything — it appends a line that
**contradicts a visible failure**, which is a louder signal than the failure alone. The
attack becomes evidence of itself.

It also keeps D-025 honest: fix-then-pass does not cry wolf, because the statement says it
was resolved rather than raising an unqualified alarm. **The original rule conflated "do
not cry wolf" with "delete the evidence"** — and only the first was ever required.

> **The invariant: new evidence adds context; it never removes an observation.**

The same reasoning killed ancestry-based suppression (D-041). Both are the same mistake:
letting later, weaker, or attacker-influenced input subtract from what was observed.

---

## D-046 — "Verified" is not a claim V0 can make ✅

The shipped description said *"an independent execution record"*, and the roadmap language
was drifting toward *"verified AI execution history."*

**"Verified" claims the record is provable against the party it audits.** It is not:
LODESTAR runs as the same OS user as the agent (the Same-UID Ceiling, `THREAT-MODEL.md`
§1), so a motivated agent can forge it, and closing that needs privilege separation — V1.

**Decision.** The V0 claim is **"a tamper-evident execution history for AI coding agent
sessions."** Every word is carried by the code: *tamper-evident* (in-place edits are
detected; truncation is not — that is stated), *execution history* (captured at the
boundary, not from the agent's self-report), *sessions* (scoped, not continuous
monitoring).

Also corrected: `ARCHITECTURE.md:376` listed "signed checkpoints" as a shipped
tamper-evidence property. **No signing code exists.** The audit found that before a
customer did.

**Why this matters more than any feature here.** The vision doc names positioning drift as
the self-inflicted risk, and a trust company's only asset is credibility. A claim the code
cannot carry is not marketing — it is the one failure you do not recover from. The smaller
claim is true, and true is the entire product.

---

## D-047 — RF-02's evidence was missing in exactly the case it exists to detect ✅

*Recorded retroactively: the code has cited D-047 since the fix landed, and this file never
had the entry. See D-052 on why that is its own bug.*

`dirtyAtEnd` rode on the `git.ref_update` event, which is emitted only inside
`if (delta.headMoved)`. RF-02 is *"the session ended with an uncommitted working tree"* —
i.e. **the agent changed files and did not commit them**, so HEAD did not move, so no event
was emitted, and the evidence was absent precisely when the fact was true.

**Decision.** A new `git.status` event, emitted **unconditionally** for a repo at session
end, carrying `dirtyAtEnd`, branch, head, ahead/behind.

Three states, held apart as everywhere else:

| Record | Meaning |
|--------|---------|
| `git.status` with `dirtyAtEnd: [...]` | measured dirty |
| `git.status` with `dirtyAtEnd: []` | **measured clean** |
| no `git.status` event | git unreadable, or not a repo — **unknown** |

RF-02 returns no fact for the third case. "We never read git" must never render as "your
tree was clean". Pinned by *"claims nothing when git was never read — unknown is not
clean"* in `rf-catalog.test.ts`.

**The general lesson, which is bigger than RF-02:** state is not an action, and a state
fact cannot ride on an action event. The event only fires when something happened; the
fact is about what *is*. Anywhere those two are conflated, the evidence goes missing in
the exact case the fact was written for.

---

## D-048 — A missed matcher must be declared, never silent ✅

*Recorded retroactively. See D-052.*

The test-command matcher was unanchored — `\b(npm|...)\s+test\b` — so `echo npm test` and
`cat npm test.log` matched, while `make test`, `tox`, `gradle test`, `mvn test`, and
`dotnet test` did not. A Python shop on `tox` got **zero RF-03/RF-04 coverage and was never
told.**

**Decision, in two parts. The second matters more.**

1. **Anchored at the start**, and broadened to the runners people actually use. A test
   runner must *be* the command, not appear inside one.
2. **A miss is declared.** `limitations()` reports when no test command was recognised, so
   "no fact" stops being ambiguous between *"the tests were fine"* and *"we never saw a
   test"*.

Part 2 is the decision. Part 1 is a bug fix. A matcher will always miss something —
someone's runner is a shell alias, a Makefile target, a bespoke script — and the product is
survivable only if a miss surfaces as a stated limitation instead of a clean report.

**This is the same failure as D-022 and D-040 for the third time:** silence rendering as
all-clear. That it recurred three times in different subsystems is why the rule is now
enforced by tests in each of them rather than trusted to reviewers.

---

## D-049 — The report model computes; every renderer only renders ✅

**The audit finding that prompted this:** the fact engine had **no user-facing consumer**.
`evaluate()` ran inside `Recorder.stop()` and its result was dropped on the floor;
`limitations()` was called by nothing at all; `lodestar report` printed *"not implemented
yet"*. Every Reality Fact in the product — "the feature that makes people install",
PRODUCT-SPEC §4 — reached a human through no code path in the repository.

**Decision.** One model, `SessionReport` (`src/facts/report.ts`), built from the **ledger
alone**, containing every judgment: facts, resolved evidence, limitations, interference,
integrity status, coverage, timeline, counts. Renderers do layout and nothing else.

Three renderers are coming — terminal, dashboard, static HTML export (D-014). If each one
reads the store and decides for itself what "degraded" means, LODESTAR ships three subtly
different answers to the only question it exists to answer, and the one the user believes
is whichever they happened to open. **A trust product cannot disagree with itself.**

**Built from the ledger, not from `SessionSummary`.** The recorder's summary lives only in
the memory of the process that recorded the session, so it can assert things no later
reader can check. The report must only say what a developer can re-derive from the bytes
next week — the same bytes the chain protects.

**Terminal first, browser second.** USER-FLOW §6 specifies a local server and an
auto-opened browser, and that is still the plan and still that file's job. It is not what
shipped first: building a dashboard on top of an unwired engine is the most expensive
possible way to discover it was unwired. PRODUCT-SPEC §5 promises a terminal summary
anyway. The dashboard becomes the second consumer of `SessionReport`, not the first thing
that ever read it.

**Three states, and `VERIFIED` must be earned:**

| Status | Means |
|--------|-------|
| `VERIFIED` | Evidence consistent. The chain recomputes **and** no known gaps. |
| `DEGRADED` | Some evidence unavailable — shadowed shim, unprobed coverage, recorder error, unclosed session, withheld content. The facts present are still true; the record is not complete. |
| `BROKEN` | Integrity failure. The chain does not recompute. |

Every gap demotes. A session with *no* evidence at all is `DEGRADED`, never `VERIFIED` —
"we saw nothing" and "we saw everything and it was fine" must not render alike. The
asymmetry is deliberate: a false `DEGRADED` costs thirty seconds, a false `VERIFIED` costs
the user the bug they installed LODESTAR to catch.

`absent` (a command is not installed) does **not** demote: that is a measurement, not a
hole. Demoting on it would make `VERIFIED` unreachable on any machine missing one of
twenty-one shimmed tools — i.e. every machine — and a status that is always yellow is a
status nobody reads.

---

## D-050 — The matcher and the shim list are one invariant, enforced by a test ✅

D-048 stated the two lists were "reconciled" and left a comment saying so. **They were
not.** The matcher recognised `bun`, `nox`, and `ctest`; none were in `SHIMMED_COMMANDS`.
Those branches could never fire — the exact dead code D-048 was written to delete — and the
comment asserting otherwise had become the drift it warned about.

**Decision.** The invariant is now data and a test, not prose:

- Each matcher declares the binaries it needs (`TEST_MATCHERS[].runners`), exported as
  `TEST_RUNNERS`.
- `matcher.test.ts` asserts **`TEST_RUNNERS ⊆ SHIMMED_COMMANDS`**, and separately asserts
  the list has not been emptied to make that pass.

`bun`, `nox`, and `ctest` were **added to the shims** rather than removed from the matcher:
they are real runners, the probe reports `absent` honestly where they are not installed,
and a shim costs nothing until the command exists.

**The rule: if the matcher names it, the boundary must be able to see it.** A matcher that
recognises what the recorder cannot observe lies twice — it claims coverage it lacks, and
it renders the miss as silence.

**Known gap, stated rather than papered over:** `python[0-9.]*` matches `python3.11 -m
pytest`, but only `python` and `python3` are shimmed, so a versioned interpreter runs
unobserved. Shimming every possible `pythonX.Y` is guesswork; the probe reports the gap.

---

## D-051 — RF-08, RF-09 and RF-10 are catalogued and not implemented ✅

PRODUCT-SPEC §4 approves ten Reality Facts. The engine implements seven, and the
`RealityFact['id']` union stops at RF-07 — so the spec and the code disagreed about what V0
means, with nothing recording which one was right.

**Decision.** Seven ship in V0. RF-08 (network egress), RF-09 (destructive git), RF-10
(binary/oversized) are deferred, and PRODUCT-SPEC now says so in the catalog itself rather
than listing them as though they exist.

**Why these three and not the others.** Each needs *capture work*, not fact work — which
makes them a different size of job than they look:

- **RF-08** needs the network boundary. The `net.request` event kind exists; nothing emits
  it. Observing egress honestly means a proxy or eBPF, and a matcher over command strings
  would be inference wearing a fact's clothes.
- **RF-09** needs git *operations*, not git *state*. The recorder reads state before and
  after; it does not observe the reflog, so `--force-with-lease` and a hard reset are not
  distinguishable after the fact.
- **RF-10** is closest — `contentWithheld: 'oversized'` is already recorded, and the
  report already discloses it as a limitation. It is deferred only because "we could not
  diff this" is already stated there, so a fact would repeat it.

The union type is the enforcement: a contributor cannot emit `RF-08` without changing the
type, which sends them here first.

---

## D-052 — A decision cited by code must exist in this file ✅

The code cited **D-047 and D-048 for weeks and neither entry existed here.** Both were real
decisions, correctly implemented, with the reasoning written only in a source comment.

That is a quiet, compounding failure. `CLAUDE.md` instructs every contributor to read this
file *"before re-opening a settled question"* — so a settled question with no entry gets
re-litigated by the next person, and the code comment that holds the reasoning is exactly
what they would change. It is also how D-048's "reconciled" claim rotted (D-050): a comment
is not load-bearing, and nothing checks it.

**Decision.** A decision cited in code must exist here before that code lands. When one is
found missing, it is written retroactively and marked as such, rather than renumbered —
the number in the code is a reference a reader will follow.

Where an invariant can be tested instead of narrated, **test it**. This file records *why*;
the test enforces *what*. D-050 is the model: the prose explains the reasoning, and
`matcher.test.ts` is what actually holds the line.

---

## D-053 — A payload type is a claim about the compiler, not about the bytes ✅

Found by the final V0 adversarial audit. Six defects, one root cause.

`payload` is typed `unknown` in the schema and cast at each use site (`e.payload as
ProcessExitPayload`). But payloads **round-trip through JSON in SQLite**, so the cast
asserts a shape nothing has checked. RF-04 had the check (`typeof mtime !== 'number'`) and
RF-06 had it (`p.signal` must be present). RF-01 and RF-02 — **the two facts a user reads
first** — did not. The discipline had been applied wherever someone happened to think of
it, which is not a discipline.

**Measured on a real store, before the fix:**

| Payload | Rendered |
|---|---|
| `{ command: 'npm test', durationMs: 1 }` | `npm test exited with code undefined` |
| `{ command: 'npm test', exitCode: '0' }` | `npm test exited with code 0` — **as a divergence** |
| `{ dirtyAtEnd: 'src/auth.ts' }` | `11 files were left uncommitted` — the count is `String.length` |
| `{ branch: 'main' }` (no `dirtyAtEnd`) | nothing — **identical to a measured-clean tree** |
| `{ exitCode: 1 }` (no `command`) | **threw**, destroying the entire report |
| `npm test`, `exitCode: null`, no signal | **zero facts, zero limitations** — a silent, clean-looking session |

The second row is the one to sit with: a **successful** command reported as a divergence.
The last row is the worst: RF-01 skipped it (not a number), RF-06 skipped it (no signal),
RF-03 treated it as "a test ran", and `limitations()` said nothing. **Total silence** — and
reachable with no forgery at all, by starting a test and killing it. A fact engine that an
agent can silence by taking an ordinary action is not a fact engine.

**Decisions.**

1. **`exitPayload()` validates before returning.** Null payload or non-string `command` →
   `null`, meaning *not evidence*. Every caller handles it; none casts.
2. **A three-state `verdictOf()`** — `pass` | `fail` | `none`. A numeric exit code is the
   OS's verdict; `null`, missing, or a string is **no verdict**. Collapsing `none` into
   either direction is what produced rows 1, 2, and 6.
3. **`isCompletedTestRun()` for RF-03/RF-04.** `isTestCommand()` matches a *string*; it
   says nothing about whether the run finished. This is the `WATCH_MODE` argument —
   *"a watcher never terminates with a verdict, so it is not a completed test run"* —
   applied to the case that reaches the same end by being killed.
4. **RF-02 requires `Array.isArray`**, and a `git.status` whose field is unusable is
   *unknown*, not clean. The three states were held apart for a missing EVENT and quietly
   merged for a missing FIELD.
5. **Unreadable events are declared, not dropped.** A payload we cannot parse is a hole in
   the record; `limitations()` states it. Skipping it silently would be asserting absence
   from a fact we do not have.
6. **The report status reads `groundTruth` at the query.** `buildReport` filtered tiers for
   facts (D-009) but not for the code deciding VERIFIED vs DEGRADED — which reads the
   coverage probe and whether the session closed, and is exactly as trust-bearing. A
   narration `agent.output` carrying a forged probe would have turned DEGRADED into
   VERIFIED from a value the agent supplied. Not reachable today; the `stdio` EventSource
   exists precisely so it will be.
7. **`factsVerdict` on the model, not an `if` in the renderer.** The terminal printed a
   green *"✓ No divergences observed"* whenever `facts` was empty — **including on a BROKEN
   record**, which is the successful-forgery case: rewrite `exit 1` to `exit 0`, the fact
   vanishes, and the user's first impression is a tick. `facts.length === 0` means two
   opposite things and only the model knows which, so the model now says
   (`divergences-observed` | `none-observed` | `record-untrustworthy`). Per D-049, meaning
   lives in the model — and the dashboard cannot be reviewed for this mistake yet, because
   it does not exist.

**The general rule, and the reason this is a decision rather than six bug fixes:**

> **Anything that carries trust validates at the boundary and reads `groundTruth` at the
> query.** A TypeScript type is a promise the compiler makes to us about our own code. It
> is not a measurement of bytes that came out of a database, off a disk, or through an
> agent.

Every case above is pinned by a test quoting its measured output, and the fixes were
mutation-tested: 13 of 15 mutations caught, the other 2 confirmed semantically equivalent.

---

## D-054 — The dashboard is a renderer. It has no logic of its own ✅

The browser dashboard, the static export, and the terminal are now three renderers over one
`SessionReport`. D-049 set the rule; this is what it cost to keep it while building a real
UI, because **HTML is where that rule dies**. A `class="ok"` here, an
`if (!facts.length) green` there, and within a month the browser and the terminal disagree
about whether a session was fine — and the user believes whichever one they opened.

**Decision: every judgment word on the page is a string from the model.** VERIFIED,
DEGRADED, BROKEN, "No divergences observed", every limitation, every reason a diff is
missing. The renderer chooses layout, colour, and order. The client-side JavaScript shows
and hides panes; that is the entire program.

Three consequences worth stating, because each was a real bug caught by mutation testing:

1. **Six reasons a diff can be missing, not one.** `available`, `withheld` (D-033),
   `oversized`, `binary`, `never-captured`, `blob-missing`. A renderer asking "do I have
   bytes?" gets a yes/no and renders every no as an empty pane — telling the user the one
   thing false in all six cases: that there was nothing to see. `blob-missing` matters
   most: blobs are deliberately not hash-chained so they CAN be deleted (D-037, the
   remediation path), so a purged blob is an ordinary state that must never read as "this
   file did not change".
2. **The session index is built by running `buildReport` per session**, not by a cheaper
   query. Hardcoding the row status to VERIFIED passed the entire suite before the test
   that now pins it. A list saying VERIFIED beside a report saying BROKEN is the
   two-answers failure, and the cheap version of the index is exactly how you get there.
3. **`mode: 'server' | 'export'` may change links and nothing else.** Asserted by a test
   that renders both and compares judgments.

**Escaping is the one piece of real logic in the renderer, and it is security, not
meaning.** Reality Facts contain filenames and command strings the *agent* chose;
`<img src=x onerror=alert(1)>.ts` is a legal filename, and the stress suite already proves
LODESTAR records hostile filenames byte-identically — so it hands them straight to the
renderer. The export is *designed to be shared* (D-014). An unescaped report is therefore
stored XSS, delivered by a trust tool, to a teammate who opened the file **because** they
trusted it. Everything is escaped at the boundary, always — and the hostile string still
renders, visibly, as text: deleting it would be LODESTAR editing reality to look tidy.

**The diff is LCS, not positional.** The first version zipped lines by index and rendered a
one-line insertion as a whole-file rewrite. No judgment was wrong; it was still
unshippable. This product's entire claim is accuracy about what happened — a diff that
exaggerates teaches the developer to discount everything else on the page.

---

## D-055 — `lodestar report` chooses its renderer by asking who is watching ✅

USER-FLOW §6 says this command opens a browser. PRODUCT-SPEC §5 says it prints a terminal
summary. Both are right, for different callers — and the caller already tells us which it
is: **`process.stdout.isTTY`**.

| Caller | Gets | Why |
|---|---|---|
| A human at a terminal | The dashboard | "Nobody wants to read terminal output every day." |
| A pipe, a script, CI | The terminal report + exit code | A program cannot read a browser, and `BROKEN` must be learnable without parsing prose (exit 2). |

`--terminal` and `--open` override; `--html [path]` exports the self-contained file.

**Why not a sixth command.** `CLAUDE.md` caps the CLI at five and requires a decision to
add one. A `lodestar dashboard` command would also have made the browser — the actual magic
moment — the thing you need to know a *second* command to find. The default should be the
best experience, not the safest one.

**The server, and what it is not.** `node:http`, bound to **127.0.0.1**, alive exactly as
long as the command you typed. Not a daemon, not a service, not an API — all three are on
the V0 do-not-build list, and `report/server.ts` must never become where they arrive. If
you are adding an endpoint that returns JSON for a client to interpret: that is a second
renderer with its own opinions, and D-049 is about you.

**Loopback is a security decision, not a default.** The report contains the developer's
source diffs, command lines, file paths, and mission text *by construction* — that is the
product. `0.0.0.0` publishes all of it to every machine on the coffee-shop wifi, and "the
report server was only meant for localhost" is not a sentence a trust company survives
saying. Pinned by a test that asserts the bound address.

The page is rendered per request from the ledger, and the database handle is opened and
closed per request rather than held: the recorder is a separate process appending to the
same file, and a report server that contends for its lock would be LODESTAR interfering
with the execution it exists to observe.

---

## D-056 — A fact leads with what happened, not with `RF-04` ✅

`RF-04` is a catalog id. It is precise, it is what the tests and the docs key on, and it
means nothing to the person reading the report. Leading with it asks the reader to learn
our internal numbering before they can learn what happened to their code.

**Decision.** Each fact carries a **title** (`Code changed after testing`) and an ordered
**chain** of steps. The id moves into an `Evidence & details` disclosure, where the people
who want it still find it. Nothing is removed; the headline changes.

The chain is the part that earns the change:

```
✓ npm test exited with code 0        10:51:13 pm
✓ wrote src/payments.mjs             10:51:14 pm
⚠ No test run was observed after this change.
```

A developer reads that in two seconds. The sentence it replaces —
*"payments.mjs modified after the last test run"* — is equally true and takes ten, because
the reader has to reconstruct the order themselves. **People process timelines faster than
prose**, and the order *is* the fact.

**Both live in the model, not the renderer** (D-049/D-054). A title invented in the HTML
would be a judgment the terminal never made, and the two surfaces would describe the same
session differently.

### The title we refused, and why it is a test

The better headline is **"Untested change"**. It is shorter, it is punchier, and **it is a
claim we cannot carry.** We know no test ran after the change *that the boundary could
observe* — and on the very machine this demo was recorded, `git` is shadowed on PATH and
the report says so. "Untested" is a conclusion about coverage; **"Code changed after
testing"** is the measurement.

Same for the closing step. Not *"This code was never tested"* — a fact about the world we
do not have — but *"No test run was observed after this change"*, a fact about our record,
which is all we ever have.

The rule that bans claim-parsing bans the better headline. A title is user-visible text,
and every user-visible statement must be derived from measured evidence. `report.test.ts`
pins it, because this is copy, and copy gets rewritten by whoever is in a hurry.

### The positioning this exposed

Chasing the headline surfaced something bigger. The original pitch was heard as
**"don't trust AI"** — an argument LODESTAR loses, because in the demo the agent is not
lying. What the product actually says is:

> **Don't trust stale evidence.**

That is a smaller claim, a truer one, and one nobody can argue with — **humans do this
too**: run the tests, make one last tiny edit, commit, assume it is fine. LODESTAR catches
the workflow, not the species. It does not need the agent to be dishonest to be useful,
which means it does not need the reader to be cynical to be convinced.

This does not change the architecture — D-002 decoupled positioning from it precisely so a
better story costs a landing page and not a rebuild. It changes the words on `site/`.

---

## D-057 — RF-04 discloses the clock it trusts ✅

Found in the enterprise-hardening audit, playing the angry customer trying to prove
LODESTAR gave false confidence. Two defects, one theme: the trust root of RF-04 was
undocumented, and its documentation was actively wrong.

**The self-refuting comment.** `rf04`'s header said *"Ordering comes from `seq`, never from
wall clocks."* That was true of the original implementation and false of the shipped one —
D-044 replaced it with `mtimeMs > testExit.ts`, a wall-clock comparison. A function whose
header contradicts its own trust-critical line is how a reviewer reasons wrongly with full
confidence. The header now describes the code that runs.

**The undisclosed domain.** "After" rests on filesystem `mtime`, which assumes:

1. the wall clock did not move **backward** mid-session (an NTP resync breaks RF-04 with no
   adversary — `mtimeMs` is real time, `testEvent.ts` is the reading captured at exit, and a
   backward jump between them inverts the comparison);
2. mtime is **fine-grained** (coarse on some network/FAT mounts, so a write a fraction of a
   second *before* the test can round to *after*);
3. nobody called `touch` — T3, out of scope, but the honest framing is that mtime is
   forgeable by the party RF-04 observes.

**Decision.** RF-04 stays exactly as accurate as it was; the change is honesty, not logic.
`limitations()` now states this domain **only when RF-04 fires** — a caveat is a qualifier
on a conclusion, and listing caveats for facts you never stated erodes trust as surely as
hiding them. Both directions are mutation-tested.

**Why this is the whole discipline in miniature.** The product's one job is to never
hallucinate confidence. A measurement reported without its domain is confidence
hallucinated politely: technically true, and read as more than it is. "RF-04 is accurate if
the clock behaved and the filesystem is fine-grained" is a smaller claim than "auth.ts was
modified after the last test run" — and the smaller claim is the true one.

### What this audit deliberately did NOT build

The audit was asked for a **"Safe to merge" verdict** and an enterprise control plane
(permissions, multi-user, compliance, integrations). Both were declined, on the vision.

- **"Safe to merge" is hallucinated confidence by construction.** LODESTAR observes what
  happened; it cannot know a team's merge criteria, which untested refactors are fine, or
  the reviewer's risk tolerance. "Safe" is an interpretation asserted as fact — the one
  thing the Reality Facts Rule forbids. An honest verdict summarises the evidence ("No
  divergences observed" / "Divergences found — review" / "Evidence incomplete" / "Record
  integrity broken") and never the decision. See D-005, D-046.
- **Permissions / accounts / cloud audit trails** are the V0 Do-Not-Build list, and D-046
  explains why any auth added now would *pretend* to solve same-user trust. The enterprise
  answer is privilege separation — architecture for V1, not a feature bolted onto V0. A
  control plane over a record an agent can still forge is theatre.

Recording the declines here so the next contributor does not read the prompt as a mandate.

---

## D-058 — The report is laid out for a staff engineer mid-incident ✅

An information-architecture pass, not a feature pass. The question: could a principal
engineer from Stripe/OpenAI/Datadog understand this report in under ten seconds, and trace
every conclusion to evidence? The rejection document (`docs/WHY-NOT-DEPLOY.md`) found five
valid IA failures; this fixes them. None changes what the model concludes — only how the
answer is structured and where the uncertainty sits.

**1. The verdict now dominates, in two axes.** The old top of the page was `Session #001`
(an id nobody needs mid-incident) and a row of seven metadata chips, with the real status a
small pill in the corner. The new top is a `Verdict` block computed by the model:

- `finding` — what diverged: *"2 divergences observed"* / *"No divergences observed"* /
  *"Record integrity broken"*.
- `coverage` — how complete the evidence is: *"Evidence complete"* / *"Evidence
  incomplete · 1 gap"*.

Two axes, because one word hid the thing that mattered. "DEGRADED" could mean "found
nothing but couldn't see everything" or "found problems AND couldn't see everything" —
different next moves. Split, the reader gets both at a glance. And it never crosses into a
recommendation: there is no "safe to merge", because the model refuses to compute one
(D-057). `finding` reports observation, `coverage` reports completeness, the decision is
the human's.

**2. Observed facts and inference are now visually unmistakable.** The principle: *facts
and interpretations must never appear in the same visual style.* Each divergence card
splits into an **Observed facts** group (neutral, monospace, a green tick or red cross) and
a **LODESTAR's reading** group (amber, bordered, labelled as ours). The labels carry the
distinction in words, not only colour — a screenshot, or a colour-blind reviewer, must
still be able to tell the measurement from the conclusion.

**3. Assumptions moved onto the fact they qualify.** D-057 disclosed RF-04's mtime trust
root in the session-level `limitations()` list. That was correct and badly placed: a caveat
three sections away from its conclusion reads as unrelated boilerplate. `FactView.assumptions`
now carries it, revealed under each card's **"Why LODESTAR believes this"** alongside
confidence, evidence, and the catalog id. `limitations()` keeps only genuinely
session-level gaps. Never hidden, now co-located.

**4. Blast radius before the timeline.** For an incident responder, *which files changed*
ranks second only to the verdict; the old default tab was a 100-row timeline — a wall of
events, not an answer. **Files affected** is now the default tab; the timeline is one click
away, not in the way.

**5. Metadata receded.** Runtime, model, machine id, git HEAD, and counts moved into the
Verification pane as a key/value grid — present for the investigator who needs identity,
absent from the path of the one who needs the answer.

**One deliberate deviation from the requested structure.** The spec numbered "Timeline" as
section 2, right after the verdict. Placing a 100-row timeline between the verdict and the
divergences would bury the divergences below the fold — violating the overriding principle
that the important thing dominates. Divergences (the substance of the verdict) come second;
the timeline is a reference tab. The numbered list is a checklist of what must be present,
and everything in it is; the vertical order follows "important dominates."

**What was refused, again.** The same prompt asked for a "Safe to merge" verdict and an
enterprise control plane. Both declined for the reasons in D-057: a merge verdict is
hallucinated confidence, and a control plane over a same-user-forgeable record is theatre.
This pass improved how honestly the evidence is presented; it did not add a claim the
evidence cannot carry.

---

## D-059 — The Evidence Record is the canonical artifact; everything renders from it ✅

**Context.** The Second-Generation Blueprint's load-bearing correction is that the
company is built on *Evidence*, not *Record* — and its first infrastructure primitive is
the **Evidence Record**: "a structured, tamper-evident bundle of Observations about one
unit of autonomous work… portable across tools and vendors by design." An architecture
review against that blueprint found V0 had every ingredient and no artifact: the ledger
was machine-local SQLite, the `SessionReport` was an ephemeral view model rebuilt per
render, and the HTML export carried judgments a recipient could not recheck. The unit
the whole company is supposed to stand on did not exist as a thing you could hold, cite,
or verify.

**Decision.** A canonical **Evidence Record** exists (`src/record/`), and the derivation
chain runs one direction:

```
ledger → buildRecord() → EvidenceRecord → reportFromRecord() → SessionReport → renderers
```

Its properties, each load-bearing:

- **Deterministic.** A pure function of the ledger: no clocks, no randomness, no
  environment. The same database state produces byte-identical records. There is
  deliberately **no export timestamp inside the record** — two exports of the same
  evidence must hash identically or the content address is a lie.
- **Content-addressed.** `recordId` = SHA-256 of the canonical record with `recordId`
  omitted. Citing, deduplicating, and verifying a record are hash operations.
- **Canonical.** One serialization (`canonicalJSON`, RECORD-SPEC.md §2); the file on
  disk *is* the hash input modulo the id field.
- **Honest about its own layers.** `observations` (chained events) are protected;
  `evidence` (facts, limitations, coverage, integrity) is the generator's deterministic
  *claim* over them; `subject` is unprotected frame from the mutable sessions table
  (D-035). The split is stated in the spec and in every verifier run, because letting
  frame data borrow the chain's credibility would be overclaiming by layout.
- **Renderer-independent.** `buildReport(store, id)` ≡
  `reportFromRecord(buildRecord(store, id))`, pinned by test. A report rendered from a
  live ledger and one rendered from an exported `.record.json` cannot disagree. This is
  D-049 extended one layer down.

Consequences: `IntegrityStatus`/`Integrity` and the degradation computation moved from
`facts/report.ts` into the record layer (they are properties of evidence, not of
presentation; the report re-exports the types). The chain walk moved to `core/chain.ts`
(`verifyEvents`), shared by the store, the builder, and specified for the verifier.
`lodestar report --record` exports the artifact (a flag, not a sixth command — D-012),
and every HTML surface embeds it inertly, so an exported report *carries* its own
verifiable record. The event schema and ledger are unchanged — **no migration**; the
record is derived, not stored.

**Rejected.** Building the record as a second persisted store (drift risk, and the
ledger already is the source of truth); pretty-printing the export (two forms of the
same bytes means two things to specify and verify); a `createdAt` field (kills
determinism); embedding blob contents (the record inherits the ledger's privacy posture
— refs, never bytes, D-037).

---

## D-060 — The record format is specified, vector-pinned, and has two implementations ✅

**Context.** An evidence artifact is only worth what a recipient can check. While the
format lived solely in TypeScript, the only party who could check a record was the party
that produced it — the self-report problem one layer up. And The Missing 10% is
explicit that the open verifier and format spec have multi-year adoption clocks that
start before product-market fit, not after.

**Decision.** Three artifacts, shipped together and kept honest against each other:

1. **The spec** — `docs/RECORD-SPEC.md`: canonical JSON (including the number and
   unicode rules where implementations actually diverge), the closed event hash-body
   field set (§3.2 — "the hash body IS the format"), chain construction, the record
   shape, versioning and compatibility rules, and what verification proves and cannot.
   Reserved top-level keys (`attestations`, `links`, `extensions`) hold the V2/V3 seams
   without building them.
2. **The golden vectors** — `spec/vectors/`, generated from a fixed session
   (`src/record/vector-fixture.ts`) that exercises every implemented fact, ancestry
   subsumption, a narration event, and a shadowed-coverage degradation. The conformance
   tests assert the implementation reproduces the committed bytes exactly.
   **Regenerating vectors is the declared act of changing the format** — the
   generator's header carries the duties (version bump, spec update, decision here).
3. **The standalone verifier** — `verifier/lodestar-verify.mjs`: one file, zero
   dependencies, deliberately an **independent reimplementation** of canonicalization,
   hashing, and the chain walk. It is the format's second implementation; the vectors
   pin both. Do not "deduplicate" it into an import from `src/` — its independence is
   its function. It verifies `.record.json` exports and HTML-embedded records, produces
   byte-deterministic output, and exits 0/1/2 (intact/invalid/altered) so CI can branch
   on it.

**Why now, in V0.** Cost was near zero (the format already existed implicitly; this
extracted it), and the payoff is the wedge's sharpest gap closed: the shareable export
stops being trust-me. The growth loop (D-014) now distributes verifiable artifacts.

**Rejected.** Signing/anchoring (V2 — attestation is a different trust claim needing an
authority and key management; the reserved key marks the seam); a JSON-Schema published
schema file (the spec's tables serve v1; schema files can follow when there is a second
consumer); "best-effort" verification of unknown format versions (a verifier that
guesses is a verifier whose PASS means nothing — unsupported versions exit 1, INVALID).

---

## D-061 — The verifier states what it cannot prove, in every run ✅

**Context.** THREAT-MODEL.md bounds what V0's capture can claim: the recorder runs as
the same OS user as the agent, so a motivated same-user actor can forge observations
*before they are chained*. Chain verification cannot detect that, and nothing in V0 can.
Meanwhile facts are deterministic generator claims — re-derivable only with the fact
engine — and `subject` is mutable frame data. A verifier that printed only green
checkmarks would let every one of those distinctions collapse into "VERIFIED ✓" in the
reader's mind.

**Decision.** The verifier's output carries a permanent two-part statement — *what this
verifier proves* (the record is unaltered since production; facts point at real chained
events at groundTruth tier) and *what it cannot prove* (fidelity of capture to reality,
correctness of fact computation, the subject frame) — on every run, pass or fail. The
spec (§9) makes this an obligation on all conforming verifiers, not a courtesy of ours.
Additionally the verifier re-checks two honesty invariants mechanically: no fact cites a
non-groundTruth event (D-009, now enforceable by third parties), and the stated
integrity status must match what the bytes recompute to — a record claiming `VERIFIED`
over disclosed gaps is rejected as ALTERED, because an inflated status is a lie whether
or not the hashes hold.

**Why.** "Never claim more than the evidence supports" is the survival condition of the
attestation layer this company intends to build (Blueprint V2); the verifier is where
that discipline first meets an external audience, and a trust artifact that lets silence
imply a stronger claim is the exact failure mode the product exists to remove.

---

## D-062 — V1 is the Evidence Graph over sealed records, not a merged-chain fabric ✅

**RATIFIED** by the founder (2026-07-17), in the reviewed form (`V1-DESIGN-REVIEW.md`
§12 normative), covering the sixth CLI command (`lodestar graph`) under D-012's rule.
Architecture is frozen from this point; changes require a demonstrated correctness
bug, not a preference. First implementation: M-V (D-063, D-064).

**Context.** Three documents describe three different V1s. The Vision ladder says
"team visibility, deeper explanation" — a shared viewer. The Second-Generation
Blueprint says "Evidence Fabric" — an org-wide distributed store whose named hard
problem is *tamper-evident merge from thousands of untrusted collectors*. Building V0
produced a third answer: because chains are per-session and the Evidence Record seals a
session into an immutable, content-addressed, independently verifiable artifact
(D-059/D-060), **the org store never needs to merge a chain — it collects sealed
records and verifies each one.** Git's actual architecture (immutable content-addressed
objects moved over dumb transports; cheap references built above), not git as metaphor.

**Proposed decision.** V1 is the **Organizational Evidence Graph**: a directory of
verbatim Evidence Records (content-addressed, idempotent adds) + per-author append-only
hash-chained **Link** ledgers (authored claims: relates-to, supersedes, incident, …) +
a **derived, disposable index** (rebuildable SQLite; never synced, never trusted,
always recomputable), queried through named citation-bearing queries and surfaced
through deterministic **Graph Facts** with a mandatory **coverage map** so absence of
records never reads as absence of activity. Local-first: syncs over any dumb transport
including a plain git repo; a server is porcelain, not a root of trust. Cross-agent is
a query dimension from the second record onward, not a phase. Person identity and
agent benchmarks are deliberately absent (Same-UID Ceiling honesty + the 10%'s
emergent-only rule). Full design: `docs/V1-DESIGN.md`. Adds one CLI command
(`lodestar graph`) under the five-command rule — ratifying this decision covers that
sixth command.

**The graph's own tier rule** (the load-bearing constraint): every edge is **derived**
(recomputed from record contents; disposable) or **declared** (an authored, chained
claim); Graph Facts consume derived data only, enforced at the query the same way
D-009 makes narration unreachable from Reality Facts. Blurring the two would be
claim-parsing at graph scale.

**Why 🔶.** This reverses the shape (not the mission) of two founding documents and
commits V1's architecture. That is the founder's call. The design is written so a "no"
costs one document.

**Validated for buildability** (`V1-VALIDATION.md`): primitives re-attacked and held;
ten end-to-end scenarios simulated object-by-object; ten refinements (F1–F10 — repo
names resolve as identity signals, conservative merge default, link self-description,
tolerant-reader coverage gaps, generator-provenance labeling, ledger-free
re-analysis, staleness in coverage, and others) folded into the spec requirements,
none breaking a primitive. Readiness: **yes, conditional on** GRAPH-SPEC Part A
draft, committed identity vectors, and this decision's ratification. First milestone
on ratification: M-V, the validation spike (store + resolution + one query,
dogfooded on this repo's own session history).

**Amended by adversarial review before any implementation** (`V1-DESIGN-REVIEW.md`):
links become content-addressed objects in one unified store (per-author chained
ledgers killed — multi-device self-conflict, undeletable claims); identity is captured
as *evidence* and resolved at derive time (capture-time repoId killed — no single
basis survives forks/mirrors/renames); the session key is `(sessionId, chainHead)`
(recordId double-counts re-analyzed sessions); Graph Facts condition on each record's
declared catalog (foreign generators). The review's §12 is the normative spec;
`WHAT-REMAINS.md` records the survival doctrine the design was tested against.
Ratifying D-062 ratifies the reviewed form.

---

## D-063 — The graph store: verify-on-add, write-once, full-rebuild indexing ✅

**Context.** M-V (V1-VALIDATION §10) lands the object store. Three implementation
decisions inside the frozen architecture needed settling.

**Decisions.**

1. **Nothing enters the store unverified.** `graph add` runs the full RECORD-SPEC §7
   checks in-process (`src/record/check.ts`) and refuses INVALID/ALTERED artifacts
   with the checker's wording. The checker REUSES the builder's functions
   (`verifyEvents`, `computeRecordId`) — it is the first implementation, not a third;
   the standalone verifier stays the only independent one (D-060), and tests
   cross-pin the two on identical accept/reject fixtures.
2. **Write-once via temp-then-rename; a lost rename race is a win.** On Windows,
   rename-over-existing throws where POSIX overwrites; since the target name IS the
   content hash, "the target appeared first" means the same bytes are already there —
   reported as `duplicate`, which is a success. Stored bytes are the canonical
   serialization: the file is the hash input, modulo the id field (D-059 extended to
   the store).
3. **`add` reindexes by full rebuild, not incremental insert.** At M-V scale a
   rebuild is milliseconds, and it makes "the index equals a rebuild" true by
   construction — the determinism contract (two rebuilds → byte-identical
   `query repos --json`) is pinned by test, and resolution runs at query time so no
   materialized grouping exists to drift. Incremental indexing arrives later behind
   the same contract or not at all.
4. **`graph verify` reports two axes, never one** (D-058 at graph scale): store
   integrity (every object verifies and is filed under its own content address —
   any failure is BROKEN and named) and evidence quality (count of records whose own
   sessions are DEGRADED — their disclosed gaps, not store damage). Averaging them
   would launder a tamper into a quality note or a quality note into an alarm.

**Rejected.** Trusting `add`-time verification forever (verify re-checks everything —
bytes rot and transports are dumb); SQLite as the store itself (un-diffable,
transport-bound, and the index must stay disposable); skipping the reindex after add
(a stale index that silently disagrees with the store is the exact two-answers
failure D-049 exists to prevent).

---

## D-064 — Identity: evidence at capture, conservative resolution at query time ✅

**Context.** GRAPH-SPEC §4, implemented in M-V. The vectors
(`spec/identity-vectors.json`) were committed before the implementation existed and
pin every rule; this entry records the judgment calls inside them.

**Decisions.**

1. **Capture records evidence, never conclusions**: `gitRemotes` (fetch URLs,
   credentials stripped at capture — adversarially tested against a token-bearing
   remote) and `gitRootCommits` (sorted, capped at the 16 smallest), both
   payload-internal — the record format did not bump, proven by the untouched
   conformance vectors.
2. **The failure direction is fixed: false-split, never silent merge (F2).**
   Auto-merge happens on a shared `origin` remote, or on a shared root commit whose
   holders include at most one origin-bearing group. Everything else — forks,
   renames, mirrors, upstream remotes — surfaces as a labelled candidate that one
   future `identity:same-repo` link resolves. A rename therefore costs one command;
   the alternative (auto-merge on shared roots) silently merges every fork in the
   org.
3. **Resolution is order-independent by construction.** The root rule evaluates
   connected components of origin-less groups against the phase-1 snapshot rather
   than merging incrementally per root — the incremental form gives order-dependent
   answers when one group's roots reach different origin groups (found by attack in
   M-V-ENGINEERING §3, guarded by a reversed-input property test).
4. **The path signal is quarantined**: it groups only records with no stronger
   signal and never bridges origin- or root-formed groups. A reused directory is not
   repo identity; the lost pre-git→post-git continuity case is accepted and
   link-fixable.
5. **Normalization refuses what it does not understand** — `file://`, empty-authority
   URLs, and local paths return null rather than a guessed signal. A missing signal
   weakens a basis; a fabricated one merges strangers.

**Rejected.** Capture-time repoId (killed in V1-DESIGN-REVIEW §1 — a baked guess in
an immutable record); trusting non-`origin` remote names for auto-merge (the
fork+upstream trap); re-normalizing stored signals when reading the index back (a
canonical `host/path` has no scheme — a second pass would erase it; found and fixed
during M-V, see the index reader's comment).

---

## D-065 — Sealed broken-session records are refused, deliberately ✅

**Context.** A record can honestly seal a tampered session: `integrity.status:
BROKEN`, recordId recomputing, the stated break matching recomputation. It fails
RECORD-SPEC §7's chain walk, so `graph add` refuses it. The M-V skeptical review
flagged this as "the graph refuses evidence of tampering," and flagged harder that
the behavior was undocumented.

**Decision.** The refusal stands — as a decision, not an accident. Under the Same-UID
Ceiling there is no signature separating the sealer from an editor, so an
honestly-broken record and a **forged** one (events edited, status restated as
BROKEN, recordId recomputed) are byte-indistinguishable. Admitting the class would
let an attacker (a) manufacture verifying "evidence of tampering" against any target
and (b) launder edited events behind a self-consistent BROKEN claim. Refusing what we
cannot distinguish is the F2 failure direction applied to trust itself. What changed
in M2 is the silence: the refusal now names itself — `add` appends a note citing this
decision and telling the user to keep the file. **Revisit when V2 signatures make
sealer identity checkable**; the RECORD-SPEC §7 wording ("any failure → ALTERED")
gets its v1.1 clarification then, not before.

---

## D-066 — The M2 query layer: self-healing index, primary records, file identity ✅

Four rules, decided together because every query depends on all of them:

1. **The index self-heals; queries never require a manual reindex.** M-V's worst
   bug: after a `git pull`, queries answered from a stale index with full confidence
   — a complete-looking partial answer, the worst failure a disclosure product can
   have. Now the object-file count is stored in index meta; every query compares it
   (plus index existence and schema version) and rebuilds automatically. Freshness is
   never *inside* a report (reports stay byte-deterministic functions of the object
   set); the CLI narrates rebuilds out of band via `indexFreshness()`. Residual,
   stated: a same-count byte swap escapes the counter — that is `graph verify`'s job.
   Rejected: warn-but-answer-stale (an honest-looking wrong answer is the exact
   failure being removed); requiring manual reindex (a mandatory step users will
   forget is a bug with extra steps).
2. **Primary record per session.** Re-analysis (F6) means several records may seal
   one session; rows must not double-count. Election: lexicographic max of
   `(generatorName, generatorVersion, recordId)` — arbitrary tiebreak, deterministic,
   disclosed (`reanalyses: n` on every row). Rejected: semver comparison (guesswork
   across unknown generators); "latest added" (not derivable from objects — breaks
   rebuild determinism).
3. **File identity is the repo-relative path**, computed at index time from
   `target.resolved` minus the session `cwd`, forward slashes, drive letters folded
   case-insensitively, case otherwise preserved. Cross-machine sessions join on
   `src/pay.ts` whatever the clone paths were. An in-scope event whose prefix does
   not relate is **excluded and counted** (`excludedUnrelatable`), never guessed
   into a history; out-of-scope events never acquire repo-relative names (RF-07's
   reasoning). Occurrence time per D-044: mtime when present, event time otherwise,
   with the source labelled on every row.
4. **Repo arguments resolve by signal strength.** Origin/display-name matches own
   their argument outright; wider signals (non-origin remotes, roots, path keys)
   resolve only when the strong tier is empty; a tie WITHIN a tier refuses with both
   names. Found by M2's own test: a flat any-signal rule made the most common query
   (`repo-history <main-repo>`) ambiguous the moment any fork carried the URL as
   `upstream`. Same-strength ties (a root shared by fork and upstream) still refuse
   — equally strong signals admit no principled choice.

Also under this decision: `divergences` conditions on each record's declared
`evidence.catalog` (a foreign generator's silence on RF-04 is disclosed, never read
as absence — D-048 at graph scale), and every query's coverage block carries the
clock disclosure ("times are stated by each machine's clock, not proven by the
chain").

---

## D-067 — Sharing is store union over dumb transports, one command, never deleting ✅

**Context.** M3's mission: the smallest sharing model that turns "my evidence" into
"our evidence" — no server, no accounts, no new trust claims.

**Decision.** `lodestar graph sync` = **collect + pull + push**: seal the
surrounding project's finished sessions (idempotent, so free to run always), pull
remote objects absent locally — **each through verify-on-add**, because a shared
folder is precisely where a tampered object arrives from — and push local objects
absent remotely, temp-then-rename on both sides. Two transports: a **path share**
(any directory holding a graph) and **git** (the graph directory is a clone; sync
pulls, commits, pushes with the user's own credentials — nothing resembling auth is
built). Offline-first: an unreachable share degrades to collect with a stated
warning and a success exit. The share target is **local** configuration
(`local.json`, gitignored) — every teammate's remote differs, and a shared file
naming one person's mount point would be config masquerading as truth. **Sync never
deletes**, anywhere: deletion-propagation is a distributed-consensus problem
wearing a convenience feature's clothes; deletion remains a transport-level act.

**Collect skips open sessions by default** (`--include-open` opts in): a
mid-session snapshot seals a shorter chain than the finished session, so the two
records carry different chainHeads and legitimately count as two sessions — true
but noisy on the common path. Skips are reported as `skipped-open`, never silent.

**Known limits, stated:** under git transport, pulled objects arrive via git rather
than the store gate, so their verification is `graph verify`'s standing job (the
path transport verifies at pull). Provenance of who pushed remains the transport's
ACL story until V2 signatures. A hostile object planted in a share is refused on
pull, named every sync, and left in place for a human to remove.

---

## D-068 — Queries are added only when an investigation cannot be answered ✅

**Context.** M3 ran eleven scripted investigations — realistic engineering
questions over a 3-repo / 4-developer / 5-machine / 3-agent corpus — with a
standing rule: a question the existing queries cannot answer is the ONLY license to
add one.

**Decision.** Two queries earned existence: **`timeline`** (cross-repository
session stream, filterable by machine/agent/time — I-4 "what happened on Alice's
machine this week, across every repo" has no per-repo composition that preserves
the interleaving) and **`coverage`** (first/last-seen per machine, agent, and repo
with degraded-session counts — I-7 "which machines are we even seeing" had no
first-class answer). `coverage` deliberately renders **no staleness judgment**:
last-seen is evidence; "too quiet" requires an expected cadence nobody declared
(the coverage-expectation question stays open).

**Deliberately NOT built, and why:** *repository evolution* (composes from
repo-history + file-history; a dedicated query is a dashboard wearing a query's
clothes); *integrity history* (D-065 keeps broken records out of the store;
in-store integrity history is the DEGRADED counts now in `coverage`); per-query
agent filters beyond timeline's (no investigation needed them); **Graph Facts**
(every pattern the investigations surfaced was answerable by a query the
investigator composes — extraction would have added judgment, not evidence; the
roadmap's GF catalog stays unbuilt until usage, not planning, demands it).

---

## D-069 — Watch mode, clock regression, and the injective RF-01 key ✅

**Context.** An external review of V0 found one wording violation and two
hardening gaps in the fact engine, all in the headline facts:

1. **RF-03 vs watch mode.** `npm run test:watch` failed the completed-run
   predicate, so RF-03 announced *"no test command was observed"* about a session
   in which one visibly was — a false statement produced by the evidence engine
   on an ordinary command. "Was a test command observed?" and "was a COMPLETED
   test run observed?" are different questions and had merged.
2. **RF-04's clock assumption.** RF-04 disclosed *"assuming the wall clock did
   not move backward"* — but every event already carries both `ts` (wall) and
   `monotonicTs`, so a backward step is detectable, not assumable.
3. **RF-01's group key.** `cwd + ' ' + command` is not injective: cwd `/a b` +
   command `c` collides with cwd `/a` + command `b c`, and a real failure in one
   group could be resolved by a pass in the other.

**Decision.** Three changes, one per issue:

- **Issue 1 — two predicates, never merged.** `isTestShapedCommand` (shape only,
  watchers included) guards RF-03: an observed watcher silences the accusation.
  `isTestCommand` (shape minus watchers) remains the completed-run candidate for
  RF-04. `limitations()` states the exact split: *a test command WAS observed;
  no completed test run was* — which is neither evidence of skipped testing nor
  evidence of passing tests.
- **Issue 2 — measure, then trust.** `clockRegression()` compares wall-elapsed
  to monotonic-elapsed between adjacent events; a step more negative than a
  1.5 s tolerance is a measured backward wall-clock step. RF-04 — whose entire
  claim is a wall-derived ordering — refuses to evaluate over such a session,
  and `limitations()` declares the gap. Steps inside the tolerance remain an
  assumption, and the assumption text says so. **A test fixture that fakes only
  one of the two clocks now reads as a clock anomaly — fixtures must keep both
  clocks consistent** (this bit `facts.test.ts` and the M3 corpus, which
  silently disabled RF-04 corpus-wide until fixed).
- **Issue 3 — NUL separator.** The RF-01 group key is `cwd + '\u0000' + command`.
  NUL cannot appear in either field, so the key is injective. The escape is
  written as `\u0000`, never as a raw byte — a raw NUL in source makes ripgrep,
  git, and most editors treat the file as binary and silently skip it
  (`source-hygiene.test.ts` pins this repo-wide).

**Rejected:** treating a watcher as a completed run (dates RF-04 against a run
that never finished); downgrading RF-04 to `confidence: 'medium'` on regression
instead of sitting out (a wall-derived ordering over a broken wall clock is not
weaker evidence, it is no evidence); hashing the group key (hides collisions
instead of removing them).

---

## D-070 — The Link object: the declared layer as content-addressed objects (M4) ✅

**Context.** V1's primitive inventory (V1-DESIGN-REVIEW §2) has six primitives;
five shipped in M-V/M2/M3. The sixth, **P5's "declared" leg** — authored claims,
including the identity-correction mechanism (P4) — was designed and left unbuilt
(the `resolveIdentities(evidence, equivalences=[])` hook). The shipped system
already surfaces the gap it cannot close: investigation **I-5** shows the
`acme/infra` → `acme/platform` rename as a lineage candidate "one link from
merged," and **I-6** shows the `contractor/web` fork as a candidate a human should
be able to mark distinct — with no mechanism to record either answer. This is the
same investigation-driven bar that authorized M3's queries (D-068): build when the
system demonstrates the gap, not because the roadmap lists it.

**Decision.** Land the Link object exactly as GRAPH-SPEC §5 specifies, as an
**immutable, content-addressed object in the same store as records** (`links/`
prefix) — not a per-author chained ledger (that design was killed, V1-DESIGN-REVIEW
§8.2). Specifically:

- **One hashing discipline.** `linkId = hashOf(canonical minus linkId)`, identical
  construction to `recordId`; the file on disk is the canonical form (D-059). Golden
  vectors in `spec/link-vectors.json`; verify-on-add refuses a malformed or
  mis-hashed link with a stated verdict, exactly as records are checked.
- **A repo address.** `evidence:repo/<signal>` names a derived repo group by any
  signal it carries (F1). It is the endpoint form for `identity:*` links. Adding an
  address *form* is within GRAPH-SPEC Part A's draft-normative evolution (§3 was
  explicitly "M-V minimal").
- **Declared identity resolution.** `identity:same-repo` unions two groups;
  `identity:distinct-repos` suppresses the candidate between them (never splits an
  already-merged group — §4.4). Applied after the automatic phases, in linkId order.
  **Only a human's link ever merges or marks distinct; the automatic rules still
  under-merge (F2).** A directive that changes nothing is disclosed
  (unresolvable/redundant/unenforceable), never silently obeyed or dropped (P6).
- **Retraction, one level, monotone.** A link is retracted iff a `retracts` link
  targets its exact linkId; `retracts` links are not themselves retractable, and
  re-assertion is a new link (different ts/reason ⇒ different linkId). No fixpoint,
  no cycle pathology — the graph-scale echo of the facts engine's "a self-referential
  suppression is not evidence."
- **P5 is structural and tested.** The fact engine reads records only; links are a
  separate object type it has no path to. Pinned: non-identity links leave
  `divergences --json` byte-identical, and an identity link changes only repo
  grouping/labels, never a fact's id, statement, or citation.
- **Sync carries links** over both transports (never deleting); dangling endpoints
  are non-fatal and disclosed.

**The sixth-vs-eighth subcommand question (V1-DESIGN-REVIEW open #5, resolved
here).** `graph` now has **8 subcommands**: writes (`init`, `add`, `link`,
`share`, `sync`), maintenance (`verify`, `reindex`), and one read verb (`query`)
whose *named-query registry* is the growth surface. Open question #5 flagged that
subcommand sprawl past ~7 is the D-012 failure mode returning through a side door.
The containment holds: reads never multiply into new top-level verbs — they are
query names under one verb — and `link` is a genuine write operation (minting a
new object type), not a read convenience. The line stays: a ninth top-level
subcommand needs its own decision.

**Deliberately NOT built (still V2, or still unproven):** author authentication /
signing (`author` stays an unauthenticated claimed string); attestation; splitting
an origin-merged group on `distinct-repos` (no principled record assignment —
surfaced, not split); Graph Facts (D-068 holds — no investigation demands a
precomputed pattern); HTTP / `serve` (V1.x). Link *value* to real teams remains the
standing WHAT-REMAINS §7 gate — the mechanism exists now so that evidence can be
gathered; the mechanism is not itself the evidence.

**Rejected alternatives:** per-author chained ledgers (V1-DESIGN-REVIEW §8.2 — self-
conflict on multi-device, undeletable claims, second storage discipline); identity
links pointing at records rather than repo signals (records are artifacts that
re-analysis multiplies; a rename is a claim about *repositories*, which are stable
signals); a resolution fixpoint over retractions (needless — monotone one-level with
content-addressed re-assertion is simpler and has no cycle case).

---

## D-071 — Release identity: public repo, scoped npm name, 0.1.0, Apache-2.0 ✅

**Context.** The V1 release audit passed with four deliberate switches left unthrown:
`private: true`, version `0.0.0`, `UNLICENSED`, and no version control. The founder
directed the release: initialize git, push to `github.com/Gshanmuk8/Loadstar`, and
publish the CLI under a scoped npm name. Bare `lodestar` is taken on the registry
(an unrelated MVC framework), verified against npm.

**Decision.**

- **Source of truth:** `github.com/Gshanmuk8/Loadstar`, repo root = this directory.
  The `package.json` `repository`/`homepage`/`bugs` fields point there.
- **npm name:** `@gshanmukha/lodestar` with `publishConfig.access: public`. **The
  executable stays `lodestar`** — a scoped package's `bin` name is unscoped, so
  `npm i -g @gshanmukha/lodestar` installs the `lodestar` command unchanged. The scope
  must match the npm account that publishes; changing scope later is a rename event
  for install docs only, never for the record format.
- **Version: `0.1.0`** in `package.json` AND `src/core/version.ts` (the one version
  string, stamped into every record as `generator.version`). Pre-1.0 deliberately:
  STABILITY.md governs what is frozen, but the 1.0 promise is earned by the
  WHAT-REMAINS §7 field gates, not declared by a publish.
- **Golden vectors regenerated** (`npm run vectors`) because `generator.version` is
  baked into `spec/vectors/session-record.json`. This is that declared regeneration
  event: the FORMAT is unchanged — canonicalization, hashing, chain, record shape all
  identical — only the generator provenance string moved. `canonical-json.json` and
  `chain-hashes.json` are byte-identical; the conformance suite and the standalone
  verifier cross-pin still pass.
- **License: Apache-2.0** (canonical text, `LICENSE`). Chosen over MIT for the patent
  grant — this is infrastructure positioning itself alongside Kubernetes/OTel-class
  projects, and evidence tooling is exactly where patent ambush would hurt adopters.
  Chosen over UNLICENSED because a public artifact nobody may legally run is not a
  release.
- **Excluded from the public history:** `demo/.workspace/` (generated by
  `demo/run.mjs`), packaging/test artifacts, and the personal session log at the repo
  root (`claude code session 1.md`) — a working note, not product; the .gitignore
  line says how to include it deliberately if ever wanted.

**Rejected:** publishing unscoped under a new bare name (loses the `lodestar`
identity every doc carries); `1.0.0` now (unearned — see the field gates);
squashing the pre-git era into fabricated history (the repo starts at its first
commit and says so — a trust product does not invent provenance it does not have).

---

## D-072 — The launcher executes agents through the shim's execution path ✅

**Context.** First Windows field report after the 0.1.0 release: `lodestar init`
worked, `lodestar claude` died with `spawn claude ENOENT` — in a session where
`claude --version` succeeded. npm installs CLIs on Windows as `.cmd` batch shims
(`claude` is `claude.cmd`), and `ProcessRecorder.run` spawned the bare name with
`shell: false`. Node hands that to CreateProcess, which resolves `.exe`/`.com` only —
it does not consult PATHEXT the way a shell (or `where.exe`, which `isOnPath` uses)
does. So the preflight check passed and the launch failed, on the product's front
door, for every npm-installed agent on Windows.

The shim runner had already solved this exact problem in Phase 6, twice over: it
resolves commands by scanning PATH × PATHEXT itself, and it executes batch targets
through `cmd.exe /d /s /c` with its own quoting (the D-038 history, the BatBadBut
`""` escape, the `%VAR%` refusal). None of that reached the launcher, one directory
away. Two spawn sites had one execution problem and only one had the fix.

**Decision.** Execution mechanics live in one module, `src/recorder/exec-command.ts`,
and both spawn sites use it:

- `resolveOnPath` — the PATH × PATHEXT scan (generalizing the shim's `findReal`;
  the shim passes its own directory as `excludeDir` to keep the fork-bomb guard).
  The launcher resolves against the **agent's** env, not ours — the record must name
  what the child's PATH chose, and the two can differ.
- `spawnSpec` — direct spawn for native executables; explicit `cmd.exe /d /s /c`
  with our quoting and `windowsVerbatimArguments` for `.cmd`/`.bat` targets.
- `unsafeBatchArg` — the launcher refuses `%VAR%`/newline arguments to a batch
  agent, loudly, same rule and reasoning as the shim: running something the
  developer did not write, then recording what they wrote, would put a lie in the
  ledger.
- The launcher records `resolvedPath` on the agent's own `process.spawn`/
  `process.exit` events, as the shim already does for intercepted commands (D-043):
  `claude` and `claude.cmd` are different claims about what ran.

The regression is pinned by tests in `exec-command.test.ts`: a fake `claude.cmd` on
PATH must launch through `ProcessRecorder.run` on Windows, with arguments and exit
code intact.

**Rejected:** `shell: true` (Node leaves the executable path unquoted — the exact
Phase 6 bug 2, `'C:\Program' is not recognized`); shelling out to `where.exe` per
launch (answers for our env, not the child's, and costs a process to learn less);
fixing the launcher locally without extracting the module (a second copy of quoting
logic that has already had one command-injection bug is how the next one ships).

---

## D-011 — Product location ⏸

LODESTAR lives at `Desktop/Loadstar/LODESTAR`, a sibling of `claude-workspace` rather
than nested inside it. The workspace repo is tooling (skills, agents, commands, rules);
this is the product. The founding PDFs currently live in `claude-workspace` and should
probably move to `LODESTAR/docs/founding/`. Not urgent; flagged so it isn't forgotten.

---

## Open items summary

| ID | Item | Blocks | Needs |
|----|------|--------|-------|
| **D-007** | Fix and Direction absent from the ladder | V2 planning. **Not V0** | Founder decision |
| **D-010** | Week 0 bar (~1 in 10) is a judgment call | Positioning confirmation | Measurement, then judgment |
| **D-018** | Session-end auto-summary on or off | Nothing | Founder ruling, best made on a real session |
| **D-011** | Founding PDFs live in the tooling repo | Nothing | Housekeeping |
