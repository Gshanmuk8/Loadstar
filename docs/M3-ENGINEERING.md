# M3 — Engineering Design: sharing, the corpus, and investigation-driven discovery

> Cycle: restate → design → attack → implement → verify → document → stop.
> Mission: validate that the Evidence Graph is *practically* useful — and be honest
> about which validation a terminal can produce and which only live teams can.

## 1. Restatement

Three deliverables, in dependency order: (a) **one-command sharing** — the smallest
model that turns "my evidence" into "our evidence" with no server, no accounts, no
new trust claims; (b) a **realistic multi-developer corpus** built through the real
machinery, hard enough to stress every query; (c) **investigations** — scripted,
repeatable engineering questions run against that corpus, whose *failures* are the
only license to add queries. Graph Facts stay unbuilt (roadmap rule 5): no
investigation below demanded a precomputed pattern that a query does not already
answer.

**The honesty boundary, stated first:** this milestone can validate mechanics
(sharing works, queries answer real question shapes, the graph survives hostile
sync) by dogfood and simulation. It cannot validate the *sharing assumption* — that
real developers will push evidence unprompted — because simulated developers cannot
decline. The stop-report scores these separately; conflating them would be the
roadmap validating itself.

## 2. Design

### 2.1 Sharing — D-067

**Model: store union over dumb transports.** Objects are immutable and
content-addressed, so synchronization has no conflicts, no ordering, no protocol —
`sync` is set union executed as file copies. Two transports:

- **Path share**: the share target is just another graph directory (network share,
  Dropbox folder, USB stick). Pull copies remote objects absent locally — **each
  through `addRecordValue`, because verify-on-add is a store property and a shared
  folder is exactly where a tampered object arrives from**. Push copies local
  objects absent remotely, temp-then-rename on the remote side too.
- **Git transport**: the graph directory itself is a git clone; sync = `git pull`
  (add-only trees merge trivially), then the local collect, then
  `git add records/ && git commit && git push` (bounded retry on push rejection:
  pull, re-push, twice, then tell the human). Authentication is the user's existing
  git credentials — nothing built, per the milestone rules.

**One command end-to-end:** `lodestar graph sync` performs, in order — (1)
**collect**: if the working directory is inside a V0 project, build+add records for
every session (idempotent by construction, so it is free to run every time); (2)
**pull**; (3) **push**; then the next query self-heals the index (D-066). The loop
the review demanded: *work → `lodestar graph sync` → teammates have verifiable
evidence.* One command, offline-first: an unreachable share degrades to collect
with a stated warning and success exit — evidence capture must never depend on
connectivity.

**Share configuration is local, never shared.** The target lives in
`<graph>/local.json`, added to the graph's `.gitignore` at share time — every
teammate's remote differs, and a shared file naming one person's mount point would
be config masquerading as truth. `graph.json` stays a pure format marker.

**Never deletes.** Sync propagates additions only. Deletion (secret remediation)
remains a transport-level act (git history shows it; a dumb share cannot), exactly
as GRAPH-SPEC B1 already states — sync must not manufacture a deletion-propagation
protocol that would really be a distributed-consensus problem in disguise.

### 2.2 The corpus

Built by `corpus-fixture.ts` through the **real** production path — real
`SqliteEventStore.append` chains, real `buildRecord` — with scripted drafts, fixed
timestamps, and controlled identities (the one thing real recorder runs cannot
give: five machines and three weeks inside one test run). Shape: 3 repositories
(`acme/payments`, `acme/web` + a contractor fork, `acme/infra` renamed to
`acme/platform` mid-corpus), 4 developers on 5 machines (one dev on two), agents
`claude-code`, `codex`, `aider`, ~45 sessions over three simulated weeks, including:
a file three developers churn (contention), an incident arc (charge.mjs modified
after its last observed test run, then the fix), a foreign-generator re-analysis
with a partial catalog, an unclosed session, a shadowed-coverage machine, and one
machine that goes silent in week 3.

### 2.3 Investigations, and what they are allowed to change

Each investigation is a test: a question a team would actually ask, answered only
through public queries, asserting both the answer and its citations. **A question
the queries cannot answer is the only justification for a new query.** Outcome
(recorded before implementation, held to afterward): two gaps surfaced —
cross-repository "what happened this week / on this machine" (no per-repo query
composes this) and "which machines/agents/repos are we even seeing, since when,
until when" (the coverage map exists per-query but has no first-class view). Hence
exactly two new queries: **`timeline`** (cross-repo session stream with
`--machine/--agent/--since/--until` filters) and **`coverage`** (first/last-seen
per machine, agent, and repo, with degraded-session and unreadable-object counts).
Both cite, both carry the clock disclosure, and `coverage` deliberately renders
**no staleness judgment** — last-seen is evidence; "too quiet" needs an expected
cadence nobody declared (the coverage-expectation open question stays open).

Explicitly NOT built, and why: *repository evolution* (file-history + repo-history
already compose it; a dedicated query would be a dashboard wearing a query's
clothes), *integrity history* (D-065 keeps broken records out of the store, so
in-store integrity history is DEGRADED counts — now in `coverage`), per-query
`--agent` filters beyond timeline's (no investigation needed them), and Graph
Facts (every pattern the investigations surfaced was answerable by a query the
investigator composes; extraction would add judgment, not evidence).

## 3. Attack (pre-implementation)

- **Two writers push the same object to a path share concurrently** — identical
  bytes under the same name; the rename race is a duplicate-success on the remote
  exactly as it is locally. Different objects never collide by construction.
- **Hostile object planted in the share** — pull verifies each incoming object;
  refusals are reported per object with the checker's wording, the local store
  stays intact, and the hostile file stays where it was (sync never deletes,
  including remotely; the report names it every sync until someone removes it).
- **The share is not a graph** — refuse with a pointer to `graph share --create`.
  Never silently init a directory someone mistyped.
- **Push rejection loops under contention (git mode)** — bounded: pull+retry twice,
  then a human-readable failure that says nothing was lost and sync is safe to
  rerun. Idempotence makes retry-forever unnecessary.
- **Sync interrupted mid-copy** — temp+rename on both sides; a torn remote temp is
  reported by the remote's own verify as a stray, harmless.
- **Collect inside a project with a live session** — an unclosed session yields a
  DEGRADED record honestly; re-running sync after session end adds the completed
  record as a *new object* (different chainHead ⇒ different session key? No —
  same sessionId, longer chain ⇒ different chainHead AND different recordId; both
  records coexist and the session appears twice with different heads). **Found by
  this attack pass:** the session key `(sessionId, chainHead)` treats a
  mid-session snapshot and the final record as two sessions. Accepted for M3 with
  disclosure (the timeline shows both, reanalyses does not collapse them because
  the observation sets genuinely differ); the alternative — collapsing by
  sessionId alone — would hide that two records disagree about what the session
  contained. Documented as a limitation in D-067; the ergonomic fix (collect skips
  sessions without `session.end` unless `--include-open`) ships now to keep the
  common path clean.
- **machineId collision in the corpus** — corpus machines are distinct by
  construction; real-world 'unknown' collisions remain the documented weak-basis
  behavior (D-064).

## 4. Testing strategy

Sync: path-share round trip (A adds → sync → B syncs → identical query answers),
idempotent re-sync (all no-ops), hostile-remote refusal with intact local store,
not-a-graph refusal, offline soft-fail, interleaved bidirectional syncs from two
graphs, git-mode round trip on a real bare repo (guarded on git availability),
collect-skips-open-sessions. Corpus: deterministic build (two builds → identical
recordIds). Investigations: eleven questions, each asserting answers AND citations
resolve. Determinism: rebuild test extended to all six queries. Full gate + stress.

## 7. Stop-report (M3 complete) — the brutal review

**What survived.** Store union as the entire sharing model: no conflict case ever
materialized because none can exist — the strongest possible validation of
seal-and-collect. Verify-on-pull caught the planted hostile object exactly as
designed, with the local store intact and the intruder named. The corpus forced
every honesty mechanism to fire somewhere real: the rename split with its
one-link-away lineage candidate, the fork isolation, the foreign generator's RF-04
silence disclosed instead of read as clean, the open session visibly DEGRADED, the
quiet machine shown without being judged. Eleven investigations, eleven answers,
every citation resolving to a record that re-verifies. Rebuild determinism now
holds byte-for-byte across six queries over a 24-record corpus.

**What failed during the cycle (the attack log):**
1. *`git status --porcelain` collapses untracked directories* — the committed-ids
   parse saw `?? records/ab/` and shipped a commit reading "0 record(s)" while
   pushing one. Fixed with `--untracked-files=all`; found by the sync tests.
2. *My hostile-object test tampered nothing* — it edited a pass-exit to the value
   it already had, and the "forged" record verified because it WAS valid. The test
   then failed by refusing too little. A tamper test must assert its tamper.
3. *The git-transport test expected pull to deliver what the clone already had* —
   the model was right, the expectation wrong; recorded in the test body.
4. *Two rounds of layout gymnastics in the first git-test draft* proved the test
   was fighting the model (graph-in-subdirectory vs graph-as-clone-root). In git
   mode the clone root IS the graph root; the test now says so in one line.

**What this milestone validated — and what it cannot.** Validated, honestly:
the mechanics (one-command loop works end to end on path and git transports,
offline degrades correctly), the question shapes (real investigation forms are
answerable with citations), and organizational correctness under attack. **Not
validated, and unvalidatable from a terminal: the sharing assumption.** Simulated
developers cannot decline to run `sync`. The corpus proves the graph is *capable*
of being an organizational memory; only real teams can prove anyone wants one.
The next milestone must therefore be exposure, not construction: the WHAT-REMAINS
§7 gates (three teams syncing weekly, one external verification event) are now
reachable with shipped software and remain the standing kill-criteria.

**Assumption ledger after M3:** F2 merge defaults — still awaiting field corpora;
coverage expectations — still open (the corpus's quiet machine made the temptation
to judge concrete, and the refusal to judge without a declared cadence held);
sharing assumption — **now the single load-bearing unknown of the company.**

**Graph Facts:** still unbuilt, now with evidence for the restraint — eleven
investigations produced zero questions a fact catalog would have answered better
than a cited query. D-068 records this as a decision, not a deferral.
