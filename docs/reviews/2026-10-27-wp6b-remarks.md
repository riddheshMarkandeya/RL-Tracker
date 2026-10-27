# WP6b review summary

Date: 2026-10-27. Full log: the Review log in `docs/plans/2026-10-27-wp6b-remarks.md`.

- Tier: Substantial (design tier: a new server module, a migration, two routes, a UI block).
  3 rounds.
- Round 1: code-review high, arch-reviewer (opus), security-reviewer, /simplify (4 angles).
  Round 2, on the delta from snapshot `96aea5d` (it touched files outside round 1, so the full
  table minus simplify): code-review high, arch-reviewer (sonnet), security-reviewer. Round 3, on
  the round-2 fixes (snapshot `d6610bc`): code-review low, arch-reviewer (sonnet),
  security-reviewer, with no bugs or risks. Security found nothing in any round.
- Fixed:
  - A pick stored while the session was live froze once it ended, even with matches after it.
    It is now re-fitted on the first view after the session, then made final (`remark_final`).
    A finished session's pick that still fits no longer re-fits on every view.
  - ↻'s pending and error state no longer follows you to another session or filter.
  - A reroll response no longer hides a newer refit: the cache is refetched after it.
  - The `remark_shown` index now serves the repeat-history query. The log's `band` is the kept
    band (plus `computedBand`). `tier` is out of the response, which the web never read.
  - `filterValue` has one import path; a `remarksKey` helper; import and line-wrap tidy-ups.
- Verified, no fix needed:
  - Only mounted remarks queries refetch after a match.
  - Liveness compares `picked_at` with the session's end on purpose: a seen-match count would
    re-fit after a late import, which the "finished sessions don't change" decision forbids.
  - The remarks migration was edited in place; no DB has run it (both at user_version 4).
- Disputed: the 10-session window ranks by when lines were shown, by design (it avoids what you
  recently saw).
- Deferred → BACKLOG: the remarks requests build the full `sessionDetail`; the first-view write
  happens on a GET that the request-header guard doesn't cover.
- Skipped /simplify suggestions (reasons in the log): picking at match close, recents derived
  from picks, shared band/tier enums, folding Retry into ↻, a shared us/them score split, and
  small style changes.
