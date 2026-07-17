/**
 * LODESTAR — the library entry point (`main` / `types` in package.json).
 *
 * V1-DESIGN.md §11 names the stable library surface; STABILITY.md governs what may
 * change. This file is a pure re-export of the two public barrels — the Evidence
 * Record layer (build, serialize, check, links) and the Evidence Graph (store,
 * identity, sync, queries). It defines no API of its own: anything importable here
 * is importable from its home barrel, and the home barrel's docs are the contract.
 *
 * The CLI does not use this file (it enters through cli/index.js, the `bin` entry).
 */

export * from './record/index.js'
export * from './graph/index.js'
