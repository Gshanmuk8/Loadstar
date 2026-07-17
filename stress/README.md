# Stress suites

`npm run stress`

Separate from `npm test` because these spawn dozens of real OS processes, hammer real
filesystems, and deliberately try to fork bomb the machine. Slow, and worth it.

| Suite | Proves |
|-------|--------|
| `adversarial.mjs` | Chain survives hostile unicode, tamper is caught mid-chain, self-consistent forgery still breaks, narration cannot create a fact, unknown stays unknown |
| `runtime.mjs` | 300-file churn, exit-code fidelity 0–255, shim fidelity through a real shell, SIGKILL leaves a valid partial chain |
| `forkbomb.mjs` | The shim never execs itself, under 5 hostile env configurations. **A hang IS the failure** — every spawn is hard-timeout'd |
| `concurrency.mjs` | N OS processes appending to ONE hash chain stay gapless and verifiable |

## Why these exist

Every serious bug in this codebase had the same shape: **a mechanism that silently did
nothing, or the wrong thing, while looking correct.** Unit tests were green for all of
them.

- chokidar 4 accepted glob strings and matched nothing → LODESTAR recorded its own
  database writes, and each write triggered another (D-022).
- The shim inferred its own directory from `argv[1]` and got it wrong → it found itself
  on PATH and recursed until the OS killed it (D-026).

Unit tests verify what you thought of. These find what you didn't.

## Adding a suite

Register it in `run-all.mjs`. Exit non-zero on failure. Prefer real processes over
mocks — a mock cannot fork bomb, which is exactly why it would not have caught D-026.
