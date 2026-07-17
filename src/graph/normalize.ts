/**
 * LODESTAR — git remote URL normalization (GRAPH-SPEC §4.2, vector-pinned).
 *
 * One function, one place, because identity grouping is only as sane as the
 * canonical form is stable: `git@github.com:acme/payments.git`,
 * `https://github.com/acme/payments`, and `ssh://git@github.com:22/acme/payments.git`
 * are one address, and every caller must agree on that byte-for-byte.
 *
 * Failure direction (F2): anything this function is unsure about becomes `null`
 * (not a remote signal) — never a guessed canonical form. A missing signal costs a
 * weaker basis; a wrong signal silently merges two repos.
 *
 * The golden vectors in spec/identity-vectors.json §normalization pin every rule.
 * Changing behavior here is a GRAPH-SPEC change and needs a DECISIONS entry.
 */

const DEFAULT_PORTS: Record<string, string> = {
  ssh: '22',
  https: '443',
  http: '80',
  git: '9418',
}

/**
 * Canonicalize a git remote URL to `host[:port]/path`, or `null` when the input is
 * not a remote identity signal (local paths, file://, empty, unparseable).
 */
export function normalizeRemoteUrl(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null

  // Windows drive paths and POSIX absolute/relative paths are machine-local — a
  // path collides across machines meaninglessly, so it is not a remote signal.
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('/') || input.startsWith('.')) {
    return null
  }

  // scheme://[userinfo@]host[:port]/path
  const url = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)(?:\/(.*))?$/i.exec(input)
  if (url) {
    const scheme = url[1]!.toLowerCase()
    if (scheme === 'file') return null
    const { host, port } = splitAuthority(url[2]!)
    if (!host) return null
    return assemble(host, port, DEFAULT_PORTS[scheme], url[3] ?? '')
  }
  // Anything ELSE carrying `://` is a URL this function does not understand —
  // `file:///x` (empty authority) lands here. It must not fall through to the
  // scp parser, which would happily read `file` as a hostname and mint a fake
  // signal. Unsure means null, never a guess.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return null

  // scp-like: [userinfo@]host:path — the colon must not look like a drive or port-only.
  const scp = /^(?:[^@]+@)?([^:/]+):(.+)$/.exec(input)
  if (scp) {
    const host = scp[1]!.toLowerCase()
    // scp form implies ssh; it has no port syntax, so no port handling.
    return assemble(host, undefined, undefined, scp[2]!)
  }

  return null
}

function splitAuthority(authority: string): { host: string | null; port?: string } {
  // Strip userinfo — everything up to the LAST @ is credentials/routing, never kept.
  const at = authority.lastIndexOf('@')
  const hostPort = at === -1 ? authority : authority.slice(at + 1)
  const m = /^([^:]+)(?::(\d+))?$/.exec(hostPort)
  if (!m) return { host: null }
  const out: { host: string; port?: string } = { host: m[1]!.toLowerCase() }
  if (m[2] !== undefined) out.port = m[2]
  return out
}

function assemble(
  host: string,
  port: string | undefined,
  defaultPort: string | undefined,
  rawPath: string,
): string | null {
  let path = rawPath.replace(/^\/+/, '').replace(/\/+$/, '')
  if (path.toLowerCase().endsWith('.git')) path = path.slice(0, -4)
  if (!path) return null

  const keepPort = port !== undefined && port !== defaultPort
  return `${host}${keepPort ? `:${port}` : ''}/${path}`
}
