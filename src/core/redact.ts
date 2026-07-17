/**
 * LODESTAR — secret redaction.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MUST RUN BEFORE THE EVENT IS CONSTRUCTED
 * ---------------------------------------------------------------------------
 *
 * API-DESIGN.md §5 says "secrets are redacted before the event is constructed, never at
 * render". That is not a stylistic preference — it is forced by the store.
 *
 * The record is append-only and hash-chained. `EventStore` has no `update` or `delete`,
 * database triggers reject both, and the chain makes any out-of-band edit detectable.
 * Every one of those properties is deliberate, and together they mean:
 *
 *   **A secret that reaches the record can never be removed from it.**
 *
 * The usual remedy for a leaked credential in a log — delete the line — is unavailable
 * here by construction. Worse, the only way to excise it is to break the chain, which
 * makes an honest cleanup indistinguishable from tampering. So redaction at render is
 * not a weaker version of this; it is no protection at all, because the plaintext is
 * already in the durable, immutable, verbatim record on disk.
 *
 * This is the same shape as the three bugs in the session log: a mechanism that is
 * documented, looks correct, and does nothing. The docs claimed redaction for two
 * phases while nothing redacted anything.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * This is a **best-effort filter over known secret shapes**, not a guarantee. It cannot
 * recognize a credential that looks like an ordinary word, and a determined leak will
 * get through. It is therefore described honestly wherever it is surfaced: "known secret
 * patterns are redacted", never "the record contains no secrets".
 *
 * Overclaiming here would be worse than not shipping it. A developer who believes the
 * record is secret-free will paste it into an issue tracker.
 *
 * The mitigation for what this misses is `.lodestar/` staying local and git-ignored —
 * not this file.
 *
 * ---------------------------------------------------------------------------
 * CONSTRAINTS THIS CODE MUST HOLD
 * ---------------------------------------------------------------------------
 *
 * 1. **Deterministic.** The same input must always produce the same output, or Reality
 *    Facts stop being reproducible (PRODUCT-SPEC.md §4, rule 2). No randomness, no
 *    clocks, no entropy thresholds that vary with tuning.
 * 2. **Structure-preserving.** `npm test` must survive as `npm test`. RF-01 groups by
 *    command string and RF-04 matches test-shaped commands; a filter that mangled
 *    ordinary argv would silently break the fact engine.
 * 3. **Never widening.** Redaction only ever replaces a matched span. It must not drop,
 *    reorder, or merge arguments — the argv array's length is preserved exactly.
 */

/** The marker left in place of a secret. Its presence is the disclosure. */
export const REDACTED = '[REDACTED]'

/**
 * Vendor token shapes.
 *
 * Prefix-anchored on purpose. Matching "long random-looking string" would redact commit
 * SHAs, content hashes, and UUIDs — all of which are load-bearing evidence in this
 * record. A false positive here destroys evidence; these patterns only fire on things
 * that are a credential and cannot plausibly be anything else.
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  // Anthropic / OpenAI — sk-ant-… must precede the generic sk-… form.
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // GitHub: ghp_ (personal), gho_ (oauth), ghu_/ghs_ (app), ghr_ (refresh), fine-grained.
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bxox[baprse]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[A-Za-z0-9_-]{35}\b/g,
  // AWS access key ids. AKIA = long-lived, ASIA = temporary session.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bdop_v1_[a-f0-9]{64}\b/g,
  // JWT — three base64url segments. Bearer tokens routinely appear on argv.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g,
  // PEM private keys, in case a key body is ever echoed into captured output.
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
]

/** `scheme://user:password@host` — keeps the user, drops the password. */
const URL_CREDENTIALS = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/g

/** `Authorization: Bearer <token>`, and the bare `Bearer <token>` form on argv. */
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/gi

/** `NAME=value`, evaluated against `isSensitiveName`. */
const ENV_ASSIGNMENT = /(?<![A-Za-z0-9_-])([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)/g

/**
 * Is this identifier the name of a secret?
 *
 * Deliberately conservative. `GIT_AUTHOR_NAME` contains "auth" and is not a secret —
 * redacting it would corrupt the record to no benefit, so the author/committer families
 * are excluded before the substring test runs.
 */
function isSensitiveName(name: string): boolean {
  const n = name.toLowerCase()
  if (/^git_(author|committer)/.test(n)) return false
  return /secret|token|passwd|password|apikey|api_key|access_key|accesskey|private_key|privatekey|credential|authorization|client_secret|encryption_key|signing_key|session_key|_auth$|^auth$/.test(
    n,
  )
}

/**
 * Flags whose *next* argv element is a secret.
 *
 * `-p` is absent on purpose: `mkdir -p`, `docker run -p`, and `ssh -p` are all common and
 * none carry a password. A filter that redacted `mkdir -p src/foo` would destroy real
 * evidence to protect nothing.
 */
const SENSITIVE_FLAG =
  /^--?(?:token|password|passwd|api-key|apikey|secret|client-secret|access-token|refresh-token|private-key|auth|authorization|credential)$/i

/** `--token=value` / `--password=value`. */
const SENSITIVE_FLAG_INLINE =
  /^(--?(?:token|password|passwd|api-key|apikey|secret|client-secret|access-token|refresh-token|private-key|auth|authorization|credential))=(.+)$/i

export interface RedactResult<T> {
  value: T
  /** How many spans were replaced. Non-zero means the record has a declared hole. */
  count: number
}

/**
 * Redact freeform text — captured stdout/stderr tails, error strings.
 *
 * Order matters: URL credentials and auth schemes run before the vendor patterns so that
 * the surrounding structure (`https://user:…@host`) survives for the reader.
 */
export function redactText(text: string): RedactResult<string> {
  let count = 0
  let out = text

  out = out.replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => {
    count++
    return `${scheme}${user}:${REDACTED}@`
  })

  out = out.replace(AUTH_SCHEME, (_m, scheme: string) => {
    count++
    return `${scheme} ${REDACTED}`
  })

  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      count++
      return REDACTED
    })
  }

  out = out.replace(ENV_ASSIGNMENT, (m, name: string, value: string) => {
    if (!isSensitiveName(name)) return m
    if (value === REDACTED) return m
    count++
    return `${name}=${REDACTED}`
  })

  return { value: out, count }
}

/**
 * Redact an argv array, using its structure.
 *
 * Structure beats text here: `--token abc123` is two elements, and only the second is a
 * secret. Text-only redaction would miss it entirely, because `abc123` matches no vendor
 * shape and is indistinguishable from an ordinary argument in isolation.
 *
 * The returned array always has the same length as the input. Callers rebuild the display
 * string from this result rather than redacting the joined string separately — two
 * independent passes could disagree, and a record whose `args` and `command` disagree is
 * worse than one that is merely incomplete.
 */
export function redactArgs(args: readonly string[]): RedactResult<string[]> {
  let count = 0
  const out: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!

    const inline = SENSITIVE_FLAG_INLINE.exec(arg)
    if (inline) {
      out.push(`${inline[1]}=${REDACTED}`)
      count++
      continue
    }

    // `--token <secret>`: consume the value as well, preserving both positions.
    if (SENSITIVE_FLAG.test(arg) && i + 1 < args.length) {
      const next = args[i + 1]!
      // A following flag means this one was a boolean switch, not a key/value pair.
      if (!next.startsWith('-')) {
        out.push(arg)
        out.push(REDACTED)
        count++
        i++
        continue
      }
    }

    const r = redactText(arg)
    count += r.count
    out.push(r.value)
  }

  return { value: out, count }
}

/**
 * Redact a command and its arguments together.
 *
 * The single entry point for the process path. Returns the redacted parts *and* the
 * joined display form, so every consumer renders the same string and none of them can
 * reconstruct the original by accident.
 */
export function redactCommand(
  command: string,
  args: readonly string[],
): RedactResult<{ command: string; args: string[]; full: string }> {
  const c = redactText(command)
  const a = redactArgs(args)
  const value = {
    command: c.value,
    args: a.value,
    full: [c.value, ...a.value].join(' '),
  }
  return { value, count: c.count + a.count }
}

/** Depth bound for `redactDeep`. Payloads are shallow; anything deeper is a bug or an attack. */
const MAX_REDACT_DEPTH = 12

/**
 * Redact every string reachable inside an arbitrary payload.
 *
 * ---------------------------------------------------------------------------
 * WHY A GENERIC BACKSTOP EXISTS ALONGSIDE THE PRECISE PASSES
 * ---------------------------------------------------------------------------
 *
 * The recorders redact with *structure* — `redactArgs` knows that the token after
 * `--token` is a secret even though it matches no vendor shape. That precision cannot be
 * had generically, so it stays where it is.
 *
 * But precision at each call site has a failure mode this product cannot afford: it is
 * opt-in. Every future recorder, every new payload field, every `agent.output` blob is a
 * fresh chance to forget — and forgetting is unrecoverable here, because the store is
 * append-only (D-028). The redaction gap that prompted all of this existed for two phases
 * precisely because it depended on someone remembering.
 *
 * So `RecordingContext.emit()` runs this over every payload as a floor. A contributor who
 * adds a recorder and never reads this file still cannot put a `ghp_…` token in the
 * ledger. Defense in depth, with the structural pass as the guarantee and the precise
 * passes as the quality.
 *
 * Safe to run over already-redacted content: `redactText` is idempotent.
 *
 * **Keys are never redacted, only values.** A key is schema, not data — redacting one
 * would corrupt the event's shape rather than protect anything.
 */
export function redactDeep<T>(value: T): RedactResult<T> {
  let count = 0

  const walk = (v: unknown, depth: number): unknown => {
    if (depth > MAX_REDACT_DEPTH) return v

    if (typeof v === 'string') {
      const r = redactText(v)
      count += r.count
      return r.value
    }

    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))

    // Plain objects only. A Buffer, Date, or class instance is not payload-shaped, and
    // rebuilding one from its entries would silently change its type inside the record.
    if (v !== null && typeof v === 'object' && isPlainObject(v)) {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val, depth + 1)
      return out
    }

    return v
  }

  return { value: walk(value, 0) as T, count }
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

/**
 * Files whose *contents* must never be copied into snapshot storage.
 *
 * ---------------------------------------------------------------------------
 * WHY WITHHOLDING BEATS REDACTING, HERE SPECIFICALLY
 * ---------------------------------------------------------------------------
 *
 * `redactText` is the wrong tool for a `.env` file. A `.env` is not text that *contains*
 * a secret — it is a file that is *entirely* secrets, in arbitrary formats, including
 * ones no pattern will recognize. Redacting it would produce a blob that looks scrubbed
 * and is not, which is worse than not storing it: it invites trust.
 *
 * So the content is never read into the store at all. **The event is still recorded** —
 * "`.env` was written at 14:32" is real evidence, and arguably some of the most
 * interesting evidence a session can produce. Only the bytes are withheld, and the event
 * says so explicitly (`contentWithheld: 'sensitive'`).
 *
 * That is the same shape as the existing `oversized` path, which already records a large
 * file's metadata and skips its bytes. Disclosed hole, not a silent one.
 *
 * **Deliberately over-broad**, unlike `redactText`. The asymmetry is the point: a false
 * positive in `redactText` destroys evidence, while a false positive here costs only a
 * diff — the event, path, timing, and size all survive. So `*.key` is withheld even
 * though plenty of `.key` files are harmless.
 *
 * Example files (`.env.example`, `.env.sample`) are excluded: they are committed to
 * public repos by convention, contain placeholders, and are genuinely useful to diff.
 */
export function isSensitivePath(path: string): boolean {
  const base = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  const dirs = path.toLowerCase().split(/[\\/]/)

  // Templates are the documented placeholder, never the real thing. Checked first so it
  // wins over every rule below.
  if (/\.(example|sample|template|dist|tpl)$/.test(base)) return false

  // dotenv, in every spelling: .env, .env.local, .env.production, env.production, foo.env
  if (/^\.?env(\..+)?$/.test(base)) return true
  if (/\.env$/.test(base)) return true

  // Public keys are public. Checked before the private-key rules so `.pub` never matches.
  if (base.endsWith('.pub')) return false

  // Private keys and keystores.
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/.test(base)) return true
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) return true

  // Credential files.
  if (
    [
      '.npmrc',
      '.netrc',
      '_netrc',
      '.pgpass',
      '.htpasswd',
      '.git-credentials',
      // Found by audit — all hold live credentials and all were being snapshotted:
      '.envrc', // direnv: arbitrary exports, routinely secrets
      '.pypirc', // PyPI upload tokens
      '.dockercfg', // legacy docker registry auth
      '.terraformrc', // provider credentials
      '.npmrc.local',
      'kubeconfig', // cluster certs + tokens
      'credentials.json', // Google OAuth's literal default filename
      'client_secret.json',
      'terraform.tfstate', // stores provider secrets in plaintext BY DESIGN
      'terraform.tfstate.backup',
    ].includes(base)
  ) {
    return true
  }
  if (base === 'credentials' && (dirs.includes('.aws') || dirs.includes('.gcloud'))) return true
  if (base === 'config.json' && dirs.includes('.docker')) return true
  if (base === 'config' && dirs.includes('.kube')) return true
  if (/^secrets?\.(json|ya?ml|toml|ini)$/.test(base)) return true
  if (/\.tfvars$/.test(base)) return true

  // Cloud service-account keys are conventionally named and are full credentials.
  if (/^service[-_]account.*\.json$/.test(base)) return true

  return false
}
