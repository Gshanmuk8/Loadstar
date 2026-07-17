# LODESTAR — Threat Model

> **Status:** source of truth for *what LODESTAR's evidence is worth, and against whom*.
> Written after the V0 adversarial audit, which falsified the claim in
> `LODESTAR-VISION.md` §5 that the record is one "the acting party cannot edit."
>
> Read this before making any claim about trust, in code, docs, or marketing.

---

## 0. Why this exists

The audit ran attacks rather than arguing about them:

```
BEFORE: [ 'npm test exited with code 1' ]     ← the real failure
AFTER:  [ ]                                    ← erased by ONE appended event
verify: {"intact":true,"eventsChecked":2}      ← and integrity still says ✓
```

Nothing said this was out of scope, because **no threat model existed**. That absence
was the real defect. A trust product without a stated adversary is not making a claim —
it is making an impression, and an impression is what fails in the room where it matters.

---

## 1. The Same-UID Ceiling

This constraint determines everything below. It is not a bug list; it is a property of
what V0 *is*.

> **The shim is spawned *by the agent*, in the agent's environment, as the agent's child,
> under the agent's UID. Every credential the shim can obtain, the agent can obtain
> first. Therefore no authentication scheme rooted in the shim can distinguish the shim
> from the agent.**

Each option fails for the same reason:

| Mechanism | Why it fails at V0 |
|---|---|
| Signing key in a file | Same UID reads it |
| Key in an environment variable | The agent *is* the environment |
| Key in the parent, shim requests it over IPC | The agent can make the same request |
| OS keychain / DPAPI / TPM | Same-UID access is the point of those APIs |
| File permissions on the ledger | Same UID |
| Recorder as a separate user or service | Privileged install — **kills the wedge** |

**Corollary.** The only V0-unforgeable evidence is what the parent observes *without the
agent's mediation*: the agent's own process lifecycle (LODESTAR is genuinely its
parent), the filesystem watcher, and git read directly. Everything the *shim* sees passes
through the agent's territory.

**Conclusion: "a record the acting party cannot edit" is unreachable at V0 by
construction, not by omission.** No code closes it while LODESTAR is unprivileged,
same-user, and daemonless — and those constraints *are* the wedge. So the claim changes,
not the wedge.

---

## 2. The three tiers

| Tier | Adversary | Behaviour | V0 stance |
|---|---|---|---|
| **T1** | **Confabulating agent** | Reports "all tests pass" when they failed. Does not know or care that LODESTAR exists. **Never attacks the record.** | **Defended. This is the product.** |
| **T2** | **Opportunistic agent** | Prompt-injected or careless. Tries obvious things: `rm -rf .lodestar`, `sqlite3 INSERT`. Does not study the source. | **Detected, not prevented.** |
| **T3** | **Motivated agent** | Knows LODESTAR. Reads any key off disk, forges `LODESTAR_EXEC_ID`, rewrites the chain with our own `hashBody`. | **Out of scope until privilege separation (V1+). Stated, never implied away.** |

**T1 is not a weak threat — it is the entire market.** A developer's real problem is an
agent that believes its own summary: false claims, true evidence. That is exactly what
LODESTAR captures. **The wedge does not require defeating T3.**

### Known T3 capabilities, accepted

- Append forged events; the chain stays `intact` (the chain proves order, not authorship).
- Erase an RF-01 by appending a passing run of the same command.
- Forge `LODESTAR_EXEC_ID` to fake process ancestry.
- Truncate the ledger's tail (no length anchor), or delete the DB (schema is recreated
  silently and `status` exits 0).
- Poison `LODESTAR_SESSION_T0` so every append throws into a swallowed catch.
- Manipulate PATH after the coverage probe has run.

---

## 3. The honest claim

> *"An independent record of what your agent did, captured outside its self-report, and
> tamper-evident against accident and opportunism. It is not proof against an agent
> deliberately attacking the recorder — that requires privilege separation, and it is
> V1."*

That sentence sells. "Unforgeable" does not survive first contact with a security
engineer, and losing that argument once costs more than the feature was worth.

---

## 4. The rules this model adds

**Fidelity beats coverage.**

> If observing a command requires changing how it executes, **do not observe it**, and
> disclose the hole.

The `.cmd` shim inserted a cmd.exe parse layer that a native target's baseline does not
have. It expanded `%VAR%` in the agent's arguments *before any LODESTAR code ran* —
changing what executed, recording the post-expansion form as the agent's, and laundering
secret values past redaction. Coverage bought with fidelity is not coverage; it is
fabrication. See D-038.

**A fact must not report a failure LODESTAR caused.** (`PRODUCT-SPEC.md` §4, rule 5.)

The four Reality Facts rules assume LODESTAR is not a participant. The shim makes it one:
a refusal returns 126, the parent inherits it, and RF-01 reports it as the agent's
failure — computable, reproducible, neutrally stated, evidence-linked, and false. See
D-039.

**Unknown is not absent, and neither is silence.**

`absent` meant both "not installed" and "we could not measure". Conflating unknown with
known-absent is exactly what D-023 exists to prevent. See D-040.

**Agent-controlled values must never delete evidence.**

`LODESTAR_EXEC_ID` is agent-controlled, so ancestry may *nest* or *annotate* facts. It
must never *suppress* one. See D-041.

---

## 5. What this model does not fix

Deliberately deferred, so the gap is a decision rather than an oversight:

| ID | Gap | Tier | Home |
|---|---|---|---|
| C1 | Appends are unauthenticated | T3 | V1 — privilege separation |
| C2 | Forged pass can erase a fact | T3 | V1 (mitigated: facts no longer cancel) |
| C3 | `LODESTAR_EXEC_ID` ancestry forgery | T3 | V1 (mitigated: no suppression) |
| C5 | Tail truncation leaves no mark | T2/T3 | V1 — checkpoints |
| C6 | DB deletion is a clean win | T2/T3 | V1 — checkpoints |
| C7 | Coverage probe is point-in-time | T3 | V1 |

`ARCHITECTURE.md` previously listed "signed checkpoints" as a shipped property. **No
signing code exists.** That line is corrected; the mechanism is V1.

---

## 6. The claim this supports

> *"I ran an AI agent through LODESTAR, and the evidence of what happened is
> trustworthy."*

True, with the adversary named:

- **Against T1 — the real developer problem — the evidence is sound**, because it is
  captured outside the agent's self-report and the agent never attacks it.
- **Against T2, tampering is detected**, not prevented.
- **Against T3, the record is not proof**, and LODESTAR says so rather than letting a
  developer discover it during an incident review.

Smaller than the founding documents claim. **One the code can actually carry** — which is
worth more, because in a business whose only asset is credibility, the first overclaim is
the one you never fully recover from.
