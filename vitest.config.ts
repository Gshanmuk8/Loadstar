import { defineConfig } from 'vitest/config'

/**
 * `node:sqlite` is importable only with the `node:` prefix — unlike every other
 * builtin, the bare name `sqlite` is not registered. Vite strips the prefix before
 * checking its builtin list, fails to find `sqlite`, and tries to resolve it as a
 * package on disk. Externalizing it explicitly short-circuits that.
 *
 * Remove this once Vite recognizes node:sqlite natively.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Nothing here is mocked: tests spawn real login shells, real npm runs, real git.
     * Under full-suite parallel load on a slow disk, a real `bash -l -c` can exceed
     * vitest's 5s default while being perfectly healthy — observed as two coverage-probe
     * timeouts that pass in isolation. The assertions are about behavior, never about
     * latency, so the ceiling is generous. A test that HANGS still fails; that is all
     * this timeout is for.
     */
    testTimeout: 30_000,
    server: {
      deps: {
        external: [/node:sqlite/],
      },
    },
  },
  ssr: {
    external: ['node:sqlite'],
  },
})
