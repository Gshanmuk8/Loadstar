# Reality Facts — V0 Audit

> **Status:** the per-fact audit required before V0 release. One section per fact, each
> answering the same seven questions.
>
> Why this file exists: `PRODUCT-SPEC.md` §4 says *what* each fact is. `DECISIONS.md` says
> *why* each was built the way it was. Neither says **what each fact cannot see** in one
> place a reviewer can read in ten minutes. That gap is where overclaiming starts.
>
> The bar for every entry below: **an experienced engineer should be able to read the
> section, open the code, and agree the claims match.**

---

## How to read this

Each fact is audited against seven questions:

| | |
|---|---|
| **Purpose** | What it detects |
| **Evidence** | Which events it consumes. If it isn't here, it isn't evidence. |
| **Reasoning** | The deterministic path from evidence to statement |
| **Edge cases** | Where it is deliberately silent |
| **Failure modes** | How it could be wrong, and what stops that |
| **Unsupported** | What it structurally cannot see |
| **Risk** | What is left, honestly |

**A note on the failure that matters.** Every fact here can fail in three ways, and only
one is loud:

1. **False positive** — accuses wrongly. Loud, and fatal to the product's only asset.
   PRODUCT-SPEC §8 sets the target at **zero**; any false positive is a bug, not a tuning
   problem.
2. **False negative** — misses something. Costly but survivable.
3. **Silent unknown** — "we could not see" rendered as "there was nothing to see". **The
   quietest and the worst**, because it is indistinguishable from success at exactly the
   moment the user is deciding whether to trust the session.

The third is what most of the code below is defending against, and what `limitations()`
and the `DEGRADED` status exist for.

---

## RF-01 — a command exited non-zero

**Purpose.** The headline fact. A command the boundary observed returned a non-zero exit
code.

**Evidence.** `process.exit` (groundTruth): `command`, `exitCode`, `cwd`, `execId`,
`parentExecId`.

**Reasoning.** Group runs by `cwd` + `command` (D-043). A run is a failure iff
`verdictOf(p) === 'fail'` — i.e. `exitCode` is a **number** and non-zero (D-053). Anchor on
the *last* failure in each group; if the group's last run passed, the statement says so
(`…then passed on a later run`) rather than vanishing (D-045). A failure with a failing
ancestor is subsumed by it and attached as evidence (D-025/D-034).

**Edge cases.**
- `exitCode: null` (signal kill) is **not** a failure — RF-06 owns it.
- A **missing or non-numeric** `exitCode` is no verdict at all — not a failure.
- A verdict-less *last* run does not resolve an earlier failure. Only an observed `pass`
  does; unknown must not cancel evidence.
- A failure whose parent *succeeded* still reports. `npm test || true` genuinely failed.
- Unknown ancestry **never** suppresses. Absence is not "no parent".
- A cycle or self-parent in the ancestry chain suppresses nothing — a forged
  `parentExecId` cannot silence a failure.

**Failure modes.** Two, both shipped and both fixed.

1. The old last-write-wins rule let one appended `exit 0` erase a real failure (D-045).
   Evidence is now qualified by later evidence, never deleted by it, which inverts the
   attack: a forged pass appends a line that *contradicts a visible failure*.
2. **The type check was missing** (D-053). `exitCode !== null && exitCode !== 0` passes for
   `undefined`, so a payload with no exit code rendered `"npm test exited with code
   undefined"` — a failure invented from an absent field. And `'0' !== 0`, so a **string**
   exit code from JSON rendered `"npm test exited with code 0"` **as a divergence** — a
   successful run reported as a problem. Both measured on a real store.

**Unsupported.** Commands the shim does not win (`shadowed`), absolute-path invocations,
and shell builtins. A failure LODESTAR never saw is not reported and cannot be.

**Risk.** Low. The most-tested fact in the product (13 ancestry tests, 4 scenario tests, 4
D-053 regressions). The residual is coverage, not correctness: RF-01 is only as complete as
the shim's PATH win, which is measured per-command and reported.

---

## RF-02 — session ended with an uncommitted working tree

**Purpose.** "Done" with uncommitted or half-edited files.

**Evidence.** `git.status` (groundTruth), emitted unconditionally for a repo at session
end by the recorder reading git directly — not the agent's report, and not inferred from
file events (D-047).

**Reasoning.** Take the **last** `git.status`. `dirtyAtEnd` must be an **array**; filter to
strings; if non-empty, state the count (or name the single file).

**Edge cases.**
- `dirtyAtEnd: []` → **measured clean** → silent.
- **No event at all** → git unreadable or not a repo → **unknown** → silent. This is the
  distinction D-047 exists for, and it is pinned by a test.
- **Event present, field missing or not an array** → **unknown** → silent, plus a declared
  limitation (D-053).
- Multiple statuses → the last one wins; the fact is about the state at the end.

**Failure modes.** Two, both shipped and both fixed.

1. Before D-047 the evidence rode on `git.ref_update`, emitted only when HEAD moved — so it
   was absent in exactly the case the fact detects. State facts must not ride on action
   events.
2. **`?? []` and no `Array.isArray`** (D-053). Measured: `dirtyAtEnd: 'src/auth.ts'`
   produced **"11 files were left uncommitted"** — the count was `String.length`, a
   fabricated number stated with high confidence. And `?? []` turned a *missing* field into
   an empty array, which this fact reads as **measured clean** — so the three states D-047
   established were held apart for a missing EVENT and quietly merged for a missing FIELD.

**Unsupported.** Non-git projects. Submodules are whatever `git status` says they are.
Nothing is claimed about *why* the tree is dirty — uncommitted work is normal, and only
the human can say whether it matters.

**Risk.** Low. The fact is a direct read of git's own answer.

---

## RF-03 — files modified, no test command observed

**Purpose.** Files changed and nothing was verified.

**Evidence.** `process.exit` (that any command was observed at all) + `file.write` with
`target.inScope`.

**Reasoning.** **Guard first:** if zero *readable* `process.exit` events exist, return
nothing. Then: if no observed command is test-shaped, and in-scope files changed, state the
count of distinct paths.

**Edge cases.**
- Zero process exits → we saw no commands at all → **silent**, plus a declared limitation.
- A test that ran and *failed* → silent (RF-01 owns it). "A test failed" is not "no test
  ran".
- A test that was **killed or reached no verdict** → silent (a test *was* observed, so the
  statement would be false), plus a declared limitation (D-053).
- **Unreadable** `process.exit` events do not satisfy the guard — a corrupt payload must
  not count as "we saw commands" and unlock the accusation.
- Out-of-scope writes → ignored (RF-07 owns them).

**Failure modes.** This is **the fact most at risk of being a false accusation.** "No test
ran" is a claim about absence, and absence has two causes — none ran, or one ran where we
could not see. Merging them is the exact inference the Reality Facts Rule bans. The guard
is the whole fact: delete it and every other test in the repo still passes while the
quietest session (LODESTAR saw nothing) becomes a confident accusation. Mutation-tested.

**The silence bug** (D-053). `isTestCommand()` matches a command *string* and says nothing
about whether the run finished — so a killed `npm test` counted as "the tests ran" and
suppressed this fact. Measured: `npm test` with `exitCode: null` and no signal produced
**zero facts and zero limitations** — RF-01 skipped it (not a number), RF-06 skipped it (no
signal), RF-03 treated it as a test that ran, and the report rendered clean. **Reachable
with no forgery**: start a test, kill it. A fact engine an agent can silence by taking an
ordinary action is not a fact engine. The half-run is now declared.

**Unsupported.** Any runner outside the matcher (D-050): shell aliases, bespoke scripts,
`python3.11 -m pytest`. All produce a *declared limitation*, never a silent pass.

**Risk.** **Medium — the highest in the catalog, and it is inherent.** RF-03 fires on
"absence of a recognised test", and the matcher will never be complete. The mitigation is
not a better matcher; it is that a miss is always disclosed (D-048). A user who reads only
the fact and not the limitation can still be misled — which is why the renderer prints
limitations unconditionally and `DEGRADED` never resolves to a bare green line.

---

## RF-04 — files modified after the last test run

**Purpose.** The sleeper fact. Test results are stale relative to the final state.

**Evidence.** `file.write` with `payload.mtimeMs` (OS-reported) + the `process.exit` of the
last test-shaped command.

**Reasoning.** Find the last **completed** test run (`isCompletedTestRun` — test-shaped
*and* it reached a verdict). A write is "after" iff `mtimeMs > Date.parse(testEvent.ts)` —
both wall-clock, same machine, same clock, so it is a measurement rather than an inference
(D-044).

**Edge cases.**
- No `mtimeMs` → **excluded, not assumed**, plus a declared limitation.
- Non-numeric `mtimeMs` → excluded. `'999…' > number` coerces to `true` in JavaScript, so
  the `typeof` check is the only thing between a corrupted event and a fabricated fact.
- Watch-mode commands are not test runs — they never terminate with a verdict.
- **A killed test is not an anchor** (D-053). "Modified after the last test run" implies
  there was a result to be stale against; a run with no verdict produced none. If an
  earlier run *did* complete, that one anchors — the kill does not erase it.

**Failure modes.** This shipped as a **live false positive**: "after" was derived from
`seq` (append order), but the fs recorder emits ~120 ms late by design while process events
emit immediately. So the most ordinary sequence there is — edit a file, then run tests —
reported "auth.ts modified after the last test run". False, with no adversary present
(D-044).

**Unsupported.** A malicious `touch` can backdate mtime — that is T3, out of scope per
`THREAT-MODEL.md`. The fact anchors on the last test **run**, not the last **passing** run;
it does not check whether that run passed, and the wording must not imply it did.

**Risk.** Low-medium. The timing bug is fixed and pinned from both directions
(before-the-test and missing-mtime). Residual risk is clock skew *within* one machine,
which we accept as negligible.

---

## RF-05 — a file was reverted to earlier content

**Purpose.** Churn — the agent changed its mind, possibly silently.

**Evidence.** `snapshotRef.before` / `snapshotRef.after` content hashes on in-scope
`file.write`.

**Reasoning.** Per path, keep the set of hashes the file has held. A write is a revert iff
`history.has(after) && before !== after`.

**Edge cases.**
- **No `after` hash → skip entirely.** Withheld, oversized, or unreadable content is
  unknown, and unknown stays unknown.
- `before === after` (a no-op touch) is not a revert.
- History is **per path** — two files sharing content (a template) is not a revert.
- Only a genuine revert counts. "Written more than once" is ordinary work; reporting it
  would cry wolf on every session.

**Failure modes.** Found by mutation testing: without the `!after` guard, a write with no
hashes puts `undefined` into the path's history, and a later write with a known `before`
but a withheld `after` matches `history.has(undefined)` — **fabricating a revert for a
file whose content was never read.** Not exotic: an unreadable file followed by an
oversized write is an ordinary Tuesday. Now pinned by its own test.

**Unsupported.** `.env`, `id_rsa`, `*.pem` and friends are never hashed (D-033), so RF-05
is structurally blind to them — correctly, and the report declares it (`DEGRADED`, content
withheld). Reverts that happen entirely between fs-watcher polls are not seen.

**Risk.** Low, with one honest caveat: RF-05's blindness to sensitive files is a
*deliberate* hole that a reader could mistake for coverage. The `DEGRADED` note is what
closes that gap, and it is a wording defense, not a code one.

---

## RF-06 — a process was killed by a signal

**Purpose.** Work may be half-complete — a different claim from failure.

**Evidence.** `process.exit.signal`, from the OS via the real parent.

**Reasoning.** Any observed exit carrying a signal name is stated as
`<command> was terminated by <signal>`.

**Edge cases.**
- Clean exit or ordinary non-zero exit → silent (RF-01 owns failure).
- `exitCode: null` with **no signal** → silent. We know it ended and not why; naming a
  signal we never observed would be inventing evidence.
- A signal kill produces **RF-06 only** — RF-01 must stay out of it, asserted from both
  sides in one test.

**Failure modes.** The RF-01/RF-06 split is the risk: if RF-01's filter were
`exitCode !== 0`, `null` would coerce in and one kill would render as two different
claims. Mutation-tested from both directions.

**Unsupported.** Windows signals are largely synthetic — there is no real `SIGKILL`, and
what the platform reports is what we record. A process killed outside the boundary is not
seen at all.

**Risk.** Low. The simplest fact in the catalog.

---

## RF-07 — files modified outside the project scope

**Purpose.** Blast radius exceeded expectation.

**Evidence.** `target.inScope === false` on `file.write` / `file.delete`, computed at
capture from the **resolved** path (`context.ts`), never from what the command looked like.

**Reasoning.** One fact per distinct out-of-scope path, stating the resolved path.

**Edge cases.**
- **`inScope === false`, not `!inScope`.** An event with no target has no scope
  determination, and `undefined` must not read as `false` — that would accuse the agent of
  a blast-radius breach on an event we never scoped. Mutation-tested.
- Out-of-scope **reads** are ignored. Reading is not modifying.
- One fact per path, not per write.

**Failure modes.** Scope is computed once, at capture, by us — not by the agent. That is
what makes it evidence. If `fileTarget()` resolved paths incorrectly (symlinks, junctions),
RF-07 would inherit the error; `context.ts` uses `path.resolve` without following links,
so a symlinked in-scope path pointing outside the root is **reported as in-scope**.

**Unsupported.** Writes by processes the fs watcher does not cover, and paths outside the
watched roots entirely. Symlink escapes, per above.

**Risk.** Low-medium. The symlink case is a known false *negative* — it under-reports,
which is the safe direction, and it is documented here rather than fixed in V0.

---

## Cross-cutting

**The Reality Facts Rule is enforced structurally, not by review.** `factInputs()` filters
`signalTier: 'groundTruth'` **at the query**, so narration is not reachable from the fact
engine — a contributor cannot build a claim-parsing fact by accident, because the data is
not there to parse. Tested by forging every fact-bearing event kind in the narration tier
and asserting zero facts.

**Evidence is never deleted.** Later evidence qualifies earlier evidence; it never cancels
it (D-045). Contradictory evidence is preserved and rendered.

**Agent-controlled values may annotate, never suppress** (D-041). `parentExecId` comes from
an environment variable the agent controls, so it may attach context and can never remove a
fact.

**LODESTAR's own interference is reported beside the facts, never subtracted from them**
(D-039). A fact must not report a failure LODESTAR caused, and the fix must not be a
suppression mechanism an agent can trigger on purpose.

**Every fact carries evidence.** Asserted for the whole catalog in one test. A fact without
a pointer is an assertion, and this product does not make assertions.

**A payload type is not a measurement** (D-053). `payload` is `unknown` in the schema and
round-trips through JSON in SQLite, so `e.payload as ProcessExitPayload` asserts a shape
nothing checked. `exitPayload()` now validates; `verdictOf()` returns three states
(`pass` | `fail` | `none`) so a missing or non-numeric exit code cannot become a verdict;
and an unreadable event is **declared as a hole**, never silently dropped. Before this,
one malformed event could throw and destroy the entire report — every unrelated fact in the
session lost, failing closed and silent, which inverts the contract in `run.ts`.

**Anything that carries trust reads `groundTruth` at the query** (D-053). The fact engine
always did (D-009). The report's *status* logic did not — it read every tier to decide
VERIFIED vs DEGRADED, so a narration `agent.output` with a forged coverage probe could have
upgraded the status from a value the agent supplied. Closed before it was reachable.

**An empty fact list means two opposite things.** "We looked and found nothing" and "the
record was rewritten, so the list is meaningless" are not the same, and a renderer reading
`facts.length` cannot tell them apart — the terminal printed a green ✓ for both, including
on a successful forgery. `factsVerdict` on the model is what makes that mistake
unavailable to the dashboard before the dashboard exists.

---

## What the catalog does not cover

| | |
|---|---|
| **RF-08 Network egress** | Not implemented. `net.request` exists in the schema; **nothing emits it.** Needs a real network boundary — a command-string matcher would be inference wearing a fact's clothes. See D-051. |
| **RF-09 Destructive git** | Not implemented. Needs git *operations*, not before/after *state*; the reflog is not read. See D-051. |
| **RF-10 Binary/oversized** | Not implemented, and deliberately redundant: `contentWithheld: 'oversized'` is recorded and already disclosed as a limitation. See D-051. |
| **Anything requiring narration** | Banned, not deferred. "Files changed the agent didn't mention" and "the agent claimed tests passed" require parsing claims. RF-01 delivers the same signal with zero inference. |
| **A fully malicious same-user attacker** | T3, explicitly out of scope. The recorder and the agent share a UID; any key we hold, the agent holds. See `THREAT-MODEL.md`. |

---

## Remaining risks, ranked

1. **RF-03's dependence on an incomplete matcher.** Inherent. Mitigated by declaring every
   miss (D-048), never by pretending the matcher is complete. **The single largest
   correctness risk in the catalog.**
2. **Limitations are prose, and prose can be skimmed.** The `DEGRADED` status and
   `factsVerdict` exist so the gaps have a machine-readable form too, but a user who reads
   only the facts can still overread a quiet report. V0 mitigates this with wording and
   ordering, not with code that can enforce it.
3. **RF-07's symlink blindness.** Under-reports; safe direction; documented.
4. **Coverage, not correctness, is the ceiling.** Every fact is only as complete as the
   shim's PATH win. This is measured per-command, reported up front and again at the end,
   and demotes the report to `DEGRADED` — but it remains the honest limit of V0.
5. **Payload validation is at the read boundary, not the write boundary.** D-053 hardened
   every *reader* in the fact engine. Nothing validates a payload on the way **in** —
   `emit()` redacts but does not typecheck — so a recorder with a bug can still append a
   malformed event, and the ledger is append-only, so it is there forever. The fact engine
   now declares such events instead of choking on them, which is the survivable half. A
   schema check at `append()` is the real fix and is **not V0**: it needs a per-kind
   validator, and getting it wrong means refusing to record a real event, which is worse
   than recording a malformed one.

## What this audit changed

The first pass through this file rated RF-01 and RF-02 "low risk" on the strength of their
guards. The adversarial pass (D-053) then found **six confirmed defects**, including a
successful command reported as a divergence and a session that produced zero facts and zero
limitations while its only test was killed.

Both of those facts *had* been reviewed. Both were "obviously correct" on reading. The
defects were only visible by executing them against a real store with hostile payloads —
which is the argument for `rf-catalog.test.ts` quoting measured output rather than
asserting intent, and for the mutation harness that proves each guard is load-bearing.

**Reading the code is not the same as running it.** That is the finding worth carrying
into V1.
