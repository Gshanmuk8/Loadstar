# Why I would not deploy LODESTAR in production

> Written in the voice of a skeptical principal engineer (Stripe / OpenAI / Datadog),
> spending an hour trying to reject the product. The goal of the exercise is to separate
> the criticisms that are *valid and fixable* from the ones that are *misunderstandings or
> out of scope* — and then to fix only the first kind. Findings marked **[FIXED]** were
> addressed in D-058; **[WON'T FIX]** are declined with reasoning; **[V1]** are real but
> architectural.

---

## The criticisms that would stop me — and were valid

### 1. I can't tell in ten seconds whether I care. **[FIXED]**

The first thing on the page was `Session #001` and a row of chips — event counts, model,
runtime version. The actual status was a small pill in the corner reading `DEGRADED`, a
word that means nothing until I've read your docs. Mid-incident I do not have thirty
seconds to parse a taxonomy; I have ten to decide whether this session is my problem.

*Fix:* a dominant verdict block with two plain-language axes — *what diverged* and *how
complete the evidence is*. "2 divergences observed / Evidence incomplete · 1 gap." I know
what I'm looking at before I've focused my eyes.

### 2. "DEGRADED" collapses two different questions into one word. **[FIXED]**

Does DEGRADED mean "you found nothing but couldn't see everything," or "you found problems
AND couldn't see everything"? Those demand opposite next moves — the first I might wave
through, the second I'm blocking on. A single status word that can't distinguish them is
worse than useless; it's confidently ambiguous.

*Fix:* the two axes are now independent. Findings and coverage each get their own line and
their own colour. A clean-but-incomplete session reads "No divergences observed" (green)
over "Evidence incomplete" (amber) — both true, neither hidden.

### 3. Your interpretation is dressed like your evidence. **[FIXED]**

RF-04's card showed a chain of rows — the observed events and LODESTAR's conclusion — in
the same indentation and weight, distinguished only by icon colour. I am colour-blind in
the red/green axis. On a shared screenshot I genuinely could not tell which line was a
measurement and which was your inference. For a product whose entire pitch is "we don't
hallucinate," blurring that line is the cardinal sin.

*Fix:* explicit **Observed facts** and **LODESTAR's reading** groups, labelled in words,
visually separated. The distinction no longer depends on anyone seeing colour.

### 4. The assumption that could invalidate the finding was three sections away. **[FIXED]**

RF-04 concludes "code changed after testing" from filesystem mtimes. That's fine — *if* I
know it rests on mtime, which breaks on a clock adjustment or a coarse filesystem. That
caveat existed, but in a session-level "Limitations" list far below the fact, where it read
as generic boilerplate I'd skim past. The one thing that could make me distrust the
conclusion was not attached to the conclusion.

*Fix:* assumptions now live on the fact card, under "Why LODESTAR believes this," beside
the confidence and the evidence. You cannot read the finding without the caveat being one
click away.

### 5. The blast radius was buried behind the timeline. **[FIXED]**

In an incident, right after "is there a problem" comes "what did it touch." That was the
*second* tab, and the default tab was a hundred-row event timeline — a wall of noise where
I needed a list of files. The information hierarchy was backwards for the actual job.

*Fix:* "Files affected" is the default tab; the timeline is one click away for when I want
to reconstruct the sequence.

---

## The criticisms I'd raise that you should NOT fix

### 6. "It won't tell me if the change is safe to merge." **[WON'T FIX — and it's the point]**

My instinct is to demand a green "Safe to merge" banner. That instinct is wrong, and a good
product should refuse me. LODESTAR observes what happened; it cannot know my team's merge
criteria, which untested refactors are acceptable here, or my risk tolerance today. A
"safe" verdict would be an interpretation asserted as fact — the exact failure the product
is built to avoid. The honest verdict reports observation and completeness and stops. If I
want a merge gate, I write the policy that reads these facts; the tool must not pretend to
be the policy. **A vendor that added "Safe to merge" because I asked would be one I trust
less, not more.**

### 7. "No SSO, RBAC, audit log, or multi-tenant story." **[V1 — architectural, not a gap]**

Real for a team rollout, but not a dashboard bug and not something to bolt on. LODESTAR
runs as the same OS user as the agent, so any access control it added at V0 would *pretend*
to solve a trust boundary it structurally cannot (the same user can forge the record). The
honest answer is that authenticated, tamper-*proof* multi-user records need privilege
separation — a V1 architecture, documented in `THREAT-MODEL.md` — not a login screen over a
forgeable file. I'd rather hear "here's exactly what V0 proves and what needs V1" than be
sold a compliance checkbox that doesn't hold.

### 8. "It's a single-session view; where's my fleet dashboard?" **[V1 — real, deferred]**

Cross-session rollups, trends, and per-repo aggregation are a genuine want for a team. They
are also a different product surface built on the same record, not a fix to this page. The
session report is the atom; the fleet view is a later composition of atoms. Building it now
would be scope drift, not hardening.

### 9. "Dark-only, no theming." **[INVALID]**

It is theme-aware — `prefers-color-scheme` with a full light-mode token set. This one I got
wrong on first look.

### 10. "No real-time streaming during the session." **[INVALID for the use case]**

This is a post-hoc investigation tool — I open it after the agent ran, to reconstruct what
happened. Live streaming is a different product (an observability agent) with a different
trust model. Not a gap; a category difference.

---

## What would actually make me deploy it

The five fixes above move it from "interesting" to "I'd put it in front of my team." The
things standing between it and a *fleet-wide* production rollout are honest and known:
privilege separation (so the record is tamper-*proof*, not just tamper-*evident*), and a
cross-session view. Both are V1, both are written down, and — crucially — the product does
not pretend to have either. **That last part is why I'd trust it at all.** A tool that is
precise about its own limits is one I can reason about; a tool that papers over them is one
I'll get burned by exactly once.

The line I keep coming back to: this is the rare trust product where the *refusals* are the
strongest signal. It won't say "safe to merge." It won't claim a test was skipped when a
shim was shadowed. It won't call a record verified when a blob is missing. Every one of
those is a place a worse product would have shown me a green check — and been wrong at the
worst possible moment.
