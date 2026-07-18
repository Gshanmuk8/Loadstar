/**
 * LODESTAR — the one version string.
 *
 * Read by `--version` and stamped into every Evidence Record as `generator.version`.
 * A record must say which build produced it — facts are computed claims, and a claim
 * without provenance cannot be re-examined when the engine improves (D-059).
 *
 * Keep in sync with package.json manually; there is no runtime package.json read on
 * purpose — `dist/` must not reach outside itself for a file that may not ship.
 */
export const LODESTAR_VERSION = '0.1.1'
