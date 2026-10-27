# WP6a-c review summary

Date: 2026-10-27. Full log: the Review log in `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`.

- Tier: Substantial (design tier: new routes, three views, a server read change and a new read
  rule). 2 rounds.
- Round 1: code-review high, arch-reviewer (opus), security-reviewer, /simplify (4 angles).
  Round 2, on the delta from snapshot `1c9c692`: code-review low, arch-reviewer (sonnet) and
  security-reviewer, with no bugs.
- Fixed:
  - Not-in-view notice: a loading state while the lookup is pending, and "Couldn't look up this
    match." on a non-404 error, where it used to read as a filter miss. The warn logs the status.
  - Flag note: with no result, a decided winner gets its own line, where it used to be dropped.
    The dead `left` guard in the lost-ending case is gone.
  - One `isMyMvp` and one `matchLabel(m, n)` for the cards, the rail and the table, whose labels
    had already drifted.
  - The scoreboard reads "Unknown team" and gives each team " · won" or " · lost".
  - `!important` swapped for specificity. The picker's view type is derived from `RecapView`. The
    focus target and its log are chosen together.
  - Comments: a stale field doc, a pointer to another file, and two prototype pointers in the new
    CSS modules.
  - /simplify: the Matches columns are one list, and `NotInView` works out one status.
- Verified, no fix needed:
  - `ExtrasSection` stays in `Overview` (it uses its stat-grid styles).
  - The scoreboard's own match fetch is by design.
  - The table's link label repeats its row's cells, so all three lists share one label.
  - `left` and `lost_ending` can't be set together.
- Skipped /simplify suggestions (reasons in the log): `onClick` dots, a server-side one-match
  aggregate, shared source enums, a combined flag reason, view and focus remodelling, and
  unmeasured memoisation.
- Deferred or disputed: none. Open, in BACKLOG: a Watch item for the `recap/player_no_team` warn.
- Live check after deploy: the left match's note, an inferred-MVP note, a goal-dot link, the
  table's ⚑, team won/lost headings and the rail's keep-in-view, with no console errors. A
  read-only recount gives 4 of 76 matches flagged (1 left, 3 inferred MVP).
