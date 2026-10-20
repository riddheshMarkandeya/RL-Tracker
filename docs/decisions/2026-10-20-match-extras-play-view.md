# Match extras come from one live-play view, with our own shot, aerial and touch rules

Date: 2026-10-20

## Context
WP4b adds the Recap page's extras (hardest shot, woodwork, aerial touches, average boost,
supersonic, time on empty boost) and one goal-map point per goal. The game sends no such stats,
so each needs a rule over raw events. Those rules are stored in `match_players` and `match_goals`.
`recompute` can rewrite them only for matches still inside the 90-day raw retention, so a rule
change doesn't reach older matches. The plan, its measurements, the plan review and the review log
are in `docs/plans/2026-10-20-wp4b-match-extras.md`.

## Decision
1. **One play view** (`src/server/recorder/play.ts`). It is a single fold over a match's deduped
   events that every stat reads. It owns the live-play window and the roster resolution:
   - Phases are countdown / play / replay / paused / ended. Only `RoundStarted` to the live
     `GoalScored` or `MatchEnded` counts. A match joined in progress starts in play.
   - Car samples come from in-play `UpdateState`s. Each is weighted by the gap to the next one,
     capped at 1 s.
2. **Registry** (`src/server/recorder/extras.ts`). Each stat has a `match_players` column, a
   compute over the play view, and an `inRange` sanity check (null when the value can't leave
   its range by construction). The writer's column list and the `extras_in_range` check both
   come from it. A migration test fails for a column without a migration.
3. **The rules** (the user's choices):
   - **Hitters**: every entry of `BallHit.Players` is a hitter, so a 50/50 credits both.
   - **Touches**: a player's hit counts as a new touch only when someone else touched since, or
     1 s has passed. The game sends a `BallHit` per contact, 1.2–1.8× its own touch count.
   - **Hardest shot**: shots only, not every hit. That is each `Shot` statfeed's last live hit
     by the shooter (the statfeed arrives late), plus each goal's origin hit.
   - **Aerial touch**: ball Z ≥ 550 and at least 300 uu from every wall, including the 45° corners.
     Wall rides don't count. Some real aerials off the backboard are missed.
   - **Woodwork**, not crossbar: `CrossbarHit` fires for the posts too. It counts once per second.
   - **Goal point**: placed at the scoring team's last hit since the kickoff. "Deflected" means a
     later hit by the other team, and the other player in a 50/50 doesn't count as one. With no
     scoring-team hit it's an own goal, unless the kickoff came before the recording.
   - **Range class** (close / mid / long): applied at read time from the stored distance
     (`src/shared/goal-range.ts`), so a threshold change reaches every match.
   - **Unresolved scorer**: a goal whose scorer isn't a roster player with a team gets no point.
     It's counted in `droppedGoals` and flagged (`goals_placed`) rather than given a team from the
     scoreboard. None has been seen, and each way of inferring the team broke on some event order
     (review rounds 1–4).
4. **Time stats** are stored as ms beside `car_ms`, so shares across matches are a ratio of sums.

## Why
- One view, so the window and the Shortcut resolution aren't re-implemented per stat. The
  roadmap's `compute(events, summary)` per stat would have repeated both.
- The rules were measured on the 4 weekend captures (46 matches) and checked against the game
  where it says something:
  - aerial goals marked match the `AerialGoal` statfeeds, 24 of 24;
  - car time covers 0.98–0.997 of live play;
  - no player has more aerial touches than touches.
- Alternatives:
  - **Hardest shot from every hit**: dribbles and clears would count.
  - **The game's last touch as goal origin**: it disagrees with the hits on 50/50s.
  - **A wall-only aerial box**: it counts corner wall rides.
- `scope: match` was dropped from the registry. Own goals and goal speeds are read from
  `match_goals`, so no stat is match-scoped yet.

## Files touched
`src/server/recorder/{play,extras,checks,read-match,summary,players}.ts`,
`src/server/records/{record,save}.ts`, `src/server/db/migrations.ts` (tracker migration 3),
`src/shared/{goal-range,constants}.ts`, and tests.

## Verification
- `bun run check`: 429 tests.
- The 46 real matches: 214 goals, 0 own goals, 38 deflected, 24 aerial; no new flags.
- `recompute`'s table hashes equal the import's, and a live replay wrote the fixture's rows.

## Related
- `docs/decisions/2026-10-20-match-records-per-player.md` (the records these columns extend).
- `docs/plans/2026-10-20-wp4b-match-extras.md`.
