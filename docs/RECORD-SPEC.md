# LODESTAR Evidence Record Format — Version 1

**Format identifier:** `lodestar-evidence-record`, `formatVersion: 1`
**Status:** Draft, implemented, conformance-tested. Two independent implementations exist
(`src/` and `verifier/lodestar-verify.mjs`), pinned to each other by the golden vectors
in [`spec/vectors/`](../spec/vectors).

This document specifies the Evidence Record: the canonical, portable, content-addressed
artifact LODESTAR produces for one recorded session. It is written so that an
implementation with **no access to LODESTAR's source** can produce and verify
byte-identical records. Where this document and the implementation disagree, that is a
bug in one of them, and the golden vectors decide which (§8).

Why the format is specified at all, in one paragraph: an evidence artifact is only worth
what a *recipient* can check. A format that lives as an implementation detail can be
checked only by the party that produced it — which is the self-report problem this
product exists to remove, reappearing one layer up. Specifying the format, and keeping a
second implementation honest against golden vectors, is what turns "trust my export"
into "run the verifier." (See DECISIONS.md D-059, D-060.)

---

## 1. Overview and terms

```
Execution Boundary  →  Observation  →  Evidence  →  Evidence Record  →  Verification  →  Presentation
(shims, watchers)      (the event)     (facts +      (this format)       (chain walk,      (reports and
                                        limitations)                      content address)   renderers)
```

- **Observation / event** — one fact captured at the execution boundary. The atom. §3.
- **Chain** — the per-session hash chain over events. §4.
- **Evidence Record ("record")** — the complete portable bundle for one session:
  the events, the chain frame, and the generator's computed judgments. §5.
- **Generator** — the software that built the record (LODESTAR, or any conforming
  implementation).
- **Verifier** — software that checks a record without trusting its generator. §7.

All hashes in this format are **SHA-256, lowercase hexadecimal, 64 characters**.
All text is **UTF-8**. There is no other encoding anywhere in the format.

## 2. Canonical JSON

Every hash in this format is computed over *canonical JSON*, defined as JSON
([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)) with these constraints:

1. **Object keys are sorted** by ascending UTF-16 code unit order, recursively.
   (`"B" < "a" < "β"` — ASCII uppercase sorts before lowercase; this is plain
   code-unit comparison, not locale collation.)
2. **No insignificant whitespace.** No spaces, no newlines, no indentation.
3. **Array order is preserved.** Arrays are sequences; only object keys sort.
4. **`undefined` / absent properties are omitted entirely.** A key is either present
   with a JSON value or not present.
5. **`null` is preserved.** `null` and *absent* are different claims in the source
   model (`null` can mean "explicitly unknown"), except where §3.2 normalizes
   absent-to-null inside the event hash body.
6. **Strings** use JSON's minimal escaping:
   - `"` and `\` are escaped; control characters U+0000–U+001F are escaped, using the
     short forms `\b \t \n \f \r` where they exist and `\u00XX` otherwise.
   - **All other characters are emitted literally as UTF-8** — no `\uXXXX` escaping of
     non-ASCII. (Implementations in languages whose JSON encoder ASCII-escapes by
     default — e.g. Python's `json.dumps` — MUST disable that: `ensure_ascii=False`,
     separators `(',', ':')`, `sort_keys=True` reproduces this format.)
7. **Numbers** are serialized in ECMA-262 `Number::toString` form — the shortest
   round-trip representation of the IEEE-754 double. Consequences an implementer must
   reproduce exactly:
   - integers print without decimal point or exponent (`42`, `1767323050000`)
   - negative zero prints as `0`
   - very large magnitudes switch to exponent form exactly as ECMA-262 does
     (`1e+21`), very small as `1e-7`
   - no `+` sign, no leading zeros, no trailing `.0`
   Values that are not finite IEEE-754 doubles (NaN, Infinity) are not representable
   and MUST NOT appear.

The canonical form of a value is a single line of UTF-8 text. The golden vector file
[`spec/vectors/canonical-json.json`](../spec/vectors/canonical-json.json) contains
input values and their exact canonical strings, including the sorting, unicode, and
number edge cases above.

## 3. The event

An event is one observation. Its JSON shape:

### 3.1 Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | ✔ | Unique id of this event. Opaque. |
| `sessionId` | string | ✔ | The session this event belongs to. |
| `seq` | number | ✔ | Position in the session chain. **1-based, gapless.** |
| `ts` | string | ✔ | Wall-clock time, ISO 8601. |
| `monotonicTs` | number | ✔ | Milliseconds since session start (monotonic clock). |
| `source` | string | ✔ | Where it was captured (`adapter`, `fs`, `process`, `git`, `stdio`). Open set — consumers MUST tolerate unknown values. |
| `signalTier` | string | ✔ | **Closed set:** `narration` \| `intent` \| `groundTruth`. §3.3. |
| `kind` | string | ✔ | What happened (`process.exit`, `file.write`, …). Open set — consumers MUST tolerate unknown values. |
| `actor` | object | ✔ | Who did it: `{ kind: 'agent'\|'human', runtimeId?, sessionScopedId? }`. |
| `target` | object | — | What was touched: `{ raw, resolved, kind, inScope }`. |
| `effectClass` | string | — | Prevention signal (`read`\|`write`\|`execute`\|`network`\|`destroy`). |
| `blastRadius` | string | — | Prevention signal (`file`\|`module`\|`repo`\|`service`\|`account`). |
| `reversible` | boolean | — | Whether the action is undoable. Absent = not assessed. |
| `taint` | boolean | — | Untrusted content entered context this turn. |
| `missionId` | string | — | Mission-coherence signal. |
| `payload` | any JSON | ✔ | Kind-specific data. May be `null`; MUST be present. |
| `snapshotRef` | object | — | `{ before?, after? }` — content-hash refs into a blob store. Refs, never bytes. |
| `prevHash` | string | ✔ | Hash of the previous event; genesis value for `seq: 1`. §4. |
| `hash` | string | ✔ | This event's chain hash. §4. |

### 3.2 The hash body — the protected field set (CLOSED per format version)

The bytes protected by an event's hash are the canonical JSON of exactly this object —
every field above except `hash`, with **absent optional fields normalized to `null`**:

```
{ id, sessionId, seq, ts, monotonicTs, source, signalTier, kind, actor,
  target: target ?? null,
  effectClass: effectClass ?? null,
  blastRadius: blastRadius ?? null,
  reversible: reversible ?? null,
  taint: taint ?? null,
  missionId: missionId ?? null,
  payload,
  snapshotRef: snapshotRef ?? null,
  prevHash }
```

Two consequences, both deliberate:

- **Absent and `null` are indistinguishable under the hash** for the optional fields.
  A verifier MUST treat them as identical. (The event *type* documents why: the chain
  could not preserve the difference, so the type must not promise it.)
- **The field set is closed.** A field not in this list is not protected by the chain;
  therefore *adding* a field to events is a **format change** that bumps
  `formatVersion` (§6). This is the single most important rule in the document: the
  hash body IS the format.

### 3.3 Signal tiers

`signalTier` states *epistemic status*, assigned at capture by where the signal came
from — never by content:

- `groundTruth` — observed at the execution boundary, outside the agent.
- `intent` — what the agent requested, via a runtime adapter, before/at execution.
- `narration` — the agent's own account of itself. Context. **Never evidence.**

The tier set is closed in v1. The invariant every conforming generator must uphold and
every verifier must check (§7): **no fact may cite a non-`groundTruth` event.**

## 4. The chain

Per session. Events are ordered by `seq`, which starts at 1 and is gapless.

```
GENESIS  = "0" × 64                        (64 ASCII zeros)
hash(e)  = SHA-256( UTF8(prevHash) ‖ UTF8(canonicalJSON(hashBody(e))) )
```

- For the first event, `prevHash = GENESIS`.
- For event *n* > 1, `prevHash = hash(event n−1)`.
- The **chain head** is the `hash` of the last event, or `GENESIS` for an empty
  session. The head content-addresses the entire observation set: every event is
  reachable from it through `prevHash`.

A chain **verifies** iff, walking from `seq: 1`: every `seq` equals its 1-based
position; every `prevHash` equals the previous event's `hash` (genesis for the first);
and every `hash` recomputes from §3.2. The first failure is reported with its `seq` and
one of three reasons: sequence gap, prevHash mismatch, content-hash mismatch.

The chain is **tamper-evident, not tamper-proof**: it guarantees that alteration of
recorded bytes is detectable, not that alteration is impossible, and not that the
events were true when written (see §9).

## 5. The Evidence Record

The record is a single JSON object. On disk it is stored in **canonical form** (§2) —
the file *is* the hash input, modulo the `recordId` field.

### 5.1 Top-level fields (all required)

| Field | Type | Meaning |
|---|---|---|
| `format` | string | Exactly `"lodestar-evidence-record"`. |
| `formatVersion` | number | This document: `1`. |
| `recordId` | string | The content address. §5.3. |
| `generator` | object | `{ name, version }` — provenance of the computed layer. |
| `subject` | object | The session frame. **Unprotected context** — §5.4. |
| `identity` | object | Chained identity from `session.start` — §5.5. May be `{}`. |
| `observations` | object | The protected layer — §5.6. |
| `evidence` | object | The computed layer — §5.7. |

Top-level keys **`attestations`, `links`, and `extensions` are RESERVED** for future
versions (signed attestations; knowledge links; namespaced extension data). A v1
generator MUST NOT emit them; a v1 verifier MUST NOT reject a record for carrying
unknown or reserved keys (they are covered by `recordId` like everything else).

### 5.2 Determinism rule

A record is a **pure function of the ledger**. A generator MUST NOT include anything
time-, machine-, or run-dependent that is not itself read from the ledger. In
particular there is **no export timestamp inside the record** — two exports of the
same evidence are byte-identical, or the content address would be a lie. Timestamps of
*observations* live in the events, where they belong.

### 5.3 `recordId` — the content address

```
recordId = SHA-256( UTF8( canonicalJSON( record without the recordId key ) ) )
```

Build the record object completely, remove (not null out) the `recordId` key,
canonicalize, hash, and attach. Verification recomputes the same and compares.
`recordId` covers *everything* — including the computed `evidence` layer and the
unprotected `subject` frame — so any post-export edit anywhere in the file moves the id.

### 5.4 `subject` — the session frame (unprotected context)

```
{ sessionId, sessionNumber, runtimeId, mission, startedAt, endedAt, exitCode, cwd }
```
`mission`, `endedAt`, `exitCode` are nullable; everything else is required.

`subject` is read from mutable session bookkeeping (a session's end time is unknowable
at start, so the row must be updatable — D-035). It frames the record and is covered by
`recordId`, but it is **not chained evidence**, and a verifier reports it as unproven.
Identity that must be trusted comes from §5.5 and the events themselves.

### 5.5 `identity` — chained identity

```
{ machineId?, runtimeVersion?, model?, gitCommit? }
```

Extracted by the generator from the `session.start` event **at `groundTruth` tier**.
Every field optional; the object may be empty (an unclosed or floor-only session).
These fields also exist inside the chained event itself, which is the authoritative
copy — `identity` is a convenience projection, and a verifier MAY cross-check it.

### 5.6 `observations` — the protected layer

```
{ genesis, head, count, events: [ …§3 events… ] }
```

- `genesis` MUST equal the 64-zero genesis constant.
- `events` MUST be the **complete** event list of one session, in `seq` order.
- `count` MUST equal `events.length`. (Redundant with the array on purpose:
  truncation is detectable before any hashing runs.)
- `head` MUST equal the chain head per §4.
- Every event's `sessionId` MUST equal `subject.sessionId` — a record cannot be
  spliced together from fragments of two sessions, even self-consistent ones.

What is *not* here: blob contents. `snapshotRef` values are references into a local
content-addressed blob store that is deletable by design (secrets remediation, D-037).
A record therefore carries the ledger's privacy posture: redacted command lines and
event metadata, **no file bytes**.

### 5.7 `evidence` — the computed layer (generator claims)

```
{
  catalog:        [ "RF-01", … ],      // fact ids the engine EVALUATED
  facts:          [ …§5.8 facts… ],    // the ones that fired
  limitations:    [ string ],           // what could not be determined
  interference:   [ string ],           // where the generator itself changed the outcome
  coverage:       [ { command, status, resolvedTo?, reason? } ],
  recorderErrors: [ string ],
  closed:         boolean,              // a session.end event exists at groundTruth tier
  integrity:      { status, chain: { intact, eventsChecked, brokenAt?, reason? }, degraded: [string] }
}
```

- `catalog` makes silence interpretable: a fact id in the catalog with no entry in
  `facts` was *evaluated and did not fire* — a measurement. Fact ids are an open set
  (future engines add facts without a format bump); the tier rule of §3.3 applies to
  all of them.
- `coverage[].status` is the closed set `observed | shadowed | absent | unknown`.
- `integrity.status` is the closed set `VERIFIED | DEGRADED | BROKEN`, and it is
  **not free**: `BROKEN` iff the chain does not verify; otherwise `VERIFIED` iff
  `degraded` is empty, else `DEGRADED`. A verifier recomputes this and rejects a
  record whose stated status disagrees with its own bytes (§7).

Everything in `evidence` is a **deterministic claim by the generator over the
observations** — re-derivable from `observations.events` by re-running the same
engine version, but not proven by chain verification alone. A verifier checks its
*consistency* (pointers resolve, tiers are legal, status matches recomputation), not
its *derivation*. The distinction is stated in verifier output, always.

### 5.8 Facts and evidence pointers

```
{ id, statement, confidence: "high"|"medium"|"low", ts,
  evidence: [ { source, eventId, eventSeq, ts } ] }
```

Every fact carries at least one pointer. Each pointer MUST resolve to an event in
`observations.events` matching all three of `eventId`, `eventSeq` (the event's `seq`),
and `ts` — and that event MUST be `groundTruth` tier. A fact with a dangling,
mismatched, or narration-tier pointer makes the record non-conforming.

## 6. Versioning and compatibility

`formatVersion` is a single integer. The rules:

**Changes that REQUIRE a version bump** (a v-N verifier must reject v-N+1):
- any change to canonicalization (§2) or hashing (§4, §5.3), including the genesis value
- any change to the event hash body field set (§3.2) — adding, removing, renaming
- removing or re-typing any required field anywhere in the record
- changing the semantics of `signalTier`, `integrity.status`, or coverage statuses

**Changes that do NOT bump the version** (v1 consumers must tolerate):
- new `kind` and `source` values on events (open sets)
- new fact ids in `catalog`/`facts`
- new **optional** fields anywhere *outside* the event hash body (they are covered by
  `recordId` automatically; structural validation must ignore unknown fields)
- new reserved-key content at top level, once specified

**Verifier obligations:** reject `formatVersion` it does not implement, with a message
that says a newer verifier may exist (exit 1, not 2 — an unsupported version is not
evidence of tampering). Never "best-effort verify" an unknown version: a verifier that
guesses is a verifier whose PASS means nothing.

**Golden-vector obligation:** any change that alters the bytes of
[`spec/vectors/`](../spec/vectors) is a format change by definition, whatever the
change log says. Regenerating vectors (`npm run vectors`) is the declared act of
changing the format and carries the duties in that script's header.

## 7. Verification

Reference: [`verifier/lodestar-verify.mjs`](../verifier/lodestar-verify.mjs) —
single file, zero dependencies, deliberately an **independent implementation** of §§2–5
(D-060). Usage:

```
node lodestar-verify.mjs <record.json | report.html>     # exit 0 INTACT · 1 INVALID · 2 ALTERED
```

A conforming verifier performs, in order:

1. **Structure** — required fields present and well-typed (§5). Failure → INVALID (1).
2. **Record id** — recompute §5.3, compare.
3. **Session identity** — every event's `sessionId` equals `subject.sessionId`.
4. **Chain** — full walk per §4.
5. **Frame consistency** — `head` and `count` match the events.
6. **Fact pointers** — §5.8 resolution, exact on id, seq, and ts.
7. **Tier rule** — no fact cites a non-`groundTruth` event.
8. **Integrity claim** — recompute `status` per §5.7 and compare with the stated one.

Any failure in 2–8 → ALTERED (2). Output MUST be deterministic for a given input
(no timestamps, no locale, no environment), and MUST state both what was proven and
what verification *cannot* prove (§9) — a verifier that prints only green checkmarks
overclaims by omission.

**HTML embedding.** An exported LODESTAR HTML report carries its record in:

```html
<script type="application/json" id="lodestar-evidence-record">…</script>
```

with every `<` in the JSON escaped as the six-character JSON sequence `\u003c` (values
are unchanged; JSON syntax itself never contains a `<` outside string values).
Verifiers accept HTML input by extracting this block and
parsing it. Hashing is defined over parsed *values* re-canonicalized per §2 — never
over raw file bytes — so embedding, BOMs, and JSON-escaping variants cannot affect
verification. (A verifier SHOULD tolerate a leading U+FEFF in any input file.)

## 8. Conformance and golden vectors

[`spec/vectors/`](../spec/vectors) contains, generated from a fixed session
([`src/record/vector-fixture.ts`](../src/record/vector-fixture.ts)):

| File | Pins |
|---|---|
| `canonical-json.json` | §2, including sorting, unicode, and number edge cases |
| `chain-hashes.json` | §3.2 + §4: per-event `prevHash`/`hash`, head, recordId |
| `session-record.json` | the complete format: the exact canonical bytes of a full record |

An implementation is **conforming** when it:

1. reproduces every `canonical` string in `canonical-json.json` from its `value`;
2. recomputes every `hash` in `chain-hashes.json` from the events in
   `session-record.json`;
3. recomputes `session-record.json`'s `recordId`;
4. as a verifier, accepts `session-record.json` and rejects each tamper class in
   §7 steps 2–8 (the test suite in `src/record/record.test.ts` demonstrates each).

The vector session is constructed to exercise every implemented fact, process-ancestry
subsumption, a narration-tier event, a shadowed-coverage degradation, content reverts,
and out-of-scope writes — a single record that touches every rule above.

## 9. What verification proves — and what it cannot

Verification proves the record is **internally consistent and unaltered since it was
produced**: the bytes you hold are the bytes the generator wrote, the facts point at
real events in the verified chain, and the stated status is honest about the stated
gaps.

Verification does **not** prove:

- **that the events faithfully describe what happened on the machine.** Capture runs
  as the same OS user as the agent it observes; a motivated same-user process can
  forge observations before they are chained. See
  [`THREAT-MODEL.md`](THREAT-MODEL.md) — this format inherits that boundary and no
  signature or hash can move it. Closing it requires privilege separation (V1+) and,
  for third-party proof, external anchoring/attestation (V2, the reserved
  `attestations` key).
- **that the facts were correctly computed.** Facts are deterministic generator
  claims; re-deriving them requires the fact engine at the generator's version.
  Pointers and tiers are checked; the computation is not re-run.
- **the `subject` frame** — mutable bookkeeping, covered by `recordId` but not chained.
- **completeness beyond what the record itself discloses.** `DEGRADED` and the
  `limitations` list are the record's own statement of its holes; nothing can verify
  the absence of unknown ones.

A verifier's output states this split in plain words on every run. That is not
boilerplate; a trust artifact that lets silence imply a stronger claim is the failure
mode this product exists to remove.
