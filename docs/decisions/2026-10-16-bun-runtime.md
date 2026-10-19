# Bun is the runtime; Vitest runs under Bun; Playwright stays on Node

Date: 2026-10-16

## Context
The roadmap switched the runtime from Node to Bun before WP2, pending a check on Windows:
`bun:sqlite`'s features, whether Vitest and Playwright run under Bun, and how a long-running
`bun.exe` behaves under Task Scheduler. The roadmap's exit gate: if Bun fails a must-have, raise
it rather than switching back silently. Sources: `docs/research/2026-10-16-bun-windows-check.md`.
Plan: `docs/plans/2026-10-16-wp2-storage.md`.

## Decision
- Bun 1.4.3 is the runtime. Storage uses `bun:sqlite` behind `src/server/db/sqlite.ts`, the only
  file that imports it, so the driver can be swapped.
- Tests: `bun --bun vitest run` with `pool: "forks"` (`vitest.config.ts`), so DB tests import the
  real `bun:sqlite`. `bun test` stays the fallback if that ever breaks.
- Playwright (WP5b) runs on Node 24 (installed): Playwright doesn't support Bun officially
  (microsoft/playwright #27139). WP5b confirms.

## Why
Every must-have passed on real files (spike on 2026-10-16, Windows 11, Bun 1.4.3):

| Check | Result |
|---|---|
| Bundled SQLite | 3.53.4 (`VACUUM INTO` needs ≥ 3.27) |
| `auto_vacuum=INCREMENTAL` set before `journal_mode=WAL` on a new file | reads back 2 after table creation and reopen |
| Same, WAL set first | reads back **0**: SQLite silently ignores it. `openDb` sets it first |
| `incremental_vacuum` after deleting 19k of 20k rows | page_count 1060 → 56, file 4.3 MB → 0.2 MB after checkpoint |
| `VACUUM INTO` | the copy opens with all rows |
| `db.transaction(fn).immediate()` throwing | rolls back rows and `PRAGMA user_version` |
| `bun --bun vitest run` (forks) with a `bun:sqlite` temp-file test | passes, as do the 34 existing tests |

The alternative, Node with `node:sqlite` or better-sqlite3, would need a native build or an
experimental module; nothing failed that would justify it.

## Task Scheduler notes for WP3b
Tested for real with a temporary task (deleted afterwards): `bun.exe crash.ts`, which appends a
line and exits 1; RestartOnFailure every 1 min × 3; `ExecutionTimeLimit` `PT0S`.
- **A crash after a good launch is not retried.** After 4 min the log had 1 line;
  `LastTaskResult` = 1. RestartOnFailure only covers a failed start. WP3b needs its own restart
  (a supervising wrapper loop, or a repeating trigger with "don't start a new instance").
- The default `ExecutionTimeLimit` stops a task after 72 h; set `PT0S`.
- Run from an interactive-logon task, `bun.exe` got a console (`stdout.isTTY` true), so a window
  shows. Hiding needs `bun build --compile --windows-hide-console` or a wrapper.
- stdout, stderr and `console.log` writes didn't throw there. The no-console case (hidden exe) is
  untested; the logger already guards those writes.

## Files touched
`package.json` (`test`, `check`), `vitest.config.ts`, `tsconfig.json` (includes the config),
`src/server/db/sqlite.ts`.

## Verification
The spike script and the Vitest spike test were throwaway (scratchpad; the test was deleted).
`bun run check` passes under the new runner.

## Related
- `docs/research/2026-10-16-bun-windows-check.md`
- `docs/plans/2026-10-16-v1-roadmap.md` (WP2, WP3b, WP5b)
