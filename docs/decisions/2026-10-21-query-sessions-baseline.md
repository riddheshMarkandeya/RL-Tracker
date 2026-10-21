# Sessions, filters and the baseline are computed at read time

Date: 2026-10-21

## Context
WP5a-a turns match records into what pages show: sessions, periods, playlist filters, aggregates
and the recap's 30-day baseline. Several choices had more than one reasonable answer, and the
user picked them. Plan: `docs/plans/2026-10-21-wp5a-a-query-logic.md`.

## Decision
- Sessions are cut at read time over every recorded match (any playlist, spectated too): a gap of
  more than `SESSION_GAP_MS` after the latest end so far, or a "start new session" break, cuts.
  Filters apply inside a session; a session with none of your matches under the filter isn't
  listed.
- A session's key is its first match's GUID. A re-cut that moves the first match gives a new key.
- The recap baseline is `[session start − BASELINE_DAYS calendar days, session start)` at the same
  local clock time, under the page's active filters.
- "Everything" leaves out private (friends' lobbies) and offline (bot games) playlists. LTMs are
  in "Extra modes". Official Tournament is in "everything" but not "All ranked". Any playlist can
  still be picked alone.
- Local days begin at `DAY_CUTOFF_HOUR` and are counted on calendar fields, never as 24 h of ms.

## Why
- Session key: stable across recomputes with nothing stored. A start time changes with clock
  fixes, and a stored id needs a sessions table that every re-cut must reconcile. Anything keyed
  by session (remark picks) resets when a re-cut moves the first match, which the map accepts.
- Cut over all matches: a session is time at the PC; cutting per filter would give each filter
  different sessions and keys.
- Baseline before the session, not the last 30 days to now: the session isn't compared with
  itself, and an old session is compared with its own era.
- Offline out of "everything": bot games would skew overall stats and the baseline.

## Files touched
`src/shared/periods.ts`, `src/shared/playlist-filter.ts`, `src/server/query/{sessions,aggregate,read}.ts`,
`src/shared/constants.ts` (`BASELINE_DAYS`, `ROLLING_*`), `src/server/rules/registry.ts` (area
`queries`).

## Verification
`bun run check` green (601 tests, DST cases pinned in New York and London). Read-only run against
the deployed `tracker.db`: 13 matches, one session, 5–8. Review log in the plan.

## Related
- `docs/plans/2026-10-15-rl-tracker-features-map.md` (Session, Periods, Recap layout)
- `docs/decisions/2026-10-20-match-records-per-player.md` ("you" joined at read time)
