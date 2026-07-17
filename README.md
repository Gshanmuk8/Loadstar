# LODESTAR

**Know what your AI actually did.**

Your agent says "done." LODESTAR tells you what actually happened.

---

## The problem

An AI coding agent works for fifteen minutes, edits fourteen files, runs a migration,
and reports:

> Authentication completed successfully.

You have no independent way to check that. The agent's account of itself is drawn from
the same fallible context that produced the work — and when you close the terminal, even
that is gone. Ask it next Tuesday what it changed in the auth module and it has no idea.
Its memory is conversational, not historical.

LODESTAR watches from outside the agent and records what actually hit the disk:

```
  Reality Facts (2)

  ▪ Code changed after testing
    payments.mjs modified after the last test run

      ✓ npm test exited with code 0  10:51:13 pm
      ✓ wrote src/payments.mjs  10:51:14 pm
      ⚠ No test run was observed after this change.

    RF-04 · confidence: high · Today 10:51 PM
      └ #7 wrote src/payments.mjs
      └ #6 npm test exited with code 0
```

No accusations. No AI judgement. Just facts you can check.

> That block is copied from real output, and the wording is the product.
>
> Note what it does **not** say. Not *"untested code"* — LODESTAR knows no test ran after
> the change **that it could observe**, and on that machine `git` was shadowed on PATH.
> "Untested" is a conclusion about coverage; "no test run was observed" is the
> measurement. Not *"the agent lied"* either — it didn't. Its summary was true about a
> codebase that no longer existed ([D-056](docs/DECISIONS.md)).
>
> An earlier README rendered these as *"Tests failed after implementation"* and *"modified
> after last passing test"* — neither of which the code says, and both of which claim more
> than it knows. A README that improves on the code's wording is describing a product that
> does not exist.

## Why an agent can't do this for itself

The actor and the auditor should not be the same system — the same reason a flight
recorder isn't built by the pilot. A "summarize" button is the agent reporting on
itself, which is the exact thing worth distrusting. And no agent vendor will ever unify
visibility across its competitors, so nothing but an outside observer can answer *"what
touched this file this week, by any agent?"*

## Status

**Pre-alpha.** The recording engine, the Reality Facts layer, and the report — terminal,
browser, and shareable file — work end to end, and `node demo/run.mjs` shows the whole
thing on a real project in 30 seconds. What remains is onboarding polish.

| Phase | | |
|---|---|---|
| 0 | Skeleton | ✅ |
| 1 | CLI foundation | ✅ |
| 2 | `lodestar init` | ✅ |
| 3 | Event schema | ✅ |
| 4 | Storage (append-only, hash-chained) | ✅ |
| 5 | Recorders (process, filesystem, git) | ✅ |
| 6 | Execution boundary wrapper | ✅ |
| 7 | Session management | ✅ |
| 8 | Reality Facts engine | ✅ RF-01 – RF-07 ([RF-08/09/10 deferred](docs/DECISIONS.md)) |
| — | Trust boundary honesty layer | ✅ [`THREAT-MODEL.md`](docs/THREAT-MODEL.md) |
| 9 | `lodestar report` — terminal | ✅ |
| 9b | `lodestar report` — browser dashboard | ✅ timeline, facts, changes + diffs, git, verification, sessions |
| 9c | Static HTML export | ✅ `lodestar report --html` |
| 9d | Demo scaffold + landing page | ✅ [`demo/`](demo/README.md), [`site/`](site/index.html) |
| 9e | Evidence Record — canonical, content-addressed, verifiable | ✅ `lodestar report --record`, [`RECORD-SPEC.md`](docs/RECORD-SPEC.md), golden vectors, standalone verifier |
| 10 | Polish | ◐ onboarding |
| V1·M-V | Evidence Graph validation spike — store, identity resolution, `repos` query | ✅ `lodestar graph`, [`GRAPH-SPEC.md`](docs/GRAPH-SPEC.md), identity vectors, git-syncable |
| V1·M2 | Store completion + three queries — `repo-history`, `file-history`, `divergences` | ✅ self-healing index, cited answers, catalog conditioning, root-conflict surfacing |
| V1·M3 | One-command sharing + the corpus + investigation-discovered queries | ✅ `graph share`/`sync` (path + git), 24-record multi-dev corpus, `timeline`, `coverage`, 11 investigations |
| V1·M4 | The Link object — the declared layer, identity correction, retraction | ✅ `graph link`/`query links`, `identity:same-repo`/`distinct-repos`, link vectors, links never reach facts ([D-070](docs/DECISIONS.md)) |

*This table previously said "the recorder is not built yet" directly above a row marking
the recorder ✅, and described `lodestar report` as refusing to run after it had been
wired. A status table nobody updates is a claim nobody checked.*

530+ tests, nothing mocked: real files, real processes, real commits, real shells — plus
golden vectors that pin the record format byte-for-byte across two independent
implementations, identity vectors committed before the resolution code existed, and
link vectors pinning the declared layer.

### See it in 30 seconds

```bash
npm run build
node demo/run.mjs --keep
cd demo/.workspace && node ../../dist/cli/index.js report
```

A real git repo, a real agent, a real `npm test`, a real report. The agent fixes the bug,
runs the tests, they pass — then it makes one more edit and reports *"all tests pass."*
Every word true; the code that passed is not the code on disk. See [`demo/`](demo/README.md)
for the 90-second narration.

**The pitch isn't "don't trust AI"** — in that demo the agent never lies. It's
**don't trust stale evidence**, and humans do it too: run the tests, make one tiny edit,
commit. See [D-056](docs/DECISIONS.md).

### The other case: an agent that does lie

The demo above is the hard case, because the agent tells the truth. The easy case still
matters — and it needs no claim-parsing either:

```
$ lodestar run node fake-agent.mjs
LODESTAR recording · session #001
  observed: npm npx node python python3
  not observed: git (shadowed on PATH)

[agent] mission: Build authentication system
FAIL: 2 tests failed
[agent] Authentication completed successfully. All tests pass.   ← the agent's claim
```

What LODESTAR recorded instead:

```
  ▪ Command failed
    npm test exited with code 1

      ✗ npm test exited with code 1  2:14:09 pm

    RF-01 · confidence: high · Today 2:14 PM
      └ #8 npm test exited with code 1
```

You never have to prove the agent *claimed* anything. Reporting that a test process exited
1 is the same signal to the developer, needs no natural-language processing, and cannot be
wrong.

### What an empty report says

The harder case, and the one a trust product is judged on. When LODESTAR finds nothing,
it must not imply that there was nothing to find:

```
  ✓ No divergences observed.
    Read the limitations below before treating that as all-clear.

  Limitations (2)
  What LODESTAR could not determine. Not evidence of absence.

  ? No test command was recognised in this session. If tests did run, LODESTAR did
    not recognise the command — RF-03 and RF-04 are therefore not evidence that
    testing was skipped.
  ? Shims were shadowed on PATH for: git. If the agent ran these, LODESTAR did not
    see it, and their absence from this report proves nothing.

  DEGRADED  some evidence unavailable · see Limitations above
            the chain itself is intact across 7 events
```

Every report ends in one of three words, and `VERIFIED` has to be earned — any known
gap demotes it ([D-049](docs/DECISIONS.md)):

| | |
|---|---|
| `VERIFIED` | Evidence consistent. The chain recomputes **and** there are no known gaps. |
| `DEGRADED` | Some evidence unavailable. The facts shown are still true; the record is not complete, and the gaps are listed. |
| `BROKEN` | Integrity failure. The chain does not recompute — the record was altered after it was written. |

### The dashboard

```bash
lodestar report            # a human at a terminal → opens the dashboard
lodestar report --terminal # or piped/CI → terminal report, exit 2 if BROKEN
lodestar report --html     # a self-contained file you can send to anyone
lodestar report --record   # the canonical evidence record itself, as verifiable JSON
```

Six panes, one model: **Reality Facts** and **Limitations** lead the page; then
**Timeline** (every event, with narration labelled *as* narration), **Changes** (per-file
diffs, or the stated reason there is no diff), **Git**, **Verification** (chain status and
measured per-command coverage), and **Sessions**.

**The dashboard renders. It never computes.** Terminal, browser, and exported file are
three renderers over one `SessionReport` — every judgment on every surface is decided in
`src/facts/report.ts` and rendered verbatim ([D-049](docs/DECISIONS.md),
[D-054](docs/DECISIONS.md)). Three renderers with their own opinions would be three
different answers to the only question this product exists to answer, and the one you'd
believe is whichever you happened to open.

The server is `node:http`, bound to **127.0.0.1**, and it lives exactly as long as the
command you typed. No daemon, no service, no API, no account. The report contains your
source diffs and command lines by construction, so loopback is a decision, not a default —
and it's [pinned by a test](src/report/server.test.ts).

The exported file loads nothing from the network: no CDN, no fonts, no fetch. A teammate
who installed nothing can open it in five years and it still works.

### The Evidence Record — the artifact under everything

Every surface above is a rendering of one canonical artifact: the **Evidence Record** —
the complete session (hash-chained events + facts + limitations + measured coverage +
integrity) as a single deterministic, content-addressed JSON document. Same ledger, same
bytes, same `recordId`, on any machine, forever. The chain of custody runs one way:

```
ledger → Evidence Record → SessionReport → terminal / dashboard / HTML
```

`lodestar report --record` exports it, and **every HTML export embeds it** — so the file
you send a teammate carries the evidence itself, not just our rendering of it. A
recipient verifies it with the standalone verifier: one file, zero dependencies, no
LODESTAR install, deliberately an independent implementation of the format:

```bash
node verifier/lodestar-verify.mjs lodestar-session-003.record.json   # or the .html
# → recomputes every hash, the chain, the content address; checks every fact's
#   evidence pointers; exits 0 intact · 1 invalid · 2 altered
```

The verifier also states, on every run, what it *cannot* prove — capture fidelity is
bounded by the same-user threat model, and facts are the generator's deterministic
claims — because a verifier that prints only green checkmarks overclaims by omission.
The wire format is specified for independent implementation in
[`docs/RECORD-SPEC.md`](docs/RECORD-SPEC.md), and pinned by golden test vectors in
[`spec/vectors/`](spec/vectors) — regenerating them is a declared format change, not
a chore.

### Honest limits

- **LODESTAR is not proof against an agent that attacks the recorder.** It runs as the
  same OS user as the agent, so a *motivated* agent can forge the record. The evidence is
  sound against a confabulating agent — the real problem — and tampering by a careless one
  is detected. Read [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) before trusting this
  for anything adversarial. The claim is deliberately smaller than "unforgeable".
- **`git` is not observed on this machine.** Git Bash's `/etc/profile` prepends
  `/mingw64/bin`, so its git wins PATH resolution over our shim. Coverage is measured
  per-command against the agent's own shell and reported, never assumed
  ([D-023](docs/DECISIONS.md)).
- **Some commands cannot be observed without changing them, so they are not observed.**
  On Windows a `.cmd` shim in front of a native binary inserts a cmd.exe parser the
  command never had, which rewrites arguments. Fidelity beats coverage
  ([D-038](docs/DECISIONS.md)): the shim is skipped and the command reports `shadowed`.
- **Commands invoked by absolute path, and shell builtins, are invisible.** No process
  is created, or PATH is never consulted.
- **A test runner LODESTAR does not recognise is a hole, and it is declared as one**
  ([D-048](docs/DECISIONS.md), [D-050](docs/DECISIONS.md)). The matcher knows npm, pnpm,
  yarn, bun, pytest, tox, nox, go, cargo, gradle, mvn, make, dotnet, and ctest. A test run
  through a shell alias, a bespoke script, or `python3.11 -m pytest` (only `python` and
  `python3` are shimmed) is not recognised — so RF-03 and RF-04 say nothing, and the
  report states that they could not tell rather than implying tests were skipped.
- **Three catalogued Reality Facts are not implemented** ([D-051](docs/DECISIONS.md)):
  network egress (RF-08), destructive git operations (RF-09), and binary/oversized files
  (RF-10). Nothing in the product claims them. RF-08 and RF-09 need capture work that does
  not exist — there is no network boundary and the reflog is not read — so their silence
  is not evidence either.
- **Secret redaction is best-effort, not a guarantee** ([D-028](docs/DECISIONS.md)).
  Known secret shapes — vendor tokens, URL credentials, `Authorization:` headers,
  secret-named env vars, `--token`-style flags — are redacted before an event is
  constructed. A credential that looks like an ordinary word will get through. The
  ledger is not certified secret-free.
- **The blob store is as sensitive as your project** ([D-037](docs/DECISIONS.md)). The
  immutable ledger is redacted; the content snapshots that power diffs are verbatim
  copies of your files, so a token hardcoded in source is copied too. Blobs are *not*
  hash-chained — unlike events, they can be deleted without breaking integrity, which is
  the remediation path. `.lodestar/` is git-ignored by `init`.
- **Credential files are never snapshotted** ([D-033](docs/DECISIONS.md)). A write to
  `.env`, `id_rsa`, or `*.pem` is recorded as an event — path, time, size — but its
  contents are never read, so no diff is available for it. The event says so
  (`contentWithheld: 'sensitive'`) rather than leaving a blank that reads as "unchanged".
- **Process ancestry is only known where shims win** ([D-034](docs/DECISIONS.md)). Where
  a shim is shadowed, a nested failure may still report alongside its parent, because
  unknown ancestry is never treated as absent ancestry.
- **An argument containing `%VAR%` is refused on Windows** rather than run
  ([D-029](docs/DECISIONS.md)). cmd.exe expands it before the target program can see it
  and there is no escape on a `/c` line, so running it would execute something the
  developer did not write while recording what they did.

## The loop

```bash
npm install -g @gshanmukha/lodestar
cd my-project
lodestar init
lodestar claude      # work exactly as before
lodestar report      # see what actually happened
```

Five commands: `init`, `claude`, `report`, `sessions`, `status`. Not fifty.

## What it is not

- Not an AI assistant, coding agent, or model.
- Not a replacement for Claude Code — it wraps it.
- Not a cloud service. No account, no signup, no telemetry. Your code never leaves your
  machine.
- Not a governance or policy tool. V0 observes; it does not block.
- Not an agent logger. Logging is the commoditized slice; the product is the independent
  record underneath.

## Development

Requires **Node 22.5+** (for the built-in `node:sqlite`).

```bash
npm install
npm run check      # typecheck + tests + stress — the full gate
```

Or individually:

```bash
npm run typecheck  # every file in src/, tests included
npm test           # 474 tests, nothing mocked
npm run stress     # 5 suites: real processes, real filesystems, real fork bombs
npm run build      # emits dist/ (tests excluded)
npm run vectors    # regenerate golden vectors — a FORMAT CHANGE, see spec/generate-vectors.ts
```

### Two test layers, and why both exist

`npm test` verifies what we thought of. `npm run stress` finds what we didn't — it
spawns dozens of real OS processes, hammers real filesystems, and deliberately tries to
fork bomb the machine.

That split is not academic. **The three worst bugs in this codebase were all invisible to
unit tests**, and all three had the same shape — a mechanism that silently does nothing
while looking correct:

| Bug | Symptom | Found by |
|-----|---------|----------|
| chokidar 4 dropped glob support ([D-022](docs/DECISIONS.md)) | LODESTAR watched its own database → unbounded feedback loop | a failing test, by luck |
| Shim inferred its own directory wrongly ([D-026](docs/DECISIONS.md)) | Shim exec'd itself → **fork bomb, 10s hang until SIGKILL** | stress test |
| Tests excluded from tsconfig ([D-027](docs/DECISIONS.md)) | 5 test files never typechecked; editor invented errors | investigating "phantom" red squiggles |

Stress coverage: 3200 concurrent appends across 32 processes on one chain (gapless,
intact), tamper detection mid-chain, self-consistent forgery, hostile unicode filenames,
5MB and binary files, 300-file churn, SIGKILL mid-session, exit-code fidelity across
0–255, and five hostile shim environments.

### The record is the product

Events are append-only and hash-chained. This is enforced in three places on purpose:
the `EventStore` interface has no `update`/`delete`; database triggers reject both; and
the hash chain makes any out-of-band edit detectable.

Try it — drop the triggers, rewrite a failed test into a passing one:

```
✗ BROKEN at event 3
  event content does not match its hash
```

Tamper-**evident**, not tamper-proof. The guarantee is that alteration leaves a mark,
not that alteration is impossible. Anything stronger would be overclaiming, and a trust
company does not survive overclaiming.

## Documentation

Read in this order. `CLAUDE.md` is the entry point for AI sessions working in this repo.

| Doc | Answers |
|-----|---------|
| [`docs/LODESTAR-VISION.md`](docs/LODESTAR-VISION.md) | Why the company exists — the six layers, the moat |
| [`docs/PRODUCT-SPEC.md`](docs/PRODUCT-SPEC.md) | What to build now — V0 scope, Reality Facts catalog |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How — signal tiers, event schema, components, the evidence pipeline |
| [`docs/RECORD-SPEC.md`](docs/RECORD-SPEC.md) | The wire format — canonical JSON, hashing, the Evidence Record, verification |
| [`docs/STABILITY.md`](docs/STABILITY.md) | What is frozen for V1–V4, what is stable, what is internal |
| [`docs/USER-FLOW.md`](docs/USER-FLOW.md) | The UX — the loop, the commands, every output |
| [`docs/API-DESIGN.md`](docs/API-DESIGN.md) | Contracts — CLI, schema, adapters |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's this way, and what's still open |
