# LODESTAR V0 — User Flow & Experience

> **Status:** source of truth for the V0 user experience — the CLI surface, every
> terminal output, and the shape of the loop.
> What: `PRODUCT-SPEC.md`. How: `ARCHITECTURE.md`. Contracts: `API-DESIGN.md`.
> Why: `LODESTAR-VISION.md`. Rationale: `DECISIONS.md`.

---

## 1. The Whole Product, in One Loop

```
Install
   ↓
lodestar init
   ↓
lodestar claude
   ↓
AI works normally
   ↓
LODESTAR records reality
   ↓
lodestar report
   ↓
Understand what actually happened
```

**Install → wrap AI work → inspect reality.** That is the entire V0 experience.

**The magic moment is the trust report after an AI session.** Everything in V0 exists
to deliver that moment and nothing else. If a proposed feature does not make that
moment arrive sooner, land harder, or feel more trustworthy, it does not belong in V0.

### The feeling

| Before | After |
|--------|-------|
| *"Claude said it worked. I hope it worked."* | *"I can see exactly what happened."* |

That table is the product spec. The rest of this document is implementation detail.

---

## 2. Install

```bash
npm install -g @gshanmuk8/lodestar
```

(The npm name is scoped — bare `lodestar` was taken on the registry long before this
project. The installed command is still `lodestar`; nothing else changes.)

```
Installing LODESTAR...

✓ CLI installed
✓ Runtime detector ready

LODESTAR is ready.

Next:
  cd your-project
  lodestar init
```

**No account. No sign-up. No API key.** This is the single most important product
decision in V0: **zero permission required to start.** Under three minutes from install
to first value, or the wedge is too heavy to carry.

> **Implementation note.** A global install must not create a database — it has no
> project to create one for, and npm `postinstall` scripts that write files are an
> antipattern that trips security-conscious developers, which is exactly the wrong
> first impression for a trust product. **The database is created by `lodestar init`.**
> See `DECISIONS.md` D-015.

---

## 3. Initialize a Project

```bash
cd my-startup-app
lodestar init
```

Creates:

```
my-startup-app/
├── src/
├── package.json
│
└── .lodestar/
    ├── lodestar.db      the record — hash-chained, append-only
    ├── config.json      project config
    └── sessions/        file snapshots (before/after blobs)
```

```
✓ Project detected      node · npm · git
✓ Runtime detected      claude-code
✓ Database created      .lodestar/lodestar.db
✓ Recording enabled

LODESTAR initialized.

Next:
  lodestar claude
```

**Meaning:** *"Start tracking this project."*

`init` detects the language, package manager, and whether it's a git repo, then detects
which supported runtime is available on the machine. Nothing is uploaded. Nothing
leaves the machine.

> Add `.lodestar/` to `.gitignore` — `init` offers to do this. The record is the
> developer's own, not a repo artifact.

---

## 4. Start an AI Session

Instead of:

```bash
claude
```

they run:

```bash
lodestar claude
```

```
Developer
    |
    ↓
LODESTAR wrapper
    |
    ↓
Claude Code
```

**Claude Code behaves normally. The developer does not change workflow.**

This is a hard requirement, not an aspiration. stdin, stdout, stderr, TTY behavior,
colors, signals (Ctrl-C), and exit codes all pass through unchanged. **If LODESTAR
changes how the agent feels to use, the wedge is dead** — a developer will not accept
friction in their core loop in exchange for a report they haven't learned to want yet.

```
lodestar claude

        ↓

LODESTAR starts recorder

        ↓

Claude Code starts

        ↓

Events captured
```

The wrapper prints one line and then gets out of the way:

```
LODESTAR recording · session #001

[Claude Code starts here, exactly as normal]
```

### If recording fails

**LODESTAR must never break the agent.** If the recorder dies, the agent keeps
running, and LODESTAR degrades loudly in the report rather than quietly in the
session. V0 has no right to be in anyone's way — it has not earned that yet.

```
⚠ LODESTAR recorder stopped (filesystem watcher error)
  Your session is unaffected. Partial record kept.
  Details: lodestar status
```

---

## 5. A Real Session

**Developer:**

```
Build authentication system
```

**Claude Code works:**

```
Reading:
src/users.ts

Editing:
src/auth.ts

Running:
npm install jsonwebtoken

Running:
npm test
```

**LODESTAR captures:**

```
SESSION #001

Mission:
Build authentication system


Timeline:

10:01:12
File read:
src/users.ts


10:03:44
File modified:
src/auth.ts


10:05:20
Command:
npm install jsonwebtoken


10:06:10
Command:
npm test


10:06:15
Result:
FAILED
Exit code: 1
```

### The moment

**AI says:**

> Authentication completed successfully.

**LODESTAR does not argue. It shows reality:**

```
Reality Facts:

⚠ Tests failed after implementation      [RF-01]

  Command:
  npm test

  Exit:
  1


⚠ Files modified after last successful test    [RF-04]

  src/auth.ts
```

**No AI judgement. Only facts.**

Notice what LODESTAR did *not* say. It did not say the agent lied, or was wrong, or
overclaimed. It did not compare the agent's words to anything. It reported that a
process exited 1 and that a file changed after the last passing test — two things that
are simply, checkably true — and let the developer draw their own conclusion.

**That restraint is the product.** See `CLAUDE.md` → The Reality Facts Rule, and
`DECISIONS.md` D-009.

---

## 6. View the Report

```bash
lodestar report
```

**LODESTAR does all of this automatically:**

1. Starts a local server on `localhost:3000` (incrementing if taken — never "port in use")
2. Opens the browser
3. Shows the dashboard

**The user never manually visits localhost.** It should feel like:

> *"LODESTAR opened my AI history."*

**Terminal:**

```
  LODESTAR report

  http://localhost:3000

  Opening your browser. Press Ctrl-C to stop.
  Piping this command instead prints a terminal report: lodestar report --terminal
```

### Which renderer you get, and why it is automatic — D-055

`lodestar report` **asks who is watching** (`process.stdout.isTTY`) rather than making you
choose:

| Caller | Gets |
|---|---|
| A human at a terminal | The dashboard, opened for them |
| A pipe, a script, CI | The terminal report, and exit `2` if the chain is `BROKEN` |

```bash
lodestar report              # dashboard (interactive) / terminal report (piped)
lodestar report 12           # a specific session
lodestar report --terminal   # force the terminal report
lodestar report --open       # force the dashboard
lodestar report --html [f]   # self-contained file — the shareable artifact (D-014)
```

Still five commands. The browser is the magic moment, so it is the default — not a second
command you must know to find.

### What the server is not

`node:http`, bound to **127.0.0.1**, alive exactly as long as the command you typed. Not a
daemon, not a service, not an API. The report contains your source diffs and command lines
by construction, so loopback is a decision, not a default.

**Browser:**

```
LODESTAR

Sessions

Today
 └── Authentication feature


-------------------

Timeline

10:01  Read users.ts
10:03  Changed auth.ts
10:05  Installed package
10:06  Tests failed


-------------------

Files Changed

+ src/auth.ts
+ package.json


-------------------

Commands

npm install jsonwebtoken
npm test


-------------------

Reality Facts

⚠ Code changed after test execution
⚠ Last test failed
```

### Rules for the dashboard

- **Reality Facts lead.** They are why the page exists. Put them where the eye lands.
- **Every fact links to its evidence** — click through to the exact events.
- **No facts is a valid, stated result.** "No divergences observed." Never manufacture
  concern to look useful; a trust product that cries wolf is finished.
- **Coverage is always shown**, including what was *not* independently verified.
- **No AI-generated explanations.** An LLM summary is the agent-reporting-on-itself
  problem wearing a different hat.
- **No risk scores.** Computed and stored, never rendered. See `DECISIONS.md` D-005.

> **Port note.** `3000` is the default and is frequently occupied on a developer
> machine. Auto-increment to the next free port and print the real one. Never fail with
> "port in use" — that is friction in the magic moment.

### Search lives here, not in the CLI

Cross-session, cross-agent search — *"what changed in `auth.ts` in the last two
weeks?"* — is the retention engine, and it lives in the dashboard rather than as a CLI
command. It needs browsing, not a flag. See `DECISIONS.md` D-013.

### Sharing

The dashboard has an **Export** button that writes a **static HTML file** — no server
needed to view it.

This matters more than it looks. The shared report is **the growth loop**: a teammate
opens it, sees what it shows about their own agent problem, and installs LODESTAR. It
is the artifact that spreads. So it must work as a bare file that someone who has
installed nothing can open. See `DECISIONS.md` D-014.

---

## 7. The CLI Surface

**Keep it small. Do not create fifty commands.**

```bash
lodestar
```

```
LODESTAR - Trust layer for AI agents

Commands:

  init        Initialize LODESTAR in a project
  claude      Run Claude Code through LODESTAR
  report      View AI session reports
  sessions    List previous sessions
  status      Show current recording status

Learn more:  https://lodestar.dev
```

### Build for V0

| Command | Purpose |
|---------|---------|
| `lodestar init` | Initialize a project |
| `lodestar claude` | Run Claude Code through LODESTAR |
| `lodestar report` | Start server, open browser, show dashboard |
| `lodestar sessions` | List previous sessions |
| `lodestar status` | Show current recording status |

**That is the whole CLI.** Five commands.

### Deferred

| Command | Why it waits |
|---------|-------------|
| `lodestar doctor` | Only earns its place once installs fail in ways support can't guess. Until there are users, there is nothing to diagnose. |
| `lodestar config` | `init` writes sensible defaults; editing `config.json` is enough for one developer on one machine. Retention and toggles are V1 concerns. |
| `lodestar export` | The dashboard's Export button covers it. A CLI flag adds surface without adding capability. |
| `lodestar search` | Lives in the dashboard. See D-013. |
| `lodestar verify` | Chain integrity surfaces in `status` and the dashboard footer. See D-016. |

---

## 8. Command Reference

### `lodestar sessions`

```
Sessions:

1. Authentication feature
   Today 10:30 AM

2. Payment integration
   Yesterday 5:20 PM

3. Database migration
   Monday
```

Sessions carry **human-readable numbers** (`#001`, `#124`), not UUIDs. A developer
should be able to say "session 124" out loud. The UUID stays internal. See
`DECISIONS.md` D-017.

### `lodestar status`

```
LODESTAR

Project:
my-app

Recording:
ACTIVE

Current session:
#124

Events captured:
57

Record integrity:
✓ verified
```

The integrity line is deliberate. **A trust product must let you check its central
claim yourself**, and this is the cheapest place to expose it — no separate command,
no ceremony, just the answer sitting where you already look.

---

## 9. Deployment — Later

**The first question is not:**

> "How do we deploy the dashboard?"

**The first question is:**

> **"Can a developer trust the information LODESTAR captures from their own machine?"**

Once that works, cloud deployment becomes the expansion layer.

### V0 — local

```
Local CLI
    +
Local dashboard
    +
Local database
```

No server. No account. No cloud. Code never leaves the machine.

### V1 — team

```
Developer machines
        |
        ↓
  LODESTAR Cloud
        |
        ↓
  Team dashboard
```

Then, and only then, you add accounts, organizations, shared history, permissions,
and retention.

### The mental model

LODESTAR is **developer infrastructure**, not a web app. Think Git, Docker Desktop,
VS Code extensions — tools that run locally first and grow a cloud later, if they grow
one at all.

None of them opened with a web app, and none needed to. **Developers live in a
terminal, and a tool that meets them there has zero adoption friction.**

### The one signal that unlocks V1

> Do free individual users start asking **"how do I share this with my team?"**

Asked unprompted, that question is the only valid trigger to begin the Team phase.
Everything else is a vanity metric.

---

## 10. Do Not Add to V0

Explicitly out of scope. Each has killed a product like this before.

- ❌ **Signup or accounts** — zero permission to start is the wedge.
- ❌ **Cloud dashboard** — V1, and only on the signal above.
- ❌ **Teams, sharing infrastructure, sync** — V1.
- ❌ **Policies, blocking, permissions, approvals** — V2. This is the entire later
  company; it must not leak into V0.
- ❌ **AI explanations or summaries** — the agent-reporting-on-itself problem in a
  new hat.
- ❌ **Memory injection back into the agent** — a different, harder product, racing
  the vendors.
- ❌ **A second runtime** — before the first is excellent.
- ❌ **IDE extension** — a client over the core; the core must work first.
- ❌ **Fifty commands** — five.

---

## 11. Why This Loop Is Enough

V0 needs none of the future to be valuable today. It stands on its own as a tool a
developer installs this month for a pain they feel this week.

But underneath the small loop, the same execution boundary that makes `lodestar report`
possible is the one every later layer stands on — Explain queries this record, Gate
decides at this boundary, Prevention scores these signals. **The developer installs a
useful tool. The company gets its foundation.** Both are true, and only one of them is
the user's problem.

That is what a future-proof wedge looks like: **useful alone, foundational if it wins.**
