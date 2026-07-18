#!/usr/bin/env node
/**
 * LODESTAR — CLI entry shim.
 *
 * This file exists only to install the warning filter before anything loads
 * node:sqlite. It must stay this small.
 *
 * Why a shim and not just an import at the top of main.ts: ESM instantiates the whole
 * module graph — resolving and loading every import, including builtins — *before*
 * evaluating any module body. A static `import './suppress-warnings.js'` placed first
 * therefore still runs too late: node:sqlite is already loaded and has already warned.
 * A dynamic `import()` defers loading the rest of the program until after this module
 * body has run, which is the only ordering that works.
 *
 * See DECISIONS.md D-019.
 */

import './suppress-warnings.js'
import { unsupportedNodeReason } from './node-guard.js'

// Before the dynamic import: main.js's module graph is what loads node:sqlite, and on
// an old Node that import is the crash this guard exists to prevent.
const reason = unsupportedNodeReason(process.versions.node)
if (reason) {
  process.stderr.write(reason)
  process.exit(1)
}

const code = await (await import('./main.js')).run(process.argv.slice(2))
process.exit(code)
