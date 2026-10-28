# WP7a review summary

Date: 2026-10-28. The full log is in the Review log of `docs/plans/2026-10-27-wp7a-trends-page.md`.

- Tier: Substantial (1,074 non-test lines; design tier Substantial). Two rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Round 2 ran on the delta from snapshot `9e21f13`: code-review low, arch-reviewer (sonnet) and
  security-reviewer. It made no fix beyond a comment. Security found nothing in either round.
- Fixed:
  - A rolling or running period no longer stays on yesterday after the 4am cutoff: `today` is in
    the period's query key.
  - The strip's default year stops at today's year, so This week in late December no longer pages
    to next year.
  - All time starts at the first match under the filter: `/api/period` returns `firstDay`.
  - Buckets take the matches in one sweep instead of a rescan per bucket.
  - The played-days ticks keep showing during a year change only, not a filter change.
  - Shared helpers: `monthStart`, `calendarSpan`, `seasonsByStart` and `rollingDays` in
    `periods.ts`, plus one `periodQuery`. The URL's year uses the API's schema. A narrower
    `StepSpec` removes a dead branch. `isRate` reads `METRICS`. Doc and comment fixes.
- Verified, no fix needed: ‹'s bound is your first played day whatever the filter, as planned. An
  empty filtered period shows its note and keeps ‹ › working.
- Disputed (/simplify, reasons in the log): an app-wide day-rollover timer, `aria-disabled` steps,
  a period-kind table, button extractions, dropping `wins`/`losses` from bucket stats (WP7b's W/L
  chart reads them), and memoising the one-a-minute clock.
- Deferred → BACKLOG: `/api/played-days` reads every result on each request (Watch list).
