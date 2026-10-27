# WP6a-b review summary

Date: 2026-10-27. Full log: the Review log in `docs/plans/2026-10-27-wp6a-b-overview-sections.md`.

- Tier: Substantial (about 600 non-test lines: Overview sections 5–8, the SVG goal map, its logic
  module, `decimal`, and the `SIDE_WALL_X` move). 3 rounds.
- Round 1: code-review high, arch-reviewer (opus), security-reviewer, /simplify (4 angles).
  Round 2, on the delta: code-review low, arch-reviewer (sonnet) and security-reviewer, all clean.
  Round 3 came from the real-browser check: code-review low and security-reviewer, clean.
- Fixed:
  - By playlist: rows are keyed on the playlist id, because ids 16 and 35 share "Rocket Labs". A null
    record shows "–" rather than a made-up 0–0.
  - Goal map: "You scored 0 of the team's 0." is hidden; pitch line sizes come from the shared field
    constants; edge marks are no longer clipped (round 3).
  - Comments: the X handedness is worded as an assumption; the module header no longer describes
    the match page as existing.
  - The e2e hat-trick match scores 4–1, as its goals do.
  - /simplify: the unused `GoalMark.match` is dropped, and `PerGameCard` carries `avg`.
- Verified, no fix needed: the fastest-goal "match N" (the wire's `goals` holds only your goals,
  raised twice); the aerial note's scope; the warn not keyed on the filter (a recorded deviation);
  double computation at ~100 goals; type-narrowing guards; `decimal`'s binary-float edge.
- Deferred or disputed: none. Open, in BACKLOG: the What-stood-out threshold check-back around
  2026-12-27; the goal map's top/bottom against a remembered goal; and a Watch item for the
  `recap/goal_no_team` warn.
