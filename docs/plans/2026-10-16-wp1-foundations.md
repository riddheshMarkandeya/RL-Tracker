# WP1 Foundations — plan

**Status: done** (2026-10-16). Work package WP1 of `docs/plans/2026-10-16-v1-roadmap.md`.

## Context
First work package of `docs/plans/2026-10-16-v1-roadmap.md` (BACKLOG v1 roadmap item). The repo
has no `package.json`, no TS/lint/test config. The only code is `scripts/capture.ts` +
`scripts/capture.test.ts` (commit 89e9f05), which is **running right now** (`bun run
scripts/capture.ts`, pid 21392) to capture weekend play. WP1 sets up the package, strict TS,
ESLint, Vitest, the structured logger, the constants module and Zod, so WP2+ build on them.
Tier: Substantial (greenfield → strict whole-codebase lint/typecheck from day one, scripts/ included).

## Decisions
- **Test runner: Vitest** (user, this session), per the roadmap. `bun run test` → `vitest run`;
  Vitest's bin runs on Node 24 (installed) for now; WP2's Bun check may change that.
  `scripts/capture.test.ts` changes only its import line (`bun:test` → `vitest`).
- **Logger: hand-written, no library** (pino+pino-roll / winston would add deps for ~60 lines we
  fully control). Sync `appendFileSync` per line — volumes are tiny (log lines, not events).
- **Dashboard port: 49100** on `127.0.0.1` — near the game's 49123/49124, below the Windows
  dynamic range (49152+), outside this machine's excluded ranges (8884, 50000–50059).
- **Stats API port constant: 49124 (WebSocket)** — the transport capture.ts proved live. The
  roadmap's WP3a says "TCP"; WP3a picks the transport and may add 49123 then.
- **capture.ts stays standalone** (no import from `src/`): it's a self-contained weekend tool;
  coupling it to app modules buys nothing.
- **Don't create empty dirs/placeholders.** `src/server` and `src/shared` get real files now;
  `src/web` is created by WP5b and `src/shared/schemas/` by the first schema (WP2 settings). Zod
  is installed now. (Small, stated deviation from the roadmap's directory list: YAGNI on
  `.gitkeep` files.)

## Steps
1. Save this plan to `docs/plans/2026-10-16-wp1-foundations.md`; roadmap WP1 status → "in
   progress (2026-10-16, plan link)".
2. **Package**: `package.json` (`private`, `"type": "module"`, scripts: `typecheck` = `tsc
   --noEmit`, `lint` = `eslint . --max-warnings 0`, `test` = `vitest run`, `check` = `tsc
   --noEmit && eslint . --max-warnings 0 && vitest run` — no nested `bun` call, since Bun isn't
   on PATH). Deps: `zod` (the roadmap names it; first schema lands in WP2).
   devDeps: `typescript`, `@types/bun`, `eslint`, `@eslint/js`, `typescript-eslint`, `vitest`.
   `bun install` → commit `bun.lock`. `.gitignore` += `node_modules/`, `dist/`.
   Bun is at `~/.bun/bin/bun` (1.4.3), not on the Bash tool's PATH — call it by full path.
3. **tsconfig.json** (root, one project): `strict`, `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `target`/`lib`
   ESNext, `module: Preserve`, `moduleResolution: bundler`, `types: ["bun"]`, `noEmit`;
   include `src`, `scripts`. (DOM lib/JSX: WP5b adds a web tsconfig.)
4. **eslint.config.mjs** (flat; `.mjs` so Node needs no TS loader): `@eslint/js` recommended +
   `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `projectService: true`;
   ignores `captures/`, `HARs/`, `prototypes/`, `node_modules/`, `dist/`; `disableTypeChecked`
   for the config file itself.
5. **Bring scripts/ to standard**: switch the test import to `vitest`; fix whatever strict
   lint/tsc flag in `capture.ts` (expected: unsafe `any` from `JSON.parse(raw).Data` in
   `matchGuidOf`; `restrict-template-expressions` at `capture.ts:87` → `String(v)` so output is
   byte-identical; `no-confusing-void-expression` on the arrow handlers at ~204, 229–231 → block
   bodies) **without behavior change** — its 14 tests must stay green, and since most fixes land
   in untested `main()`, a manual run checks it (see Verification). The running process is
   unaffected (code already loaded); the edited file is what the next launch runs.
6. **Constants** `src/shared/constants.ts`: `SESSION_GAP_MS` (30 min), `DAY_CUTOFF_HOUR` (4),
   `WEEK_START_DAY` (1 = Monday), `RETENTION_DAYS` (90), `STATS_API_PORT` (49124, WebSocket),
   `DASHBOARD_HOST` ("127.0.0.1"), `DASHBOARD_PORT` (49100). One-line comment: fixed in v1,
   settings later per the map.
7. **Paths** `src/server/paths.ts`: `dataDir(env = process.env)` = `RLTRACKER_DATA_DIR` (tests,
   dev) else `%LOCALAPPDATA%\RLTracker` (fallback `os.homedir()/AppData/Local/RLTracker` if the
   var is missing). WP2 reuses it for the DBs. TDD: `paths.test.ts`, one case per branch.
8. **Logger** `src/server/log.ts` (TDD, tests first in `src/server/log.test.ts` on temp dirs):
   - `createLogger({ dir, fileName = "tracker.log", maxBytes = 5 MB, maxFiles = 5, now?,
     echo? })` → `{ info, warn, error }(category, event, fields?)`.
   - One JSON line: `{ ts (ISO), level, cat, event, ...fields }`, via a JSON replacer applied
     per value: `Error` → `{ name, message, stack }`, BigInt → string, a repeated object (cycle,
     tracked in a WeakSet) → `"[Circular]"`. The line is never dropped.
   - Rotation: size tracked from `statSync` at first write plus bytes written. When the counter
     says the next line would pass `maxBytes`, **re-`statSync` the real size first** (another
     process — a second instance logging "port taken", a dev run beside autostart — may have
     rotated already); rotate only if the real size is non-zero and still over. Rotation shifts
     `tracker.log.3→.4 … tracker.log→.1` (dropping `.4`), so at most 5 files.
   - Never throws: `mkdirSync({recursive})` lazily; any fs failure is caught (comment on why the
     catch is broad: best-effort, must never crash the recorder), reported once to stderr as
     `log_write_failed` with the error, and re-reported only after a success. The stderr report
     and the console echo are inside the same catch (no console under Task Scheduler can make
     them throw). Accepted for v1: under autostart a `log_write_failed` goes nowhere visible.
   - `echo` (default: `process.stdout.isTTY`) mirrors lines to the console, so dev runs show
     them and the autostart task (no console) doesn't.
   - Default instance `log` = `createLogger({ dir: dataDir() })`.
   - Tests: line shape + fields; Error/BigInt/cycle serialization; rotation keeps exactly
     `maxFiles` files with the newest content in the base file and the oldest dropped (small
     `maxBytes`); stale counter (file truncated/rotated externally) → no extra rotation; a single
     line over `maxBytes` into an empty file → no rotation loop; unwritable target (dir path is an
     existing file) → no throw, one stderr report, later calls still don't throw; size picked up
     from a pre-existing file.
9. **Entry** `src/server/main.ts`: logs `app`/`started` with `{ pid, dataDir, bun: Bun.version }`
   and exits. WP3b grows it into the process host. Script `start` = `bun run src/server/main.ts`.
10. Docs: `PROJECT_INDEX.md` adds the WP1 plan and a short "Code layout / commands" note
    (`bun run check`, data dir, `RLTRACKER_DATA_DIR`); roadmap WP1 entry → done, with a one-line
    note that `src/web` and `src/shared/schemas` are created by their first users (WP5b, WP2),
    and that Vitest ran on Node (WP2's Bun check covers it); BACKLOG item "Next:" → WP2. Commit
    only when the user asks.

## Logging questions (what `log.ts` lines must answer)
- Did the process start, which version, which data dir? (`app/started`)
- Did a log write fail, where and why? (`log_write_failed` on stderr — the file is what failed)
- Did rotation fail, and why? The line is still kept (`log_rotate_failed` on stderr, once per streak)

## Verification
- `bun run check`: typecheck, lint (src + scripts, zero warnings), tests (logger + capture's 14) pass.
- `RLTRACKER_DATA_DIR` unset: `bun run start` → a real `started` line in
  `%LOCALAPPDATA%\RLTracker\tracker.log` (read it back).
- Failure path fired once for real: `RLTRACKER_DATA_DIR` pointing at a file → `start` exits 0
  with one `log_write_failed` on stderr.
- Logger rotation **under Bun** (tests run on Node): a one-off scratch script run with `bun`,
  `createLogger({ dir: <scratch>, maxBytes: 200 })`, writing ~50 lines → `tracker.log` + `.1`–`.4`
  exist, nothing older.
- capture.ts `main()` after the lint fixes: `CAPTURE_DIR=<scratch> bun run scripts/capture.ts`
  with the game's port closed → `started`, then `connect_failed`; Ctrl+C → `shutdown`. Compare
  the `capture.log` line format with a line in the real `captures/capture.log`.
- Running capture (pid 21392) still alive and still appending afterwards.
- Then `independent-review-pass` by the actual diff.

## Plan review
plan-reviewer (opus), 1 round, 8 findings — all folded in:
1. capture.ts lint fixes land in untested `main()` → manual run in Verification; `String(v)` for
   byte-identical output.
2. Logger tested on Node but runs on Bun → manual rotation check under Bun in Verification.
3. Multi-process stale size counter → re-stat before rotating; skip when the file is empty.
4. `check` with nested `bun` may fail (not on PATH); plain `eslint .` passes on warnings → direct
   commands with `--max-warnings 0`.
5. `paths.ts` had no test seam → `dataDir(env)` + 3 tests.
6. stderr/echo writes can throw with no console; per-field serialization → inside the catch;
   replacer per value; silent `log_write_failed` under autostart accepted and stated.
7. Zod installed but schemas dir deferred → keep Zod (roadmap names it); record the dir deferral
   in the roadmap entry.
8. `*.config.*` tsconfig include is dead without `allowJs` → dropped.

## Implementation notes (2026-10-16)
- `typescript` pinned to `~6.0`: `bun add typescript` resolved 7.0 (the native port), which
  typescript-eslint 8.71 doesn't support (peer `<6.1.0`).
- Cycle handling marks only true cycles (ancestor stack via the replacer's `this`), not every
  repeated object as the plan's WeakSet would have: a value shared by two fields is written twice.
- The echo has its own guard (`writeConsole`, which also gives each stream a no-op `error`
  listener) instead of sharing the write's catch, and it runs even when the file write failed.
  A failed write resets the size counter, so the next attempt re-stats and re-runs `mkdirSync`
  (otherwise done only on the first write).
- A field whose serialization throws (a throwing `toJSON` or getter) drops that line and reports
  `log_write_failed`; Error/BigInt/cycles never do.
- `scripts/capture.test.ts` changed beyond its import line: the `state`/`other` helpers wrap
  template values in `String()` for `restrict-template-expressions` (test-only, no behavior).

## Verification log (2026-10-16)
- `bun run check`: exit 0; tsc clean, eslint clean (0 warnings), 26 tests passed in 3 files
  (capture 14, paths 3, log 9). Before review; 34 after the review fixes (see Review log).
- `bun run start`, no override: `{"level":"info","cat":"app","event":"started","pid":30208,
  "dataDir":"C:\\Users\\riddh\\AppData\\Local\\RLTracker","bun":"1.4.3"}` read back from
  `%LOCALAPPDATA%\RLTracker\tracker.log`.
- `RLTRACKER_DATA_DIR` = an existing file: exit 0, exactly one `log_write_failed` on stderr.
- Rotation under Bun (scratch script, `maxBytes: 200`, 50 lines): `tracker.log` + `.1`–`.4`,
  holding n=49–50 … 41–42; nothing older.
- `capture.ts` after the lint fixes, `CAPTURE_DIR` = scratch, game closed: `started` then
  `connect_failed url=ws://127.0.0.1:49124 retry_s=5 note=is the game running?`, same format as
  `captures/capture.log`. The Ctrl+C → `shutdown` path could not be fired from the tool:
  Windows doesn't deliver SIGINT to a child of `timeout`, so the process was force-killed.
  That change is arrow-shorthand → block body only; left for a manual Ctrl+C check.
- pid 21392 (the weekend capture) alive throughout.

## Review log
Tier: Substantial (design tier). Snapshot before fixes: `a54c9bf` (`git stash create`).

### Round 1: code-review high, arch-reviewer (sonnet), security-reviewer, /simplify
- security: no findings.
- code-review high (10):
  1. A failed rotation dropped the line, on every write while it kept failing. [Fixed] Rotation
     failure is caught, reported once as `log_rotate_failed`, and the line goes into the base file.
  2. Rotation wasn't atomic: a failed final rename left a gap that each retry widened, deleting
     history. [Fixed] `rotate()` shifts only into the first free slot, so a retry after a failed
     base rename deletes nothing. Test mocks `renameSync` failing on the base file.
  3. Fields could overwrite `ts`/`level`/`cat`/`event` (also arch). [Fixed] The logger's keys win.
  4. Errors lost `code`, `syscall`, `cause`, `AggregateError.errors`. [Fixed] Own fields, cause
     and errors kept; a cause cycle becomes `"[Circular]"`.
  5. An empty `LOCALAPPDATA` gave a relative data dir. [Fixed] Treated as missing.
  6. A failing file silenced the dev console echo. [Fixed] Echo runs whenever the line serialized.
  7. `reportFailure` could throw when `err` itself can't be serialized. [Fixed] Falls back to
     `err: "[unserializable]"`.
  8. Async `error` events on stdout/stderr (EPIPE) would crash the process. [Fixed] One no-op
     listener per stream.
  9. `maxFiles`/`maxBytes` unvalidated (also arch). [Fixed] `RangeError` at creation.
  10. `mkdirSync` on every line (also arch). [Fixed] Only on the first write or after a failure.
  - Below the cap: the `constants.ts` header named the features map [Fixed]; `main.ts` calls
    `dataDir()` again [Verified, no fix needed: one env read, keeps main decoupled]; no test of a
    failed rotation [Fixed by 2].
- arch-reviewer (2 risk, 7 nit): the reserved keys, mkdir and validation findings are merged above.
  Doc block on `LoggerOptions` instead of `createLogger` [Fixed]. `capture.test.ts` changes not in
  the notes [Fixed]. Roadmap heading still said "may merge into WP2" [Fixed]. Plan had no status
  line [Fixed]. Ctrl+C → `shutdown` never run on the edited `capture.ts` [Open → manual check by
  the user; their Ctrl+C at 17:38 exercised the old code]. `matchGuidOf`, `skipLibCheck`, unused
  constants and zod [Verified, no fix needed].
- /simplify (4 angles): `at(level)` factory replaces three copy-pasted methods [Fixed]. Skipped:
  looping the `capture.ts` signal handlers (its diff stays lint-only); the import-time `log`
  singleton (the plan's default instance); dropping the multi-process hedging (plan review
  finding 3; a single-instance lock is WP3b's); `capture.ts` reusing `STATS_API_PORT` or the
  logger (the plan keeps it standalone). Efficiency: no findings.
- After the fixes: `bun run check` exit 0, 34 tests (paths 4, log 16, capture 14). Rotation
  re-run under Bun (maxBytes 200, 50 lines): `tracker.log` + `.1`–`.4`, n=41–50, nothing older.

### Round 2 (delta `git diff a54c9bf`): code-review low, arch-reviewer (sonnet), security-reviewer
- code-review low: no findings. security: no findings.
- arch-reviewer (1 risk, 4 nit, 1 q), all docs/comments: stale test counts in the Verification
  log [Fixed: notes the post-review 34]; `log_rotate_failed` missing from Logging questions
  [Fixed]; echo/mkdir implementation note stale [Fixed]; rotation retried per line looked
  unintentional [Fixed: comment]; q whether validation, doc-block move and console listeners
  trace to a finding [Verified, no fix needed: round-1 items 8, 9 and the arch doc-block nit];
  validation lines over 130 chars [Verified, no fix needed: no width rule, lint clean].
- Nit fixes only (no executable change), so the round doesn't reopen. `bun run check` exit 0,
  34 tests. **Review done.** Open: the user's Ctrl+C → `shutdown` check on the edited
  `capture.ts`.
