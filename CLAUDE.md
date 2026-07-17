# LODESTAR Project Context

You are working on LODESTAR.

Before making any product, architecture, or engineering decisions:

1. Read `docs/LODESTAR-VISION.md`
2. Read `docs/PRODUCT-SPEC.md`
3. Read `docs/ARCHITECTURE.md`

These documents define the source of truth.

## Document map

| Document | Answers | Read it when |
|----------|---------|-------------|
| `docs/LODESTAR-VISION.md` | **Why** the company exists, the six layers, the moat | Questioning direction or strategy |
| `docs/PRODUCT-SPEC.md` | **What** to build now — V0 scope, Reality Facts catalog, roadmap | Deciding if something is in scope |
| `docs/ARCHITECTURE.md` | **How** — signal tiers, event schema, components, the evidence pipeline (§3a) | Writing anything in `src/` |
| `docs/RECORD-SPEC.md` | **The wire format** — canonical JSON, hashing, the Evidence Record, verification | Touching hashing, canonicalization, `src/record/`, or the verifier |
| `docs/STABILITY.md` | **What is frozen** for V1–V4, what is stable, what is internal | Changing any exported interface |
| `docs/USER-FLOW.md` | **The UX** — the loop, the five commands, every terminal output | Touching the CLI, report, or dashboard |
| `docs/API-DESIGN.md` | **Contracts** — CLI, event schema, adapter, report model (§4·0) | Changing an interface, or building the dashboard |
| `docs/REALITY-FACTS-AUDIT.md` | **What each fact cannot see** — per-fact evidence, edge cases, failure modes, risks | Touching any RF, or reviewing the claims |
| `docs/THREAT-MODEL.md` | **What V0 does and does not defend against** | Before writing any trust claim, anywhere |
| `docs/V1-DESIGN.md` | **What V1 is** — the Evidence Graph, its primitives, and the roadmap (D-062 🔶) | Planning or building anything beyond one session |
| `docs/V1-DESIGN-REVIEW.md` | **What survived the stress test** — the adversarial review; its §12 is the normative V1 spec | Before implementing any part of V1 |
| `docs/V1-VALIDATION.md` | **Is it buildable** — simulated walkthroughs, findings F1–F10, readiness ruling, the M-V spike | Before writing the first line of V1 code |
| `docs/GRAPH-SPEC.md` | **The graph format** — objects, addresses, identity rules, the directory binding | Touching `src/graph/` or the identity vectors |
| `docs/M-V-ENGINEERING.md` | **How M-V was built** — design, attack log, stop-report | Continuing V1 implementation |
| `docs/M2-ENGINEERING.md` | **How M2 was built** — the review fixes, query layer, attack log | Touching the graph queries or index |
| `docs/M3-ENGINEERING.md` | **How M3 was built** — sharing, the corpus, investigations; what remains unvalidated | Touching sync, or planning any milestone after M3 |
| `docs/M4-ENGINEERING.md` | **How M4 was built** — the Link object (declared layer P5, identity correction P4), retraction, the P5 gate; attack log | Touching `src/record/link.ts`, links in the store/graph/sync, or identity resolution's declared inputs |
| `docs/WHAT-REMAINS.md` | **The survival doctrine** — what outlives vendor evolution; wedge vs platform | Any strategy, positioning, or build-vs-skip decision |
| `docs/DECISIONS.md` | **Why it is this way**, and what is still open | Before re-litigating anything |

**Read `docs/DECISIONS.md` before re-opening a settled question or acting on an
unsettled one.** Several decisions here reverse the founding documents deliberately;
that file records which, and why. Open items are marked 🔶 and listed at the bottom.

**A decision cited in code must exist in `DECISIONS.md` before that code lands** (D-052).
The code cited D-047 and D-048 for weeks with no entry in that file — real decisions whose
reasoning lived only in a source comment, which is how D-048's "reconciled" claim rotted
into the D-050 drift. And where an invariant can be *tested* instead of narrated, test it:
this file records why, the test holds the line.

---

# Company Mission

LODESTAR builds the trust layer for autonomous AI.

It does not build:
- another AI assistant
- another coding agent
- another LLM

It makes existing AI systems trustworthy enough to perform real work.

---

# What V0 Is

**A CLI that wraps a coding agent and produces a tamper-evident execution history of
what actually happened — with unreported reality surfaced up front and a searchable
history underneath.**

**Say "tamper-evident", never "verified".** "Verified" claims the record is provable
against the party it audits. It is not: LODESTAR runs as the same OS user as the agent,
so a motivated agent can forge it, and closing that needs privilege separation (V1). What
V0 genuinely delivers is capture *outside the agent's self-report*, hash-chained, with
in-place edits detectable. That is a real and useful claim. The larger one is not ours to
make yet — see `docs/THREAT-MODEL.md`, and read it before writing any trust claim in code,
docs, or marketing.

Positioning: **"Know what your AI actually did."**

The core hook is **surfacing unreported reality**: deterministic facts where the
AI's actions and the actual system state diverge.

V0 is not a prototype of the Record Layer. It *is* the Record Layer, narrowed to
its first runtime. Every later layer is an addition to the same execution path,
never a rebuild of it. This is why the event schema matters more than any
feature in V0.

Two things V0 is explicitly not:
- **Not a generic AI session logger.** "We log what your agent did" is the
  commoditized slice. If LODESTAR is ever perceived as an agent logger, it has
  already lost.
- **Not an AI assistant or a competitor to Claude Code.** LODESTAR observes
  agents; it does not do their work, and it does not feed context back to them.

The report and dashboard are only the interface. The product is the trust
infrastructure underneath.

## The V0 loop — the entire product

```
lodestar init  →  lodestar claude  →  (work normally)  →  lodestar report
```

**Install → wrap AI work → inspect reality.**

**The magic moment is the trust report after an AI session.** If a proposed feature
does not make that moment arrive sooner, land harder, or feel more trustworthy, it
does not belong in V0.

The V0 CLI is **five commands**: `init`, `claude`, `report`, `sessions`, `status`.
Not fifty. Adding a sixth requires a decision in `DECISIONS.md`.

Two hard constraints on the loop:

- **The developer does not change workflow.** `lodestar claude` must feel exactly like
  `claude` — stdio, TTY, signals, colors, exit codes all pass through. If LODESTAR
  changes how the agent feels to use, the wedge is dead.
- **LODESTAR must never break the agent.** If recording fails, the agent keeps running
  and LODESTAR degrades loudly in the report. V0 has not earned the right to be in
  anyone's way.

Full detail, including every terminal output: `docs/USER-FLOW.md`.

---

# The Reality Facts Rule

This rule is load-bearing and has no exceptions.

**Only report verifiable facts. Never parse natural language to infer intent, and
never accuse an agent of lying.**

```
Good:  "npm test exited with code 1"
Bad:   "The AI lied about tests passing"
```

A Reality Fact must satisfy all four:

1. **Computable from the event record alone** — no inference about what the agent
   meant, believed, or claimed.
2. **Reproducible** — the same record always produces the same fact.
3. **Stated as observation, not judgment** — report the state, let the human draw
   the conclusion.
4. **Carries evidence pointers** — every fact links to the recorded events that
   support it.

Why the rule exists: a trust product that wrongly accuses an agent has spent the
only asset it has. Credibility in a trust company is lost in an instant and
rebuilt over years. Claim-parsing is fuzzy, so it produces false accusations, so
it is banned — not deferred.

The inversion that makes this work: you never need to prove the agent *claimed*
tests passed. Reporting that a test process exited 1 is the same signal to the
developer, requires no natural-language processing, and cannot be wrong.

See `docs/PRODUCT-SPEC.md` for the catalog of approved Reality Facts and the bar
a new one must clear.

---

# Core Product Principles

Everything belongs under:

## Record

Capture what actually happened.

Examples:
- tool calls
- file modifications
- commands
- outputs
- execution timeline
- runtime events

## Explain

Help humans understand AI behavior.

Examples:
- session history
- investigation
- root cause analysis
- replay
- audit evidence

## Gate

Control risky AI actions.

Examples:
- permissions
- approvals
- policies
- prevention

> **Scope note.** These three are the operating filter for V0–V2 — the work that
> is actually reachable now. The full company arc has six layers (Record,
> Explain, Gate, Prevent, Fix, Direct); the last two are documented in
> `docs/LODESTAR-VISION.md` and are deliberately absent from this filter because
> they are not buildable until the record exists. Do not treat their absence here
> as a decision to drop them. See `DECISIONS.md` D-007.
>
> Within V0, "Explain" means **local** explain only: timeline, searchable history,
> session reports. Root cause analysis, replay, and audit evidence are V1 — they
> appear in the list above because this section describes the layer, not the
> version.

---

# Engineering Principles

Always prioritize:

- truth over AI claims
- observability
- reliability
- security
- extensibility
- runtime independence

Never build:

- unnecessary AI features
- chatbot features
- another coding agent
- features without connection to trust, visibility, or control

## Runtime independence is a schema property

The core — storage, analysis, reporting — must never assume anything
Claude-Code-specific. If it does, "add Codex support" becomes a rewrite instead
of a new adapter. Every runtime gets a thin adapter that translates its tool-call
shape into the one normalized event schema; the core never changes when a runtime
is added.

## Honest coverage

Adapters declare what they can and cannot observe. The UI reports coverage
honestly and says what it did *not* independently verify. A trust product with
silent holes is worse than one with disclosed holes.

---

# Decision Filter

Before implementing anything ask:

Does this improve:

1. Knowing what the AI actually did?
2. Understanding why it happened?
3. Controlling risky actions?

If not, question whether it belongs.

## V0 secondary filter

If it passes the filter above, it still must pass this one:

- **Does it survive Week 0?** If the feature only makes sense given an
  unmeasured assumption, it waits for the measurement.
- **Is it load-bearing or surface?** Load-bearing (schema, capture, storage)
  gets built right the first time. Surface (reports, dashboard) gets built
  cheaply and changed often.
- **Does it require parsing the agent's claims?** Then it is banned, not
  deferred. See the Reality Facts Rule.

---

# V0 Do-Not-Build List

Carried from all three founding documents. These are scope killers, not
preferences.

- **No memory injection back into the agent.** Recording only. The moment you
  feed context to the agent you are a different, harder product, racing the
  vendors.
- **No cloud, no accounts, no team features, no sync.** One dev, one machine.
- **No prevention, blocking, permissions, or policy.** Pure observation. This is
  the entire later company; it must not leak into V0.
- **No second runtime before the first is excellent.** Depth beats breadth.
- **No AI-generated analysis or summarization of the session.** An LLM summary on
  top is the agent-reporting-on-itself problem wearing a different hat.
- **No IDE extension before the CLI and dashboard work.** The extension is a
  client; build the engine first.
- **No shadow-mode risk indicators in the UI.** Computed and stored, never
  displayed. See `DECISIONS.md` D-005.

---

# Working Preferences

- Prefer the smallest change that solves the problem; match surrounding code style.
- Run tests before claiming something works; report failures honestly.
- Confirm before destructive or hard-to-reverse actions.
- Ask when a decision is genuinely the founder's; otherwise pick a sensible
  default and say what you chose.
