# WP7b review summary

Date: 2026-10-28. The full log is in the Review log of `docs/plans/2026-10-28-wp7b-trends-charts.md`.

- Tier: Substantial (design tier; ~620 non-test lines). Four rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
- Round 2 was the full table on the delta from snapshot `8616a86` (a fix touched `format.ts`,
  outside the round-1 diff): code-review high, arch-reviewer (sonnet) and security-reviewer.
- Round 3 ran code-review high and security-reviewer from `de3ba4e`. Round 4 ran code-review low
  and security-reviewer and was clean. Security found nothing in any round.
- Fixed:
  - The rolling back-reach can no longer read the whole history at a window of 1.
  - Hover columns cover each point's nearest area.
  - Season marks use the point's x, so a capped column set can't drop them to x = 0.
  - Min/max is a loop, not a spread.
  - A day with matches but no session is titled by its record and logged
    (`[rlt] trends/day_no_session`).
  - `x=auto` is accepted.
  - Two auto thresholds are named apart, and `ChartMode` is defined once.
  - The average key shows only with an average line.
  - Short date labels are in `format.ts`, and one `polyline()` serves the sparkline and the chart.
  - `linePoints` is memoised, and the guid → session map is built lazily.
- Escalated to the user: narrow boxes, raised in rounds 1–3 (a clamp, then a caller-side `fits()`).
  The user chose the simplest form: `.plotBox { min-width: 120px }` keeps every box wider than the
  chart's padding, with no code guard.
- Verified, no fix needed:
  - `useWidth` vs ShareCard's ResizeObserver: ShareCard is outside the diff.
  - Memoising the geometry: the lint rule rejects it, and it runs once a minute.
  - An arg-safe min/max shared with `sparkPath`, and `xOf`'s closure.
  - The full in-memory results scan in `rolling()`.
  - The W/L season-mark fallback.
- Skipped from /simplify, with reasons in the log:
  - plan decisions: `rolling` always served, a day-only `session`, `chartMode` in the page;
  - small helpers: a season-mark component, a plot box, `metricLabel`;
  - a sliding-sum `rollingWindows`;
  - memoising the W/L chart and coalescing `useWidth`.
- Deferred → BACKLOG: none.
