# LODESTAR — Product & Architecture Roadmap: V0 → V4

> **Status:** the master roadmap after V0. *Why the company exists:* `LODESTAR-VISION.md`.
> *What V0 is:* `PRODUCT-SPEC.md`. *What evidence is worth:* `THREAT-MODEL.md`. *What
> survives vendor evolution:* `WHAT-REMAINS.md`. *Rationale for everything:* `DECISIONS.md`.
>
> **Conflict rule:** if this document contradicts `RECORD-SPEC.md`, `GRAPH-SPEC.md`,
> `THREAT-MODEL.md`, or a ratified decision, the contradiction is a bug in THIS file.
> The founding blueprints (Second-Generation Blueprint; The Missing 10%) are honored
> where the operating docs adopted them (D-059, D-060, D-062) and superseded where
> they were adjudicated. This file does not reopen settled decisions; it composes them.

---

## 0. How to read this roadmap

**It is ordered by evolution, not by calendar.** No rung carries a date. Every rung
carries three things instead: what it is, what it builds on, and **the gate — the
smallest observation from the outside world that unlocks it** (`WHAT-REMAINS.md` §7:
gates, not vibes). A rung entered before its gate is founder push, and the one
structural risk this company controls is positioning drift driven by founder push
(`LODESTAR-VISION.md` §6, risk 2; D-068).

**It refuses fictional premises.** A roadmap section that assumes an unbuilt
capability says so in place. As of this writing the true state is: V0 complete and
hardened (record, facts RF-01–07, report, verifier, vectors); V1's graph slice
shipped through M4 (store, identity, three queries, sharing, links); **zero external
installs; zero field data; Week 0 unrun**. Every claim downstream of "users do X"
is a hypothesis with a gate, and is marked as one.

**The word "inevitable" is banned here.** A roadmap that feels inevitable is the
bull case wearing a spec's clothes — the exact failure `LODESTAR-VISION.md` §6
exists to prevent. This roadmap is *conditional by construction*, because the
company's product is honesty about what evidence supports, and a company document
is not exempt from the product's own rule.

**The standing kill-criterion travels with the roadmap.** If, at the V1.x gate, no
team shares a graph and no outsider verifies a record, the compounding thesis is
wrong as stated: fall back to the solo product's honest ceiling and re-examine.
(`WHAT-REMAINS.md` §7.) Every section below inherits this clause.

---

## 1. What LODESTAR is

### 1.1 The company

LODESTAR builds the **neutral evidence layer for autonomous software work** — the
missing layer in:

```
Foundation models → Coding agents → [ EVIDENCE ] → GitHub → CI/CD → Cloud → Organizations
```

It does not build models, assistants, or agents. It sits at the execution boundary —
where agent intent becomes filesystem writes, process exits, and git state — and
produces a record that is independent of every producer, verifiable by anyone,
owned by the organization, and durable across vendor switches and years.

### 1.2 The problem, stated as architecture

An agent's account of its own work is drawn from the same fallible context that
produced the work. This is not a model-quality defect; it is a *reporting topology*
defect. Whoever acts cannot be the neutral witness of the action — at any capability
level. Concretely, in the code that exists today:

- An adapter hook reporting an exit code would be the audited party reporting on
  itself; `EvidenceSource` has no `agent_message` member and the fact engine's only
  query filters `signalTier: 'groundTruth'` (D-009, D-023). The rule is a type, not
  a policy.
- The OS gives exactly one guarantee no participant can fake for another: **a
  parent, and only a parent, learns
  its child's exit status** (`ARCHITECTURE.md` §1a). Everything LODESTAR claims is
  anchored to being the parent, watching the filesystem, and reading git directly —
  never to what any model said.

### 1.3 Why the problem grows if AI becomes perfect

A perfect agent still cannot testify about itself, for the same reason a perfect
employee still gets a payslip, an access log, and a code review: **trust is a
property of the system around the actor, not of the actor.** And volume inverts the
comfort: better agents ⇒ more delegated, less-watched work per human hour ⇒ less
human attention per change ⇒ trust becomes *scarcer* exactly as competence becomes
abundant. The record's value scales with unwatched consequential action, which is
precisely what improving models manufacture (`WHAT-REMAINS.md` §3; V1-VALIDATION §8).

### 1.4 Why independence is structural, not a feature

The Same-UID Ceiling (`THREAT-MODEL.md` §1) is the honest floor: at V0, recorder and
agent share a user, so the record is tamper-*evident*, not tamper-*proof*, and the
roadmap's trust claims climb only as the architecture separates the witness from the
actor (V2). But independence from the *vendor* is absolute from day one, and no
vendor can cross it:

- A producer shipping "trust features" is the audited party auditing itself. The
  moment any incumbent ships an agent — GitHub (Copilot), GitLab (Duo), Google
  (Gemini), Microsoft — it disqualifies itself from the neutral position
  (V1-VALIDATION §8). The position is only occupiable by *not being them*.
- A vendor sees only its own agent. The organization runs Claude Code, Codex,
  Cursor, Gemini CLI, and in-house agents; only a layer that treats every producer
  identically can hold the cross-vendor record, and the cross-vendor record is the
  asset an org uses to evaluate, negotiate with, and leave vendors — which is why
  no vendor will ever be allowed to host it (`WHAT-REMAINS.md` §3).

### 1.5 Why LODESTAR does not compete with Claude, Codex, Cursor, Gemini, Windsurf

They convert intelligence into changes. LODESTAR converts changes into evidence.
The interface between the two businesses is a format, not a battlefield: agents are
**producers** whose work enters the record, and the record gets *more* valuable as
they get better (more actions, higher stakes). If a vendor someday emits conforming
records natively, that is coverage gained, not territory lost — self-emitted records
are labelled as self-report (provenance, F5/W10), and LODESTAR's independent capture
graduates from wedge to audit instrument, spot-checking vendor self-records against
floor observations of the same sessions (F9). We are short the price of
intelligence and long the volume of autonomous action (`LODESTAR-VISION.md` §1).

---

## 2. The six pillars

The six pillars are one artifact viewed six ways. Everything is a function of the
**Evidence Record** — the sealed, content-addressed, self-verifying bundle of one
session's observations (D-059). No pillar introduces a second source of truth.

### 2.1 Evidence

**Definition.** What actually happened, captured at the execution boundary, in a
form whose integrity anyone can check without trusting the producer.

**Why it exists.** Every other pillar is an interpretation; this is the thing
interpreted. It is also the only pillar that cannot be added later — evidence not
captured at execution time is gone.

**Internal architecture (shipped).** Two-signal capture (adapter intent + ground-
truth floor: PATH shims with measured coverage, fs watcher with settle-and-hash,
git read directly, process parentage); hash-chained append-only ledger
(`core/chain.ts` — the format, D-059); canonical JSON + SHA-256 content addressing;
the sealed Evidence Record with `recordId` recomputable by anyone; a standalone
verifier pinned to the implementation by golden vectors (D-060); redaction as a
store property (D-028/D-033); coverage probes that report `observed / shadowed /
absent / unknown` per command (D-040).

**User-facing.** `lodestar run <agent>`; nothing about the session changes; the
record exists afterward whether or not anyone reads it.

**Enterprise value.** The record *is* the compliance posture: evidence gravity —
accumulated, unleavable, growing switching cost (`LODESTAR-VISION.md` §2).

**Expansion.** More boundaries (network egress — RF-08's missing capture; container
and CI collectors at V2+), more generators (vendor emitters, SDK), never more
inference. Capture fidelity rules are permanent: fidelity beats coverage (D-038);
if observing would change execution, do not observe, and disclose the hole.

### 2.2 Trust

**Definition.** The calibrated relationship between a claim and its evidence —
including the claim "we could not see."

**Why it exists.** A record nobody can calibrate is a vibe with a hash. Trust is
manufactured by three separations the code enforces: observed / computed / declared
(P5 — tiers at the query, links never reach facts); verified / unverifiable (the
verifier states what it cannot prove, every run — D-061); covered / uncovered (the
coverage map on every output, "absence of records is not absence of activity").

**Internal architecture.** `signalTier` filtering at every trust-bearing query;
provenance labels (generator name+version) on every citation and aggregate (F5);
`factsVerdict` so an empty fact list is never conflated with a broken chain; the
three-tier adversary model (T1 confabulation: defended — the market; T2
opportunism: detected; T3 motivated same-user: out of scope until V2, stated).

**User-facing.** Verdict-first reports (D-058): what diverged, how complete the
evidence is — two independent axes, never one ambiguous word.

**Enterprise value.** The only vendor claim that survives a security review is the
one that names its adversary (`THREAT-MODEL.md` §3). Honesty is the sales asset.

**Expansion.** V2 attestation converts "tamper-evident against opportunism" into
"provable to an outsider": signatures, privilege separation, checkpoints, external
anchoring — each closing a named gap (C1–C7), none claimed before it ships.

### 2.3 Memory

**Definition.** The organization's accumulated, queryable past: every session, every
agent, every repo, resolved into identities and linked into meaning.

**Why it exists.** An agent's memory is conversational and dies with the session; a
vendor's memory sees one producer. Cross-agent, cross-year memory can only
accumulate in the neutral store — and it is the one asset a competitor cannot copy
at any price (`WHAT-REMAINS.md` §3).

**Internal architecture (shipped through M4).** The Evidence Graph: add-only
keyspace of records + links; verify-on-add; identity evidence captured in records
(normalized remotes, root commits) with conservative query-time resolution —
false-split over false-merge, one declared link fixes a rename, no silent fork
merge (F2); self-healing indexes that are pure functions of the object set;
citations as permanent `evidence:` addresses; session keys `(sessionId, chainHead)`
so re-analysis never double-counts (F6).

**User-facing.** "What touched `auth.ts` in the last two weeks, across both
agents?" — answered with citations, bases, and a coverage line, in four commands
(W6). Investigations, not dashboards.

**Enterprise value.** Institutional memory that outlives employees, vendors, and
machines; the corpus that makes V3 possible.

**Expansion.** V3 turns passive memory into active guidance (Direction). The graph
is also where the failure corpus (`LODESTAR-VISION.md` §2, asset 4) accumulates —
aggregated and anonymized only under explicit consent architecture, V4.

### 2.4 Replay

**Definition.** Reconstructing a past session faithfully enough to understand,
investigate, and prove what happened — from the record alone, with no original
machine.

**Why it exists.** Explanation without reconstruction is narrative. The record
carries complete ordered events, before/after content hashes, resolved targets,
and timing — sufficient to walk a session forward or backward exactly as observed.

**Internal architecture.** Already latent in the artifact: `reportFromRecord(R)`
renders the full report from a sealed record with zero V0 code changes (W1) —
replay is a renderer over the same model (D-049/D-054). Timeline reconstruction,
per-file diff walks, and re-analysis by newer engines (`evaluateEvents` over a
record's events, W7) all run ledger-free.

**User-facing.** Step through the timeline; open any file at any observed state;
compare two sessions on the same task. **Honest boundary:** this is *observational
replay*. Deterministic *re-execution* was demoted from V0 (D-006) and stays out of
the roadmap until a rung demonstrates need — it is a different, heavier product.

**Enterprise value.** Incident forensics that do not depend on the developer's
laptop still existing; auditor walkthroughs years later (W9).

**Expansion.** V1.x adds side-by-side session compare; V2 dual-record correlation
replays vendor self-records against floor records of the same session (F9).

### 2.5 Policies

**Definition.** Decisions about actions — allow, warn, ask, block — derived from
signals the record already carries.

**Why it exists.** Layers 3–4 of the six-layer thesis (`LODESTAR-VISION.md` §3):
gate what violates a known rule; prevent what is dangerous with no rule against it.

**Internal architecture (V0 reality).** Shadow only, by decision: risk verdicts are
computed and stored from day one and never displayed (D-005). The V2 signal fields
(`effectClass`, `blastRadius`, `reversible`, `taint`, `missionId`) are in the schema
now so the dataset accumulates without a migration. V0 blocks nothing and must not
(fail-open is correct for a system of record; the inversion to fail-closed for
irreversible actions is earned only when gating ships — `ARCHITECTURE.md` §1a).

**User-facing (future).** Policy as data, versioned in the org's own store;
verdicts always cite the evidence and the rule; **the human-attention budget is the
design constraint** — a prevention layer that asks about everything manufactures
consent and is worse than none (`LODESTAR-VISION.md` §3, Layer 4).

**Enterprise value.** The meter that prices the ladder: free → seats → governed
actions.

**Expansion.** V2 ships gate + prevention only after shadow mode proves them quiet
on real fleets. V4 scales policy to org governance. Prevention runs on resolved
actions, never on stated intentions — the difference between prevention and theatre.

### 2.6 Audit

**Definition.** The discipline that makes every output answerable: who observed,
what was computed, what was declared, what was not seen, and how to check.

**Why it exists.** It is the epistemic discipline productized (`WHAT-REMAINS.md`
§2, primitive 5) — the one primitive that is a practice, not a technology, and
therefore the hardest to copy: a producer's observability exists to make its agent
look good; ours exists to be checkable when it makes everyone look bad.

**Internal architecture (shipped).** Limitations computed and rendered
unconditionally; `DEGRADED` never resolving to a bare green line; facts carrying
their assumptions on the card (D-057/D-058); interference reported beside facts,
never subtracted (D-039); every fact evidence-linked, asserted for the whole
catalog in one test; disclosure obligations on every graph answer (GRAPH-SPEC §6).

**User-facing.** The verifier anyone can run with nothing installed; reports a
staff engineer parses in ten seconds mid-incident (D-058).

**Enterprise value.** SOC2/ISO evidence *production* — not a checkbox, but the
artifact an auditor can independently re-verify (V2 makes this provable).

**Expansion.** V2 attestation; auditor-facing views (§5, §6); continuous sampled
verification at fleet scale with the sampling disclosed (V1-VALIDATION §5 — P6
applies to verification itself).

### 2.7 How the pillars interact

One lifecycle, one artifact:

```
capture (Evidence) → seal → verify (Trust) → accumulate + resolve (Memory)
    → reconstruct (Replay) → decide (Policies, shadow → live) → answer (Audit)
        → and every answer cites back into the same sealed objects
```

Dependencies are strict and load-bearing: Policies without Evidence is theatre;
Memory without Trust is a rumor mill; Replay without Audit is a narrative; Audit
without Memory forgets. This ordering is why the layers ship in the order they do —
each is unlocked by data the previous one captured, which is also why a competitor
starting at the top cannot catch up (`LODESTAR-VISION.md` §3).

---

## 3. The individual developer

The wedge. Free, permissionless, local, and complete on its own — a developer who
never syncs anything must still get full value forever, or local-first is a slogan.

### 3.1 Discovery → first value

Discovery is a shared report or a post (the export is the growth loop, D-014), and
the pitch must answer "why do I care" in one sentence: *your agent says "done" —
LODESTAR tells you what actually happened.* The journey is `npm install -g lodestar`
→ `cd project && lodestar init` (detects language, package manager, git, runtime) →
`lodestar claude` → work exactly as before → `lodestar report`. No account, no API
key, no cloud, no permission from anyone. **Under three minutes to first value or
the wedge is too heavy** (`PRODUCT-SPEC.md` §5). The magic moment is the first
report where a Reality Fact names something the session summary didn't.

### 3.2 Daily use

The CLI stays five commands plus `graph` (D-012, D-062); every surface beyond it is
a renderer over the same record (D-049). A typical day: wrap two or three sessions;
glance at the terminal verdict after each (TTY-aware, D-055); open the dashboard
when something looks off; search history when something breaks days later. The
recorder is silent during sessions — stdin/stdout/TTY/signals/exit codes pass
through untouched, and if recording fails **the agent still runs** and the gap is
declared (`API-DESIGN.md` §1). LODESTAR is never allowed to be the reason work
stopped.

### 3.3 The local dashboard

`lodestar report` starts a local server, picks its own port, opens the browser.
Files-affected first, timeline one click away (D-058); facts lead with what
happened, not catalog IDs (D-056); observed facts and LODESTAR's reading are
visually separate groups (colour-blind-safe, D-058); the chain-integrity line sits
in the footer always (D-016). Search across sessions lives here, not in the CLI
(D-013): by file, agent, date — the retention engine.

### 3.4 History, memory, offline, sync-later

Everything lives in `.lodestar/` (project) and the graph directory (org or
personal); both are plain files; nothing phones home. Offline is not a mode — it is
the architecture; there is nothing to be offline *from*. "Sync later" is literal:
records sealed today enter a graph years from now and the answers simply improve
retroactively (W9 — the unordered store is the feature). A developer's personal
graph is the same object model a 1,000-seat org uses; nothing is thrown away on the
climb (§9).

### 3.5 Editor and terminal surfaces

Terminal-first is a decision, not a gap: the wedge user lives where the agent runs.
A VS Code extension is a **renderer** (open the report beside the diff, jump from a
fact to the file) and is deferred until the report itself is the thing users share
unprompted — an extension that renders a report nobody re-opens is furniture. The
V0 Do-Not-Build list applies (`PRODUCT-SPEC.md` §7).

### 3.6 Updates

The recorder and the format version independently. Records are forever: a format
change is a spec version with new golden vectors, never a migration of sealed
bytes (RECORD-SPEC is frozen per version; W7 re-analysis handles engine upgrades).
The updater may never touch a ledger. Coverage probes re-measure after every
update, because a new shell or PATH is a new world (D-023).

---

## 4. The small team (5 → 20 developers)

**Gate to invest beyond D-067's file-transport sharing:** ≥3 teams with a shared
graph receiving records weekly for a month, unprompted after setup, and ≥1 human
resolving an identity or declaring a link because they needed it
(`WHAT-REMAINS.md` §7). Until then, everything in this section runs on the shipped
mechanics.

### 4.1 How evidence moves (shipped: D-067)

Sharing is store union over dumb transports — a synced folder, a git repo, a
network share, a USB stick. `lodestar graph share` / `sync`; objects are verified
through the same gate on arrival; nothing is ever deleted by sync; conflicts do
not exist because there is nothing to merge (add-only keyspace). Two teammates'
graphs union into the truth of both. No server earns its place at this size, and
that is a feature: the trust story ("your code never leaves your machines") is
also the deployment story.

### 4.2 Mixed runtimes are the normal case

Five developers on Claude Code, Codex, Cursor, Gemini CLI, and something in-house:
the ground-truth floor records all of them identically (fallback wrapping,
`API-DESIGN.md` §1); adapters enrich where they exist; provenance labels every row
with generator and runtime (F5). The team's graph is the only place all five
appear in one queryable history — the cross-vendor pillar working at its smallest
scale.

### 4.3 Investigation, collaboration, knowledge

The incident loop is W6 and it is the product: alert → `sessions --repo X --since
24h` → `divergences` → verify the record → read the evidence → declare an
`incident` link to the tracker with a reason. Weeks later, `links --target INC-421`
reproduces the trail. Knowledge-sharing at this size is exactly two mechanisms —
the shared static export (zero-install artifact for "look at this") and declared
links (durable, attributed, retractable-not-deletable claims) — deliberately not a
wiki, because prose drifts and links cite.

### 4.4 What each role sees

The **platform engineer** sees coverage: which machines report, which commands are
shadowed where, staleness per machine ("no records received since Tuesday" — never
"no activity", F7). The **engineering manager** sees sessions and divergences per
repo — never per person as a performance metric; the day LODESTAR becomes
surveillance is the day the wedge dies, so per-developer views exist for the
developer, and aggregates exist for the org (a positioning commitment, restated in
§6 and §15). **Security** sees RF-07 blast-radius facts, out-of-scope writes, and
the taint/effect-class dataset quietly accumulating for V2.

### 4.5 How trust grows

Not by dashboards — by the record being right when it mattered once, per person.
The compounding loop: a fact fires → a developer checks it → it holds → the next
"done" gets verified in thirty seconds instead of re-read scrollback. Teams then
route the *sharing* habit through the graph because the graph is where the answers
were. If that loop does not close with real teams, the kill-criterion applies and
the roadmap stops selling teams what individuals didn't want.

---

## 5. The enterprise (100 → 1,000+ developers)

**Gate:** everything enterprise-shaped in this section is V2+ and inherits V2's
entry gate (§10) — at least one concrete external-verification event (an auditor,
security review, or customer asking for/accepting a verifiable record), plus the
V1.x sharing gate already met. Selling enterprise before an outsider has ever
demanded verification is selling a compliance checkbox V0 explicitly refuses to be
(`WHY-NOT-DEPLOY.md` §7).

### 5.1 Architecture at scale

The primitives do not change; the bindings do (V1-VALIDATION §5 — five orders of
magnitude, same objects). Store binding: directory/git → object storage
(S3/GCS/Azure) at ~10³ engineers; index: per-consumer SQLite → server-side
Postgres/DuckDB behind a **read** API; verification: verify-on-add → continuous
sampled verification with the sampling rate disclosed. Multi-region and residency
are trivial *because* objects are immutable and content-addressed — replication is
`cp` that cannot corrupt; the org keys the store, LODESTAR never holds the only
copy, and "cloud" remains a binding choice, not a custody change.

### 5.2 Collectors

Capture points beyond the developer laptop, each an independent generator with its
own provenance label: **CI collectors** (the runner wraps the agent exactly as a
laptop does — and a CI record is privilege-separated *by construction*, since the
agent never had the runner's credentials: the first honestly tamper-resistant rung
on the ladder, available before V2's local separation); **container/K8s
collectors** (a sidecar or wrapper at the pod boundary, V2+); **fleet ingestion**
(HTTP `graph add` with verify-on-add, §13.4). Collectors never parse narration;
they are the same boundary, relocated.

### 5.3 The Evidence Fabric

The Blueprint's name for what GRAPH-SPEC §2 already defines: the org-wide add-only
keyspace, unioned across every source (laptops, CI, collectors), indexed for
queries, disclosed for coverage. Business units are graphs; the org is a
graph-of-graphs (union semantics already defined, V1-VALIDATION §4); federation is
set union with provenance, not a data-sharing negotiation.

### 5.4 Compliance, SOC2, ISO, regulated industries

LODESTAR's posture: **evidence production, not checkbox theater.** What a SOC2 or
ISO auditor actually needs — change history, actor attribution, integrity proof,
retention — maps onto records, provenance, chain verification, and the append-only
store. The regulated-industry pitch is the flight-recorder pitch verbatim, plus
V2's attestation so the artifact is provable to the *regulator's* auditor, not
just to the org. Healthcare/finance/government each add residency and access
constraints — bindings and RBAC (V2's privilege separation makes RBAC honest;
bolting it onto V0's same-UID record would be pretending, D-046/`THREAT-MODEL.md`).

### 5.5 Who uses it, how

**An investigation** at enterprise scale is W6 with more zeros: org-wide search
narrows by repo group, time, agent; every step cites; the investigation itself is
saved as links (attributed, timestamped, retraction-preserving) so the
investigation is *also* evidence. **Security** starts from divergences and taint
across the fleet, pivots to blast radius, exports the verifiable bundle for the
vendor or the insurer. **Auditors** get read-only access to records + the
standalone verifier — they re-verify independently, which is the entire point;
sampled continuous verification reports live in the audit view. **Executives** get
the only executive dashboard this company will ever ship: fleet coverage, verified
fraction, divergence trends, governed-action counts — aggregates with citations,
never a "trust score" (a score is an interpretation dressed as a measurement; the
refusal is the product, `WHY-NOT-DEPLOY.md` §6).

---

## 6. The web application

**Rule zero:** the web app is a renderer with an index. It computes nothing the
graph cannot recompute, asserts nothing without an `evidence:` address, and every
page exists because a named investigation needs it (D-068 applied to UI — a page
that answers no investigation is furniture). The dashboard has no logic of its own
(D-054); the report model computes, every renderer only renders (D-049).

### 6.1 The object model IS the information architecture

The app introduces zero new truth-bearing objects. Its nouns are the graph's nouns:

| Object | Source of truth | The app adds only |
|---|---|---|
| **Session** | session key `(sessionId, chainHead)`; primary record election (D-066) | a URL |
| **Evidence Record** | sealed object, RECORD-SPEC | rendering + verify button |
| **Event** | record `observations.events[seq]` | deep-link `#seq` |
| **Reality Fact / Limitation** | computed by the engine, evidence-linked | grouping, filters |
| **Repo group** | derived identity resolution (GRAPH-SPEC §4) | display name = a signal |
| **Link** | `lodestar-link` objects, incl. retractions | authoring UI (writes a link, nothing else) |
| **Investigation** | a saved, named set of cited queries + links | the page itself |
| **Coverage** | disclosure obligations on every answer (GRAPH-SPEC §6) | the banner no page may omit |
| **Attestation** | reserved seam, V2 | — (absent until real) |
| **Policy / Verdict** | shadow verdicts (D-005), enforcement V2+ | — (absent until real) |
| **Developer / Team / Org** | identity is V2 (privilege separation makes it honest) | claimed strings until then, labelled as claims |

### 6.2 Pages

**Dashboard** — the fleet verdict block (divergences observed / evidence
completeness, D-058's two axes at org scale), coverage staleness per machine (F7),
recent sessions. Answers: "is anything my problem right now?"

**Sessions** — the cross-agent list, filterable by repo/agent/date/divergence.
Answers W6 step 1. **Session detail** is the V0 report, unchanged: verdict, files
first, timeline one click away, facts with assumptions on the card, chain line in
the footer.

**Repositories** — repo groups with bases (`origin`/`root`/`path`), root-conflict
flags, lineage candidates awaiting a human's identity link (I-5/I-6 rendered as an
inbox — the page where the graph asks its one legitimate question: "same repo?").

**Changes / File history** — the file-level query with citations; the "what
touched auth.ts in two weeks, across agents" page. **Search** — sessions, files,
commands, links; every result row cites; search never ranks by inference.

**Investigations** — saved query sets + their link trail; an investigation is
shareable as a bundle (records + links + verifier) so its recipient can re-verify
without an account. **Links** — the declared layer browsed: active, retracted
(shown, struck through — disagreement is preserved), dangling (disclosed).

**Verify** — paste or upload a record, run the same pure walk the CLI runs, get
INTACT/BROKEN with the stated cannot-prove list (D-061). Public, no login: the
trust claim as a public utility.

**Analytics** — aggregates with citations only: divergence rates by repo, coverage
trends, generator mix. No per-developer league tables, ever (§4.4). **Timeline** —
org activity as observed, with the coverage sentence pinned. **Admin/Teams/
Settings** — bindings, retention, keys (V2), roles (V2); nothing here can edit an
object, because nothing anywhere can.

### 6.3 What the web app refuses

No edit affordances on evidence (there is no API for it to call — §13.4's write
surface is `add` and `link` only); no AI summarization layer between the user and
the record (the summarize button is the agent reporting on itself one layer up,
`PRODUCT-SPEC.md` §1); no green "safe" banner (`WHY-NOT-DEPLOY.md` §6); no page
without its coverage line.

---

## 7. The landing page

**The thirty-second test:** a developer who has been burned once must recognize
their problem in the hero, see the proof in one artifact, and reach `npm install`
without a form. The page sells the wedge (`PRODUCT-SPEC.md` §3); the platform
story exists but sits behind one link, not in the hero.

**Hero.** *Your agent says "done." LODESTAR tells you what actually happened.*
Subline: an independent, tamper-evident record of every AI coding session — local,
no account, three minutes to first proof. Install command inline. No demo video —
a **real exported report** (D-014's artifact doubles as the demo: static, fast,
and itself shareable).

**Problem.** Three lines, no fear-mongering: the summary said done; the tests said
otherwise; nobody could reconstruct what changed. Then the one architectural
sentence: *the actor cannot be its own witness.*

**Architecture.** The boundary diagram from `ARCHITECTURE.md` §1a, animated only
as far as clarity needs: agent → shims/fs/git → chained record → verifier. One
line on what is NOT captured (narration never reasoned over) — the refusal shown
as a feature.

**Interactive demo.** The exported report of a real session with a real RF-01 —
clickable facts, evidence links, the limitations block visible. The demo must
contain a visible limitation; a demo with no disclosed hole would be the exact
overclaim the product bans.

**Sections** in order: Developers (the daily loop, offline, no telemetry — with
the threat model linked, not paraphrased); Evidence & Security (the honest claim
from `THREAT-MODEL.md` §3 verbatim, T1/T2/T3 table, the standalone verifier to
download); Enterprise (one paragraph, one link — the gate applies to marketing
too); Pricing (free forever locally; seats for the shared graph; governed actions
at V4 — publish the ladder now so nobody fears a rug-pull); Docs (install,
five-command reference, RECORD-SPEC public from day one — the spec IS marketing to
the 10% who decide for the 90%); FAQ (answer "why not just Claude Code's logs?"
with the topology argument, and "can it lie about my agent?" with the D-039 rule);
Changelog + the DECISIONS.md philosophy made public — engineering honesty as brand.

---

## 8. AI & ecosystem integrations

Four integration classes, in descending order of trust, always labelled:

1. **Floor** (ground truth): any CLI agent, wrapped, no adapter needed — fs,
   process, git capture with measured coverage. This is how Codex/Gemini
   CLI/aider/anything work on day one (`API-DESIGN.md` §1 fallback).
2. **Adapter** (intent): the runtime's hooks enrich the record with missions,
   tool calls, resolved targets. Claude Code ships; each next adapter is built
   when demand is demonstrated, not before (one excellent runtime before a second,
   `PRODUCT-SPEC.md` §7).
3. **Emitter** (self-report in our format): a vendor/framework emits conforming
   records natively. Welcomed — verified structurally, labelled as self-emitted
   (W10/F5): *the format cannot make self-report independent, and the graph never
   blurs who observed.*
4. **Anchor** (independent corroboration): git hosts and CI — a second system's
   own records correlated with ours.

**Claude Code** — shipped: wrap + adapter; shell-selection env vars via the
adapter registry (the recorder knows no vendor, the registry describes them).
**Codex / Gemini CLI / Cursor / Windsurf** — floor today; Cursor/Windsurf are
IDE-shaped, so their session boundary is fuzzier: the honest unit is "workspace
watch + process tree," and the record says so; adapters follow demonstrated use.
**OpenAI / Anthropic / Gemini APIs, OpenRouter** — an application calling models
is an agent we didn't spawn; integration is the SDK/emitter path plus (later) a
local proxy that gives RF-08 its real network boundary — **command-string
inference about network activity is banned; no boundary, no fact** (D-051).
**LangGraph & frameworks** — an emitter SDK: `beginSession/emit/seal` producing
conforming records from inside the framework, self-report-labelled, chain-valid.
**MCP** — two directions: recording MCP tool calls as intent events (adapter
work); and exposing LODESTAR *as* an MCP server so agents can query history
("what broke last time anyone touched this file?") — read-only, cited, and
explicitly advisory; the moment memory injection steers execution it is V3
Direction and carries V3's evidence bar, not before.
**GitHub / GitLab** — links to PRs/issues (shipped mechanism); a CI check that
runs the standalone verifier on the session records attached to a PR (the
"evidence attached, verified" badge — V1.x); Copilot/Duo records ingest as
emitter-class, labelled.
**CI/CD** — the collector with structural privilege separation (§5.2): wrap the
agent step, seal, `graph add` — the deployment story for teams that trust no
laptop. **Docker/K8s** — the same boundary at the pod/sidecar; V2+, gated on
fleet demand.

**What remains vendor-neutral, permanently:** the format and verifier (no vendor
fields, `x-<ns>` extensions only); provenance on every citation; trust-of-
generator as a consumer-side judgment the graph labels and never makes; and the
structural bans — no vendor money steering the catalog, no house agent, ever
(`WHAT-REMAINS.md` §5).

---

## 9. V1 — The Evidence Graph (team memory over sealed records)

**Entry gate: passed** — V0's own development produced the corpus and the
investigations (I-1…I-6) that demanded it (D-062, D-068). **Exit gate (to V1.x
server work):** ≥3 teams sharing weekly for a month unprompted; ≥1 identity/link
authored from need. **The kill-criterion checkpoint lives here** (§0).

**Mission.** Turn sealed per-session records into org-owned, cross-agent,
cross-year memory — without a server, an account, or a byte of new trust surface.

**Architecture.** Shipped (M-V→M4): add-only keyspace; verify-on-add; directory
binding + dumb-transport sync (D-067); pure-function indexes that self-heal
(D-066); conservative identity with declared-link correction (GRAPH-SPEC §4–5).
Remaining, in order of demonstrated need: **auto-add** (the hot path must never
depend on the graph — the watcher stays out of the session lifecycle, F8);
**side-by-side session compare** (demoted from V0, D-006 — revives only on
investigation demand); **V1.x read API + server index** (Part B binding: HTTP
`add` with verify-on-add, read-only queries; Postgres/DuckDB index; the server
holds derived state only — losing it loses nothing).

**Data model.** Frozen: records + links, content-addressed, RECORD-SPEC /
GRAPH-SPEC Part A. V1 adds **no truth-bearing object**. The reserved seams
(`attestations`, `extensions`, link `x-` types) absorb V2–V4 without a format
bump — additions are new objects, never edits (V1-VALIDATION §1).

**UX / CLI.** `lodestar graph init·add·link·share·sync·verify·reindex·query`;
three queries until an investigation demands a fourth (D-068). Web: §6 in
read-only form first — a dashboard over the shared directory before any server.

**Storage & sync.** Files → git → object storage, same bytes; sync is union;
years-late records are legal and improve answers retroactively (W9).
**Scaling:** the V1-VALIDATION §5 table stands — five orders of magnitude,
nothing in the format changes.

**Failure modes.** Stale index → self-heals by count, disclosed (D-066); torn
files → naming discipline + anomaly surfacing; broken-session records → refused
with stated reason (D-065); link spam → claims never reach facts, filterable by
author, blast radius is presentation; same-count substitution → `verify`'s job,
and the counter never claims otherwise.

**Engineering challenges (named unknowns).** Identity split-rate in real orgs
with mirrors (V1-VALIDATION unknown 8 — field data decides; one-link fix bounds
damage); record-size discipline under stdout-heavy sessions (unknown 9 — measure
before Part B profiles); index-freshness wording at scale (unknown 7 — the read
API must not overclaim between rebuilds).

**Moat contribution.** Corpus gravity begins: every week of records makes
leaving costlier — the first asset a competitor cannot copy by shipping features.

**Success metrics.** The exit gate above, plus: W6-class investigations answered
in minutes with citations; zero reported identity false-merges (false-splits are
one link to fix — the chosen failure direction); unprompted shares of exports
and investigations — the only growth number V1 tracks.

---

## 10. V2 — Attestation & the trust boundary (evidence becomes proof)

**Entry gate:** ≥1 concrete external-verification event — an auditor, security
review, or enterprise customer demanding/accepting a verifiable record — AND ≥1
non-LODESTAR generator emitting conforming records, even a toy: an attestation
authority over a single-producer format is self-report with extra steps
(`WHAT-REMAINS.md` §7). **No V2 code before both.**

**Mission.** Close the Same-UID Ceiling and make the record provable to someone
who trusts neither the developer, the agent, nor LODESTAR's goodwill.

**Architecture.** Privilege separation first: the sealer as a separate OS
user/local daemon holding the only signing key — the agent can no longer author
what the sealer signs. **This is a trust-model replatform and this roadmap says
so plainly.** The adoption ladder's "no replatforming at any step"
(`LODESTAR-VISION.md` §4) is true of the record format and false of the trust
architecture; repeating the false half would be making an impression rather than
a claim (`THREAT-MODEL.md` §0). The format does not change; who can sign does.
Then, in strict order, each closing a named gap from `THREAT-MODEL.md` §5:
signed checkpoints (C5/C6 — truncation and deletion finally leave marks);
authenticated appends (C1); ancestry attestation (C3); coverage re-probes under
separation (C7). External anchoring (transparency-log-style head publication)
makes "the org cannot rewrite its own past" checkable by outsiders. **Dual-record
correlation** (F9): floor records vs vendor self-records of the same session —
independent capture's graduation from wedge to audit instrument.

**Attestation objects.** The reserved seam becomes real: signed, content-
addressed statements about records (`sealed-by`, `verified-at`, `anchored-in`)
from actors whose keys are now distinguishable from the agent's.

**Gate & Prevention (the policy half).** Shipped only after shadow mode proves
them quiet on real fleets — D-005's dataset finally cashes in; verdicts computed
on resolved actions, never stated intent; ASK budgeted against human attention;
fail-open inverts to fail-closed **only** for irreversible action classes once
gating exists (`ARCHITECTURE.md` §1a). RF-08 lands here with its real network
boundary; RF-09 with git-operation observation — D-051's deferrals end when the
capture exists, not before.

**UX.** Daily recording unchanged. New: key enrollment, `lodestar attest`, the
public Verify page accepting attestations, RBAC that is now honest because the
substrate is (D-046's objection retired by architecture, not by a login screen).

**Failure modes.** Key loss → re-enrollment + re-attestation of heads, never
re-signing history; daemon downtime → recording continues unsigned, gap declared
(fail-open for *recording* is permanent); signature theater → every attestation
names what it does NOT prove (D-061 extended).

**Moat contribution.** Trust earned in calendar time starts compounding — the
unbroken record of never having lied, which cannot be crash-built.

**Success metrics.** External verifications performed by parties who are not us;
attested records demanded in a real procurement or audit; published shadow-mode
false-positive rate before any verdict is ever displayed.

---

## 11. V3 — Institutional knowledge (memory becomes guidance)

**Entry gate:** graphs old enough that history queries answer questions their
askers had *forgotten* the answers to — measured by repeat usage of queries
against >6-month-old records (`WHAT-REMAINS.md` §7). Knowledge cannot ship
before there is a past worth consulting.

**Mission.** Direction — Layer 6 of the founding thesis: steer agents toward the
good path *before* they act, from the one asset only the org's graph holds: its
recorded decisions, incidents, and outcomes.

**This section proposes the D-007 resolution** (founder ratifies): **Fix** lands
as V2.x recovery-as-mission — a proposed fix runs through the full trust stack
like any work; autonomy laddered by reversibility; never autonomous for
irreversible actions (`LODESTAR-VISION.md` §3, Layer 5 — the record gates the
autonomy). **Direction** is V3, where the founding documents placed it. The
operating ladder's old V3 (org-scale policy) folds into V4. D-007's 🔶 closes
when this paragraph is ratified or corrected.

**Architecture.** Two wells, structurally separated forever: **human-authored**
guidance (per-service `DIRECTION.md`, ADRs, constraints — declared-layer
objects: attributed, versioned, citable, trustworthy day one) and **learned**
guidance (extracted from incidents, reverts, and outcomes — advisory only,
behind a high evidence bar, every suggestion citing the sessions that taught
it). Injection happens at the boundary LODESTAR already occupies — Direct is
"context injected at the point V0 already sits" (`ARCHITECTURE.md` §1). **Memory
injection comes off the Do-Not-Build list here and only here**, with the danger
named in the founding docs kept in the foreground: bad guidance is worse than no
guidance — steering an agent confidently wrong is a failure mode the product
itself introduces, so learned guidance stays advisory until its own track record
is evidence.

**UX.** Agent-facing: the read-only MCP/API surface answers "what should I know
before touching payments?" with cited history — the worked example is the
payments-freeze re-plan (`LODESTAR-VISION.md` §3, Layer 6). Human-facing: the
Knowledge view is the same answer rendered; every direction shows its citations
and their age.

**Failure modes.** Stale guidance → citations age visibly; unresolvable
citations demote the guidance; guidance loops → the advisory tier cannot gate;
Direction mistaken for policy → it is context, not control; control lives in
V2/V4 and stays there.

**Moat contribution.** The deepest: a competitor can copy the algorithm and
cannot copy years of the org's resolved, linked, evidenced history. Direction is
where the flight recorder becomes the institution's memory.

**Success metrics.** Re-plans induced before action (visible in adapter intent);
citations followed vs dismissed; **zero incidents attributable to injected
guidance — absolute; one violation pauses the well that produced it.**

---

## 12. V4 — Coordination & governance (the fleet, governed)

**Entry gate:** documented incidents where evidence *would have changed a
decision in flight* (the dataset D-005 has been accumulating since V0), plus
enterprise pull for policy — **never founder push** (`WHAT-REMAINS.md` §7).

**Mission.** The full lifecycle at organizational scale: governed, auditable
control over what fleets of agents may do — the org's trust posture as
infrastructure, and the ladder's final rung (`LODESTAR-VISION.md` §4).

**Architecture.** Policy objects in the org's own store — versioned, attributed,
citable; **policy changes are themselves evidence**. Verdict pipelines at every
collector boundary (laptop daemon, CI, cluster). Org-scale aggregation as
graphs-of-graphs federation (union semantics unchanged from V1). The
governed-actions meter as the billing primitive (free → seats → governed
actions). The failure corpus becomes a product **only** under explicit,
revocable, org-level consent — aggregated, anonymized, disclosed; the day
consent is assumed is the day neutrality dies.

**UX.** The Policies page goes live; ASK verdicts arrive where the developer
already is (terminal, PR); every block cites rule + evidence; appeals are links,
recorded. Executives see governed-action trends; auditors replay policy history
against incident history.

**Failure modes.** Consent manufactured by ASK-fatigue → the attention budget is
a hard, monitored ceiling per developer-day; policy theater → a rule that cites
no incident must declare itself a priori; fail-closed cascades → only
irreversible action classes may fail closed, and the recording path is fail-open
forever.

**Moat contribution.** If the format won (§13), V4 is where the *position*
earns the business — store, verifier authority, resolution, governance — heeding
the OCI warning that a format can win while its steward loses
(V1-VALIDATION §7).

**Success metrics.** Verdict precision (blocks that were right; asks that
changed outcomes); attention cost under ceiling; enterprise renewals
attributable to governance; the 2032 test still passing (§14).

---

## 13. Open standards

The standard is not a side project; it is the highest-ceiling asset in the
company (`LODESTAR-VISION.md` §2, asset 3) and today's most undervalued one
(`WHAT-REMAINS.md` §5).

**13.1 The evidence format.** RECORD-SPEC + GRAPH-SPEC Part A, public from day
one, frozen per version, pinned by golden vectors, with two implementations
required for every claim (D-060). An independent implementation that reproduces
four functions reproduces our hashes (`core/chain.ts` header) — that sentence is
the whole standards strategy in miniature.

**13.2 The attestation format.** V2's signed statements, specified the same way:
canonical form, content address, golden vectors, a stated list of what each
attestation type does and does not prove.

**13.3 The open verifier.** Standalone, dependency-light, runnable by someone
with nothing installed, stating what it cannot prove in every run (D-061). The
verifier is the standard's enforcement arm: a format is real when a party who
distrusts every producer can check conformance alone.

**13.4 The ingestion protocol.** V1.x: HTTP `add` (verify-on-add, write-once,
size-bounded) + read-only cited queries. Any conforming generator may submit;
provenance is recorded; nothing about ingestion grants trust — tier honesty is
not checkable by a verifier (W10), so provenance labelling is the protocol's
load-bearing rule.

**13.5 The extension API.** Already reserved, deliberately: `x-<ns>:<t>` link
types (tolerated, counted, never silently dropped — F4), the `extensions` and
`attestations` seams on records, unknown-object tolerance with disclosed skips.
Extension happens by *new object types*, never by mutating existing ones.

**13.6 How it becomes the neutral standard.** Consumers standardize on the
format no producer controls (containers, OTel, TCP/IP — V1-VALIDATION §7).
Strategy, in order: publish specs + vectors + verifier; make the second
generator trivially easy (the emitter SDK, §8); court *consumers* (auditors,
insurers, security tooling) rather than producers; and if producers adopt the
format natively, declare victory on coverage while the moat moves to the
position — store, verifier authority, resolution, corpus — per the OCI warning.
**Gate for standards investment beyond publishing:** the second-generator
assumption (`WHAT-REMAINS.md` §6.5) shows life — one external emitter, even a
toy.

---

## 14. The 2032 test

Assume the strongest 2032: coding agents are excellent, cheap, ubiquitous;
vendors ship replay, timelines, self-observability, signed self-reports; "AI
coding" is considered solved. What of LODESTAR survives?

Delete everything a vendor can absorb — capture engines, per-session reports,
dashboards, the seven facts, even `lodestar claude` itself (`WHAT-REMAINS.md`
§4 already deletes them). What cannot be deleted, at any capability level:

1. **The topology.** A producer-signed log of the producer's work answers "what
   does the vendor say it did." The question organizations must answer is "what
   can anyone check happened, whoever's agent did it." Independence is not a
   feature that capability absorbs; it is a property the producer cannot have.
2. **The volume inversion.** Solved AI coding means orders of magnitude more
   unwatched consequential change per human hour. Trust is the input that gets
   *scarcer* as capability gets cheaper — and unlike code, it does not get
   cheaper with scale (`WHAT-REMAINS.md` conclusion).
3. **The corpus.** The org's own linked history — decisions, incidents,
   resolutions — accumulated in a store no vendor hosts. In 2032 that corpus is
   five-plus years deep, and it is the raw material of V3/V4, which by then are
   the product.
4. **The record of never having lied.** Calendar-time trust, the one asset a
   2032 entrant cannot crash-build, however good its models are.

If, instead, agents in 2032 still take no consequential unsupervised actions —
the autonomy bet failed — the market is the modest tooling business the vision
already prices in (`LODESTAR-VISION.md` §6, risk 1). The company is a leveraged
bet on autonomy scaling; this roadmap does not pretend otherwise.

---

## 15. Engineering principles

Harvested from the decision log — each earned by a shipped mistake or a named
attack, none aspirational. These govern every rung above.

**Epistemics**
1. Never claim beyond the evidence; state what you cannot prove, every time
   (D-046, D-061, THREAT-MODEL §3).
2. Unknown is not absent, and silence must be loud (D-022, D-023, D-040, D-048).
3. Evidence may be qualified by later evidence, never deleted by it (D-045).
4. Observation, not judgment: report state; the human concludes (the Reality
   Facts Rule; RF catalog bans claim-parsing outright, D-009).
5. A measurement's assumptions travel with the measurement (D-057, D-058).
6. Measured beats intended: reading the code is not running it
   (REALITY-FACTS-AUDIT close, D-053).

**Capture**
7. Fidelity beats coverage: if observing would change execution, do not
   observe, and disclose the hole (D-038).
8. Coverage is measured, never assumed — probe the world you will actually run
   in (D-023, D-040: test the exact invocation, check for evidence of success).
9. A fact must never report a failure LODESTAR caused (D-039).
10. Agent-controlled values may annotate, never suppress (D-041).
11. State facts do not ride on action events (D-047).

**Data**
12. Append-only, content-addressed, immutable; correction is a new object,
    never an edit (RECORD-SPEC, GRAPH-SPEC §1).
13. The schema outlives every feature; design it as if V2 exists (API-DESIGN,
    ARCHITECTURE §1).
14. Everything derived is a pure function of the object set; nothing derived is
    truth (GRAPH-SPEC; D-049, D-054: renderers render).
15. A type is a claim about the compiler, not about the bytes — validate at
    trust boundaries (D-053).
16. False-split over false-merge, in identity and everywhere: a visible split
    is one link to fix; a silent merge is a lie (F2).

**Product**
17. Local-first, offline-first, no account, code never leaves the machine —
    the wedge's physics, permanent (PRODUCT-SPEC §2; D-015).
18. Fail-open for recording, forever; fail-closed only for irreversible actions
    once gating has earned it (ARCHITECTURE §1a).
19. Capability ships on demonstrated need, never because a roadmap lists it
    (D-068 — this document included).
20. Spend human attention only where it changes an outcome; a system that asks
    about everything manufactures consent (VISION §3).
21. Autonomy is safe exactly to the degree that mistakes are reversible; the
    record makes reversibility knowable, so the record gates the autonomy
    (VISION §3, Layer 5).
22. Vendor-neutral by structure, not policy: no house agent, no vendor money
    steering the catalog, provenance on everything, trust judged by the
    consumer (WHAT-REMAINS §5; F5).
23. The refusals are the product: no "safe to merge," no trust scores, no
    summarize button, no surveillance views (WHY-NOT-DEPLOY §6; §4.4, §6.3
    above).
24. Graceful degradation everywhere: the agent runs even if recording fails;
    the report renders even if a payload is malformed — and every degradation
    is declared (ARCHITECTURE failure table; D-053).

---

## 16. The anti-roadmap

What this roadmap refuses at each rung, so scope drift needs a decision, not a
mood. Inherited from the V0 Do-Not-Build list and extended:

- **At V1:** no server until the sharing gate; no fourth query without an
  investigation; no AI summarization; no IDE extension before unprompted
  sharing exists; no auto-add in the session hot path.
- **At V2:** no RBAC/SSO/multi-tenant before privilege separation makes them
  honest; no displayed verdict before published quiet-proof; no "unforgeable"
  in any sentence, ever.
- **At V3:** no learned guidance with authority; no memory injection outside
  Direction's evidence bar; no knowledge feature that cannot cite.
- **At V4:** no policy without citation or declared a-priori status; no
  failure-corpus product without explicit revocable consent; no governance
  sold to an org whose developers didn't adopt the wedge (bottom-up is the
  ladder's physics).
- **At every rung:** nothing that requires trusting LODESTAR's goodwill — the
  company's own access to the org's evidence is governed by the same
  architecture it sells.

**The standing sentence** (`LODESTAR-VISION.md` §6): sell the ledger, build the
trust layer, and never confuse the two.

---

*End of roadmap. This document composes: VISION (why), PRODUCT-SPEC (V0),
THREAT-MODEL (what evidence is worth), ARCHITECTURE (the boundary),
RECORD-SPEC/GRAPH-SPEC (the formats), V1-DESIGN-REVIEW/V1-VALIDATION (the
graph), WHAT-REMAINS (what survives), DECISIONS D-001…D-070 (everything else).
Where it proposes rather than records — the D-007 resolution (§11), the
replatforming correction (§10), the gates as written — the proposal stands
until ratified in DECISIONS.md, which remains the only place decisions live.*



