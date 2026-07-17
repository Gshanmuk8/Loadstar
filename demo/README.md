# The demo

> **What this is:** a real session you can run in 30 seconds, and the script for the
> 90-second recording built on it.
>
> **What it is not:** a mockup. Everything below is a real git repo, a real agent, a real
> `npm test`, a real exit code, and a real report. If you are asked a question on camera,
> you can answer it by opening the thing you just pointed at.

```bash
npm run build
node demo/run.mjs --keep     # set up + record a session + print the report
cd demo/.workspace && node ../../dist/cli/index.js report   # the dashboard
```

---

## The story, in one paragraph

The agent is asked to reject negative charge amounts. It edits `payments.mjs`, runs the
tests, and **the tests pass** — genuinely. Then it makes one more edit ("tidied up edge
cases"), never re-runs the tests, and reports: *"Done. Negative amounts are rejected and
all tests pass."*

**Every word of that is true.** It is also useless, because the code that passed is not the
code on disk. The last edit added `if (!card.token) return 'rejected'` — a rule no test has
ever executed.

This is the demo precisely *because* the agent does not lie. An agent that prints a false
sentence proves nothing; everybody knows a program can do that, and "just read the test
output" is a fair answer. **Stale evidence has no such answer.**

---

## The narration — 90 seconds

Six beats. Do not explain the internals; they are not the point and they cost you the
minute you have.

| # | On screen | Say |
|---|---|---|
| 1 | `lodestar claude` — the agent starts working | *"The agent fixed the bug."* |
| 2 | `npm test` scrolls past | *"It ran the tests."* |
| 3 | `PASS: negative amounts rejected` | *"The tests passed."* |
| 4 | `[agent] tidied up edge cases…` | *"Then it made one more edit."* |
| 5 | `[agent] Done. …all tests pass.` | *"Its summary wasn't false — it described a codebase that no longer existed."* |
| 6 | The report: **Code changed after testing** | *"LODESTAR doesn't read the summary. It reads the evidence."* |

Then stop. The three-line chain on screen finishes the sentence for you:

```
✓ npm test exited with code 0        10:51:13 pm
✓ wrote src/payments.mjs             10:51:14 pm
⚠ No test run was observed after this change.
```

**If you have 30 more seconds**, open *Changes* and point at the second added line:
*"That rule has never been executed by a test. Not once."*

---

## Shot list

| Time | Shot | Notes |
|---|---|---|
| 0:00–0:08 | Terminal, `lodestar init` | One line of output. Do not narrate the install. |
| 0:08–0:35 | `lodestar claude`, agent works | Beats 1–4 land here. Let `PASS` sit on screen for a beat. |
| 0:35–0:45 | `[agent] Done. …all tests pass.` | Beat 5. **Pause here.** This is the whole pitch. |
| 0:45–0:50 | Type `lodestar report`, browser opens | Say nothing. The tool is doing the talking. |
| 0:50–1:10 | The facts card | Beat 6. Read the chain aloud, slowly. |
| 1:10–1:25 | Click *Changes*, expand the diff | The untested line. |
| 1:25–1:35 | Scroll to *Limitations* | *"And it tells you what it couldn't see."* This is the credibility shot — do not cut it. |

**Total: ~95 seconds.**

---

## Two things not to do

**Do not hide the limitations block.** It says `git` was shadowed on PATH and that its
absence from the report proves nothing. It is tempting to crop — a yellow warning in a
launch video feels like an own goal. It is the opposite: it is the only reason a sceptical
engineer believes the two facts above it. A tool that admits what it cannot see is a tool
you can check.

**Do not say "untested".** The report never does. It says *"no test run was observed after
this change"* — because a shadowed shim means a test could have run where we could not see
it. The stronger word is a claim about the world; the weaker one is a claim about our
record, and only the second is ours to make. See D-056.

---

## Regenerating the landing page assets

```bash
node demo/run.mjs --keep
node demo/capture.mjs        # → site/assets/*.png, from the real report
```

`capture.mjs` drives real Chrome over CDP: it clicks the real tabs, measures the real
elements, and clips at 2×. Every image on the landing page is a photograph of a report
LODESTAR produced. If a screenshot looks wrong, fix `src/report/html.ts` — never the
screenshot.
