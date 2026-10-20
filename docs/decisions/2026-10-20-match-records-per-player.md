# Match records cover every player; "you" is resolved when a page reads them

Date: 2026-10-20

## Context
WP4a persists each finished match into `tracker.db` so pages never read `raw.db`. The roadmap
planned per-player rows with a column "on your team at any point", which bakes the current
`my_ids` list into every record. Your ID is a guess (the camera target) until the user confirms
it in WP8, and `raw.db` keeps events for only 90 days. The full plan, its review and the review log
are in `docs/plans/2026-10-20-wp4a-match-records.md`.

## Decision
1. **Records are neutral.** Every player gets a full row in `match_players` (scoreboard line,
   `team_num`, a `teams_seen` bitmask, `present_at_end`), plus a `match_player_statfeed` child
   table. The match row stores the winner (and its source), the MVP (and its source) and the
   camera target's PrimaryId. Nothing in a record depends on `my_ids`.
2. **Pages find "you" with a join on `my_ids`** at query time (WP5a). "With you" is
   `me.teams_seen & p.teams_seen != 0`. Your result is `resultFor` (`src/shared/result.ts`).
3. **Result with no winner** (user's choice): a leave, a superseded close or a timeout is a loss;
   a restart (the tracker was down, you may have played on) is unknown, so no W/L; its
   `closed_via` column marks it. A decided winner always comes first.
4. **Decided winner**: with no `MatchEnded`, different scores and either overtime or a last clock
   reading of 0 s, the higher score wins. A `MatchEnded` winner is kept only when it names a real
   team: a no contest (`WinnerTeamNum` -1) has no winner, so no W/L. Only team 0 and 1 are real
   teams (user's choice), checked wherever a team number is read; a winner no player is on would
   show every player a loss. The score comes from the last scoreboard with both teams' goals.
   Knockout's numbering is unknown (a BACKLOG watch item).
5. **Pending guess**: the camera target becomes a pending `my_ids` entry when it isn't a bot, isn't
   already listed, and no confirmed ID played. The camera counts only if it stayed on one roster
   player for at least 95% of the resolved play-time targets; a spectator's camera switches.
6. **Final player stats**: each player stat keeps its highest value over the `UpdateState`s
   after `MatchEnded`, for players still in them. Roster, presence, score and playlist still come
   from before it. This revisits WP3a's "scoreboard frozen at `MatchEnded`" rule
   (`2026-10-19-recorder-websocket-raw-store.md`) for player stats only.

## Why
- **Neutral records vs. a stored "on your team" column**: confirming or rejecting an ID in WP8
  then corrects every match at once, including matches past raw retention, with no recompute. A
  stored column would freeze a wrong guess into matches that can no longer be rebuilt. The cost
  is a join on every page query and storing every player's row (about 5 per match), which is
  small.
- **Restart → unknown**: after a restart the tracker can't tell a leave from a missed ending, so
  showing a loss would be a guess presented as fact.
- **Decided rule at 0 s**: a 1-goal lead at 0 s could in theory still be equalised while the ball
  is in play. The feature map accepts this rule; a wrong call is rare and recompute can fix it if
  the rule changes.
- **Camera share**: on the captures, the user's own matches had 100% of targets on one player and
  a spectated private 1v1 had 71%, which had produced a false guess. Targets not yet resolvable
  (the player still at team 255) don't count: counting them put a real match at 94.6%.
- **Final stats**: in two real matches a shot under 0.5 s before `MatchEnded` reached the
  scoreboard only afterwards, so the frozen scoreboard was one shot short of the statfeed.
  Nothing is played after the end, so a counter can only catch up there; the highest value
  ignores teardown states with reset counters, and doesn't depend on which post-end state the
  sampler happened to store first.

## Files touched
`src/server/recorder/{summary,checks,read-match,recorder,lifecycle,store}.ts`, `src/server/records/` (`record`,
`save`, `recompute`), `src/server/db/migrations.ts` (tracker migration 2),
`src/shared/{result,playlists}.ts`, `src/server/main.ts`, `scripts/{recompute,import-capture}.ts`.

## Verification
46 real matches imported: one flag (the spectated match, `camera_on_roster`), exactly one pending
guess (the user's). `bun run recompute` rebuilt identical tables. A live replay recorded through
`main.ts`. The same figures and table hashes held after the review fixes. Details in the plan's
"Implementation notes" and "Review log".

## Related
- `docs/decisions/2026-10-19-recorder-websocket-raw-store.md` (the snapshot rule revisited in 6).
- `docs/plans/2026-10-16-v1-roadmap.md` (WP4a/WP4b, WP5a).
