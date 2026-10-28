# WP7a: Trends page, period controls and tiles

Repo copy (step 1): `docs/plans/2026-10-27-wp7a-trends-page.md`. Tier: Substantial.

## Context
WP7 builds the Trends page (roadmap § WP7; map "Period views — the Trends page", reference =
variant B of `prototypes/period-views/period-views-prototype.html` on branch
`prototype/period-views`). `/trends` is a placeholder today (`src/web/pages/Placeholders.tsx:6`).
The server already has `GET /api/period` (`src/server/api/pages.ts:135`, one aggregate + range +
playlistsPresent + sessions) with no web consumer, plus `periodRange`/`dayOf`/`shiftDay` in
`src/shared/periods.ts` and `aggregate()` in `src/shared/aggregate.ts`. Nothing computes a previous
period or buckets yet.

WP7 is ~2,200 lines, so it splits (user, 2026-10-27):
- **WP7a (this plan)**: the shared trend logic (buckets, previous period), the period API with
  previous + buckets, a played-days endpoint, the page with period controls, header, six tiles with
  ▲▼ and sparklines, and the empty states.
- **WP7b (own plan later)**: rolling-20 with back-reach, the big chart (average line, season
  marks, hollow dots, By date / By match, auto-switch under 6 buckets with its note), the W/L bar
  chart with click-through, and the roadmap's done-criterion ("every quick pick and stepper renders
  against seeded data").

## Decisions (the user's, 2026-10-27)
- Split as above.
- **Day click (WP7b, recorded now; closes the roadmap's open item)**: a day in the W/L chart opens
  that day's **first** session; "2nd of 2" is one ‹ › step away on the recap.
- **Not enough data**: Trends shows the page-level "not enough data yet" note while you have
  **fewer than 20 played matches in total** (all playlists, all time), so the 2-match DB shows it.
- **Default period**: Last 30 days.

## Resolved from the spec and the code (no fork)
- Default filter on Trends: `ranked` ("All ranked"); the URL omits it when it is `ranked`.
- **Kinds on Trends**: last7, last30, week, month, season, this_year, all. Kind `year` (and `day`)
  stay API-only; the year stepper changes only the strip's `year` URL value, never the period
  (as in the prototype's `timeline()`).
- **Bucket kind**: day for last7, last30, week, month; week for season, this_year; month for all.
  Week buckets start Monday and are clipped to the period's edges (a season starting on a
  Wednesday gets a short first week); a bucket's `day` is its Monday (week) or the 1st (month),
  not the clipped start, so WP7b's click-through opens the whole week or month. Running periods:
  the axis runs to the period's end for a closed calendar period (the rest of this week/month as
  empty buckets) and to the end of today for open ones (last7/30, this_year, current season). A
  range with `to <= from` (a season entered ahead of time, `periods.ts:81`) gives no buckets.
  `all` starts at the month of your first match under the filter; none gives no buckets. Empty
  buckets carry `matches: 0` and null stats (no fake zeros: gaps in sparklines, never a 0 point).
- **Previous and next period**: one shared `previousSpec(spec, seasons)` / `nextSpec(spec,
  seasons)` (week ± 7 days, month ± 1 with the year rollover, season by start date, none past the
  table's ends) serves both the server's comparison (through `periodRange`) and the web's ‹ ›.
  last7/last30 compare with the n days before `from` (a raw range, the only special case);
  this_year and all have none ("nothing earlier" in the header). An open current season is
  compared with the whole previous one: tiles are rates and per-game, so unequal lengths are fine.
- **Today** on the web is always `dayOf(Date.now())` (4am cutoff), so 02:00 on a Monday still
  belongs to the week before for This week / Last week.
- **An empty period** (no matches under the filter, at or over the 20-match threshold): the
  controls, strip and the title line (title, ‹ ›, date range, "compared with …") stay, so you can
  step out of it; the stats line and tiles are replaced by "No matches in this period with these
  filters." The prototype dropped the title line too, which left no ‹ ›.
- **Tile deltas** (prototype `dlt`): Win % and Shooting % in points, "≈" under 1 pt; per-game
  tiles via the recap's `vsAverage` (`src/web/logic/recap.ts:61`, "same" under 3%). No delta when
  the previous period has no matches; the header says so once ("last week had no matches here").
- **Tiles, in order**: Win %, Goals, Shots, Shooting %, Assists, Saves (per game). A tile is a
  `<button aria-pressed>` that selects the metric (`metric` in the URL); in WP7a it only selects,
  WP7b's big chart reads it.
- **Period header**: title with ‹ › (week, month, season only), date range, "still running" for an
  unfinished calendar period (week, month, season, this year), "compared with …" or "nothing
  earlier", W–L, matches, sessions, best win streak, MVPs, and the amber "⚑ includes N matches you
  left early" when `aggregate.leftEarly > 0`.
- **Period controls**: quick picks Last 7 days, Last 30 days, This week (week of today), Last week
  (week of today − 7), This year, All time (a native button group with `aria-pressed`); the
  playlist `<select>` (`PlaylistFilter`, options from the period's `playlistsPresent`); the year
  stepper (‹ YYYY ›, from your first played year to the current one); the year strip.
- **Year strip** (custom, ported from the prototype's `timeline()`): season bands (buttons, clipped
  to the year, a disabled "before S22"-style band before the first season), 12 month cells
  (buttons; future months disabled), thin grey day ticks (aria-hidden, height by match count,
  under the filter), the selected period shaded, today marked. Scrolls sideways on a phone. The
  strip's year is `year` in the URL, defaulting to the year the selected period ends in.
- **Stepping bounds**: ‹ disabled when the earlier period would end before your first played
  match's day; › disabled when the later one would start after today; seasons follow the table.
- **URL** (`/trends?…`, all optional): `kind` (+ `day` / `season` as `periodParams` takes them),
  `filter`, `metric`, `year`. A week is stored as its Monday so quick-pick matching is exact. Bad
  values fall back to the default and log once, like `parseFilter` (`src/web/logic/filter-options.ts:18`).
- **Live**: query keys start with `"period"` / `"played-days"`; the existing invalidation
  predicate (`src/web/logic/invalidation.ts:26`) already refetches any non-`session` key on
  `match_ended`, so nothing changes there.
- UI defaults from the roadmap apply unchanged: focus to the changed control, a loading state with
  no placeholder data, native controls, passive charts (sparklines are `aria-hidden`; the tile's
  value and delta are text).

## Approach and files

**Shared, pure, TDD'd** — new `src/shared/trends.ts` (+ `trends.test.ts`):
- `bucketKind(spec)`; `buckets(spec, range, { now, firstDay }) → {from, to, day}[]` built from
  `dayStart`/`shiftDay`/`nextMonthStart` (DST-safe like `periodRange`).
- `previousSpec` / `nextSpec(spec, seasons) → PeriodSpec | null` (week, month, season), and
  `previousRange(spec, range, { now, seasons }) → PeriodRange | null` = `periodRange(previousSpec)`
  or the n days before for last7/last30.
- `trendStats(a: Aggregate)`: `{matches, wins, losses, winPct, shootingPct, perGame: {goals,
  assists, saves, shots}}`, the compact shape buckets (and WP7b's rolling points) carry.

**Server**:
- `src/shared/schemas/responses.ts`: extend `periodResponse` with `previous: {range, aggregate} |
  null`, `bucket: "day"|"week"|"month"`, `buckets: [{from, to, day, stats}]`; add
  `playedDaysResponse = {days: [{day, matches}], firstDay: string|null, totalMatches: number}`.
- `src/shared/schemas/params.ts`: `playedDaysParams = {year, filter}`, `year` a 4-digit whole
  number ≥ 1000 for the same reason as `dayParam` (`params.ts:14`).
- `src/server/api/pages.ts`: `period()` adds previous and buckets (one `readMyMatches` for the
  range, one for the previous range; bucket by `startedAt`); new `playedDays(year, filter)` built
  from `reader.readResults()` alone (no `index()`: no breaks or session cuts needed) — played,
  under the filter, grouped by `dayOf` — with `firstDay` and `totalMatches` over every played
  match whatever the filter.
- `src/server/api/index.ts`: route `GET /api/played-days`.
- Logging: the router's existing request logging covers both endpoints; no new failure path.

**Web**:
- `src/web/logic/trends.ts` (+ test): URL parse/serialize, quick-pick specs and pressed state
  (incl. 02:00 on a Monday), step bounds on top of the shared `previousSpec`/`nextSpec`,
  titles/range/"compared with" text, which header parts an empty period keeps, tile values and
  deltas, sparkline points, year-strip geometry.
- `src/web/queries.ts`: `usePeriod(spec, filter)` (the URL's `ranked` default applied before the
  query, since the server defaults to `everything`), `usePlayedDays(year, filter)`, `useSeasons()`
  over the existing `/api/seasons` (season bands, season titles, ‹ ›); `src/web/api.ts` clients
  parsed with the shared schemas.
- `src/web/pages/trends/`: `TrendsPage.tsx`, `PeriodControls.tsx`, `YearStrip.tsx`,
  `PeriodHeader.tsx`, `MetricTiles.tsx` (with an inline `Sparkline`), CSS Modules on the existing
  tokens (`src/web/styles/tokens.css`). Reuse `PlaylistFilter`, `EmptyState`, `format.ts`, `pct`,
  `vsAverage`.
- `src/web/App.tsx`: `/trends` → `TrendsPage`; drop it from `Placeholders.tsx`.

**Tests**: e2e seed mode `few` (2 matches) in `test/e2e/stack.ts` + `fixtures.ts`; new
`test/e2e/trends.spec.ts` on the `rich` seed (33 matches over three months).

## Steps
1. Save this plan to `docs/plans/2026-10-27-wp7a-trends-page.md`. Mark WP7 "in progress, split
   a/b" in the roadmap, with the day-click decision closing its open item. Invoke
   `ui-implementation-guidelines` and `dataviz` (sparklines).
2. TDD `src/shared/trends.ts`: bucket kinds; edges per kind, including a DST week, a season with
   clipped weeks, a running month to month end, last30 = 30 day buckets ending today, all from the
   first month, `to <= from` → []; bucket `day` = Monday for a clipped week; previous/next specs
   and ranges per kind (first season → null, January → December, a week across the year,
   this_year/all → null); `trendStats` on an empty aggregate gives nulls.
3. Schemas + `pages.period` + `playedDays` + route. Behaviour in `src/server/api/pages.test.ts`
   (next to its period tests): a 03:30 match lands in the previous day's bucket; previous counts
   for one month; `totalMatches` ignores the filter; a filtered `all` starts at the filtered first
   month. Contract in `src/server/api/api.test.ts`: both responses parse with the shared schemas;
   a bad year → 400.
4. TDD `src/web/logic/trends.ts`.
5. Page components, queries, route; check in a real browser through the dev proxy (all quick
   picks, ‹ ›, strip clicks, filter, phone width, three themes).
6. e2e, independent of the run date (the `rich` seed sits at today, 1 and 2 months back): `few`
   seed → "Not enough data yet"; `rich` → each quick pick renders its title line (and either stats
   or the empty-period note); clicking the current month's strip cell, then ‹, reaches last month,
   whose header shows the ⚑ note and the stats; tiles switch `metric`; axe on `/trends` ×
   carbon/slate/oled. The shell spec's `/trends` axe check keeps passing.
7. `bun run check` (lint, types, Vitest), e2e; then the `/compact` line, then
   `independent-review-pass`, then `documentation-backlog-hygiene` (roadmap status, BACKLOG).

## Verification
- `bun run check` green; `trends.test.ts` (shared and web) cover the cases in steps 2 and 4.
- `api.test.ts` parses `/api/period` and `/api/played-days` with the shared schemas.
- `trends.spec.ts` and `shell.spec.ts` green, axe clean per theme.
- Manual: the page on the real installed DB after `deploy`, checked by the user.

## Plan review
plan-reviewer (opus), 2026-10-27. Its verdict: the approach fits and the split is sound. All 11 findings were folded in:
1. The empty-period state was unspecified, and the e2e depended on the run date → the title line stays, the stats are replaced by a note, and the e2e assertion was made date-independent.
2. The month-click and ⚑ e2e checks failed in January → the test clicks the current month, then ‹.
3. The web had no seasons data → `useSeasons()` over `/api/seasons`.
4. The server logic was only schema-parsed → behaviour cases added to `pages.test.ts`.
5. The previous-period logic was written twice → shared `previousSpec`/`nextSpec`.
6. A season entered ahead gives `to <= from` → that range gives no buckets, with a test.
7. "Today" needs the 4am cutoff → `dayOf(Date.now())`, with a 02:00 Monday test.
8. The year stepper's meaning was unclear → it only pages the strip; kind `year` stays API-only.
9. A clipped week bucket's `day` was undefined → it is the Monday (or the 1st of the month).
10. `playedDays` doesn't need `index()` → it uses `readResults()` alone.
11. The year param had no bounds → a 4-digit year ≥ 1000.

## Implementation notes (2026-10-27)
- `weekStart(day)` is now exported from `src/shared/periods.ts` (it was inline in `periodRange`);
  `buckets`, `previousSpec`/`nextSpec` and the web's quick picks share it.
- The delayed loading pulse moved from `RecapPage.tsx` to `src/web/components/Loading.tsx`, so
  Recap and Trends share one loading model.
- The controls and the title line are built from the URL and `/api/seasons` (the range through the
  shared `periodRange`), so they stay mounted while a period loads and focus stays on the control
  used. Only "compared with …", the stats line and the tiles wait for `/api/period`.
- `usePlayedDays` keeps the previous year's data while the next loads (`keepPreviousData`): paging
  the strip changes only its ticks, so it shouldn't drop the page to a loading state.
- The page reads the clock through `useNow()` (once a minute), not `Date.now()` in render (the
  React purity lint), so a page left open moves on to the next day.
- Focus: Chrome keeps focus on a button that disables itself (‹ reaching the first month), so the
  title-focus rule also covers focus on a disabled button, not just on `body`. Found in the
  browser check, fixed and re-checked.
- The `few` seed has its own spec file (`test/e2e/trends-few.spec.ts`), like `recap-empty.spec.ts`.

## Verification log
- `bun run check`: lint and types clean; Vitest 76 files, 947 tests passed.
- `bun run e2e`: 35 passed (5 in `trends.spec.ts`, 1 in `trends-few.spec.ts`; `shell.spec.ts`
  axe on `/trends` still green).
- Browser (Chrome, rich seed stack): all six quick picks, a strip month click, ‹ to the first
  month (‹ disabled, focus to the title), the ⚑ note, "nothing earlier", tiles and sparklines. The
  320px check is the e2e's (the browser window could not be narrowed).

## Review log

Tier by the diff: Substantial (1,074 non-test lines; design tier Substantial). Round-1 snapshot
`9e21f13`.

### Round 1 (2026-10-27): code-review high, arch-reviewer (opus), security-reviewer, simplify

security-reviewer: no findings.

code-review high:
1. The period query key had no date, and cached queries never go stale, so a page left open (or
   reopened next day in the same tab) kept yesterday's rolling or running period. [Fixed] `today`
   is in the `usePeriod` key.
2. In late December, the strip for This week jumped to next year (every month disabled).
   [Fixed] `stripYear` caps the default at today's year (tested).
3. The All time header and strip started at the unfiltered first day, but the buckets started at
   the filtered one. [Fixed] `/api/period` returns `firstDay` (first match under the filter), and
   the page uses it for All time. (Also raised by arch as a question.)
4. Efficiency: each bucket rescanned every match; played-days reads every result on each request.
   [Fixed] for buckets (one sweep over the start-ordered matches). [Deferred → BACKLOG] for
   played-days.
5. `METRICS[].rate` was unused, and `isRate` repeated it. [Fixed] `isRate` reads `METRICS`.
   (Also raised by arch.)
6. `monthStart`, the season sort and the week/month edges were each written in up to three
   places. [Fixed] `monthStart`, `calendarSpan`, `seasonsByStart` and `rollingDays` now live in
   `periods.ts`, and `periodRange`, shared trends and web logic all use them.
7. `periodQuery` in queries.ts duplicated `trendsPath`'s encoding. [Fixed] one `periodQuery` in
   logic/trends, used by both.
8. The `previous` doc left out day and year. [Fixed] (Also raised by arch.)

arch-reviewer (opus): 1 risk, 8 nits, 2 questions.
- The `first` min-reduce should use the reader's order. [Fixed]
- The year-param comment pointed to another comment. [Fixed]
- `rollingDays` was duplicated. [Fixed]
- The URL year regex duplicated the API's. [Fixed] It now uses `playedDaysParams.shape.year`.
- `stepTarget` had a dead branch. [Fixed] `step` now returns a narrower `StepSpec`, so the branch
  is gone.
- `STEP_NOUN` was a middle man. [Fixed]
- A loose `!=`. [Fixed]
- trends-few used `?filter=everything`. [Fixed] It is now plain `/trends`.
- Question: keep played-days ticks across a filter change? [Fixed] Old ticks are kept only on a
  year change.

simplify (4 angles): applied the `pickPressed` → `specEqual` change, the narrower `StepSpec`,
and dropping the redundant sort in played-days (results come back in start order).
Skipped:
- [Disputed] The day rollover on an app-level timer and for other queries. The other queries were
  not part of this diff. Client and server share one clock on this machine, so the key can't run
  ahead of the server's day.
- [Disputed] `aria-disabled` for ‹ ›, which would change the reviewed focus rule.
- [Disputed] A `KIND_INFO` table, the `StepButton`/`StripButton` extraction, the `parseTrends`
  helper, METRICS `get`, and a `PeriodBody` extraction. These are refactors for taste; the code
  reads as is.
- [Disputed] Dropping `wins`/`losses` from `TrendStats`: WP7b's W/L chart reads them per bucket.
- [Disputed] `useNow` re-renders once a minute; the cost is negligible at this size.
- [Disputed] The month short label and `daysBetween` moving to shared helpers: one use each.

After the fixes: `bun run check` passed (76 files, 948 tests) and `bun run e2e` passed (35).

### Round 2 (2026-10-28, delta `git diff 9e21f13`): code-review low, arch-reviewer (sonnet), security-reviewer

security-reviewer: no findings. arch-reviewer: every round-1 [Fixed] item checked fixed.
- ‹'s bound uses the unfiltered first played day, unlike All time. [Verified, no fix needed]
  It's deliberate, as the plan says: ‹ stops at your first played match whatever the filter.
  An unfiltered-but-empty period shows the empty-period note, and its ‹ › still work.
- The bucket sweep relies on the buckets ascending without overlap. [Fixed] A comment now says so.
  It's a nit, so the round stays closed.
- queries.ts imports `periodQuery` from logic/trends. [Verified, no fix needed] There's no cycle.
  Move it if WP7b's pages need it elsewhere.
- No test covers the filter-change tick placeholder. [Verified, no fix needed] It's display-only
  and keyed by the filter.
- code-review low: `firstDay` from `mine[0]` relies on the order. [Verified, no fix needed]
  `readResults` orders by `started_at` (read.ts:274).
- code-review low: `monthStart` is written twice. [Verified, no fix needed] It's already a single
  export from `periods.ts` (the reviewer was reading an old hunk).

Done: round 2 had no fix beyond a comment. Summary: 2 rounds; 21 fixed, 1 deferred (played-days
scan → BACKLOG), 6 simplify suggestions disputed.
