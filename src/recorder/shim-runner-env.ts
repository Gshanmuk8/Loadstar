/**
 * The env contract between the wrapper and its shims.
 *
 * These live in their own module because `shim-runner.ts` runs on import — it ends in
 * `process.exit(main())`. Anything importing constants from it would execute a shim.
 */

export const ENV_SESSION = 'LODESTAR_SESSION_ID'
export const ENV_DB = 'LODESTAR_DB'
export const ENV_SHIM_DIR = 'LODESTAR_SHIM_DIR'

/**
 * The `execId` of the currently-running command, handed down to anything it spawns.
 *
 * This is how process ancestry is *observed* rather than inferred: a shim sets it before
 * exec'ing, so every shimmed descendant reads its true parent from the environment it was
 * born with. Unlike the shim directory (D-026), a stripped value here degrades safely —
 * ancestry is simply unknown, and unknown stays unknown. See D-034.
 */
export const ENV_EXEC_ID = 'LODESTAR_EXEC_ID'
export const ENV_RUNTIME = 'LODESTAR_RUNTIME_ID'
export const ENV_T0 = 'LODESTAR_SESSION_T0'
