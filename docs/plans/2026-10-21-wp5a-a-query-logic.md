# WP5a-a: Query logic (periods, sessions, filters, aggregates, baseline, record reads)

## Context
Roadmap WP5a (`docs/plans/2026-10-16-v1-roadmap.md`, "WP5a: Query logic and API"). Pages (WP6a
recap, WP7 trends, WP5b header chip) need match records turned into sessions, periods, filtered
sets and aggregates, served over a JSON API. Nothing reads `tracker.db` for pages yet, and the host
(`src/server/host.ts`) only serves `POST /api/shutdown`.

**Split (user said "split if needed", 2026-10-21)**: logic + API with tests is ~1,400 lines, over one
session, so:
- **WP5a-a (this plan)**: the pure, TDD'd query logic plus the read layer over `tracker.db`, and
  their rule-registry entries. No HTTP.
- **WP5a-b (next)**: router, static `dist` + `index.html` fallback, Zod schemas, endpoints, SSE,
  the "start new session" POST, contract tests. Its decisions so far go into the roadmap at step 1
  (see "WP5a-b handoff" below) so its plan starts from them.

## User decisions (2026-10-21)
1. Split a/b as above.
2. **Session key = the GUID of the session's first match.** Stable across recompute; a re-cut that
   moves the first match gives a new key (fresh remark picks, which the map accepts).
3. **Recap 30-day baseline = `[session start − 30 days, session start)`**, under the active filters.
   The session isn't compared with itself; an old session is compared with its own era.
4. **Offline playlists (group `offline`: Season, Exhibition, Training, LAN, …) are left out of
   "everything"**, so bot games don't reach overall stats or the baseline; they show only as a
   single-playlist pick.
5. **LTMs (group `ltm`) go under "Extra modes"; Official Tournament (group `tournament`) stays out
   of "All ranked"** but counts in everything and can be picked alone.

## Rules and constraints that bind this plan
- Map: Session (Q8), Periods, Period views (playlist dropdown), Recap layout (30-day baseline),
  Friends (private exclusion). Roadmap cross-cutting: private (group `private`) left out of
  "everything" and the baseline by default; no fake zeros (empty → null, never 0); pages read match
  records only; logger at decision points.
- Roadmap WP5a "You": your row = `match_players.primary_id` in `my_ids` with status ≠ `rejected`;
  result via `resultFor` (`src/shared/result.ts`); no "you" row (spectated) → no result and not in
  your stats; playlist names via `playlistInfo` (`src/shared/playlists.ts`).
- WP4b notes: extras not computed ⇔ `woodwork_hits` null; car shares = Σ ms ÷ Σ `car_ms`, boost =
  `car_ms`-weighted mean; own goals = `match_goals.own_goal`.
- Constants already exist in `src/shared/constants.ts`: `SESSION_GAP_MS`, `DAY_CUTOFF_HOUR`,
  `WEEK_START_DAY`. Seasons come from the `seasons` table; breaks from `session_breaks(at)`.
- Project rule (CLAUDE.md, unseen shapes): flag + Watch-list item rather than invented handling.
- WP4c registry: every rule gets an entry; new constants go into `constant-pins.json`;
  `docs/definitions.md` regenerated and kept in sync by its test.
- `src/shared` stays free of server code (`result.ts` comment).

## Approach

### 1. Local days and periods: `src/shared/periods.ts` (new, pure)
Uses the process's local time zone via `Date` local getters/constructors (the server and the
browser are the same PC). Verified: Bun honours `process.env.TZ` set at runtime, so tests pin
zones (America/New_York, Europe/London) for DST cases.
- `dayOf(ms): string` — local `YYYY-MM-DD`, minus one day when the local hour < `DAY_CUTOFF_HOUR`.
  Done on local calendar fields, not by subtracting 4 h of ms, so DST days stay right.
- `shiftDay(day, n): string` — calendar-day arithmetic on the date string; every "N days ago" goes
  through it (or local `Date` fields), never `n × 24 h` of ms, so edges stay at 04:00 across DST.
- `dayStart(day: string): number` — `new Date(y, m-1, d, DAY_CUTOFF_HOUR)` ms (4am exists on every
  DST change day in practice; a zone where it doesn't is left to `Date`'s own resolution).
- `type PeriodSpec = { kind: "day" | "week" | "month" | "year", day: string } | { kind: "season", id: number }
  | { kind: "last7" | "last30" | "this_year" | "all" }`.
- `periodRange(spec, { now, seasons }): { from: number | null, to: number, running: boolean }` —
  half-open `[from, to)` ms. Week starts on `WEEK_START_DAY` at the cutoff; month on the 1st; year
  on 1 Jan; a season runs from `dayStart(start_date)` to the next season's `dayStart`, ordered by
  `start_date` (not id; the table is editable). The last season is open-ended: `to` = now.
  `last7`/`last30` = `dayStart(shiftDay(dayOf(now), −(N−1)))` to now, N from `ROLLING_SHORT_DAYS` /
  `ROLLING_LONG_DAYS`. `all` has `from` null. `running` = `from ≤ now ≤ to` (true for the
  open-ended kinds, whose `to` is now). Previous-period mapping and chart buckets stay in WP7.
- Unknown season id → `null` return (the API turns it into 404).

### 2. Playlist filters: `src/shared/playlist-filter.ts` (new, pure)
- `type PlaylistFilter = "everything" | "ranked" | "casual" | "extra" | "private" | { playlist: number }`.
- `inFilter(playlistId: number | null, f): boolean` from `playlistInfo`: everything = group not
  `private` or `offline` (ltm, tournament and unmapped/unknown ids included); ranked = group
  `ranked`; casual = group `casual` (ids 1–4 only, per the map); extra = groups `extra` + `ltm`;
  private = group `private` (6 and 26); single = that id (any group, offline included).
- `playlistsPresent(ids: (number|null)[]): number[]` — distinct, sorted, nulls dropped; the dropdown
  is built from it (WP6a/WP7), with no counts.
- Dropdown grouping/labels are UI (WP6a); not here.

### 3. Sessions: `src/server/query/sessions.ts` (new, pure)
- `cutSessions(matches: {guid, startedAt, endedAt}[] (any order), breaks: number[], gapMs = SESSION_GAP_MS): Session[]`
  with `Session = { key, guids: string[], startedAt, endedAt }`, oldest first.
- Sort by `startedAt` (tie: guid). Cut before match `n` when `n.startedAt − prevMaxEndedAt > gapMs`
  (exactly 30 min does not cut), or when a break `b` satisfies `prev.startedAt < b ≤ n.startedAt`.
  A break during a match therefore cuts before the next match (cheap, obvious choice).
- Cut over **all** recorded matches (any playlist, spectated too): a session is time at the PC.
  Filters apply inside a session; a session with none of *your* matches under the filter (so a
  spectated-only session too) is dropped from lists.
- `key` = first match's guid. `currentSession(sessions, breaks, now)`: the last session if
  `now − endedAt ≤ gapMs` and no break after its last match's start, else null (WP5b's chip).

### 4. Aggregates: `src/server/query/aggregate.ts` (new, pure)
Input `MyMatch` (from the read layer): match fields, your player row (or null), your result, your
goals' speeds, your statfeed counts. Spectated rows are excluded before aggregation.
- `aggregate(rows): Aggregate`:
  - `matches`, `wins`, `losses`, `noResult`, `winPct` (W ÷ (W+L), null when 0), `leftEarly`
    (end_kind `left`, for the ⚑ note), `mvps` (mvp_key = your key).
  - Totals and per game for goals, assists, saves, shots, demos, score; per game null at 0 matches.
    `shootingPct` = goals ÷ shots, null at 0 shots.
  - Streaks in time order: `bestWinStreak`, `bestLossStreak`, `endedOn: { result, length } | null`.
    A no-result match is skipped (neither extends nor breaks a streak).
  - Extras over rows with extras computed (`extrasMatches` count; all null when 0): `hardestShotKmh`
    max, `fastestGoalKmh` max over your non-own goals, `woodworkHits`, `aerialTouches` totals,
    `boostAvg` (`car_ms`-weighted), `supersonicShare`, `emptyBoostShare` (Σ ms ÷ Σ car_ms over rows
    with `car_ms` not null).
  - `statfeed: Record<event, count>` summed.
- `byPlaylist(rows): { playlistId, aggregate }[]`.
- `baseline(rows, sessionStart)` = `aggregate` over rows with `startedAt` in
  `[same local clock time BASELINE_DAYS calendar days earlier, sessionStart)`; returns null-valued fields when empty (no fake zeros).
  The filter is applied by the caller before both, so the baseline follows it.

### 5. Read layer: `src/server/query/read.ts` (new, DB)
Plain SQL over `Db` (`src/server/db/sqlite.ts`); no ORM.
- `readMatchTimes(db)` → guid, started_at, ended_at for all matches (session cutting).
- `readBreaks(db)` → `session_breaks.at[]`; `readSeasons(db)` → id, name, start_date.
- `readMyMatches(db, { from?, to?, guids? })` → `MyMatch[]`: matches LEFT JOIN your row
  (`match_players` ⋈ `my_ids` status ≠ rejected), result via `resultFor(m, me.team_num)`, your
  goals (`match_goals.scorer_key` = your key, with speed and own_goal) and statfeed in two batched
  follow-up queries keyed on the returned guids (no N+1).
- **Two "you" rows in one match** (two of your IDs in one lobby): never seen. Pick the one equal to
  `camera_primary_id`, else the lowest `player_key`; log `query/two_yous` warn {guid, keys} **once
  per guid per process** (a module-level Set, as `playlist_map` logs once per run); add a BACKLOG
  Watch-list item (project rule).
- Follow-up goal/statfeed queries reuse the main query's predicate (a join/subquery on the
  `started_at` range) rather than an `IN` list of every guid; the guid list is only for `guids`.
- Timing: log `query/read` info {fn, rows, ms} so slow reads are visible once the history grows.

### 6. Rule registry entries (`src/server/rules/registry.ts`)
New constants in `src/shared/constants.ts`: `BASELINE_DAYS = 30`, `ROLLING_SHORT_DAYS = 7`,
`ROLLING_LONG_DAYS = 30` (the registry's constants are the values the code runs on).
All entries `applied: "read"`, version 1, refs this plan + the map:
- New area `"queries"` (added to `AREAS` and `AREA_TITLES`, after `"goals"`): `session_cut`
  (SESSION_GAP_MS, breaks), `session_key`, `local_day` (DAY_CUTOFF_HOUR), `week_start`
  (WEEK_START_DAY), `season_range`, `rolling_periods` (ROLLING_*), `playlist_filters` (decisions
  4–5, casual = 1–4), `baseline_30_day` (BASELINE_DAYS), `streaks`.
- In `"identity"`, beside `camera_identity`/`pending_guess`: `your_row` (non-rejected IDs, two-yous
  pick; logged, no check).
- In `"extras"`, beside `car_stats`: `car_share_aggregate`.
`bun run definitions` regenerates `docs/definitions.md` and `constant-pins.json`.

### Logging (what each log answers)
- `query/read` — which read, how many rows, how long (is the page slow because of the DB?).
- `query/two_yous` — did the unseen two-IDs case happen, in which match, which keys were chosen.
- Pure modules don't log (no I/O); the API layer (WP5a-b) logs requests and failures.

## WP5a-b handoff (written into the roadmap at step 1)
- Host starts before storage (`src/server/main.ts`), so the host gains `mount(handler)`; `/api/*`
  answers 503 `{error:"starting"}` until mounted.
- Writes other than shutdown require a custom header (`X-RLTracker-Request: 1`): the Host check
  stops DNS rebinding, not a cross-site form POST to 127.0.0.1. No CORS headers, so other sites
  can't read GET or SSE responses.
- Response shapes as Zod schemas in `src/shared/schemas/`, so contract tests parse with them and
  the web gets inferred types.
- SSE: `status` sent on change (client `onStatus` + a short poll for `statsApiOff`), `match_ended`
  {guid, sessionKey} after `writer.save` succeeds, heartbeat comment.
- Endpoints sketch: status, events, sessions (range + month folds), session detail, match detail,
  period aggregate, seasons, `POST` break. The b plan settles them.
- `staticDir` is an option; the compiled tracker's real `dist` location is confirmed with WP5b.

## Files
- New: `src/shared/periods.ts`, `src/shared/playlist-filter.ts`, `src/server/query/sessions.ts`,
  `src/server/query/aggregate.ts`, `src/server/query/read.ts`, each with a `.test.ts`.
- Changed: `src/server/rules/registry.ts`, `src/server/rules/definitions.ts` (area title),
  `src/server/rules/constant-pins.json`, `docs/definitions.md` (generated),
  `docs/plans/2026-10-16-v1-roadmap.md` (status, split, b handoff), `BACKLOG.md` (Next pointer,
  two-yous Watch item), `PROJECT_INDEX.md` (new modules).

## Steps
1. Save this plan as `docs/plans/2026-10-21-wp5a-a-query-logic.md`; roadmap WP5a status "in progress,
   split a/b" + the b handoff; BACKLOG Next pointer.
2. TDD `periods.ts` (red first; every periods/sessions test file pins `TZ`, each file is its own
   fork): 4am boundary (03:59 vs 04:00), DST spring/fall in both zones (day length 23/25 h, `dayOf`
   around the change), week start: **Monday 03:30 is in the prior week, Monday 04:00 in the new
   one**, month and year starts, seasons (middle, last open-ended and running, before the first
   season, unknown id, start dates out of id order), last7/last30 edges incl. a `last30` spanning a
   DST change (`from` stays 04:00), `running` on last7, a past week and the open-ended season.
3. TDD `playlist-filter.ts`: one id from each of the seven groups against every filter (6 and 26
   out of everything; offline 8 out of everything but in `{playlist: 8}`; ltm 38 in extra and
   everything; tournament 34 in everything, not ranked), unknown id in everything only,
   `playlistsPresent`.
4. TDD `sessions.ts`: gap exactly 30 min vs 30 min + 1 ms, overlapping matches (max endedAt), break
   before / between / inside a match / after the last match, multiple breaks, unsorted input, key =
   first guid, `currentSession` edges (a break after the last match → null).
5. TDD `aggregate.ts`: empty input → nulls, zero shots, streaks with a no-result match in between,
   `endedOn`, MVP count, left-early count, extras-not-computed rows excluded, car-weighted boost and
   shares with opponents' null car_ms, fastest goal ignores own goals, `byPlaylist`, `baseline`
   window edges (exactly 30 calendar days before included, session start excluded, across a DST
   change).
6. TDD `read.ts` against a temp DB (`openStorage` + `createRecordWriter`, as `save.test.ts` does):
   pending ID is you, rejected isn't, spectated → `me` null, two yous → camera pick + one log line
   across two reads, goals/statfeed attached to the right match, range bounds; a spectated-only
   session is dropped from a filtered session list.
7. Registry entries, pins, `bun run definitions`; registry tests green.
8. `bun run check` green. Then the `/compact` line, then `independent-review-pass`.
9. Docs per `documentation-backlog-hygiene` (ADR gate for the session-key + baseline decision).

## Verification
- `bun run check` (tsc, eslint strict, vitest) green, with the new suites red first then green.
- Read-only sanity run against the deployed `tracker.db` (opened `readonly`, as `rules-diff` does)
  via a scratchpad script: session count, last session's key and W–L, a 30-day baseline. Check
  them by eye against what was played. No writes.

## Plan review
plan-reviewer (opus), 2026-10-21. All folded in:
1. Groups ltm/tournament/offline unassigned → asked the user; decisions 4–5; a test per group.
2. Week-start test was dead (Sunday 03:30 is the same week) → Monday 03:30 vs 04:00.
3. 7/30-day windows hard-coded → `BASELINE_DAYS`, `ROLLING_*` constants, pinned.
4. two_yous warn on every read → once per guid per process, tested.
5. `running` vs half-open `[from, now)` → `from ≤ now ≤ to`, tested.
6. Day subtraction in ms drifts across DST → `shiftDay` / local fields; DST tests.
7. Season edges/order unspecified → `dayStart(start_date)`, ordered by `start_date`.
8. `IN` list of every guid → reuse the range predicate.
9. Unpinned `TZ` → every periods/sessions test file pins it.
10. Areas → new area named `queries`; `your_row` in identity, `car_share_aggregate` in extras.
11. Spectated-only sessions → stated (dropped from lists) and tested.

## Review log
Diff re-classified Substantial (~1,480 lines, new modules). Snapshot for round 2: `86e581c`.

**Round 1**: code-review high, arch-reviewer (sonnet), security-reviewer, /simplify (4 angles).
- security: no findings. Its notes (validate `day`, `from`/`to`, filter and guids at the HTTP
  boundary) → WP5a-b handoff.
- code-review: BACKLOG two-yous Watch item missing → [Fixed] in step 9.
- code-review: closed periods were `running` at `now === to`, so two adjacent periods both ran at
  the shared 04:00. Revisits plan-review item 5: `from ≤ now ≤ to` was meant for the open-ended
  kinds (`to` = now), and is wrong for closed ones → [Fixed] closed ranges use `now < to`;
  regression test.
- code-review + arch: last season entered ahead of its start gave `from > to` → [Fixed] empty range
  at its start, `running` false; regression test.
- code-review: `Math.max(...xs)` exceeds the argument limit on a long history → [Fixed] reduce;
  regression test (300k goals, RangeError before).
- code-review + arch: copy-on-append grouping (O(n²)) in `byPlaylist` and read.ts → [Fixed]
  `Map.groupBy`.
- code-review + arch: `{key}` string replace in SQL → [Fixed] `yours(key)` typed function.
- code-review + arch: dead `?? 0` on woodworkHits; boost/share nulls → [Fixed] narrowed type;
  [Verified, no fix needed] for car stats (`boost_avg` null only at `car_ms` 0, which weighs
  nothing; the ms columns are never null when `car_ms` is set; `recorder/extras.ts`), commented.
- code-review + altitude: `currentSession` only valid on the unfiltered list → [Fixed] contract in
  its doc comment; a composed page entry point → WP5a-b handoff.
- code-review: day strings not validated → [Deferred → WP5a-b handoff] Zod at the boundary.
- arch: `readMyMatches` one long closure → [Fixed] `toMyMatch` extracted.
- arch: `gapMs` params nobody sets; altitude: gap/break logic split between `cutSessions` and
  `currentSession` → [Fixed] both use `SESSION_GAP_MS` and `breakBetween`.
- arch: speculative header comment in sessions.ts → [Fixed] reworded.
- arch: plan §5 named plain functions, code is a reader closure → [Fixed] Implementation note.
- arch: `readBreaks`/`readSeasons` log every call → [Verified, no fix needed] one cheap line each;
  the read trail stays uniform.
- arch/simplify: nested-ternary guid compare → [Verified, no fix needed] code-unit order is
  deliberate (`localeCompare` varies by locale).
- simplify (applied): `NO_EXTRAS` const, `nullCounts` from `COUNTED`, `GroupFilter` type,
  `daysBefore` in periods.ts used by `baseline` (altitude: date math in one module).
- simplify (skipped): `Pick<MyMatch,…>` for `sessionsPlayed` rows (tests pass bare objects; the
  structural type is enough); test builders shared with save.test.ts (outside the diff); month
  rollover, rolling-days lookup, single-pass aggregate (no payoff now); explicit
  `extrasComputed` flag (the woodwork_hits proxy is the registered rule); playlist filter in SQL
  and caching cut sessions (fine at current scale; WP5a-b handoff notes per-request cost).
- Tests after fixes: `bun run check` green, 47 files, 601 tests.

**Round 2** (delta from `86e581c`): code-review low, arch-reviewer (sonnet), security-reviewer.
- security, code-review: no findings.
- arch: no bug or risk; regression checks of every round-1 fix passed. Nits: sessions.ts header
  wording → [Fixed] (nit, no re-round); `NO_EXTRAS` not frozen and `nullCounts` built with a cast
  → [Verified, no fix needed] nothing mutates it, `COUNTED` is the single key list.
- Review closed: round 2 had no new finding and no /simplify edit.

## Implementation notes
- The two-yous "once per guid" Set lives in `createQueryReader`'s closure, not at module level: one
  reader per process gives the same once-per-process, and tests stay isolated (the playlist_map
  precedent is per writer too).
- `sessionsPlayed(sessions, rows, filter)` (in `sessions.ts`) is the "drop sessions with none of
  your matches under the filter" rule from §3, as a pure function.
- `Session` carries `lastStartedAt`, which `currentSession` needs for the break check.
- `aggregate` skips spectated rows itself, so no caller can forget to.
- The read functions are one `createQueryReader({tracker, logger})` rather than plain `(db)`
  functions: the logger and the two-yous Set need a home.
- `cutSessions` and `currentSession` take no gap parameter: nothing sets one, and one constant
  keeps cutting and "current" in step.

## Verification results
- `bun run check` (2026-10-21): tsc, eslint clean; vitest 47 files, 599 tests. New suites red
  first (missing module) then green: periods 20, playlist-filter 13, sessions 15, aggregate 18,
  read 10.
- Read-only sanity run against the deployed `tracker.db` (scratchpad script, `openDb` readonly):
  13 matches, all played, 1 session (key `C6C39D8E…`, 19 Oct 21:41–23:16, day 2026-10-19),
  5–8, 25 goals, ended on a 1-loss streak; baseline for it 0 matches (all nulls, nothing earlier
  recorded); no current session; by playlist Doubles 1–4, Ranked Doubles 3–4, unmapped 53 1–0;
  no `two_yous`; `readMyMatches` 13 rows in 8 ms. To check by eye: that evening's W–L.
