# M2 — Engineering Design: store completion, identity hardening, three queries

> Cycle: restate → design → attack → implement → verify → document → stop.
> Architecture frozen (D-062); this designs implementation inside it. The M-V review
> (the "skeptical progress review") found three honesty defects — this milestone
> fixes them BEFORE adding capability, because a trust product carrying known
> silent-wrongness has no business growing.

## 1. Restatement

**What:** (a) complete the store: stray-file detection, ingestion size bound,
query-time staleness self-healing, and a *decided* stance on broken-session records;
(b) harden identity: root-conflict surfacing plus four new adversarial vectors;
(c) exactly three queries — `repo-history`, `file-history`, `divergences` — with
citations, coverage, generator provenance, and catalog conditioning. Nothing else:
no Graph Facts catalog, no links, no server, no dashboard.

**Why:** these are the parts that prove the graph deserves to exist — correct
answers to real engineering questions, honestly bounded. Everything here consumes
Evidence Records through the store; nothing invents truth.

## 2. Design decisions (the load-bearing ones)

### 2.1 Broken-session records are refused, deliberately — D-065

A record honestly sealing a tampered session (`status: BROKEN`, recordId recomputes,
chain break matches its own statement) fails verification and is refused by `add`.
The review called this a defect; the attack pass concludes it is the correct
conservative stance **at V1**: under the Same-UID Ceiling, an honestly-broken record
and a *forged* record whose events were edited and whose status was restated as
BROKEN are **byte-indistinguishable** — no signature exists to separate the sealer
from the editor. Admitting the class would let an attacker (a) manufacture verifying
"evidence of tampering" against any target and (b) launder edited events behind a
self-consistent BROKEN claim. Refusing when we cannot distinguish is F2's failure
direction applied to trust itself. The refusal is now *explained at the point of
refusal* (the add output names D-065 when a record states BROKEN consistently),
documented here, and scheduled for revisit when V2 signatures make sealer identity
checkable. What was actually wrong was the silence, and the silence is fixed.

### 2.2 The index self-heals; freshness is checked before every query — D-066

M-V's worst bug (E1): after a `git pull`, queries answered from a stale index with
full confidence. Fix: the object-file count is stored in index meta at reindex; every
query first compares it against a fresh count (cheap directory walk) and **rebuilds
automatically** on mismatch, missing index, or index schema version change. Reports
stay byte-deterministic because freshness is never *in* the report — the CLI checks
`indexFreshness()` separately to print "index was stale — rebuilt." Known residual,
stated: a same-count byte-swap escapes the counter; that is `graph verify`'s job, and
the staleness check never claims otherwise. Corollary: a corrupted or deleted index
is not an error state anywhere — every query path recovers by construction.

### 2.3 Primary record per session — D-066

Re-analysis (F6) means one session may have several records. Session-level rows
(repo-history, divergences) and event-level rows (file-history) must not
double-count, so each session key elects a **primary record**: the lexicographic
maximum of `(generatorName, generatorVersion, recordId)`. Arbitrary tiebreak,
deterministic, and *disclosed* — rows carry `reanalyses: n` when alternatives exist.
Rejected: semver comparison (guesswork across unknown generators), "latest added"
(not derivable from objects — would break rebuild determinism).

### 2.4 File identity within a repo — D-066

`file-history` matches on the **repo-relative path** with forward slashes, computed
at index time from `target.resolved` minus the session's `cwd` (the same rule the
report's displayPath uses), stored per event alongside the absolute path.
Cross-machine sessions of one repo therefore join on `src/pay.ts` regardless of
`C:\work\payments` vs `/home/a/payments`. Case is preserved (false-split direction);
out-of-scope events keep only absolute paths and are excluded from rel-path matches
(a `../../.bashrc` must never look repo-local — RF-07's reasoning). Occurrence time
per D-044: `mtimeMs` when present, event `ts` otherwise, and the column says which.

### 2.5 Root-conflict surfacing

The origin rule merges everything sharing an origin URL — including a URL *reused*
for a different repository (deleted and recreated, or mis-set remote). Detectable,
derived signal: a group where two or more members carry roots but **no root is
shared by any pair of root-bearing members** gets `rootConflict: true` and a printed
note. Never auto-split (the origin claim is real evidence too); a declared
`identity:distinct-repos` link (M4) is the correction path. Vector-pinned.

### 2.6 Ingestion bound

`add` refuses inputs over 64 MiB before parsing (files by `stat`, values by
serialized length). A record is a session's *events*, not its blobs; nothing
legitimate approaches this bound (typical records are tens of KB), and an unbounded
`JSON.parse` on a hostile path is a free DoS. The bound is a binding property
(GRAPH-SPEC Part B), not a format property.

### 2.7 Catalog conditioning in `divergences`

Facts are reported per record with the generator that computed them; the report
carries a `catalogs` section (generator → fact ids evaluated), and an `--rf` filter
adds an explicit disclosure counting sessions whose generator never evaluated that
fact — their silence is not absence (D-048 at graph scale, F5's provenance rule).

## 3. Attack (pre-implementation)

- *Staleness check races an in-progress sync* (count taken mid-pull): the rebuild is
  itself derived-from-whatever-is-present and the next query heals again — eventual
  consistency over objects, never wrongness about present objects. Accepted, stated.
- *Auto-rebuild cost surprise* at scale: O(store) on first query after sync. At M2
  scale, milliseconds; the incremental path (same contract) is named future work.
  Rejected alternative: warn-but-answer-stale — an honest-looking wrong answer is
  the exact failure this milestone exists to remove.
- *Primary-election flip*: a later-added re-analysis can change the primary and thus
  query rows. Correct and visible (`reanalyses` changes too); determinism is over
  the object set, not over time.
- *Rel-path prefix mismatch* when `cwd` recorded with a trailing separator or
  different case-drive (`C:` vs `c:`): normalize the prefix comparison per-session
  the same way displayPath does; a failed prefix on an in-scope event falls back to
  `payload.path` relative heuristics — no: **falls back to exclusion with the
  absolute path kept**, because a guessed rel-path is a fabricated join. Counted.
- *Hostile strings* in paths/statements flow into `--json` (safe, JSON-escaped) and
  terminal lines (same exposure as V0's report — accepted there, accepted here).
- *`repos` arg resolution ambiguity*: a signal matching two groups is impossible by
  construction (a signal in two groups would have merged them — except non-origin
  shared remotes, which don't merge!). So arg resolution must handle multi-match:
  refuse with both names listed, never pick. Found by this attack pass; designed in.

## 4. Testing strategy

New identity vectors (rewrite, conflicting-roots flag, shallow clone, origin-change
bridge). Query tests: cross-machine rel-path join, session dedupe with re-analysis,
catalog disclosure under mixed generators, empty-history honesty. Determinism:
reindex ×2 → byte-identical `--json` for **all four** queries. Self-healing: delete
index → query works; corrupt index file → query works; add-out-of-band (file copied
in, simulating `git pull`) → query heals and counts it. Store: stray top-level file
detected; oversized add refused; broken-session refusal carries the D-065 note.
CLI-level: flag positions, exit codes, stale-index note — the layer M-V left bare.

## 7. Stop-report (M2 complete)

**What held.** All of §2 as designed: the three review defects are fixed and
decision-logged (D-065 broken-session refusal now explains itself; D-066
self-healing index; stray files surfaced), the ingestion bound landed, root
conflicts surface with a vector pinning the monorepo non-flag case, and the three
queries answer the incident questions on the real demo corpus with event-level
citations, provenance, clock disclosure, and coverage on every output. Rebuild
determinism now spans all four queries byte-for-byte. 454 tests; RECORD-SPEC
vectors untouched; stress green.

**What failed and was fixed during the cycle (the attack log):**
1. *My own §3 attack rule was wrong.* "Two matches never pick one" made the single
   most common query ambiguous the moment any fork carried the main repo as
   `upstream`. The test caught the design, not the code. Replaced with two-tier
   signal-strength resolution (D-066 §4); same-strength ties still refuse.
2. *Fixture arithmetic.* Four query tests initially encoded the wrong write count
   for the golden session (3 vs 2 writes to payments.mjs) — the tests were wrong,
   the code was right; worth recording because the failure mode (trusting the test
   author's memory over the fixture) is exactly what golden fixtures exist to
   prevent. Verified against the drafts before changing expectations.
3. *An M-V test pinned the behavior M2 deliberately removed* ("no index → throw").
   Updated to pin the new contract, with the reasoning in the test body — a
   contract change must read as a decision, not a flake fix.
4. *The repo's own D-052 gate failed the build* until D-065/D-066 existed in
   DECISIONS.md — the discipline policing its author, working as designed.

**What surprised.** The self-healing index made the empty-graph and virgin-graph
paths *simpler* than the error paths they replaced — honesty and convenience landed
on the same side for once. And the demo corpus, queried with `divergences`, cites
the exact post-test edit (#7) that the demo narrative is about — the graph
independently rediscovers V0's flagship story from sealed evidence.

**Assumptions carried.** F2 merge defaults and the sharing assumption remain
untested by construction (open questions #1, #6 — unchanged). The next milestone
per the review's priorities is one-command sharing plus real-team exposure, NOT
Graph Facts — the query layer now exists to be judged by users, and building GF-01
before anyone has run `divergences` in anger would be the roadmap-ahead-of-evidence
failure the review named.
