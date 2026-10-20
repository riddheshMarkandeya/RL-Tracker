# WP3b: Background process — plan

Tier: **Substantial** (new modules, a supervisor design decision). Roadmap:
`docs/plans/2026-10-16-v1-roadmap.md` § WP3b. Inputs: ADR `docs/decisions/2026-10-16-bun-runtime.md`
(Task Scheduler notes), `docs/research/2026-10-16-bun-windows-check.md` §3, features map
"Background program form" (`docs/plans/2026-10-15-rl-tracker-features-map.md`).

## Context
WP3a made a recorder that runs from `bun run start` in a console. To be a background program, it
still needs:
- a single-instance guard (bind the dashboard port first);
- a way to stop it (`bun run stop`, through a header-guarded shutdown endpoint);
- autostart at logon, with no console window and a restart after a crash;
- `scheduleMaintenance` started with `recorder.isRecording`;
- "Stats API off" detection and the one "no data within ~60 s" toast;
- a footprint measurement against a threshold.

Task Scheduler doesn't restart a task that crashes after a good launch (tested in WP2), and a
plain `bun.exe` always opens a console. Restart and hiding therefore need their own design. The
background tracker must also not run whatever happens to be in the working tree.

### User decisions (2026-10-19)
1. **A supervisor exe and a compiled tracker exe.**
   - `install-autostart` compiles both with `bun build --compile --windows-hide-console` into
     `<dataDir>\bin\`: `rltracker-supervisor.exe` and `rltracker.exe`.
   - The task runs the supervisor. The supervisor spawns `rltracker.exe` from its own folder with
     `windowsHide: true`.
   - Restart policy:
     - a nonzero exit restarts it after 5 s, doubling up to 5 min;
     - 10 min of uptime resets the delay;
     - each restart is logged to `supervisor.log`;
     - a clean stop (exit 0) or "port taken" (exit 3) is not restarted, and the supervisor exits
       too.
   - *Revisits the map's "one Node process"*: there are now two processes, the supervisor (idle)
     and the tracker.
2. **A stable snapshot.** The background tracker is the compiled exe, not the repo's `src/`.
   Code changes reach it only when `bun run install-autostart` is run again: it stops the running
   one, rebuilds both exes, re-registers the task and starts it.
3. **`bun run dev`** runs `main.ts` from source with a repo-local data dir (`.dev-data/`,
   gitignored) on port 49101, so it can run beside the background tracker. While the game is
   running, both record, into separate DBs. `bun run start` keeps the real data dir and port.
   A dev run stops with Ctrl+C.
4. **Footprint threshold**:
   - the tracker stays under 1% of one core and under 100 MB RSS while recording a fast replay;
   - tracker plus supervisor stay under 150 MB RSS combined.
   - Idle and recording figures are recorded for both processes.

## Design

### Exit codes (`src/server/exit-codes.ts`)
| Code | Name | Meaning | Supervisor |
|---|---|---|---|
| 0 | `EXIT_OK` | clean stop | stop |
| 1 | — | Bun's uncaught exception or rejection (a Task Manager kill is 255; any other nonzero code counts the same) | restart, logged as `crash` |
| 2 | `EXIT_START_FAILED` | storage or migration failure before recording starts | restart with backoff, logged as `start_failed` (often transient: a locked DB or antivirus) |
| 3 | `EXIT_PORT_TAKEN` | another instance holds the port | stop |
| 4 | `EXIT_CONFIG_INVALID` | an invalid `RLTRACKER_PORT` or `STATS_API_URL` (added in review) | stop: no retry fixes it |

### Dashboard port override
`dashboardPort(env)` sits next to `statsApiUrl` in `recorder/client.ts`, or in `paths.ts`, and
follows the same validation pattern:
- it reads `RLTRACKER_PORT` and falls back to `DASHBOARD_PORT` (49100);
- an invalid value throws, which `main` turns into exit 4 (`EXIT_CONFIG_INVALID`; exit 2 before
  the review).

### Host (`src/server/host.ts`)
`startHost({ port, onShutdown, logger })` uses `Bun.serve` on `DASHBOARD_HOST`, as
`scripts/replay.ts` does. WP5a builds its router on this server.
- **Bind failure**: `EADDRINUSE` throws `PortTakenError`. The spike confirms that a second bind
  really fails on Windows. If it doesn't, stop and raise it; a lock file would be the fallback.
- **Host check**: a request whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>` gets 403
  (`host/bad_host`). This blocks DNS rebinding, where the attacking page is same-origin and can
  send custom headers. WP5a inherits the check.
- **Shutdown**: `POST /api/shutdown` needs the header `X-RLTracker-Shutdown: 1`.
  - A custom header forces a CORS preflight, which the server never answers.
  - A request without the header gets 403 (`host/shutdown_rejected`).
  - A request with it gets 202 at once (`host/shutdown_requested`). `onShutdown` is then scheduled
    with `setTimeout(0)`, so the response is sent before teardown.
- **Other routes**: 404, until WP5a.
- `stop()` closes the server.

### main.ts
New order:
1. Log `app/started`.
2. Read `statsApiUrl()` and `dashboardPort()`. Either failing exits 4 (`app/config_invalid`;
   exit 2 before the review).
3. Call `startHost` **before storage**, so a second instance never runs migrations or backups.
   `PortTakenError` → log `app/port_taken`, exit 3.
4. Run `openStorage()`, then create the recorder and call `recoverAtStartup()`. A failure here
   → log `app/start_failed`, then the shared `stop("start_failed", 2)` tears down what started
   (the host included) and exits 2.
   - An explicit exit is required: the listening server would otherwise keep a zombie alive that
     holds the port and records nothing.
5. `scheduleMaintenance({ storage, isRecording: recorder.isRecording })`.
6. `startStatsClient`, then `startGameWatch`.

`stop(reason)` is async and runs once: a re-entry guard covers a signal and the endpoint arriving
together. It skips any part that isn't set up yet, because a signal or shutdown can arrive
mid-startup. Steps:
1. `client.stop()`, `gameWatch.stop()`.
2. `recorder.flush()`.
3. `await maintenance.stop()`.
4. `storage.close()`, `host.stop()`.

All of it sits in `try/catch/finally`:
- a teardown error is logged as `app/stop_failed`;
- `finally` always logs `app/stopped { reason }` and calls `process.exit(0)`, so a user stop is
  never turned into a crash restart.

The existing signal handlers stay. The endpoint calls `stop("shutdown")`.

### Supervisor (`src/server/supervisor.ts`)
- **Restart policy**: a pure `decide(exitCode, uptimeMs, prevDelayMs)` returns
  `{ kind: "stop" } | { kind: "restart", delayMs, cause: "crash" | "start_failed" }`. It is TDD'd
  over every row of the exit-code table, the doubling and its cap, and the 10 min reset.
- **Loop**: `runSupervisor({ cmd, cwd, logger, spawn = Bun.spawn, sleep = Bun.sleep })`.
  - It spawns `cmd` with `windowsHide: true` and all stdio ignored; the tracker logs to its own
    file.
  - It awaits `exited`, then logs `supervisor/child_exited { code, uptimeMs }`, followed by either
    `supervisor/restarting { delayMs, cause }` or `supervisor/stopped`.
  - A throwing `spawn` (exe missing) logs `supervisor/spawn_failed` and counts as a crash. The
    spike checks whether Bun throws synchronously here or exits nonzero.
- **Entry**: `cmd = [join(dirname(process.execPath), "rltracker.exe")]`, with `cwd` set to the bin
  folder, so no paths are baked into the task. A test passes its own `cmd`.
- **Logging**: `createLogger({ dir: dataDir(), fileName: "supervisor.log" })`. Two processes
  rotating one file would race.
- **Limit**: Task Scheduler's "End" kills only the supervisor, and the tracker keeps running.
  `bun run stop` is the documented stop, and the ADR says so.

### Game watch (`src/server/game-watch.ts`)
- **Polling**: only while the client status is `waiting`, every 20 s, it runs
  `tasklist /FI "IMAGENAME eq RocketLeague.exe" /FO CSV /NH` with `windowsHide`.
  - A pure `parseTasklist(stdout)` returns true only when a CSV row's first field is
    `"RocketLeague.exe"`. The "no tasks" message is localized, so the parse doesn't read it.
- **False "off"**: the client's backoff can reach 30 s. When the watch first sees the game, it
  calls a new `client.retryNow()`, which resets the backoff and connects immediately. The 60 s
  wait then measures the game rather than the backoff. The spike times how long RL takes from
  process start to an open port.
- **State machine**: a pure `step(state, { gameRunning, status, now })` returns
  `{ state, statsApiOff, toast, retryNow }`, with an injected clock.
  - `statsApiOff` is true once the game has run 60 s or more while the status is still `waiting`.
  - The toast fires once per game run. The run resets when the process disappears.
- **Toast** (best-effort, never throws): `powershell -NoProfile -NonInteractive -Command <script>`
  with `windowsHide`. The script uses `Windows.UI.Notifications` under PowerShell's
  AppUserModelID. Logs `toast/shown` or `toast/failed { code, stderr }`.
- **Interface**: it exposes `statsApiOff()` and logs `game/stats_api_off` and
  `game/stats_api_ok`. WP5a combines this with `client.status()`; WP8 owns the toast switch.
- **Detection failure**: a `tasklist` failure logs `game/detect_failed` once per streak and counts
  as "not running".

### Stop script (`scripts/stop.ts`, `bun run stop`)
- It POSTs to `127.0.0.1:<dashboardPort()>/api/shutdown` with the header.
- A pure `describeStopResult(outcome)` is TDD'd. It maps each outcome to a message and an exit
  code:

| Outcome | Message | Exit |
|---|---|---|
| 202 | "stopping" | 0 |
| connection refused | "not running" | 1 |
| reset after sending | "stopping?" | 0 |
| other status | the status | 1 |

- Optionally, with `--wait`, it polls until the port is free. The install script uses this.

### Autostart (`scripts/autostart.ts`, `bun run install-autostart` / `uninstall-autostart`)
- **Task XML**: a pure `taskXml({ userId, exe, workDir })` is TDD'd. It XML-escapes the paths and
  emits a UTF-16 declaration (the file is written with a BOM). Contents:
  - a LogonTrigger for the user;
  - Principal `InteractiveToken` with `LeastPrivilege`;
  - `MultipleInstancesPolicy IgnoreNew` and `ExecutionTimeLimit PT0S`;
  - no battery conditions;
  - RestartOnFailure 1 min × 3, which covers failed starts only.
- **Install / update**:
  1. If the tracker answers on 49100, stop it (`stop --wait`), then wait for the supervisor exe
     to unlock.
  2. Compile both exes to `*.new.exe`, then rename them over the old ones, so a failed build
     leaves the installed pair intact.
  3. `schtasks /Create /TN RLTracker /XML <tmp> /F`, then `schtasks /Run /TN RLTracker`.
  4. Print the stop and uninstall commands.
- **Uninstall**:
  1. `schtasks /Delete /TN RLTracker /F`.
  2. `stop --wait`.
  3. Remove `bin\`. If it's still locked, print "run `bun run stop` first".
- **Errors**: a failed build or `schtasks` call prints its stderr and exits 1.
- **Risk**: a non-admin user may not be allowed to create a logon-triggered task. The spike
  checks this. If it's refused, raise it with the user. The fallback is a Startup-folder shortcut
  to the supervisor exe; the supervisor and the port guard still provide restart and single
  instance.
- The map's Start menu or desktop dashboard shortcut stays with WP5b, since there is nothing to
  open yet.

### Dev run
- `package.json`:
  `"dev": "RLTRACKER_DATA_DIR=.dev-data RLTRACKER_PORT=49101 bun run src/server/main.ts"`. Bun's
  script shell supports env prefixes on Windows; the spike confirms this.
- `.gitignore` gets `.dev-data/`.

## Steps
1. Copy this plan to `docs/plans/2026-10-19-wp3b-background-process.md`.
2. **Spike** (scratchpad, throwaway). Record the results in the plan; if any check fails, stop and
   raise it.
   1. A second `Bun.serve` on the same port throws `EADDRINUSE` on Windows.
   2. A compiled `--windows-hide-console` main-like exe opens `bun:sqlite` and writes a file.
   3. A compiled hidden supervisor spawning it with `windowsHide` runs with no window. It is
      started through a non-admin `schtasks /Create /XML` LogonTrigger task and `schtasks /Run`;
      the task is deleted afterwards. Also check whether `Bun.spawn` of a missing exe throws.
   4. The PowerShell toast shows when spawned hidden from that exe.
   5. `tasklist` output with the game closed and open (the user starts RL), and the time from the
      process appearing to port 49124 opening.
   6. The `bun run dev` env prefix works.
3. TDD the pure parts: `decide`, `parseTasklist`, game-watch `step`, `taskXml`,
   `describeStopResult`, `dashboardPort`.
4. `host.ts` and its tests:
   - a real bind, then a second bind on the same free port → `PortTakenError`;
   - shutdown without the header → 403 and no call;
   - shutdown with the header → 202, then the call;
   - a bad `Host` → 403;
   - GET → 404.
5. Rewire `main.ts` (host first, exit codes, maintenance, game watch, guarded async stop), plus
   `client.retryNow()`. Integration test `src/server/main.test.ts` spawns `main.ts` with a temp
   `RLTRACKER_DATA_DIR`, a free `RLTRACKER_PORT` and an unused `STATS_API_URL`:
   - a second spawn exits 3 and logs `app/port_taken`;
   - POST shutdown → the first exits 0, and its last log line is `app/stopped`. This covers the
     WP3a stop check through the endpoint; Ctrl+C itself stays a manual check;
   - an unopenable data dir (a file in its place) → exit 2 and nothing left listening.
6. Supervisor loop and its integration test, using a tiny entry under `test/` run as `cmd`
   (`[bun, script]`) with small injected delays:
   - exits 1 twice, then 0 → assert the restart lines and the final stop;
   - an exit-3 child → not restarted.
7. `scripts/stop.ts`, `scripts/autostart.ts`, the `package.json` scripts (`dev`, `stop`,
   `install-autostart`, `uninstall-autostart`) and `.gitignore`.
8. `bun run check` passes. Offer `/compact`.
9. Real runs (see Verification), then docs:
   - ADR `docs/decisions/2026-10-19-supervisor-autostart.md`: the supervisor plus compiled
     snapshot, the alternatives, the spike results, and the "End kills only the supervisor"
     limit;
   - roadmap: WP3b status, plus notes for later WPs (the host's Host check, `statsApiOff()`, and
     dev on 49101);
   - BACKLOG: close the design item, set Next to WP4, and resolve the perf item as measured;
   - PROJECT_INDEX.
10. `independent-review-pass`.

## Error handling and logging
Questions the logs must answer:
- Why did the tracker stop or restart: exit code, uptime, delay, cause, reason?
- Did a second instance start and leave?
- Was a shutdown or a foreign `Host` rejected?
- Why did detection or the toast not fire?

New events:
- `app/port_taken`, `app/config_invalid`, `app/start_failed`, `app/stop_failed{step}`,
  `app/stopped{reason, code}`;
- `host/listening`, `host/bad_host`, `host/shutdown_rejected`, `host/shutdown_requested`;
- `supervisor/started`, `child_exited`, `restarting`, `stopped`, `spawn_failed`;
- `game/detect_failed`, `stats_api_off`, `stats_api_ok`;
- `toast/shown`, `toast/failed`.

Fire each of these once for real (all are offline and cheap): the port-taken exit, the
start-failed exit, the rejected shutdown, and a child crash under the supervisor.

## Verification
- `bun run check` passes, including the new unit and integration tests.
- Real runs, once each, with the results written into the plan's "Verification results":
  - `bun run install-autostart` → no window, and both `tracker.log` and `supervisor.log` show a
    start;
  - running it again → it stops, rebuilds and restarts cleanly (the update path);
  - kill `rltracker.exe` in Task Manager → `supervisor/restarting`, then a new `app/started`
    within about 5 s;
  - `bun run dev` beside the background tracker → both run, on separate ports and data dirs;
  - a replay → the match is recorded. Run `bun run scripts/replay.ts
    test/fixtures/completed.ndjson --speed 10` against a dev run; the compiled tracker uses the
    real Stats API URL;
  - `bun run stop` → `app/stopped{reason:"shutdown"}` and `supervisor/stopped`, and both processes
    are gone;
  - sign out and back in → it autostarts (the user does this);
  - `bun run uninstall-autostart` → the task and `bin\` are gone;
  - game watch: RL running with the Stats API port closed → after about 60 s,
    `game/stats_api_off` and one toast (the user confirms they saw it).
- Footprint:
  - **Sampler**: a scratch script reads PowerShell `Get-Process` every 1 s (CPU-time delta divided
    by wall time, so % of one core; WorkingSet64 and PrivateMemorySize64). It samples the tracker
    and supervisor PIDs, and times one `tasklist` spawn separately.
  - **Runs**:
    - idle for 5 min, game closed, with polling;
    - recording a replay at `--speed 1`, then at a fast speed, through the compiled exe. Its
      `STATS_API_URL` is set for the measurement run only.
  - Record the figures against the thresholds.
  - If recording fails the threshold, apply the BACKLOG perf item (cached statements and
    `synchronous=NORMAL` for raw.db) and re-measure.

## Plan review
`plan-reviewer` (opus), 2026-10-19. Each finding was folded in:
1. High, zombie on a start failure after the bind → explicit `process.exit(2)` after
   `host.stop()`; `stop()` tolerates a half-started process; an integration case covers it.
2. Med, `EXIT_START_FAILED` was the same as Bun's code 1 → it is now 2, restarted and labelled
   `start_failed`; there is a row in the `decide` tests.
3. Med, a lost 202 or a failed teardown would trigger a crash restart → the 202 is returned first
   and `onShutdown` is deferred; teardown is `try/finally` with `exit(0)`; `stop.ts` maps a reset
   to "stopping?".
4. Med, a false "Stats API off" from the 30 s backoff → `client.retryNow()` runs on game
   detection; the spike times process start to an open port.
5. Med, DNS rebinding → the Host header check, with a test.
6. Med, a reinstall over a running exe → install stops it first, builds to `*.new.exe`, then
   renames.
7. Low, the localized tasklist "no tasks" text → the parse matches only the image-name CSV field.
8. Low, footprint definitions → CPU is % of one core; the `tasklist` cost is timed separately.
9. Low, test seams → `describeStopResult` is pure; `--cwd` is no longer needed, because the
   supervisor resolves the tracker next to itself.
10. Low, claims only the spike can settle → spike items 2.1–2.6, including whether the spawn
    throws and the UTF-16 BOM. Whether `windowsHide` affects logoff signals gets recorded;
    `recoverAtStartup` covers both cases.

The user's later decisions (the compiled snapshot and `bun run dev`) came after the review and
are folded into the decisions and design above.

## Spike results (2026-10-19)
Throwaway scripts in the session scratchpad. Bun 1.4.3, Windows 11, non-elevated shell.
1. A second `Bun.serve` on a bound port throws `EADDRINUSE` (`Failed to start server. Is port N
   in use?`), from the same process and from another. The port guard holds; no lock file needed.
2. A `--compile --windows-hide-console` exe opened `bun:sqlite`, wrote rows and a log file.
   `stdout.isTTY` is undefined there, and `process.stdout.write` doesn't throw.
3. A hidden supervisor exe spawning the hidden tracker exe with `windowsHide`, started by a
   non-admin `schtasks /Create /XML` LogonTrigger task (`InteractiveToken`, `LeastPrivilege`) and
   `schtasks /Run`: no window (user confirmed), both logs written, the task deleted afterwards.
   The `UserId` must be `DOMAIN\user` (`%USERDOMAIN%\%USERNAME%`); a bare name is rejected. The
   XML was written UTF-16LE with a BOM. `Bun.spawn` of a missing exe **throws synchronously**
   (`ENOENT ... uv_spawn`), so `spawn_failed` is the path for it.
4. The PowerShell toast (PowerShell's AppUserModelID), spawned hidden from that exe, exited 0 and
   showed (user confirmed).
5. `tasklist /FI "IMAGENAME eq RocketLeague.exe" /FO CSV /NH` with the game closed prints
   `INFO: No tasks are running which match the specified criteria.` and exits 0. One call takes
   about 220 ms. With the game open, the row is `"RocketLeague.exe","81680","Console","1","58,028 K"`.
   Port 49124 opened **26 s** after the process appeared (one launch, polled every 500 ms).
   In the same launch the installed tracker logged `retry_now` on detection and connected 35 s
   later, held back by the client's backoff after the first retry. A port opening more than ~35 s
   after detection would have connected only at ~65 s: a false "off". So the watch now asks for
   `retryNow` on every poll that sees the game while waiting, not only the first, and the
   connect lands within one 20 s poll of the port opening.
6. `"dev": "RLTRACKER_DATA_DIR=.dev-data RLTRACKER_PORT=49101 bun run ..."` passes both variables
   on Windows.
Also measured: Bun `fetch` errors carry `code` `ECONNREFUSED` (nothing listening) and
`ECONNRESET` (closed after sending), which `scripts/stop.ts` maps.

## Implementation notes (deviations from the design)
- `dashboardPort` lives in `paths.ts` (env-derived like `dataDir`), not `client.ts`.
- The game watch asks for `retryNow` on every poll that sees the game while waiting, not only the
  first (see spike result 5): one retry left the client's backoff able to outlast the 60 s.
- The `main.test.ts` start-failure case puts a directory where `tracker.db` belongs rather than a
  file in place of the data dir, so the log still works and `app/start_failed` can be read.
- Install and uninstall share `stopInstalled`: `stop --wait`, then up to 10 s for both exes to
  unlock, then `taskkill /F` on the supervisor and then the tracker. That covers a supervisor
  sleeping between restarts, which has no tracker to answer the stop.
- The BACKLOG perf item was applied, because the first 10× run failed the CPU bar. `Db.run` uses
  `db.query(sql).run` (cached statement), and raw.db opens with `synchronous = NORMAL`.
- `test/` joined `tsconfig.json`'s `include`, for the supervisor test's child script.

## Addendum: Stats API config check (2026-10-19)
Standard-tier addition requested after verification. The "off" toast said only "off". The tracker
now finds the install, reads `TAStatsAPI.ini` (falling back to `DefaultStatsAPI.ini` per key), and
names the fix in the toast. The plan was reviewed by `plan-reviewer` (opus) and all 8 findings were
folded in. Key points:
- `src/server/stats-config.ts`:
  - Pure parts: `parseStatsIni`, `diagnose` (`no_ini`, `ta_missing`, `send_rate_off`,
    `web_port_off`, `web_port_mismatch`), `describeProblem`, `installDirFromExe`,
    `parseEpicManifest`, `expectedPort`.
  - Live part: `checkStatsConfig`, which logs `game/stats_config` or `game/stats_config_unknown
    {tried}` and never throws.
- Locators:
  - Order by caller: startup is Epic only (no PowerShell spawn per start); when the game runs it's
    the process (`Get-CimInstance … ExecutablePath`), then Epic. *Superseded by the fix below:
    Epic only, at both phases.*
  - A candidate counts only if `<dir>\TAGame\Config` exists.
  - Steam is dropped: it's untestable here. *(Was: "the process locator covers it while the game
    runs". It doesn't: EAC hides the path. Steam installs now lose only the install layers; the
    Documents copy, which is the one in effect, is found on its own.)*
- File timestamps are unreliable (an edited ini kept its old mtime), so there's no "edited after
  launch" check. *(Wrong: the edits went to the Documents copy. See the real session below.)*
- `src/server/powershell.ts` (`runPowerShell`) adds a spawn timeout: 5 s for the process locator,
  10 s for the toast. The watch also races the check against 15 s
  (`game/stats_config_timeout`), so a hung WMI call can't wedge `poll()`'s `busy` flag.
- The game watch:
  - checks once at startup;
  - re-checks on the off transition, and the toast body is that check's first problem, or the
    generic text when no install was found or the check timed out;
  - exposes `statsConfig()` beside `statsApiOff()`.
- `showToast`'s parameters became `(logger, body, title)`.
- `web_port_off` is inferred from the ini's own comment, not tried in game. A WebPort missing from
  both files counts as off.

Verification:
- `bun run check` passes: 28 files, 267 tests. That includes the stats-config units, the
  `checkStatsConfig` integration over temp fixture installs (UTF-16, Default fallback,
  fall-through of a failing, a throwing and a stale locator), real-PowerShell timeout tests, and a
  `startGameWatch` test with a fake clock (startup check, off-transition toast body,
  `statsConfig()`, a never-resolving check that's cut off while polling continues).
- Real runs on this machine:
  - startup locators: Epic finds `C:\Games\rocketleague`, `TAStatsAPI.ini`, no problems, in 3 ms;
  - running-game locators with the game closed: `process` "no path (556 ms)", then Epic;
  - the toast with the `send_rate_off` text: `toast/shown` in 304 ms.
- Real session, 2026-10-20 (UTC), installed tracker, game running:
  - the process locator got **no path** with the game running ("no path (700 ms)"), so the
    path is hidden, probably by EAC; Epic found the install, and both are logged as designed;
  - user check `PacketSendRate=0` and launch: the "off" flag fired correctly (80 s after
    detection) and the toast showed, but its body said "looks right". **The check reads the
    wrong file.** The user's edit was in
    `<Documents>\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini` (OneDrive-redirected here;
    the game-written `[IniVersion]` section shows it's the game's user copy). It was written at
    02:33:05, and the game, restarted with 30, connected at 02:33:50. The install-dir copy still
    reads 30 and dates from 2026-10-15. That also explains the Context note that "timestamps are
    unreliable": the edits went to the other file. Fixed below ("Fix: the check reads the Documents
    copy").

### Fix: the check reads the Documents copy (2026-10-19)
Standard tier; plan reviewed by `plan-reviewer` (opus), all 8 findings folded in. Evidence: with
the Documents copy at 0 and the install copy at 30, no data came, so the Documents copy wins. Its
`[IniVersion] 0=` equals the install `DefaultStatsAPI.ini`'s mtime: the standard Unreal 3 per-user
copy generated from the Default.
- Layers per key: `{ ...Default, ...install TAStatsAPI.ini, ...Documents copy }`. `diagnose({ user,
  ta, def })`; `file` is `"user" | "install" | "default" | null`.
- `user_missing` replaces `ta_missing` and is raised whenever the Documents copy is absent, even if
  the install copy looks right: the game writes it at launch, so its absence most likely means a
  wrong Documents path, which the install file must not hide.
- `describeProblem(problem, port, file)` names
  `Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini` when that's in effect (and for
  `user_missing`/`no_ini`), else "TAStatsAPI.ini in the game's TAGame\Config folder". The full
  path is in the log and `statsConfig().path`.
- Documents lookup (`findUserConfigDir`): `reg query "HKCU\…\User Shell Folders" /v Personal`
  (`parseRegSz`, `expandEnv`), 5 s timeout; on a nonzero exit, timeout, unparsable value or a
  folder that doesn't exist (OEM code page decoding), the attempt goes into `tried` and
  `%USERPROFILE%\Documents` is used.
- `runCommand(argv, timeoutMs)` in `powershell.ts` holds the spawn; `runPowerShell` calls it.
- `fromProcess`, `installDirFromExe` and the startup/running locator pair are gone: one
  `LOCATORS = [fromEpic]`. The watch keeps `phase` for its log.
- `checkStatsConfig({ …, userDir })` returns a result when either the Documents dir or the install
  is found (`installDir`/`foundBy` nullable, `userConfigDir` added, `path` mapped per `file`).
  `game/stats_config` adds `userConfigDir`, `userFoundBy` and `layers` (each file's parsed values).
  A read failure logs `stats_config_read_failed {path}`.

Verification:
- `bun run check` passes: 28 files, 286 tests. New: `parseRegSz` (this machine's real output, a
  path with spaces, `REG_SZ`, a missing value), `expandEnv`, `diagnose` (the Documents 0 beats the
  install 30; no Documents copy with the install at 30 → `user_missing`), `describeProblem` per
  file, `checkStatsConfig` over temp dirs (every layer logged, no install, a `userDir` outcome and
  rejection, neither found), `findUserConfigDir` fallbacks with a fake `run`, and a real
  `runCommand` (`cmd /c … exit 3`).
- Real run, game running: `userConfigDir` = the OneDrive Documents path via `registry`, file
  `user`, layers user 30 / install 30 / default 0, no problems. `findUserConfigDir` 164 ms, whole
  check 159 ms (the process locator alone cost 700 ms).
- Real run, Documents copy set to 0 (game closed; install copy still 30, the case that failed):
  `send_rate_off`, file `user`, path the Documents copy, layers user 0 / install 30 / default 0.
- User check, 2026-10-20: launched with the Documents copy at 0; the toast (notification panel)
  named the Documents `TAStatsAPI.ini` and said to set PacketSendRate to 30. Restored to 30
  afterwards.

## Verification results (2026-10-19)
`bun run check`: typecheck, lint and tests pass (26 files, 239 tests, final code). The installed
snapshot was rebuilt from that code after the uninstall check.

| Check | Result |
|---|---|
| `install-autostart` | both exes built, task created and run; no window (no `MainWindowHandle`); `supervisor/started`, then `app/started`, `host/listening` 49100 |
| run it again (update) | "RL Tracker stopped." → rebuild → `supervisor/child_exited{code:0}`, `stopped`, new `started`; `app/stopped{reason:"shutdown"}` |
| kill `rltracker.exe` (Stop-Process -Force) | `child_exited{code:255}` (a kill is 255, not 1), `restarting{delayMs:5000,cause:"crash"}`, new `app/started` 5 s later |
| `bun run dev` beside it | 49100 (compiled) and 49101 (dev) both listening; the dev run recorded `completed.ndjson` at 10× (`summary` completed, 728 stored) |
| POST shutdown without the header | 403, `host/shutdown_rejected` |
| `bun run start` while installed | exit 3, `app/port_taken` |
| `RLTRACKER_PORT=49101 bun run stop` | "RL Tracker is stopping.", dev log ends `app/stopped{reason:"shutdown"}` |
| start failure | fired for real by `main.test.ts` (spawned process exits 2, `app/start_failed`, port free) |
| game with Stats API on | `retry_now` on detection, connected 35 s later; no `stats_api_off`, no toast |
| game with `PacketSendRate=0` | `game/stats_api_off{runningForMs:79993}` and `toast/shown` once, then `stats_api_ok` when the game closed. **The toast banner doesn't appear over the full-screen game** (Windows suppresses it; it waits in the notification panel; user confirmed) |
| `uninstall-autostart` | task gone (`schtasks /Query` fails), `bin\` removed, both processes exited (`supervisor/stopped{code:0}`) |
| sign out and in | **pending: user** |

The 60 s "off" flag lands on a 20 s poll, so it fires 60–80 s after detection (80 s here: the
60 s poll came a few ms short).

### Footprint
Sampled with PowerShell `Get-Process` about every 2 s (CPU = CPU-time delta / wall delta, % of
one core). Working set (WS) is the RSS figure; private bytes are listed for reference.

| Run | Process | CPU mean | CPU max | WS max | Private max |
|---|---|---|---|---|---|
| idle 5 min, game closed (300 samples) | tracker | 0.07% | 3.1% | 27.5 MB | 95.4 MB |
| | supervisor | 0.03% | 4.7% | 22.1 MB | 83.6 MB |
| recording 1× (real rate), old code | tracker | 0.22% | 6.2% | 38.1 MB | 112.3 MB |
| recording 10×, old code, replay window | tracker | 1.59% / 1.46% (two runs) | 6.2–7.8% | 34.9 / 107.8 MB | 101.7 / 101.3 MB |
| recording 10×, perf fix, replay window | tracker | 0.77% / 0.89% (two runs) | 7.7–10.8% | 110.9 / 110.7 MB | 110.1 / 110.7 MB |

One `tasklist` call: about 220 ms wall, only while waiting, every 20 s.

Against the thresholds:
- **CPU under 1% while recording a fast replay**: fails before the perf fix (about 1.5% at 10×),
  passes after it (about 0.8–0.9%). At the real rate it's 0.22%.
- **Tracker WS under 100 MB**: passes idle (27.5 MB) and in the first runs (35–38 MB). The three
  10× runs made while Rocket League was open peaked at 108–111 MB, old code included, so the perf
  change doesn't cause it. The jump is a single ~75 MB step at replay start that then stays flat,
  while private bytes moved only a few MB. That points to shared or file-backed pages, not
  heap growth. Not explained yet.
- **Tracker + supervisor WS under 150 MB**: about 50 MB idle; up to about 133 MB with the
  108–111 MB tracker figure.

## Review log

Diff re-classified at review time: about 2,000 code lines, design tier Substantial → the
Substantial row. Scope: WP3b, the stats-config addendum and its Documents-copy fix. Prerequisites:
`bun run check` green (286 tests). Snapshot before fixes: `8d9c7e3` (`git stash create`).

### Round 1 (2026-10-20): `/code-review high`, `arch-reviewer` (sonnet), `security-reviewer`, `/simplify`

`security-reviewer`: no findings (spawn argv, toast quoting, shutdown endpoint, task XML, ini /
registry / manifest inputs all checked).

1. `detectGame` spawns `tasklist` with no timeout; one hang leaves `busy` set and the watch dead
   (code-review + arch). **[Fixed]** through `runCommand` with a 10 s timeout.
2. `install` stops the tracker before building; a failed build leaves nothing recording.
   **[Fixed]** builds first, stops only once both built.
3. `retryNow` logs `retry_now` on every 20 s poll while the game runs with the Stats API off.
   **[Fixed]** logged once per failing streak; `still_waiting` carries a `retries` count. Test.
4. `bun run stop` while the supervisor sleeps between crash restarts says "not running", then
   the supervisor restarts the tracker. **[Fixed]** on the installed port, a refused connection
   ends a running supervisor (`taskkill`); a dev port leaves it alone. Tests via injected
   `request`/`endSupervisor`.
5. A supervisor killed on its own leaves the tracker unsupervised; the next supervisor exits on
   the taken port. **[Deferred → BACKLOG]** watch list; already an ADR limit (Task Scheduler End).
6. The two renames that swap in the new exes aren't atomic, and a failure gives a raw stack
   trace. **[Fixed]** each rename retries 10 s (antivirus), then a `StepFailed` that says to
   re-run install.
7. An invalid `RLTRACKER_PORT`/`STATS_API_URL` exits 2, which the supervisor retries forever.
   **[Fixed]** new `EXIT_CONFIG_INVALID = 4`, logged `app/config_invalid`, not restarted. Tests in
   `decide` and `main` (a real process).
8. `stopInstalled` matched the message text "not running" (code-review + arch). **[Fixed]**
   `stopTracker` returns `notRunning`.
9. `stop.ts` hard-coded the shutdown header (code-review + arch). **[Fixed]** imports
   `SHUTDOWN_HEADER` (and so does `main.test.ts`).
10. `main.ts` `stop()` ran every teardown step in one `try`, so an early throw skipped storage
    close. **[Fixed]** each step guarded on its own; `stop_failed` names the step.
11. `exit-codes.ts` comment and this plan's exit-code table said a kill shows as 1 (it's 255).
    **[Fixed]** both.
12. `game-watch.ts` holds detection, toasts, the state machine and the config check.
    **[Deferred]** to WP8 (toast switch), which moves `showToast` into its own module.
13. `CheckPhase` passed to a check that ignores it. **[Verified, no fix needed]** the addendum
    keeps it for the timeout log.
14. `Locator`/`findInstall` with one real locator. **[Verified, no fix needed]** it's the test
    seam (fake locators); a second real locator isn't planned.
15. Nits: the BOM literal → `"﻿"`; the swallowed `schtasks /Delete` comment now says why
    going on is safe; the `rmSync` failure includes the error. **[Fixed]**
16. Docs: PROJECT_INDEX bullet split; stale "Filed in BACKLOG" line; untracked 108–111 MB WS
    miss; ADR "Files touched" scope. **[Fixed]** (the WS miss → BACKLOG, performance Med).

Side effect while red: the new `stopTracker` tests ran before the injection existed and called
the real endpoint, stopping the installed tracker (05:55:02Z); restarted by the reinstall below.

`/simplify` (reuse, simplification, efficiency, altitude), deduped:
- **[Fixed]** `killImage` in `stop.ts`, used by `endSupervisor` and `stopInstalled` (was two
  `taskkill` spawns); `TRACKER_EXE`/`SUPERVISOR_EXE` live in `paths.ts` (were in autostart,
  supervisor and stop).
- **[Fixed]** one teardown: a storage failure at startup goes through `stop(reason, code)` instead
  of its own partial teardown.
- **[Fixed]** one layer vocabulary: `IniLayers = Record<IniLayer, …>` (`user`/`install`/`default`),
  so the log passes `layers` as is.
- **[Fixed]** small ones: the `.new.exe` paths built once; `allowedHosts` is a `const` set;
  `TA_INI`/`DEFAULT_INI` unexported.
- **[Skipped]**
  - `fromEpic` as `async`: `require-await` rejects it.
  - The `synchronous` option as a boolean: it mirrors the pragma, like `autoVacuum`.
  - `GameWatch.statsConfig()`/`statsApiOff()` unused: WP5's status display reads them (planned).
  - `retryNow` replaced by a shorter backoff cap: the recorded deviation ("`retryNow` on every
    poll"); nothing new.
  - A supervisor stop channel instead of `taskkill`: a design change for a rare case; the BACKLOG
    orphan item covers the related gap.
  - `nextDelay` reuse in `decide`: it would pull the client into the supervisor exe for a
    one-line formula.
  - A `withTimeout`/`runChecked` helper and renaming `powershell.ts`: two callers each, cosmetic.
  - `userDir` ‖ `findInstall`: ~100 ms on a cold path.
  - `tasklist` cost: about 0.1–0.3% of a core, within budget.

Live after fixes:
- `bun run check` green (292 tests).
- `install-autostart` built both exes before stopping anything, then swapped and ran them.
- Killed `rltracker.exe` with `taskkill /F` (exit 1 that way; a Task Manager kill is 255; either
  is a crash, supervisor backoff 5 s), then `bun run stop` printed "wasn't
  running; ended its supervisor…", and nothing restarted 8 s later.
- Re-ran the task: `stats_config` reads the Documents copy at 30, no problems.

### Round 2 (2026-10-20): delta vs `8d9c7e3`; `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`

`/code-review low` and `security-reviewer`: no findings. `arch-reviewer` confirmed the round-1
fixes and found:
1. Plan lines still said invalid config exits 2 and the start failure stops only the host.
   **[Fixed]**
2. The events list lacked `app/config_invalid` and the new `step`/`code` fields. **[Fixed]**
3. "Killed (exit 1)" looked like it contradicted "a kill is 255". **[Fixed]** wording: `taskkill
   /F` gives 1, Task Manager 255.
4. `bun run stop` while a restarted tracker hasn't bound its port yet ends the supervisor and
   orphans that tracker. **[Deferred → BACKLOG]** added to the orphan watch item (narrow, manual).
5. A failing `stopInstalled` left both ~92 MB `.new.exe` files. **[Fixed]** build, stop and swap
   share one `try/finally` that removes them.
6. `replace` retried permanent errors for 10 s. **[Fixed]** only EPERM/EBUSY/EACCES retry.
7. The `main.ts` start-failure comment no longer matched. **[Fixed]**
8. `retry_now` can log once more when a streak hasn't failed yet. **[Verified, no fix needed]**
   at most one extra line per streak.

Live: `bun run check` green (292). `install-autostart` with the tracker running built, stopped
("RL Tracker stopped."), swapped and ran; `bin\` holds only the two exes. Snapshot `37bf592`.

### Round 3 (2026-10-20): delta vs round 2; `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`

`/code-review low` and `security-reviewer`: no findings. `arch-reviewer` confirmed the round-2
fixes; one doc line ("Either failing exits 2" in the startup order) was missed by round-2 item 1.
**[Fixed]** It's a doc-only nit fix, so it doesn't reopen a round.

**Review closed**:
- 3 rounds; passes: `/code-review` high, then low twice; `arch-reviewer` (sonnet) three times;
  `security-reviewer` three times; `/simplify` once.
- 25 findings:
  - 19 fixed;
  - 3 deferred: the orphan and the stop race → BACKLOG, `toast.ts` → WP8;
  - 3 verified, no fix needed.
- Plus the `/simplify` cleanups.
