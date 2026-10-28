# WP7b: Trends big chart, rolling 20, W/L chart with click-through

Repo copy (step 1): `docs/plans/2026-10-28-wp7b-trends-charts.md`. Tier: Substantial (second half
of WP7; ~800–1,000 lines with tests, one session).

## Context
WP7a (committed `01377d4`) shipped the Trends page: controls, year strip, period header, six
tiles with ▲▼ and sparklines, and `/api/period` returning `range`, `aggregate`, `previous`,
`firstDay`, `bucket` and `buckets[{from,to,day,stats}]`. The selected tile's `metric` is already in
the URL, but nothing plots it yet. WP7b adds what roadmap § WP7 and the features map ("Period views
— the Trends page", map lines 245–256) still list:
- **The big chart** of the selected metric: points per bucket, hollow dots under 3 matches, a
  dotted period-average line, season-start markers.
- **By date / By match**: By match is a rolling average of the last 20 matches, and its window
  reaches back before the period, so the first points are full windows. **Auto** switches to By
  match when fewer than 6 buckets have matches, and says why; the user can switch back.
- **The W/L bar chart** per bucket: wins up, losses down, W/L letters on the axis. Clicking a day
  opens that day's first session (user, 2026-10-27); clicking a week or month opens that period.
- **The done-criterion**: every quick pick and stepper renders against seeded data, and a 2-match
  DB shows the "not enough data yet" note. The note is already covered by `trends-few.spec.ts`.

Reference: variant B of `prototypes/period-views/period-views-prototype.html` on branch
`prototype/period-views` (`lineChart`, `wlChart`, `rolling`, `seasonMarks`, `VariantB`). Rejected
in the map: a dashed previous-period line on the big chart.

## Decisions (no fork the user needs; open to change at approval)
- **Rolling points come from the server, in `/api/period`** (`rolling: [{n, startedAt, stats}]`).
  The web has no match rows, and the auto rule needs the rolling point count on first render. It's
  one query, so the toggle switches instantly with no second loading state. Size: one compact
  `TrendStats` per match in the period, about 200 B each: ~200 KB for a 1,000-match year, ~1 MB for
  5,000 matches on All time, served from your own PC. A separate lazy `/api/rolling` was
  considered. It isn't worth a second query and loading state at this size.
- **The rolling rule** (shared `ROLLING_WINDOW = 20`, which WP8 makes a setting): the period's
  matches are taken in start order under the filter, preceded by the 19 played matches before the
  period under the same filter. Point *n* is the window of 20 that ends at the period's *n*-th
  match. **Only full windows are plotted.** If the history is short (all time, or a filter's first
  weeks), the line starts at the first full window. Fewer than 20 matches overall gives no points:
  By match then shows "By match needs 20 matches with these filters", and auto never picks it.
  This matches the prototype in effect: its `min(n, all.length)` rule left one point for a short
  history. The map's "one friend over 30 days" example is for a teammate filter, which isn't in v1.
- **The back-reach is bounded**: from `index().results`, take the guids of the 19 played
  matches under the filter that start before `range.from`. Then read them with
  `readMyMatches({ guids })`. No full-history read. All time has no back-reach.
- **Auto rule**: fewer than 6 buckets with matches **and** at least 6 rolling points → By match,
  with the note "Only N days with matches here, so this shows a rolling average of 20 matches
  instead. Pick By date to see them." (N's noun follows the bucket kind.) The rolling-point
  condition replaces the prototype's `ms.length >= 8`: it switches only when the rolling line
  actually has more to show.
- **The x mode is in the URL**: `x=date|match`; absent means auto. Bad values fall back and are
  logged like the other params. The toggle is a native button group with `aria-pressed` on the
  effective mode. Pressing a mode writes it explicitly, so "By date" sticks after an auto switch
  **within that period and filter**. A period change (quick pick, strip, ‹ ›, W/L click) or a filter
  change resets `x` to auto, as `year` is reset, because what fits one period doesn't carry over.
  A metric change keeps it.
- **A day bucket's click target** is the first session listed for that day under the filter (the
  first `summaries(idx, filter)` entry whose `day` is the bucket's day), so the recap opens on that
  day's "1st of N". If no session starts that day, because its matches are the tail of a session
  that began before 04:00 and crossed the cutoff, it falls back to the session holding the
  bucket's first match. The server adds `session: string | null` to day buckets, and it is null for
  week/month buckets and empty days. The recap is opened with `recapPath(key, filter)`, so it
  counts under the same filter. Week bucket → `{kind:"week", day}`, month bucket →
  `{kind:"month", day}` on Trends (the bucket's `day` is already its Monday or 1st, from WP7a),
  with `year` reset.
- **Charts are drawn at the measured width** (a small `useWidth` ResizeObserver hook, like
  `ShareCard.tsx:153`), not a 1000-wide viewBox scaled down. At 320px a scaled viewBox would
  shrink 11px axis text to ~4px. The geometry is pure functions of `(points, width, height)`.
- **The y-axis** is fitted to the data and the average, padded by 15%, never below 0; 3 grid
  lines labelled with the metric's own format (`metricValue`), as in the prototype. The line joins
  across empty buckets (the same as the sparklines), and the dots show where data is. Dots are
  drawn only up to 80 points; past that the line stands alone. Hover columns are capped at one per
  4 px of width: past that, each column stands for the nearest point. The path is still drawn
  through every point, so By match on All time doesn't draw thousands of `<g>`s.
- **Hover**: each x-column is a hit area with an SVG `<title>` ("Tue 13 Oct: 54% · 7 matches";
  "… · under 3 matches"; "no matches"; rolling points read "Match 12 · 5 Oct · last 20 matches
  (reaches before this period)" while n < 20), as in the `GoalMap` precedent. The column is
  highlighted with CSS. No custom tooltip. **Accepted limit**: `<title>` doesn't show on touch, so
  on a phone the big chart's per-point values can't be read; the tiles carry the period's values.
  The W/L links' `aria-label`s carry each bucket's W–L. If a phone readout turns out to be wanted,
  that goes on the BACKLOG.
- **Accessibility**: the big chart is passive, `role="img"` with a summary label ("Win % per day
  over 30 days; period average 52%"); its numbers are already in the tiles. Each W/L **column**
  for a bucket with matches is an SVG `<a>` link in the tab order: a full-height transparent rect
  plus its bars, so a 1–0 day is still easy to hit. As in the prototype's `g.hit`, it is one small
  `BucketLink` component per column, since `useLinkClickHandler` is a hook (`GoalMap.tsx:102`).
  Its `aria-label` reads like "Tue 13 Oct: 3 wins, 2 losses. Open its recap." It is the only way
  from Trends to a day's recap or a week/month, so unlike GoalMap's marks it is not `tabIndex=-1`.
  A visible focus ring outlines the column. Empty buckets are plain, non-focusable. The
  ui-implementation-guidelines target-size rule is checked in step 1. Narrow columns at 320px
  (Last 30 days ≈ 9 px) are the known compromise: they sit next to each other with no gap.
- **Season marks**: a season whose start falls strictly inside the plotted span (after the first
  bucket's `from` and before the last bucket's `to`, so All time with its null `range.from` works)
  gets a dashed vertical line at its bucket and its name ("S22"). They appear on the By date chart
  and the W/L chart, not on By match (as in the prototype).
- **The empty period** keeps WP7a's behaviour: no charts, only the "No matches in this period"
  note.

## Approach and files

**Shared (pure, TDD)**, `src/shared/trends.ts` (+ `trends.test.ts`):
- `ROLLING_WINDOW = 20`;
  `rollingWindows<T>(before, inPeriod, size) → {n: number; window: T[]}[]`, with full windows
  only and `before` trimmed to its last `size − 1` matches.

**Server**:
- `src/shared/schemas/responses.ts`: add `session: z.string().nullable()` to each bucket and
  `rolling: z.array({ n, startedAt, stats: trendStatsSchema })` to `periodResponse`.
- `src/server/api/pages.ts` `period()`:
  - The bucket sweep (`pages.ts:162-168`) adds `session` for day buckets. It takes the first key
    per day from `summaries(idx, filter)`, falling back to a guid → key map built once from
    `idx.all`. `keyOf` (`pages.ts:127`) is per-guid and linear, so it isn't reused.
  - The back-reach is the 19 `idx.results` before `range.from` that are played and under the
    filter → `readMyMatches({ guids })` → `rollingWindows` → `trendStats(aggregate(window))`.
- Logging: no new failure path or external call. The router's request log (with `ms`) covers the
  extra work. `period()` logs nothing today, and this adds no decision a log would need to explain.

**Web**:
- `src/web/logic/trends.ts`: `TrendsState.x: "auto" | "date" | "match"` in
  `parseTrends`/`trendsPath`, and `rawValue` exported for the chart (it's private now).
- New `src/web/logic/trend-chart.ts` (+ `trend-chart.test.ts`), pure:
  - `chartMode(asked, buckets, rolling) → {mode, auto, withData}`.
  - `bucketLabel(day, kind)` ("Tue 13 Oct" / "Week of 12 Oct" / "Oct 2026", via `format.ts`
    `dayLabel`/`monthLabel`).
  - `linePoints` builds both series' points. For buckets: value, matches, hollow, title. For
    rolling: value, title.
  - `lineGeometry(points, avg, {width, height}) → {yTicks, path, dots, avgY, xLabels, columns}`.
  - `seasonMarks(buckets, seasons, range) → {i, name}[]`.
  - `wlGeometry(buckets, {width, height})` gives the bars (zero-height bars are omitted) and
    `bucketHref(bucket, kind, state)` gives the recap or Trends path for a bucket, or null.
- `src/web/components/useWidth.ts`: a ResizeObserver hook giving a ref and its content width
  (0 before the first measure, when nothing is drawn).
- `src/web/pages/trends/TrendChart.tsx`: the big chart panel, with its heading ("Win % · per day" /
  "· rolling 20 matches"), the By date / By match group, the auto note, the SVG and the key
  (dotted = period average; "hollow dot = under 3 matches" or "each point = your last 20
  matches").
- `src/web/pages/trends/WinLossChart.tsx`: the W/L panel, with the heading "Wins and losses · per
  day · select a day to open its recap" (the hint follows the kind) and the bars as links.
- `TrendsPage.tsx`: render both after `MetricTiles` when the period has matches; log
  `console.debug("[rlt] trends/chart", { mode, auto, withData, rolling })` when the effective mode
  changes. This answers "why did the chart show By match?" from the console.
- `Trends.module.css`: chart classes on the existing tokens (accent line, `--win`/`--loss` bars,
  grid and muted text). They are checked in all three themes.

**e2e**: `test/e2e/trends.spec.ts` on the `rich` seed. Last month under All ranked has 2 days with
matches and ~30 matches after one earlier match, so auto picks By match. It can't hold 20 full
windows before the period, but it has 12 points ≥ 6.

## Steps
1. Save this plan to `docs/plans/2026-10-28-wp7b-trends-charts.md` and mark WP7b in progress in
   the roadmap. Invoke `ui-implementation-guidelines` and `dataviz` (big chart, bars, colours),
   and fold any design rule they add into the chart decisions above before coding.
2. TDD `rollingWindows`:
   - The back-reach fills the first windows.
   - A `before` longer than 19 uses only its last 19.
   - With a short `before`, the first point is the first full window.
   - With no `before` (all time), the first point is the period's 20th match.
   - Fewer than 20 in total gives [].
   - `n` numbers the period's matches.
3. Schema + `period()`. `pages.test.ts` cases:
   - The first rolling point's stats count the matches before the period.
   - A match before the period on a playlist outside the filter is not counted.
   - A day bucket's `session` is the day's first listed session under the filter, even when the
     tail of the previous day's session (started 03:30, crossed the cutoff) has the earliest match.
   - A day with only such a tail falls back to that session.
   - `session` is null for a week bucket and an empty day.

   `api.test.ts`: the response still parses.
4. TDD `trend-chart.ts` and the `x` URL param:
   - Auto picks By match with 5 days with data and 6 rolling points. It keeps By date with 6
     days, or with 5 days and 5 points.
   - An asked mode wins.
   - `x` resets to auto on a period or filter change and is kept on a metric change (the page's
     `go` patches go through one tested helper).
   - Hover columns are capped by width.
   - Season marks on All time (null `from`).
   - The y range includes the average and stays ≥ 0; a flat series gets a non-zero span.
   - A single point is centred.
   - The path skips nulls.
   - Hollow dots under 3 matches; no dots past 80 points.
   - Season marks: only starts strictly inside the period, at the bucket that holds the start.
   - W/L heights scale to the max.
   - `bucketHref`: day → `recapPath`, week/month → `trendsPath` with year reset, empty → null.
   - Labels per kind.
5. Components, `useWidth` and the page wiring. Check in a real browser through the dev proxy:
   - All six quick picks, ‹ › on a week, month and season, and By date/By match/auto.
   - Click-through: a day bar to the recap, an All time month bar to that month, a This year week
     bar to that week.
   - Keyboard Tab to the bars.
   - Phone width and all three themes.
6. e2e (`trends.spec.ts`, independent of the run date):
   - The quick-pick test also asserts the big chart and W/L chart, or the empty-period note.
   - A stepper test: ‹ from This week, a month ‹ (already there), and a season band → ‹/› when
     enabled. Each renders its title and charts or the empty note.
   - Last month opens on By match with the auto note. "By date" sets `x=date`, and the heading
     says "per day".
   - Clicking last month's day-12 bar opens the recap of the day's first session (its 4 Ranked
     Doubles matches). Don't assert "of 2": under `ranked`, the casual `e2e-second` is filtered
     out, so the recap reads 1 of 1.
   - After "By date", a quick pick returns to auto (no `x` in the URL).
   - On All time, clicking a month bar shows that month's title.
   - The existing 320px no-sideways-scroll test and the axe test (three themes) now cover the
     charts.
7. `bun run check`, `bun run e2e`. Then give the `/compact` line, run `independent-review-pass`,
   then `documentation-backlog-hygiene`: WP7 done in the roadmap and BACKLOG, the plan's review
   log, and a commit when asked.

## Verification
- `bun run check` green: the new cases in `shared/trends.test.ts`, `pages.test.ts`,
  `trend-chart.test.ts` and `logic/trends.test.ts`.
- `bun run e2e` green, including the new chart, stepper and click-through tests and axe per theme.
- A browser check as in step 5. The user checks the real installed DB after `deploy`.

## Plan review
plan-reviewer (opus), 2026-10-28. Its verdict: sound and well grounded. It checked the seed figures
(last month under ranked has 2 days with data and 12 rolling points), `readMyMatches({guids})` and
the fields on `idx.results`. Its 9 findings and what was done with each:
1. A day click could open the day before's session that crossed the cutoff → it now opens the
   day's first listed session, and the crossing session is only a fallback. Both cases are tested.
2. What happens to `x` on a period or filter change was unspecified → it resets to auto, like
   `year`, and a metric change keeps it. Tested.
3. The W/L click targets were tiny → the link is now the whole column, through a `BucketLink`
   component.
4. `<title>` doesn't show on touch → accepted and stated. The W/L `aria-label`s carry each
   bucket's W–L, and a phone readout would go on the BACKLOG if wanted.
5. There are no rolling points under 20 matches, unlike the prototype → kept. In effect the
   prototype also gave one point, and the friend filter isn't in v1. The plan now says so.
6. The payload and DOM grow on All time → the size figure is corrected, and hover columns are
   capped by width.
7. The season-mark rule didn't cover All time → marks now use the first and last bucket edges.
   Tested.
8. A line reference was wrong → fixed.
9. The e2e "of 2" assertion would be wrong under ranked → the test asserts the 4 matches instead.

## Design-skill notes (step 1)
- Marks (dataviz): the line is 2px with round joins and caps; dots r = 4 with a 2px ring in the
  surface colour, hollow dots a 2px accent stroke on the surface. Grid lines are 1px solid
  `--grid`. The average line is dotted and the season marks dashed: they are reference lines,
  not grid lines. Bars are at most 24px wide with a 2px gap between neighbours, and a 4px round
  only at the data end (wins round at the top, losses at the bottom), square at the baseline.
- Colour: `--win #2ca57a` / `--loss #b84a63` validated on the three dark surfaces: all pass,
  CVD ΔE 7.6 (deutan) is in the 6–8 band, legal only with secondary encoding. Here direction
  (up/down) and the W/L axis letters carry it. Text stays in ink tokens, never the series colour.
- Hover: dataviz's default crosshair tooltip is replaced by SVG `<title>`s per the
  ui-implementation-guidelines "passive charts" default, with the touch limit accepted above.
- Target size: the project floor is WCAG 2.1 AA, which has no target-size criterion (2.5.5 is
  AAA); the whole-column link is the mitigation for narrow buckets.

## Implementation notes (2026-10-28)
Steps 1–6 done; `bun run check` (978 tests) and `bun run e2e` (39) green. Changes against the plan:
- `rollingWindows` also returns `end` (the period match a window ends at), so the server takes a
  point's `startedAt` without an index lookup.
- Hover columns map end to end (`round(c·(n−1)/(count−1))`), so the first and last points always
  have one.
- The y axis of a rate is capped at 100%.
- Chart headings are `h3` under the period title's `h2`.
- Axis labels use a bucket's clipped start (`dayOf(from)`), so This year's first week reads 1 Jan,
  not the Monday before.
- Browser check (Chrome, rich-seed stack): All time (auto By match, note, S24 mark), last month By
  date with S24 marks, the day-12 bar → `/recap/e2e-first-a?filter=ranked`, This year with a
  keyboard-focused week column (ring visible) and Enter → that week with `x` reset, slate theme.
  320px is the e2e's (the window could not be narrowed).
- Step 7 done: review below (4 rounds); roadmap, BACKLOG, index and review summary updated.

## Review log
Diff tier: Substantial (design tier; ~620 non-test lines). Snapshot of the round-1 state:
`8616a86` (`git stash create`).

### Round 1 — code-review high, arch-reviewer (opus), security-reviewer, /simplify
- [Fixed] cr: `rolling()` sliced with `-(ROLLING_WINDOW − 1)`, which is `slice(-0)` (the whole
  history) at a window of 1 → `Math.max(0, len − (W − 1))`.
- [Fixed] cr: hover columns were equal slices, not each point's nearest area → each column now runs
  halfway to its neighbours' points; tested.
- [Fixed] cr + arch (risk): a season mark at a bucket with no hover column (columns capped) fell to
  x = 0 → `lineGeometry` returns `xOf(i)`, and marks use it.
- [Fixed] cr: `Math.min(...all)` could pass more values than a call takes on By match/All time →
  a loop, as `aggregate.ts` does.
- [Fixed] cr + arch: a day with matches but a null `session` was titled "no matches" and unlogged →
  `wlRecord` titles it by its record, and the page warns `[rlt] trends/day_no_session {days}`. The
  server's guid fallback should make it impossible; no BACKLOG item, since no real data shape is
  in question (it would be our own bug).
- [Fixed] cr: `x=auto` was logged as a bad param → accepted.
- [Fixed] cr: a box narrower than its padding gave negative widths → inner width clamped at 0;
  tested.
- [Verified, no fix needed] cr: `useWidth` repeats ShareCard's ResizeObserver block. ShareCard is
  outside this diff and measures height; a shared hook would reopen it for five lines.
- [Fixed] cr + arch: `shortDay`/`shortLabel` copied `dayLabel`/`monthLabel`'s parse → one private
  `utcDate` in `format.ts` with `shortDayLabel`/`shortMonthLabel` beside the long forms.
- [Fixed] arch: `rolling()` wrote out the filter check → `yours(filter)`.
- [Fixed] arch: one `AUTO_BELOW` stood for two thresholds → `AUTO_MIN_POINTS` added.
- [Fixed] arch: `ChartMode` restated `chartMode`'s return → defined once in `trend-chart.ts`.
- [Fixed] arch: the key showed "period average" with no average line → shown only with one.
- [Fixed] arch: W/L season marks sat at the column's left edge, the big chart's at the point →
  both at the bucket's centre (the charts' padding differs, so they still don't line up exactly).
- [Fixed] arch: the e2e `lastMonth` helper repeated an existing test's steps → that test uses it.
- security: no findings.
- /simplify (4 angles), applied: one `polyline()` for the sparkline and the big chart's path;
  `lineX` dropped for `xOf`; the single-label anchor ternary simplified; the guid → session map
  built only on the rare fallback; `linePoints` memoised so a resize redraws only the geometry.
  Skipped:
  - `Bar`'s x/y/w/h, which the tests use;
  - a shared season-mark component, shared plot-box helper and `metricLabel`, all small;
  - a shared SVG link with GoalMap's `LinkedMark`, which differs in tab order;
  - a sliding-sum `rollingWindows`, ~100k folds at 5,000 matches, run locally;
  - serving `rolling` only on demand, and a day-only `session` field, both plan decisions;
  - moving `chartMode` and its log into the chart, where the plan puts them in the page;
  - `x` reset living in `patchTrends`, its one tested place;
  - memoising the W/L chart (≤ 366 buckets) and coalescing `useWidth` to animation frames.
- Tests after fixes: `bun run check` 980 passed; `bun run e2e` 39 passed (trends re-run 10 passed
  after the e2e helper change).

### Round 2 — full table on the delta (round 1's fixes touched `format.ts`, outside its diff): code-review high, arch-reviewer (sonnet), security-reviewer
- [Fixed] cr: the W/L season-mark comment claimed the marks line up with the big chart's → the
  comment now says the x scales differ.
- [Fixed] cr (second finding on narrow boxes, now with a clean fix): clamping the inner width left
  `plot.right` behind `plot.left`, and 1 px bars spilled out of 0-width columns, with colliding
  keys → no clamps. A chart draws only when `fits(width, pad)`, i.e. wider than its padding, and
  "Nothing measured" now depends on the points rather than the width.
- [Fixed] cr: By match built each rolling point's short day twice → once.
- [Fixed] cr: `rolling()` had become two passes over the results → one pass again, with the filter
  predicate hoisted.
- [Verified, no fix needed] cr: memoise the geometry too. `react-hooks/preserve-manual-memoization`
  rejects that memo, and with `points` memoised it costs one O(points) pass per minute's clock tick.
- [Verified, no fix needed] cr: share an arg-safe min/max with `sparkPath`. `sparkPath` gets at most
  a few hundred buckets, and one loop isn't worth a helper.
- [Verified, no fix needed] cr: `xOf` keeps the geometry's closure alive. It lasts one render.
- [Verified, no fix needed] cr + arch: the orphan days are joined, then split → commented as the
  effect's stable dependency (nit).
- [Verified, no fix needed] arch: the W/L mark's `g.plot.left` fallback. `seasonMarks` indexes the
  same buckets, so a column always exists; the fallback only satisfies indexed-access typing.
- [Verified, no fix needed] arch: a test pinning `AUTO_BELOW` and `AUTO_MIN_POINTS` apart (optional).
- security: no findings.
- Tests: `bun run check` 980 passed; `bun run e2e` 39 passed before the memo was dropped, trends
  re-run after it 10 passed.

### Round 3 — code-review high (the fixed pass), security-reviewer, on `8616a86..de3ba4e`
- [Fixed] cr: the hoisted predicate's name `mine` clashed with two other `mine`s in `pages.ts` →
  `wanted` (nit).
- [Verified, no fix needed] cr: `rolling()` scans all in-memory results to keep 19. It is one
  linear pass over rows already in memory, and the DB read is still bounded.
- **Escalated to the user** (third finding on narrow boxes: round 1 clamp, round 2 `fits`): the fit
  check lives in the callers, checks width only, and the "too narrow" state draws an empty box. 5
  findings on that topic.
- security: no findings.
- User's decision (2026-10-28), when asked what could be simpler: no code guard. `.plotBox` gets
  `min-width: 120px`, wider than either chart's padding, which the geometry assumes. Heights are
  fixed constants. `fits()` and its test are removed, and the charts draw once `width > 0`. Not
  taken: one shared x scale for both charts (so season marks line up), and one hover column per
  point with none past 1 per 4 px. Both work as they are, and either would reopen review.
- Tests: `bun run check` 979 passed; `bun run e2e` 39 passed.

### Round 4 — code-review low, security-reviewer, on `git diff de3ba4e`
- code-review low: no findings. security: no findings. **Review closed** (a clean round).
