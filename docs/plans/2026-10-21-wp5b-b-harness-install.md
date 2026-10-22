# WP5b-b: Playwright harness, web build at install, installed `dist` path, Start menu shortcut

## Context
WP5b-a built the web shell (`src/web/`), but nothing serves it once installed. The installed tracker
serves `RLTRACKER_STATIC_DIR` or nothing (`src/server/paths.ts:28`), `deploy` never runs `vite build`,
and there is no shortcut to open the dashboard. The roadmap's WP5b done-criterion ("the shell renders
live status from a replay") was so far checked only by hand. Roadmap `docs/plans/2026-10-16-v1-roadmap.md`
→ "WP5b" → WP5b-b bullet; BACKLOG Next pointer. Tier: Substantial (new test harness, install changes).

## Constraints that bind this plan
- Roadmap scope: Playwright harness against a seeded temp DB plus a replay, with axe; `vite build` in
  `deploy`; the installed `dist` path (`staticDir()` default); the Start menu shortcut (map: "a fixed
  URL, plus a Start menu or desktop shortcut created at install. The browser never opens by itself").
- **User decisions (2026-10-21)**:
  - `deploy` runs the Playwright smoke as a gate: check → e2e → install → recompute.
  - Playwright drives the **installed Chrome** (`channel: "chrome"`), with no Chromium download.
- Playwright runs on Node, not Bun (decision `docs/decisions/2026-10-16-bun-runtime.md`; "WP5b confirms").
  Node 24.14.1 is installed. Seeding needs `bun:sqlite`, so seeding and the tracker run under Bun.
- The cross-cutting rules: loopback only, data local, strict TS and ESLint, a Playwright smoke per
  page, the structured logger on the server side.
- Install pattern (`scripts/autostart.ts`): build beside the running install, stop it only once
  every build succeeded, swap, and on any failure leave the old install intact. `StepFailed` for
  user-facing failures. Uninstall removes `<dataDir>\bin` and keeps the data.
- Existing contracts not changed: the API, SSE events, `serveStatic` (a missing `index.html` gives
  "dashboard not built").

## Approach

### 1. The installed `dist` path
- `staticDir(env)` → `RLTRACKER_STATIC_DIR` if set, else `join(dataDir(env), "bin", "web")`.
  The web build lives next to the exes it belongs to, so it is replaced with them on install and
  removed by uninstall's `rm bin`. In dev (`.dev-data`) the folder doesn't exist, so the tracker
  answers "dashboard not built" as it does today; dev uses `web:dev`.
- The return type becomes `string`. `createApi` keeps `string | null` (tests pass null).
- `paths.test.ts`: the default follows `RLTRACKER_DATA_DIR` and `LOCALAPPDATA`, and an empty env var
  falls back to it.

### 2. `vite build` at install (`scripts/autostart.ts`)
- `install()` builds the web app beside the install, along with the exes and before stopping
  anything: `bun run web:build --outDir <bin>\web.new --emptyOutDir`, with cwd the repo root. Vite
  runs on Node via its shebang, as `web:build` does today.
- `run()` gains an optional `cwd`. The build uses the repo root with an absolute `--outDir`.
- After `stopInstalled`, swap with a rollback:
  - rename `web` → `web.old` (skipped when `web` is absent);
  - rename `web.new` → `web` through `replace()`, which retries while antivirus holds a file;
  - if that fails, rename `web.old` back and raise `StepFailed`;
  - otherwise remove `web.old` with `rmSync({recursive, force, maxRetries})`.
- The `finally` also removes a leftover `web.new`.
- A failed build is a `StepFailed` ("Building the dashboard failed: …") before the tracker is
  stopped, so the old install keeps running.
- Install builds its own copy and doesn't copy the repo's `dist/`, so a standalone
  `install-autostart` can't ship a stale build.

### 3. Start menu shortcut
- An Internet Shortcut file, `%APPDATA%\Microsoft\Windows\Start Menu\Programs\RL Tracker.url`:
  `[InternetShortcut]\r\nURL=http://127.0.0.1:49100/\r\n` (`DASHBOARD_HOST`, `DASHBOARD_PORT`). It is
  a plain file write: no COM and no PowerShell. It opens the default browser, and it never runs the
  tracker.
- `shortcutFile(url)` is a pure function, tested in `autostart.test.ts` (CRLF, the URL). Install writes
  the shortcut after the task is registered. Uninstall deletes it (`rmSync force`).
- A failed write (or `APPDATA` unset) doesn't fail the install, because the tracker is installed and
  running by then. It prints "Could not create the Start menu shortcut (…); the dashboard is at
  http://127.0.0.1:49100/". The success message prints the URL too.
- Fallback if the live check shows a `.url` doesn't appear in Start: a `.lnk` via
  `src/server/powershell.ts` (WScript.Shell). Record the result in the Implementation notes.

### 4. Playwright harness (`test/e2e/`)
- Deps (dev, pinned, at least two weeks old): `@playwright/test`, `@axe-core/playwright`. No browser
  download: `channel: "chrome"`.
- `playwright.config.ts` at the root: `testDir: "test/e2e"`, `workers: 1`, `retries: 0`,
  `use: { channel: "chrome" }`, `reporter: "list"`, and `trace: "retain-on-failure"` (to
  `test-results/`, which is gitignored and eslint-ignored). No `webServer`: the fixture owns the stack.
- **`test/e2e/stack.ts`** (runs on Bun):
  - mkdtemp a data dir. Copy the repo's `dist/` to `<tmp>\bin\web`, which exercises the **default**
    `staticDir` with no `RLTRACKER_STATIC_DIR`. It fails with "run vite build first" if
    `dist/index.html` is missing.
  - Seed with `openStorage({dir, logger})` and `createRecordWriter({tracker, logger})`. Both get
    `createLogger({dir: tmp})`; with none they fall back to the real install's log
    (`log.ts:173`, `storage.ts:61`). The seed is a confirmed `ME` in `my_ids` plus one won match
    (`record()` from `src/server/testing.ts`) that ended 5 min ago, which makes the current session
    "This session: 1–0". Close the storage before spawning the tracker.
  - Start the replay server (`startReplayServer`) on `port: 0` with the `completed.ndjson` fixture,
    **gated**. It accepts the socket, so the tracker shows "connected", but holds the frames until
    `go`. It runs with `idleTimeout: 0`: the held socket stays silent through the axe step.
  - One free port for the tracker, from `Bun.serve({port: 0})` then stop.
  - Spawn the real tracker, `bun run src/server/main.ts`.
    - Its env is explicit: `RLTRACKER_DATA_DIR`, `RLTRACKER_PORT` and `STATS_API_URL`, with
      `RLTRACKER_STATIC_DIR` deleted, so the default path is what's tested.
    - Wait until `GET /api/status` answers 200.
  - Print `ready {"url", "dataDir"}` on stdout. Read stdin: the line `go` releases the replay. EOF
    means teardown: POST `/api/shutdown` with `SHUTDOWN_HEADER`, wait for exit (kill after 10 s),
    and remove the temp dir unless `RLT_E2E_KEEP=1`.
  - If the tracker exits early, print its code and the tail of `<tmp>\tracker.log`, then exit nonzero.
- **`scripts/replay.ts`**: `startReplayServer` gains `gate?: Promise<void>`, awaited in `open` before
  streaming. The CLI is unchanged.
- **`test/e2e/fixtures.ts`** (Node): a worker-scoped `stack` fixture spawns `bun run
  test/e2e/stack.ts`. It waits for the `ready` line (30 s timeout, echoing the stack's
  stderr/stdout on failure). It exposes `url` and `go()` (writes `go\n`). Teardown ends stdin and
  awaits exit. stdin EOF as the teardown signal means a crashed runner still stops the tracker.
- **`test/e2e/shell.spec.ts`**: serial, since the replay is one-shot, with `baseURL` from the
  fixture:
  1. **Before the match**:
     - `/` → `/recap`;
     - the status reads "connected";
     - the chip reads "This session: 1–0";
     - Recap, Trends and Settings navigate with `aria-current`;
     - reloading `/trends` serves the app (the static fallback through the real tracker);
     - an unknown path shows the not-found note.
  2. **axe**: on `/recap`, `/trends`, `/settings` and not-found, × each of carbon, slate and oled
     (set `data-theme` on `<html>`): no violations. This is the per-page smoke the cross-cutting rule
     asks for.
  3. **The replay** (the done-criterion):
     - `go()`;
     - the status shows "recording match", then "connected";
     - the chip reads "This session: 1–1" with no reload (the fixture's camera player becomes a
       pending "you" and loses);
     - no console errors (a `page.on("console")` collector).
  4. **Start new session**: the two-step, Yes → the chip is gone and the button is unavailable.
  - The replay speed is chosen at implementation so "recording match" lasts at least ~3 s; it is
    recorded in the notes.
- Scripts:
  - `e2e` = `vite build && playwright test`;
  - `deploy` = `bun run check && bun run e2e && bun run install-autostart && bun run recompute`.
- Tooling:
  - Vitest gets `exclude: [...configDefaults.exclude, "test/e2e/**"]`. Its default include picks up
    `*.spec.ts`, and a bare `exclude` would drop the `node_modules` default.
  - `playwright.config.ts` goes in the root tsconfig `include`.
  - The root tsconfig has no DOM lib. Page-side code in the specs uses
    `page.locator("html").evaluate((el) => …)` with the element typed by Playwright. Add a
    `/// <reference lib="dom" />` only if that isn't enough. `bun run typecheck` must cover the e2e
    files.
  - `.gitignore` gets `test-results/` and `playwright-report/`, and ESLint ignores them.
  - The e2e files type-check and lint under the root project.

### Logging
- `stack.ts`, with console lines tagged `[e2e]`, answers:
  - which ports and data dir were used;
  - whether the tracker became ready, and how long that took;
  - whether it exited early (the code plus the `tracker.log` tail);
  - whether teardown stopped it cleanly or killed it.
- The tracker's own log is in `<tmp>\tracker.log`, which `RLT_E2E_KEEP=1` keeps.
- Install prints each step, in the existing style: building the dashboard, swapping, the shortcut
  written or skipped (with the reason).

### Failure points
- The vite build at install fails → `StepFailed` before the stop, and the old install is kept.
- The `web` swap fails → the old `web` is rolled back, then `StepFailed` with a "run
  install-autostart again" hint. The new exes then serve the previous dashboard.
- The shortcut write fails → a warning, and the install still succeeds.
- The stack: the ready timeout, an early tracker exit, and the teardown kill are all printed.

## Files
- New:
  - `playwright.config.ts`;
  - `test/e2e/{stack.ts, fixtures.ts, shell.spec.ts}`.
- Changed:
  - `package.json` (deps, `e2e`, `deploy`);
  - `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`;
  - `src/server/paths.ts` (+ test);
  - `scripts/autostart.ts` (+ test);
  - `scripts/replay.ts` (`gate`);
  - docs: the roadmap, BACKLOG, PROJECT_INDEX, and the bun-runtime decision (Playwright on Node
    confirmed).

## Test seams
- TDD (Vitest), each red first:
  - `staticDir` default;
  - `shortcutFile`;
  - `startReplayServer`'s gate: no frame before release, all after. The test lives in a new
    `scripts/replay.test.ts`, with a Bun WebSocket client.
- Live-only, by a script first (`tdd-live-code-carveout`):
  - The harness is its own repro: `bun run e2e` red first. Run it before the replay gate exists (or
    with the chip expectation inverted) to see it fail on the right assertion, then green.
  - The install path: the real `bun run deploy`, plus the **forced-failure run** (a broken web build
    fails the install before the stop, and the old dashboard keeps serving). See Verification.
  - First run: `fixtures.ts` logs `process.versions` once, to confirm Playwright runs on Node. The
    console-error collector ignores nothing at first. If Chrome reports the missing
    `/favicon.ico` 404, filter that one URL and note it.

## Steps
1. Save this plan to `docs/plans/2026-10-21-wp5b-b-harness-install.md`. Roadmap status.
2. TDD `staticDir` default; TDD `shortcutFile`; TDD the replay gate.
3. Playwright deps, config, tooling edits; `stack.ts`, `fixtures.ts`, `shell.spec.ts`. `bun run e2e`
   red, then green. Run it 3 times in a row for flakiness.
4. Install: vite build into `web.new`, swap, shortcut, uninstall removes it. `deploy` script.
5. `bun run check` green. Live install check (Verification). The `/compact` line. Then
   `independent-review-pass` (with the security pass: install writes into the user's profile, and a
   new child-process harness).
6. Docs per `documentation-backlog-hygiene`: roadmap WP5b done, BACKLOG Next → WP6a,
   PROJECT_INDEX, decision file note.

## Verification
- `bun run check` green; `bun run e2e` green 3 times in a row.
- Live, on this machine (it replaces the installed tracker, which is what deploy is for; data kept):
  - `bun run deploy` passes every stage. `<LOCALAPPDATA>\RLTracker\bin\web\index.html` exists, and
    no `web.new` is left behind.
  - Start menu: "RL Tracker" is listed. Opening it shows the dashboard at `http://127.0.0.1:49100/`
    in the default browser, with the live header status (checked in Chrome via Claude in Chrome).
    Deep link `/trends` reload works.
  - Install while the tracker is running: it is stopped, swapped and restarted. Rerunning
    install-autostart is idempotent (the shortcut is overwritten, not duplicated).
  - `uninstall-autostart`: the shortcut and `bin` are gone, and the data is kept. Then
    `install-autostart` again restores everything.
  - A forced failure: break the web build temporarily (a syntax error) → install fails before
    stopping, and the running tracker keeps serving the old dashboard. Then revert.
- Residual for the user: the Start menu entry's icon and name.

## Plan review
Run by the `plan-reviewer` agent (opus), 2026-10-21. It confirmed the chip 1–0 → 1–1 path, "connected"
while gated, the replay speed (≤ 128x keeps "recording match" ≥ 3 s), the dev default and installed
Chrome. Findings and how each was handled:
1. Med: a bare Vitest `exclude` drops the `node_modules` default. **Fixed**: `configDefaults.exclude` spread.
2. Med: seeding without a logger writes to the real install's log. **Fixed**: a temp-dir logger
   for both, and the storage is closed before spawning.
3. Med: the root tsconfig has no DOM lib for page-side code. **Fixed**: `locator.evaluate` with a
   lib-reference fallback, and typecheck covers e2e.
4. Med: the swap had no rollback, and `run()` has no cwd. **Fixed**: the `web.old` rollback and a
   `cwd` param.
5. Low: Bun's WebSocket idle timeout on the gated socket. **Fixed**: `idleTimeout: 0`.
6. Low: implicit env, and a redundant port probe. **Fixed**: `RLTRACKER_STATIC_DIR` deleted, and the
   replay uses `port: 0`.
7. Low: the forced-failure check was missing from Test seams. **Fixed**: named there.
8. Low: confirm Node under Playwright, and the favicon console noise. **Fixed**: checked on the
   first run.

## Implementation notes (2026-10-21)
- Deps: `@playwright/test` 1.63.0 (2026-09-04) and `@axe-core/playwright` 4.13.0 (2026-08-11), the
  newest releases at least two weeks old. No browser download; `channel: "chrome"`.
- Replay speed: 64x (the completed fixture lasts ~392 s, so ~6 s of replay). The replay test takes
  ~7 s; "recording match" was visible on every run.
- The replay server now always uses `idleTimeout: 0` (not only when gated): the CLI also leaves the
  socket open after the last frame.
- First run: the runner is Node 24.14.1 (`underBun: false`), so Playwright runs on Node as decided.
  The collector filters nothing. (A first "no console errors" reading was wrong: the collector wasn't
  listening yet; see the Review log. Once it was, Chrome's `/favicon.ico` 404 was the only error, fixed
  at the source with `<link rel="icon" href="data:,">`.)
- Page-side code in the spec uses a string expression in `page.evaluate`, since the root tsconfig has
  no DOM lib. A `/// <reference lib="dom" />` would have added DOM types to the whole server program.
- axe found a real defect in the WP5b-a shell: `page-has-heading-one` on every page. Fixed with a
  visually hidden `<h1>` per page (Recap, Trends, Settings, "Page not found") and a `.visually-hidden`
  utility in `global.css`. The visible layout is unchanged.
- Red first: with the replay test expecting "This session: 1–2", it failed on exactly that assertion
  (received "1–1"). Then green 3 times in a row (25.8–26.7 s, 4 passed each).
- Live (this machine):
  - `bun run deploy` passed every stage (check 723 tests, e2e 4 passed, install, recompute 13
    written). `bin\web\index.html` exists, and no `web.new` or `web.old` is left.
  - Start menu: `Get-StartApps` lists "RL Tracker" → `http://127.0.0.1:49100/`, so the `.url` works
    and no `.lnk` fallback is needed. Opening it launched the default browser (Firefox on this
    machine). In Chrome, the `/trends` deep link rendered with the live header ("waiting for game")
    and no console errors.
  - Forced failure (a syntax error appended to `src/web/main.tsx`): install failed with "Building the
    dashboard failed: …" before stopping anything. The tracker log shows no new stop, the old
    dashboard kept answering 200, and no leftovers. Reverted.
  - A rerun while running stopped, swapped and restarted the tracker, and left one shortcut.
  - `uninstall-autostart` removed the task, the shortcut and `bin`, and kept the data. Then
    `install-autostart` restored everything (`/recap` 200).
- Residual for the user: the Start menu entry's icon (the default browser's) and name.
- Step 6: the "Playwright on Node, WP5b confirms" note in `docs/decisions/2026-10-16-bun-runtime.md`
  is confirmed here and in PROJECT_INDEX rather than appended to the decision file, which is
  write-once.

## Review log
Diff re-classified at review time: Substantial (design tier; ~740 lines). Snapshots: round 1
`3e8dee2`, round 3 `51e8f64`.

**Round 1**: `/code-review high`, `arch-reviewer` (sonnet), `security-reviewer`, `/simplify`.
- Security: no findings.
- code-review 1 (High): `consoleErrors` was requested only by `afterEach`, so Playwright built it
  after the test body and it never saw an error. **[Fixed]** `{ auto: true }`. The fixed collector
  then caught Chrome's `/favicon.ico` 404 on every page; fixed at the source with
  `<link rel="icon" href="data:,">` in `src/web/index.html`, not filtered.
- code-review 2 / arch risk: a failed `web` swap (or `web.old` cleanup) threw after the stop, so the
  tracker stayed stopped until the next logon. **[Fixed]** install keeps the swap failure, still
  registers and runs the task, then reports "RL Tracker is running again, but the dashboard was not
  updated: …". Live repro: a read handle held on `bin\web\index.html` → exit 1 with that message,
  `/recap` 200, `web` intact, no `web.new`.
- code-review 3: axe ran mid colour-transition after a theme switch. **[Fixed]**
  `contextOptions.reducedMotion: "reduce"` (the app's own reduced-motion rule turns transitions off).
- code-review 4: the teardown timeout killed only the stack, orphaning the tracker. **[Fixed]**
  `taskkill /T /F` on the tree.
- code-review 5 / arch nit: failure exits left the temp dir. **[Fixed]** `removeDir` on every
  failure path (after the log tail is printed).
- code-review 6 / arch nit: no `error` listener on the spawn or stdin. **[Fixed]**
- code-review 7: the fixture's ready timeout equalled the stack's. **[Fixed]** 45 s vs 30 s.
- code-review 8: un-awaited probe stop in `freePort`. **[Fixed]**
- code-review 9: `staticDir` null branch now dead. **[Fixed]** narrowed to `string` in
  `ApiOptions`/`serveStatic`; the test uses a missing folder instead of null.
- code-review 10: fixed sleep in `replay.test.ts`. **[Fixed]** (`vi.waitFor` in round 3).
- arch nit: hidden h1 repeated in 4 placeholder pages (also raised by `/simplify`).
  **[Verified, no fix needed]** the placeholders are replaced by real pages from WP6a, which should
  carry a visible h1 rather than stack on these.
- arch nit: roadmap WP5b-b line over-long. **[Fixed]** in step 6.
- `/simplify` (4 angles): **[Fixed]** `freePort` moved to `src/server/testing.ts` (shared with
  `main.test.ts`); `stack.ts` uses `requestStop` from `scripts/stop.ts` (it has the timeout).
  Skipped: parallel builds at install (CPU-bound, rare); the duplicate vite build in `deploy`
  (deliberate: install builds its own copy so a standalone install can't ship a stale `dist/`);
  the swap rollback, the APPDATA null guard and the two-level timeouts (plan decisions); the runner
  log line (the plan's logging).

**Round 2** (full round on the delta, since fixes touched files outside the round-1 diff):
security clean; arch 2 nits **[Fixed]** (`describeStopResult` so a `reset` isn't logged as a failed
stop; taskkill failure logged). The `/code-review high` run reviewed the round-1 snapshot instead of
the delta: its repeats were already fixed; new **[Fixed]**: guard the `web.new` cleanup in
`finally`; uninstall says "Removed the Start menu shortcut" only when there was one.
**[Verified, no fix needed]**: `staticDir` from the data dir, not the exe location (an install under
a custom `RLTRACKER_DATA_DIR` already mismatches the task's data dir; `start` from source reading
the installed build is consistent with it using the real data).

**Round 3** (`/code-review high` on the delta, security):
- security clean.
- **[Fixed]**: every install leftover removal goes through one never-throwing `removeLeftover` (the
  exes' and `web.new` in `finally`, `web.old`); any `swapWeb` error, not only `StepFailed`, still
  restarts the tracker; a `web.old` left by a failed rollback is the only working dashboard and is
  kept as the backup rather than deleted (live: `web` renamed to `web.old`, install → exit 0, `web`
  restored and swapped, 200); the worker fixture gets its own timeout (the default 30 s would cut
  setup first); fixture exit timeout 30 s > the stack's worst case; `removeDir` never throws;
  `vi.waitFor` in `replay.test.ts`.
- Round-3 follow-up `/code-review medium` on the same files: **[Fixed]** `close` not `exit` (output
  drained); `child.kill()` when taskkill fails; `on("error")`; a 2 s timeout on the readiness fetch;
  the `web.old` restore no longer renames there and back.
- **[Verified, no fix needed]** (raised in rounds 2 and 3, upheld twice → settled): `stack.ts`
  cleanup doesn't cover throws from `startReplayServer`/`freePort`/`Bun.spawn` (port-0 binds on
  loopback; no real failure path) or a lost swap failure when `schtasks` also fails (the schtasks
  error is shown, and rerunning install reports the dashboard again). Two near-identical
  best-effort rm helpers (`removeLeftover`, `removeDir`) differ in their logger; left apart.
- **[Deferred → BACKLOG]**: a failed **exe** replace after the stop leaves the tracker stopped (older
  than this diff; same shape as the fixed web case).

**Round 4** (`/code-review low` on `git diff 51e8f64`): no findings (test files skipped at that
level; the fixture/stack delta self-checked and green in e2e). Done.

Final: `bun run check` 61 files / 723 tests; `bun run e2e` 4 passed, green on every run after the
fixes (24.8–27.1 s), no temp dirs left; a clean `install-autostart` serves the current build (200).
