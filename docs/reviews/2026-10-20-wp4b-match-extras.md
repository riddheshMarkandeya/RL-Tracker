# WP4b Match extras and goal map — review

Plan and full per-finding log: `docs/plans/2026-10-20-wp4b-match-extras.md` (Review log).

- **Passes**:
  - Round 1: code-review high, arch-reviewer (sonnet), security-reviewer and /simplify.
  - Round 2: the full table again minus /simplify, because a fix reached `src/shared/constants.ts`.
  - Rounds 3–11: code-review high and security on each delta.
  - Round 12: code-review medium and security. The user chose medium after high kept finding
    test-precision and wording items on tiny deltas.
- **Outcome**: 12 rounds, with no security findings in any of them. About 60 fixes in all.
  - Deferred to BACKLOG (Watch list): the woodwork window isn't clamped when the clock steps back.
  - Disputed (3): endStretch, the aerialPending counter, and the car_ms limit flagging a
    clock-stepped match.
  - Disputed (1 more): a dropped goal's origin hit isn't counted toward hardest shot, because a
    goal with no team has no origin.
- **What mattered**:
  - **Unresolved scorer** (rounds 1–4): the team was inferred from the scoreboard three ways:
    a next score change, a per-team tally, then a per-kickoff baseline. Each way broke on some
    event order. It went to the user under the stop rule, who chose drop and flag. Such a goal
    gets no point and raises `goals_placed`, and `scorer_key` is NOT NULL. None has been seen in
    214 real goals, and a Watch-list item adds inference fitted to the first one seen.
  - **Last-touch cross-check** (rounds 6–8): it went to the user under the stop rule, who chose to
    keep the check with fixes. It is compared only when both sides are known.
  - **Attribution** (rounds 9–11): one `resolveRef` serves every kind of reference. A player
    object that isn't on the roster counts under its kind. A missing reference doesn't count. A
    hit's malformed `Players` entry counts as an unidentified hitter. `Hit.known` gates the
    comparison.
  - Round 1: hardest shot is a running maximum, `GOAL_LINE_Y` is shared, each registry stat
    carries its `inRange`, and an extras failure leaves the base summary flagged
    (`extras_computed`).
- **Held throughout**: after every round from 3 on, all 46 real matches gave identical table
  hashes (214 goals, 0 own, 38 deflected, 24 aerial), with the same single flag (the spectated
  match's `camera_on_roster`). Recompute stayed equal to the import.
- **Process notes**: a slice-index slip in an edit script duplicated a test block (round 7). The
  test run caught it and it was fixed before review.
