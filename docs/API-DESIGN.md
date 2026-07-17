# LODESTAR V0 — API Design

> **Status:** source of truth for interface contracts.
> V0 has no network API and no server. "API" here means the four surfaces that
> outlive V0: the **CLI**, the **event schema**, the **adapter contract**, and the
> **report format**.

Two of these are effectively permanent. The event schema and the adapter contract are
consumed by every future layer and every future runtime; changing them later is
expensive in a way that changing a CLI flag is not. Design them as if V2 exists.

---

## 1. CLI Surface

The CLI is the product at V0. Every other surface is a client over the same record.

**Five V0 commands plus one V1 command. See `USER-FLOW.md` for every V0 terminal
output verbatim — that document is the source of truth for the UX; this one is the
contract. Each command past five cost a decision (D-012): `run` is the general form of
the agent wrapper (D-024), and `graph` is the V1 Evidence Graph (D-062; its contract
lives in `GRAPH-SPEC.md` and `V1-DESIGN.md` §11).**

| Command | Purpose |
|---------|---------|
| `lodestar init` | Detect project (language, package manager, git), detect available runtime, create `.lodestar/` |
| `lodestar <agent> [args...]` | Wrap and launch a runtime. `lodestar claude` is the wedge path. Sugar for `lodestar run <agent>` (D-024) |
| `lodestar run <agent> [args...]` | The general wrapper form — unknown agents fall back to ground-truth-only capture |
| `lodestar report [sessionId]` | Start the local server, open the browser, serve the dashboard. Defaults to the last session |
| `lodestar sessions` | List recorded sessions |
| `lodestar status` | Recording state, current session, event count, chain integrity |
| `lodestar graph <sub>` | The organizational Evidence Graph (V1, D-062): init · add · link · share · sync · verify · reindex · query |

**Deferred:** `doctor`, `config`, `export`, `search`, `verify`. See `USER-FLOW.md` §7
for why each waits, and `DECISIONS.md` D-012.

### Design rules

- **Wrapping must be transparent.** stdin, stdout, stderr, TTY behavior, signals, and
  exit codes pass through unchanged. The developer must notice nothing during a
  session. If LODESTAR changes how the agent feels to use, the wedge is dead.
- **LODESTAR must never break the agent.** If recording fails, the agent keeps
  running and LODESTAR degrades loudly in the report — never the reverse. V0 has no
  right to be in anyone's way; it has not earned it.
- **Exit code is the agent's exit code.** Always. Scripts wrap agents.
- **`report` does the work, not the user.** It starts the server, picks a free port
  (3000, incrementing if occupied), and opens the browser itself. The user never types
  a URL. "Port in use" is not an acceptable failure in the magic moment.
- **Chain integrity is always reachable.** A trust product must let you check its
  central claim yourself. It surfaces in `lodestar status` and the dashboard footer
  rather than a dedicated command — same guarantee, one less command. See
  `DECISIONS.md` D-016.

### Fallback behavior

`lodestar <unknown-agent>` still works: no adapter means no Tier 2 signal, so the
session is recorded from the ground-truth floor alone. Coverage is reported honestly
(§4). This is how cross-agent value exists at launch despite one adapter.

---

## 2. Event Schema

Canonical definition: `src/types/events.ts`. Rationale: `ARCHITECTURE.md` §4.

```ts
interface LodestarEvent {
  id: string
  sessionId: string
  seq: number                    // total order within session
  ts: string                     // ISO 8601, wall clock
  monotonicTs: number            // ns since session start — clock skew is real

  source: 'adapter' | 'fs' | 'process' | 'git' | 'stdio'
  signalTier: 'narration' | 'intent' | 'groundTruth'
  kind: EventKind
  actor: Actor

  target?: {
    raw: string                  // what the agent asked for
    resolved: string             // what the system will actually touch
    kind: 'file' | 'process' | 'url' | 'ref'
    inScope: boolean
  }

  // V2 signals — computed at V0, unused at V0, never migrated later
  effectClass?: 'read' | 'write' | 'execute' | 'network' | 'destroy'
  blastRadius?: 'file' | 'module' | 'repo' | 'service' | 'account'
  reversible?: boolean | null
  taint?: boolean
  missionId?: string

  payload: unknown               // discriminated by `kind`
  snapshotRef?: { before?: string; after?: string }

  prevHash: string
  hash: string
}
```

### Invariants

1. **Append-only.** No event is ever updated or deleted. `lodestar` has no code path
   that issues `UPDATE` or `DELETE` against `events`.
2. **`seq` is gapless** within a session. A gap means loss, and loss must be visible.
3. **`hash` = `H(prevHash || canonicalJSON(event minus hash))`.** Canonicalization must
   be stable across versions or old chains stop verifying.
4. **`signalTier` is set at collection**, never inferred later.
5. **Secrets are redacted before the event is constructed**, never at render.

### The rule this schema enforces

**Reality Facts query `signalTier === 'groundTruth'` only.** This is enforced at the
query layer, not by convention:

```ts
// The evaluator cannot see narration. By construction.
function factInputs(sessionId: string): LodestarEvent[] {
  return store.query({ sessionId, signalTier: 'groundTruth' })
}
```

A contributor cannot accidentally build a claim-parsing fact, because the narration
data is not reachable from that code path. Codifying the rule beats documenting it.

---

## 3. Adapter Contract

The runtime-independence boundary. **Adding a runtime must mean writing one small
adapter and changing nothing else.**

```ts
interface RuntimeAdapter {
  readonly id: string                     // 'claude-code'
  readonly displayName: string

  detect(): Promise<DetectResult>         // is this runtime available here?
  launch(argv: string[], ctx: SessionContext): Promise<AgentProcess>
  toEvents(raw: unknown): LodestarEvent[] // translate → normalized schema

  readonly capabilities: AdapterCapabilities
}

interface AdapterCapabilities {
  toolCalls: boolean          // can we see tool calls at all?
  resolvedTargets: boolean    // post-expansion targets, or just raw?
  mission: boolean            // can we capture the stated mission?
  stdio: boolean              // can we capture narration?
  preExecution: boolean       // can we see actions BEFORE they commit? (V2 gate)
}
```

### Why capabilities are declared, not assumed

Two reasons, both load-bearing.

**Honest coverage.** The UI reports what it did *not* independently verify. A trust
product with silent holes is worse than one with disclosed holes — the founding
Strategic Analysis names capture completeness as a real risk, and disclosure is the
mitigation.

**V2 readiness is a data question.** `preExecution` tells the future Gate layer which
runtimes it can actually enforce on. Without it, V2 discovers per-runtime enforcement
gaps at the worst possible moment.

### The rule

**No adapter may leak runtime-specific shape past `toEvents()`.** If storage, analysis,
or reporting ever imports a runtime-specific type, runtime independence is already
broken. Guard this in review.

---

## 4. Report Format

**Three renderings, one source.** All read the same record; none computes anything the
others don't. See `USER-FLOW.md` §5–6 for the user-facing versions.

### 4·0 The report model — the contract every renderer consumes

> **This section is the dashboard contract. Read it before writing any UI.** The model is
> `SessionReport` in `src/facts/report.ts`; that type is normative and this is its
> summary. See D-049.

`buildReport(store, sessionId): SessionReport | null` is the **only** entry point a
renderer may use. It reads the **ledger alone** — never the recorder's in-memory
`SessionSummary`, which can say things a later reader cannot check.

```
SessionReport
├── session          Session          number, runtimeId, mission, times, exitCode, cwd
├── identity         ReportIdentity   model, runtimeVersion, machineId, gitCommit
│                                     ← read from the session.start EVENT, not the
│                                       mutable sessions table (D-035)
├── closed           boolean          false = no session.end event: wrapper died, or
│                                     still running. Everything after the last event
│                                     is unobserved.
├── integrity
│   ├── status       VERIFIED | DEGRADED | BROKEN
│   ├── chain        VerifyResult     intact, eventsChecked, brokenAt?, reason?
│   └── degraded     string[]         why it is DEGRADED. Never empty when DEGRADED.
├── facts            RealityFact[]    RF-01…RF-07. Empty is a valid answer and means
│                                     "no divergence was OBSERVED" — never "all clear".
├── evidence         Record<eventId, EvidenceEvent>
│                                     every pointer in `facts`, pre-resolved to
│                                     { seq, ts, kind, source, target?, summary }
├── limitations      string[]         what the fact engine could not determine
├── interference     string[]         where LODESTAR itself changed the outcome (D-039)
├── coverage         CommandCoverage[]  per-command, as MEASURED at session start.
│                                     Empty = never probed.
├── recorderErrors   string[]         holes we know about, from the record itself
├── timeline         TimelineEntry[]  { eventId, seq, ts, kind, summary, cited, tier }
│                                     ← `tier` so narration is LABELLED as narration
├── changes          FileChange[]     per file: writes, deleted, inScope, and
│                                     `content` + `contentNote` — the model's verdict on
│                                     whether a diff exists and why not (see below)
├── git              GitView          commits, branch, head, and `dirtyAtEnd`:
│                                     `undefined` = UNKNOWN, `[]` = measured clean
└── counts           { events, commands, filesChanged }
```

Two companions, for renderers that show diffs and session lists:

```
buildIndex(store, limit?)         → SessionIndexRow[]   the session explorer
resolveDiff(change, snapshots)    → DiffView            { kind: 'text', before, after }
                                                      | { kind: 'unavailable', reason }
```

**`content` has six states, and a renderer must not collapse them** (D-054):

| State | Means |
|---|---|
| `available` | Both sides are there. Show the diff. |
| `withheld` | Credential-shaped path. Never read, by design (D-033). |
| `oversized` | Larger than the snapshot bound. |
| `binary` | No readable diff exists. |
| `never-captured` | We saw the change and could not read the file. **A real gap.** |
| `blob-missing` | A ref was recorded and the blob is gone. Expected — blobs are deletable by design (D-037) — and never the same as "unchanged". |

An empty pane for all six tells the user the one thing false in every case: that there was
nothing to see. `contentNote` carries the model's sentence; render it verbatim.

**The rules a renderer must not break:**

1. **The dashboard renders. It never computes.** Every judgment — which facts fired, what
   is degraded, what a timeline entry is called — is decided in `report.ts`. If a renderer
   needs an `if` about *meaning*, that `if` belongs in the model. Three renderers deciding
   independently is three different answers to the only question this product answers.
2. **`evidence` is pre-resolved.** A renderer looks up `evidence[pointer.eventId]` and
   never queries the store itself.
3. **`limitations` and `integrity.degraded` render together, unconditionally**, including
   — especially — when `facts` is empty. This is what stops an empty report from implying
   success.
4. **`VERIFIED` is earned, never assumed.** Any known gap demotes. A renderer must not
   invent a fourth state, soften `BROKEN`, or show a green line while `degraded` is
   non-empty.
5. **`summary` strings are already in the neutral voice.** Do not re-word them into
   judgments; that is the Reality Facts Rule leaking out through the view layer.
6. **Escape everything, at the boundary, always.** Facts contain filenames and command
   strings the *agent* chose, and the export is designed to be shared — so an unescaped
   report is stored XSS delivered by a trust tool to someone who opened the file *because*
   they trusted it. The hostile string still renders, visibly, as text: deleting it would
   be LODESTAR editing reality to look tidy.
7. **Presentation flags may not change judgments.** `mode: 'server' | 'export'` changes
   links. That is all it is allowed to change, and a test compares both renderings.

### 4a. Session-end terminal summary

Printed automatically when a wrapped session exits — the magic moment at zero
commands. Deliberately terse; **it is a pointer, not the report.**

```
LODESTAR  session #001  ·  claude-code  ·  18m 42s

  23 events recorded
  7 file(s) left uncommitted

  ▪ 2 Reality Fact(s) observed — see lodestar report

  Not observed: git

  Record integrity: ✓ verified

  lodestar report     see what actually happened
```

**The count only, and that is a decision.** This block used to be specified with each fact
rendered inline — which is a second renderer, and two renderers drift into two answers
(D-049). The summary says a fact exists and where to read it; `lodestar report` is the one
place facts are rendered.

> **Open question — D-018.** The founding Technical Blueprint specifies this
> auto-summary; the founder's user flow goes straight from session end to
> `lodestar report`. Both work. Cheap to build, easy to remove; ships behind a config
> flag (`sessionEndSummary`) until the founder rules.

### 4b. `lodestar report`

**Terminal today** (`src/cli/commands/report.ts`), browser next. Both are renderers over
`SessionReport` (§4·0); the terminal one shipped first because the fact engine had no
consumer at all and a dashboard on top of that gap would have been the most expensive way
to find out. See D-049.

Order is fixed, and every block prints unconditionally when it has content:

```
header (session, runtime, when, mission)  →  counts
Reality Facts (or "No divergences observed" + a pointer to the limitations)
Limitations           ← limitations + integrity.degraded, merged
LODESTAR interference ← when present (D-039)
VERIFIED | DEGRADED | BROKEN
```

Exit codes: `0` normally, `2` when the chain is `BROKEN` — anything scripting this must be
able to learn that without parsing prose — and `1` for no project / no session.

**Browser (not built).** Local server, opened automatically, same model: sessions,
timeline, diffs, commands, Reality Facts, search.

### 4c. Static HTML export

Written by the dashboard's Export button. **Fully self-contained — no server, no client
fetch.** A teammate who has installed nothing must be able to open the file.

**This is the growth loop, not a convenience feature.** The shared report is the
artifact that spreads: a teammate opens it, recognizes their own problem, and installs.
Treat its portability as a requirement. See `DECISIONS.md` D-014.

### Presentation rules

- **Reality Facts lead.** Top of both renderings.
- **Neutral voice.** State the observation. Never characterize the agent.
- **Every fact links to evidence.**
- **No facts is a valid, stated result** — "No divergences observed." Never
  manufacture concern to look useful.
- **Coverage is always shown**, including what was not verified.
- **No shadow-mode risk indicators.** Computed, stored, never rendered. See
  `DECISIONS.md` D-005.

---

## 5. Storage Interface

Kept behind an interface so V1's shared backend is an implementation, not a rewrite.
This is the seam where the local-first tool becomes a team product.

```ts
interface EventStore {
  append(event: Omit<LodestarEvent, 'hash' | 'prevHash' | 'seq'>): Promise<LodestarEvent>
  query(filter: EventFilter): Promise<LodestarEvent[]>
  verify(sessionId: string): Promise<VerifyResult>
  // no update(). no delete(). by design.
}
```

The absence of `update` and `delete` is the interface's most important feature. An
append-only store whose interface admits mutation is append-only by convention only,
and convention is not what a tamper-evident record is sold on.

> **V1 note.** The hardest problem in V1 is syncing tamper-evident logs from many
> machines into a shared store **without breaking the tamper-evidence guarantee** —
> the chain must remain verifiable after merge. That constraint belongs in the design
> of this interface now, not discovered later.
