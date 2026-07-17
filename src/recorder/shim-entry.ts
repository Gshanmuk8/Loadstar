#!/usr/bin/env node
/**
 * LODESTAR — shim entry point. This is what the shim scripts actually invoke.
 *
 * Same shape, and same reason, as src/cli/index.ts: ESM instantiates the entire module
 * graph — loading node:sqlite and firing its ExperimentalWarning — *before* evaluating
 * any module body. A static `import './suppress-warnings-runner.js'` at the top of
 * shim-runner.ts therefore runs too late, and the warning leaks into the output of
 * every `npm test` the developer runs.
 *
 * A dynamic import is the only ordering that works: this body runs, installs the
 * filter, and only then loads the code that touches node:sqlite.
 *
 * This mistake was made twice — once in the CLI (D-019), once here. The rule worth
 * remembering: in ESM, "import it first" is not the same as "run it first".
 */

import './suppress-warnings-runner.js'

const { runShim } = await import('./shim-runner.js')
process.exit(runShim())
