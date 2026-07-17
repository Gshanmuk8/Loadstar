# LODESTAR V0 — Product Specification

> **Status:** source of truth for *what to build now*.
> Why: `LODESTAR-VISION.md`. How: `ARCHITECTURE.md`. Rationale: `DECISIONS.md`.

---

## 1. Definition

**V0 is a CLI that wraps a coding agent and produces an independent record of what
actually happened — with unreported reality surfaced up front and a searchable
history underneath.**

Positioning: **"Know what your AI actually did."**

One-line pitch for the landing page:

> Your agent says "done." LODESTAR tells you what actually happened.

### The two pillars

V0 does two things an agent structurally *cannot* do for itself. Everything else is
delivery surface.

1. **Independent verification.** Capture what actually hit the disk and what exit
   code the process actually returned, from *outside* the agent. An agent's account
   of itself is drawn from the same fallible context that produced the work.
2. **Durable, cross-agent history.** Searchable days or weeks later, spanning every
   agent. An agent's memory is conversational, not historical — it dies with the
   session. And no agent vendor will ever unify visibility across its competitors.

**Verification gets them in. History keeps them.** The first is the acute,
in-the-moment pain that drives installs; the second compounds and creates retention.

### Why this is not a summarize button

A summarize button is the agent reporting on itself — which is the very thing
pillar 1 exists to distrust. Claude Code cannot close this gap by adding a feature,
because **the gap is who is doing the reporting.** This is the core defense and it
is structural, not a feature.

---

## 2. Scope

### Must have — this *is* the product

- **Transparent agent wrapping** for one runtime (Claude Code). `lodestar claude`.
- **Independent capture** at the filesystem and process boundary: file changes with
  before/after snapshots, spawned commands with real exit codes, git operations.
- **Runtime adapter** for Claude Code: tool calls with resolved targets and mission.
- **Reality Facts** — deterministic divergence surfacing (§4). *The hook.*
- **Immutable event history** — hash-chained, append-only, local.
- **Execution timeline** — ordered, typed, timestamped, linked to resolved targets.
- **Cross-session, cross-agent search** by file, agent, and date. *The retention
  engine.* Ships **in the dashboard**, not as a CLI command (D-013).
- **Local dashboard** — Sessions, Timeline, Changes, Reports. Opened automatically by
  `lodestar report`.
- **Static HTML export** — self-contained, viewable by someone who installed nothing.
  *The growth loop* (D-014).
- **Chain verification** — surfaced in `lodestar status` and the dashboard footer
  (D-016).
- **Honest coverage reporting** — what was and was not independently verified.
- **Shadow-mode risk verdicts** — computed and stored, never displayed (D-005).
- **Local-first, zero-account, zero-cloud.** Code never leaves the machine.

### Nice to have — only if the must-haves are solid

- Session replay (step through the timeline). *Demoted from the founding V0 —
  see D-006.*
- Side-by-side compare of two sessions on the same task.
- Simple per-file diff view.
- A second runtime adapter.

### Do NOT build

See `CLAUDE.md` → V0 Do-Not-Build List. Summary: no memory injection, no cloud, no
accounts, no teams, no blocking or policy, no second runtime before the first is
excellent, no AI summarization, no IDE extension, no risk indicators in the UI.

---

## 3. Target User

Narrow and specific: **a developer who runs AI coding agents on real work several
times a day, and has already been burned at least once** by an agent that said
"done" and wasn't, or by not being able to reconstruct what an agent changed.

This person does not need convincing that agents are useful. They need to trust
them enough to delegate more, and they can't yet. They are the early adopters of
coding agents — the population growing fastest right now.

### The main use case

> A developer runs Claude Code on a real task. The agent works for fifteen minutes
> and reports success. The developer — who has learned not to fully trust that —
> opens LODESTAR and sees, independently: the seven files that actually changed, and
> that a test process exited 1 four minutes before the session ended. In thirty
> seconds they know what to trust and what to re-check.
>
> A week later, when something in auth breaks, they search LODESTAR for every
> session that touched the auth module and find the exact one — across two different
> agents — that introduced the change.

**The value in one line:** thirty seconds of certainty about what an agent actually
did, and a memory of it that outlives the session.

---

## 4. Reality Facts — the core hook

The catalog of deterministic divergence signals. **This is the feature that makes
people install.** It is also the feature most capable of killing the company if done
wrong, which is why the rule below is absolute.

### The rule

Restated from `CLAUDE.md` because it governs this whole section:

**Only verifiable facts. Never parse natural language. Never accuse.**

```
Good:  "npm test exited with code 1"
Bad:   "The AI lied about tests passing"
```

### The bar a Reality Fact must clear

1. **Computable from the event record alone** — no inference about intent or claims.
2. **Reproducible** — same record, same fact, always.
3. **Observation, not judgment** — report state; the human concludes.
4. **Evidence-linked** — points at the events that support it.

If a proposed fact requires knowing what the agent *said*, it is not a Reality Fact
and does not ship. No exceptions, no "just this one," no confidence thresholds.

### Approved catalog for V0

Each is deterministic, requires zero natural-language processing, and cannot be
wrong.

**Shipped in V0** — implemented in `src/facts/index.ts`, tested in `facts.test.ts`,
`ancestry.test.ts`, and `rf-catalog.test.ts`:

| # | Fact | Signal | Why it matters |
|---|------|--------|----------------|
| RF-01 | A command exited non-zero and was not subsequently re-run successfully | exit code | The headline fact. "npm test exited with code 1." |
| RF-02 | Session ended with a dirty working tree | `git.status` (D-047) | "Done" with uncommitted or half-edited files. |
| RF-03 | Source files were modified but no test process ran | process tree | 12 files changed, nothing verified. |
| RF-04 | Files were modified *after* the last test run | `mtimeMs` vs exit time (D-044) | Test results are stale relative to the final state. |
| RF-05 | A file was written and later reverted within the session | content hashes | Churn — the agent changed its mind, possibly silently. |
| RF-06 | A process was killed or timed out | signal | Work may be half-complete. |
| RF-07 | Files outside the project scope were modified | path resolution | Blast radius exceeded expectation. |

**Catalogued, NOT implemented** — see D-051. Listed here because they are approved and
still wanted; they are not part of V0, and no code claims them. The `RealityFact['id']`
union stops at RF-07 so this cannot silently change.

| # | Fact | Blocked on | Status |
|---|------|-----------|--------|
| RF-08 | Network egress occurred during the session | A network boundary. `net.request` exists in the schema; **nothing emits it.** | Deferred — needs capture work, not fact work |
| RF-09 | Destructive git operation (force-push, hard reset, branch delete) | Observing git *operations*, not before/after *state*. The reflog is not read. | Deferred |
| RF-10 | Binary or oversized file modified | Nothing — `contentWithheld: 'oversized'` is already recorded and already disclosed as a limitation in the report. | Deferred as redundant with the limitation |

> **The rule this table exists to hold.** A fact in a spec and not in the code is a claim
> the product does not carry. Anyone reading the shipped table must be able to run the
> command and see it. Anyone reading the deferred table must not be able to mistake it for
> something that works.

**A fifth rule, added after the V0 audit (D-039):**

> **5. A fact must not report a failure LODESTAR caused.**

The other four rules assume LODESTAR is not a participant in the session. The shim makes
it one: when LODESTAR refuses a command it exits 126, the parent command inherits that and
exits non-zero, and RF-01 reports it as the agent's failure — computable, reproducible,
neutrally stated, evidence-linked, and false. A fact can satisfy every rule above and
still be an accusation about the wrong party.

**RF-04 is the sleeper.** "`auth.ts` was modified three minutes after the last test
run" is fully deterministic, needs no claim-parsing, and is a stronger signal than
most claim-based checks would be — the tests genuinely did not cover the final state.

### Explicitly rejected

- ❌ *"Files changed that the agent didn't mention"* — requires extracting mentions
  from narration. **Banned.** Show the files changed; let the human compare.
- ❌ *"The agent claimed tests passed"* — requires parsing the claim. **Banned.**
  RF-01 delivers the same signal with zero inference.
- ❌ Any LLM-scored "suspicion" ranking. That is the agent-reporting-on-itself
  problem wearing a different hat.

### Presentation

Reality Facts lead the report — terminal summary and HTML, top of the page. Neutral,
factual voice. Every fact links to its evidence. If there are none, say so plainly
("No divergences observed") rather than manufacturing concern.

---

## 5. User Journey

**Discovery.** A post, a teammate's shared report, an AI-coding community. The pitch
answers "why do I care" in the first sentence.

**Install.** `npm install -g @gshanmuk8/lodestar` (the command is `lodestar`; the npm
name is scoped because bare `lodestar` was already taken). No account, no sign-up, no
API key.
**This is the single most important product decision in V0: zero permission required
to start.** Under three minutes to first value, or the wedge is too heavy.

**Initialize.** `cd my-project && lodestar init` — detects the project (language,
package manager, git), writes `.lodestar/config.json`, detects the available runtime.

**Use AI exactly as before.** `lodestar claude` launches a normal Claude Code
session, wrapped. Nothing about the interaction changes.

**Silent recording.** For the session's duration LODESTAR records the request, every
file read and written, every command and exit code, network calls, git changes, and
the order and timing of all of it. The developer notices nothing.

**Report.** `lodestar report` — a terminal summary for a glance, and a local HTML
dashboard for the browsable, shareable version. **Reality Facts at the top.**

**The loop closes** when something looks off, the developer investigates using the
report instead of re-reading scrollback, and shares the report with a teammate —
the first, unplanned seed of V1.

---

## 6. Week 0 — the gate before any product code

**Do not skip this to feel productive.**

The founding documents each specify a Phase 0, but they ask *different questions*.
Both must be answered, because **they gate different decisions.**

### Question 1 — the schema gate

Pull 20–30 real Claude Code sessions. Manually classify every action as
**clean-structured**, **pattern-matchable**, or **opaque**.

- **Gates:** the event schema and the adapter approach.
- **Deliverable:** a written classification with real numbers, and a schema decision.
- **Consequence:** decides whether the wedge is a six-week or four-month build, and
  possibly which runtime to build on.

### Question 2 — the positioning gate

Across the same sessions, measure **how often a Reality Fact from the §4 catalog
would have fired**, and how often the developer would have cared.

- **Gates:** the positioning only. **Not the architecture.**
- **Proposed bar:** a material Reality Fact should fire in roughly **1 session in
  10**. A developer running agents several times a day then feels it every couple of
  days — enough to build a habit. Much rarer and it's a novelty.
- **This bar is a judgment call, not derived from the founding documents.** Record
  the measured rate and decide against it honestly.

### The contingency that makes this safe

If Question 2 comes back below the bar, **the architecture does not change.** Fall
back to history-and-search-led positioning ("the memory your agents don't have") and
keep building the same system. This is the entire point of decoupling architecture
from positioning — see D-002. A bad answer costs a landing page, not a rebuild.

---

## 7. Roadmap

Front-loads the risky, valuable capture work; defers everything cosmetic.

| Phase | Goal | Completion criteria |
|-------|------|--------------------|
| **0** | Validate (§6) | Both questions answered in writing, with numbers. |
| **1** | CLI skeleton | `lodestar claude` launches the agent normally and creates an empty session record. |
| **2** | Recording engine — *the hard part* | A real session produces a complete, ordered, tamper-evident event log with no missing actions. |
| **3** | Reality Facts + report | `lodestar report` answers "what did it actually do?" without re-reading scrollback. |
| **4** | Storage + search | Answer "what changed in `auth.ts` in the last two weeks?" across sessions and agents. |
| **5** | Dashboard | `lodestar report` opens a browser showing real history with working timeline, diffs, and search. |
| **6** | Hardening | A week of the founder's own daily use with zero missed or malformed events. |
| **7** | Launch | Developers install without being asked twice; at least one report shared unprompted. |

> **Ordering note.** Phases 3 and 4 are swapped relative to the founding Product
> Blueprint, which put storage/history before the report. Reality Facts are the
> install trigger and the thing Week 0 is measuring — get them in front of a human
> as early as possible. Search is retention, and retention has no one to retain
> until people install. See D-008.

### What NOT to do in these phases

No cloud, no accounts, no VS Code extension, no memory injection, no second runtime
before the first is excellent, no AI summarization layer. Every one is a week spent
on something that isn't the wedge.

---

## 8. Success Metrics

**During V0:**

- Reality Fact fire rate on real sessions (validates the wedge).
- False-positive rate on Reality Facts. **Target: zero.** They are deterministic;
  any false positive is a bug, not a tuning problem.
- Missed or malformed events per session. **Target: zero** by Phase 6.
- Time from install to first report. **Target: under three minutes.**
- Reports shared unprompted.

**The one metric that gates V1:**

> Do free individual users start asking **"how do I share this with my team?"**

Asked unprompted, that question is the only valid signal to begin the Team phase.
Everything else is a vanity metric at this stage.

---

## 9. Cost

V0 has no server and no model-hosting bill. Domain (~$1–2/mo annualized), static
docs hosting (free tier), npm publishing (free), CI (free tier). **Realistic total:
$0–20/month.**

This is the structural advantage of being a trust layer rather than a model wrapper,
showing up early: the cost starts at zero.
