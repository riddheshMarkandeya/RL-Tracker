# The background tracker is a compiled snapshot run by a supervisor exe from a logon task

Date: 2026-10-19

## Context
WP3a's recorder runs from `bun run start` in a console. As a background program it needs to start
at logon with no window, come back after a crash, run once, and stop on request. The WP2 check
(`docs/decisions/2026-10-16-bun-runtime.md`) found that Task Scheduler doesn't restart a task that
crashes after a good launch (RestartOnFailure covers failed starts only), and that a plain
`bun.exe` from an interactive-logon task gets a console window. The features map planned "one
Node process". Plan: `docs/plans/2026-10-19-wp3b-background-process.md`.

## Decision
- `bun run install-autostart` compiles two exes with `bun build --compile --windows-hide-console`
  into `<dataDir>\bin\`: `rltracker-supervisor.exe` (`src/server/supervisor.ts`) and
  `rltracker.exe` (`src/server/main.ts`). It registers the `RLTracker` task (LogonTrigger,
  `InteractiveToken`, `LeastPrivilege`, `IgnoreNew`, no time limit, no battery conditions) that
  runs the supervisor, and starts it.
- The supervisor spawns `rltracker.exe` from its own folder with `windowsHide` and no stdio, and
  restarts it on a nonzero exit: 5 s, doubling to 5 min, reset after 10 min of uptime. Exit 0
  (a clean stop) and exit 3 (port taken) end both. Each decision goes to `supervisor.log`.
- **A stable snapshot.** The background tracker never runs the working tree. Code changes reach
  it only through `bun run install-autostart` again, which stops it, rebuilds to `*.new.exe`,
  swaps the pair, re-registers and restarts. `bun run dev` runs the source beside it, on port
  49101 with `.dev-data/`.
- Single instance: binding the dashboard port (49100) is the guard. A second instance exits 3
  before opening storage.
- Stopping: `bun run stop` POSTs `/api/shutdown` with the `X-RLTracker-Shutdown: 1` header; the
  host also refuses any `Host` other than `127.0.0.1:<port>` or `localhost:<port>`.
- Exit codes (`src/server/exit-codes.ts`): 0 clean stop, 1 Bun's crash, 2 start failed
  (restarted with backoff: often transient), 3 port taken.

This revisits the map's "one Node process": there are two processes, an idle supervisor and the
tracker.

## Why
Alternatives considered:
- **Task Scheduler alone.** No restart after a launched crash (tested in WP2), and `bun.exe`
  shows a console.
- **A repeating trigger with "don't start a new instance"** (every few minutes). Restarts within
  the interval instead of seconds, a console still shows, and every crash looks the same.
- **The tracker running `bun.exe src/server/main.ts` from the repo.** Whatever is in the working
  tree would run at the next restart or logon, half-edited code included; the user chose a
  snapshot.
- **A lock file for single instance.** Not needed: a second bind fails with `EADDRINUSE` on
  Windows (spike), and the port must be held anyway for the dashboard.
- **A Startup-folder shortcut** instead of a task: the fallback if a non-admin user couldn't
  create a logon task. The spike showed they can.

## Spike results
On 2026-10-19 (Windows 11, Bun 1.4.3, non-elevated): a second `Bun.serve` on a bound port throws
`EADDRINUSE`; a hidden compiled exe uses `bun:sqlite` and writes files; a hidden supervisor exe
started by a non-admin LogonTrigger task (`UserId` as `DOMAIN\user`, XML in UTF-16LE with a BOM)
spawns the hidden tracker with no window; `Bun.spawn` of a missing exe throws `ENOENT`
synchronously; a PowerShell toast from the hidden exe shows. Details in the plan.

## Limits
- Task Scheduler's **End** kills only the supervisor; the tracker keeps running, unsupervised, and
  a supervisor started later exits on the taken port. `bun run stop` is the documented stop.
- A kill from Task Manager shows up as exit 255, not 1; the supervisor treats every nonzero code
  other than 3 (port taken) and 4 (invalid config) as a crash.
- The two exes are about 92 MB each on disk (each embeds the Bun runtime).

## Files touched
`src/server/{main,host,supervisor,game-watch,exit-codes,paths}.ts`, `src/server/recorder/client.ts`
(`retryNow`), `scripts/{stop,autostart}.ts`, `package.json` (`dev`, `stop`, `install-autostart`,
`uninstall-autostart`). The same work package also added the Stats API config check
(`stats-config.ts`, `powershell.ts`) and a SQLite perf fix (`db/sqlite.ts`); neither is part of
this decision, and the plan records both.

## Verification
Unit and integration tests (`host`, `main` as a process, the supervisor with a real child), plus
real runs of install, update, kill-and-restart, dev beside it, stop and uninstall. See the plan's
"Verification results".

## Related
- `docs/plans/2026-10-19-wp3b-background-process.md` (spike, verification and footprint figures)
- `docs/decisions/2026-10-16-bun-runtime.md` (the Task Scheduler notes this answers)
