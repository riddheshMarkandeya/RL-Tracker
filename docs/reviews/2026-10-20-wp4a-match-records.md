# WP4a Match records — review

Plan and full per-finding log: `docs/plans/2026-10-20-wp4a-match-records.md` (Review log).

- **Passes**:
  - Round 1: code-review high, arch-reviewer (sonnet), security-reviewer and /simplify.
  - Round 2: the full table again minus /simplify, because fixes reached lifecycle and store.
  - Rounds 3–11: code-review high and security on each delta.
  - Round 12: code-review low on a test-only delta.
- **Outcome**: 12 rounds. Security found nothing in any round. About 57 fixes in all. 11 findings
  were verified as needing no fix. 1 was deferred to BACKLOG (Knockout team numbers). 1 was
  disputed (merging a partial scoreboard into the last full one).
- **What mattered**:
  - Final player stats are the per-stat maximum over post-`MatchEnded` states. A shot that
    reaches the scoreboard late now counts, and a teardown state's reset counters don't.
  - A no contest (`WinnerTeamNum` -1) gets no W/L.
  - The team rule (rounds 3–6) went to the user under the stop rule. Only team 0 and 1 are real,
    checked by one `teamOf` read and carried as a `TeamNum` type.
  - The score is a `[number, number]` pair, taken only from a scoreboard with both teams' whole,
    non-negative goals. A rejected scoreboard is counted and flagged (`scoreboards_complete`)
    rather than silently dropped.
  - A guard on retagged post-end states was added in round 2 and reverted in round 3. Capture
    evidence showed those states are the old match's own teardown.
- **Held throughout**: all 46 real matches gave identical table hashes after every round, with
  the same single flag (the spectated match's `camera_on_roster`).
- **Process notes**: twice, tests were written first but not run red before the implementation
  (`record.test` and the round 10 fact).
