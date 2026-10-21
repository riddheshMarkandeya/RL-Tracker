# Stat rule definitions

<!-- Generated from src/server/rules/registry.ts by `bun run definitions`. Don't edit by hand. -->

Every rule we apply to the game's data, as it stands now. This file is the current source; plans,
ADRs and review logs are dated history that say why a rule was decided.

## Changing a rule
1. Edit its entry in `src/server/rules/registry.ts` and bump its `version`. Change one rule per
   run of step 2: a bump hides another rule's unbumped change from the WARNING. A changed constant
   without a bump fails `bun run check` and `bun run definitions`.
2. Run `bun run rules-diff` and read every moved column, not only the WARNING. A match that
   changed while no rule's version did is a WARNING: bump the rule that changed, or add a
   recorded rule for what moved if none covers it. A moved column none of whose listed rules was
   bumped, or that no rule lists, is a "review:" line: the lists are best-effort, so look at
   whether the bumped rule explains it.
3. Write an ADR if the change passes the ADR gate.
4. Run `bun run definitions` to regenerate this file and the constant pins.
5. Run `bun run deploy`.

**When applied**:
- *stored*: while recording, into raw.db; recompute can't change it.
- *recorded*: when a match's record is computed, live or by recompute; each record stores these
  rules' versions.
- *read*: when a page reads the record, so it always applies at its current version.

A *dense* rule reads every UpdateState. Once retention has thinned a match, the match keeps the
outputs snapshotted when it was thinned, and the rule's version from then, so a change to a dense
rule reaches only matches still whole (recent or flagged ones).

## Recording

### `update_state_sampling` · v1 · stored

UpdateState is stored about once per interval; the latest dropped one is held and written just before the next other event (and before any close), so the scoreboard at a goal, MatchEnded or a close is never lost.

- **Constants**: `UPDATE_STATE_INTERVAL_MS` = 500
- **Evidence**: About 2 states a second follows the scoreboard; the car stats weigh each sample by the gap to the next, and car time covers 0.98–0.997 of live play on the 46 captured matches.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`

### `loadout_once` · v1 · stored

Each player's Loadout is stored only the first time they appear in a match's states.

- **Evidence**: Loadout is constant within a match and makes up most of an UpdateState's size.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`

### `menu_states_dropped` · v1 · stored

UpdateStates still showing the menu's PlaylistId 0, before the match's first non-zero one, are not stored.

- **Evidence**: They carry the menu, not the match.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`

### `update_state_thinning` · v1 · stored

Once a match's last event is older than this many days, its UpdateStates are thinned to the first, the last, and each that changes a player's Name, PrimaryId, Shortcut, TeamNum or scoreboard stats, the teams' scores (or whether there is a scoreboard), PlaylistId, Arena or bOvertime, or reads a clock other than the running one; every other event is kept. The dense rules' outputs are snapshotted first.

- **Constants**: `RETENTION_DAYS` = 90
- **Checks**: `thinned_snapshot_covers_dense`
- **Evidence**: UpdateState is 94% of raw.db. On the 46 captured matches it kept 6,572 of 42,974 states in the 45 it thinned, raw.db went from 98.1 MB to 27.3 MB, and rules-diff showed no change: the car stats and camera came from the snapshot.
- **Decided in**: `docs/decisions/2026-10-20-raw-thinning.md`, `docs/plans/2026-10-20-wp4c-b-retention-split.md`

### `retention_flag_exempt` · v1 · stored

A match past retention that any check flags under the current rules is kept whole, as the corpus for fixing a rule; the decision is re-checked when the recorded rule versions change, and a match no longer flagged is thinned.

- **Evidence**: Flagged matches are the ones a rule fix needs whole: the unseen-shape rule fits a rule to the real match when one first appears.
- **Decided in**: `docs/decisions/2026-10-20-raw-thinning.md`, `docs/plans/2026-10-20-wp4c-b-retention-split.md`

### `open_match_owns_events` · v1 · stored

One match is open at a time, and it owns every event, whatever guid the event carries, until a MatchDestroyed (any guid) closes it.

- **Evidence**: After a private game the old match's teardown arrives under the next match's guid: 5 retagged teardowns on the 4 weekend captures, each kept with its match.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`, `docs/research/2026-10-19-weekend-captures.md`

### `match_superseded` · v1 · stored

A MatchCreated with another guid closes the open match, whatever its phase, with cause superseded.

- **Evidence**: Never seen on the captures; a safety net against a lost MatchDestroyed.
- **Decided in**: `docs/plans/2026-10-19-wp3a-recorder.md`

### `orphan_timeout` · v1 · stored

The recorder closes the open match itself with cause timeout after this long with no events, and with cause restart when it starts with a match left open.

- **Constants**: `ORPHAN_TIMEOUT_MS` = 600000
- **Evidence**: Matches are serial, so only the last match can be left open; a restart on a real data dir closed its open match as restart.
- **Decided in**: `docs/plans/2026-10-19-wp3a-recorder.md`

### `close_cause` · v1 · stored

closed_via is destroyed when the game's MatchDestroyed closed the match, else the recorder's cause (timeout, restart, superseded), stored with its RecorderClosed marker.

- **Evidence**: The cause tells a leave from a lost ending: it feeds the end kind (left vs orphaned) and your result.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`, `docs/decisions/2026-10-20-match-records-per-player.md`

### `lobby_no_record` · v1 · recorded

A match that closes before any live trigger (MatchInitialized, CountdownBegin, RoundStarted, GoalScored) is a lobby and gets no record; recompute keeps a lobby's existing record and warns.

- **Evidence**: A lobby opened and closed with no game on the captures.
- **Decided in**: `docs/plans/2026-10-19-wp3a-recorder.md`, `docs/decisions/2026-10-20-match-records-per-player.md`

### `only_latest_match_open` · v1 · recorded

Recompute skips a match with no close marker as still open; only the match with the latest event can be live, so another unclosed one is warned about.

- **Evidence**: Matches are serial: an unclosed match that isn't the latest lost its close marker in a failed write.
- **Decided in**: `docs/plans/2026-10-19-wp3a-recorder.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `dedup_replay_goal` · v1 · recorded

A GoalScored with an empty scorer name, GoalSpeed 0 and GoalTime 0 is the replay's copy, dropped on read.

- **Checks**: `goal_events_equal_score`
- **Writes**: `match_players.hardest_shot_kmh`
- **Evidence**: Every goal is sent twice, the copy when the replay ends or is skipped; the three markers always come together on the captures.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`, `docs/research/2026-10-19-weekend-captures.md`

### `dedup_repeat_crossbar` · v1 · recorded

A CrossbarHit whose data equals the previous CrossbarHit's is dropped on read.

- **Writes**: `match_players.woodwork_hits`
- **Evidence**: The game repeats CrossbarHit with identical data.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`

### `dedup_repeat_ballhit` · v1 · recorded

A BallHit whose data equals the previous BallHit's is dropped on read.

- **Writes**: `match_players.hardest_shot_kmh`, `match_players.woodwork_hits`, `match_players.aerial_touches`, `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`
- **Evidence**: The game repeats BallHit with identical data.
- **Decided in**: `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`, `docs/plans/2026-10-19-wp3a-recorder.md`
## Match

### `roster` · v1 · recorded

The roster is every player in a state before MatchEnded: team_num is their last real team, teams_seen has bit 1 << team for each team they were on, present_at_end says they were in the last state before MatchEnded.

- **Writes**: `match_players.primary_id`, `match_players.name`, `match_players.team_num`, `match_players.teams_seen`, `match_players.present_at_end`
- **Evidence**: Records cover every player, so pages resolve "you" and "with you" at read time; about 5 rows per match.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `real_teams_only` · v1 · recorded

Only TeamNum 0 and 1 are teams, wherever a team number is read; 255 (not on a team yet), -1 (no contest) and anything else are no team.

- **Checks**: `winner_valid`
- **Writes**: `match_players.team_num`, `match_players.teams_seen`, `matches.winner_team_num`, `matches.winner_source`, `matches.mvp_key`, `matches.mvp_source`, `match_goals.team_num`, `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`, `match_players.hardest_shot_kmh`
- **Evidence**: A winner no player is on would show every player a loss (user's choice).
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `score_last_full_scoreboard` · v1 · recorded

The score is the last scoreboard before MatchEnded with both teams' goals whole and non-negative; a scoreboard without them is rejected and counted.

- **Checks**: `scoreboards_complete`, `goal_events_equal_score`, `player_goals_equal_score`, `assists_within_goals`
- **Writes**: `matches.score_team0`, `matches.score_team1`
- **Evidence**: A scoreboard missing a team's goals says nothing reliable; none was rejected on the 46 captured matches.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `final_player_stats` · v1 · recorded

Each scoreboard stat is the last state before MatchEnded raised to its highest value in the states after it, for players still in them.

- **Checks**: `statfeed_matches_scoreboard`, `player_goals_equal_score`, `assists_within_goals`, `player_stats_non_negative`
- **Writes**: `match_players.score`, `match_players.goals`, `match_players.shots`, `match_players.assists`, `match_players.saves`, `match_players.touches`, `match_players.demos`
- **Evidence**: In two real matches a shot under 0.5 s before MatchEnded reached the scoreboard only afterwards; teardown states can carry reset counters, so the highest value is kept.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `statfeed_counts` · v1 · recorded

Each StatfeedEvent counts once for its resolved target, by event name; one whose target doesn't resolve is counted apart.

- **Checks**: `statfeed_resolved`, `statfeed_matches_scoreboard`
- **Writes**: `match_player_statfeed.count`
- **Evidence**: The statfeed matched the scoreboard on every captured match recorded from its start.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `end_kind` · v1 · recorded

With MatchEnded, a match ended early when, outside overtime, the last clock reading before it is above 0 or the one before that above 1, else it completed; without MatchEnded it was left (MatchDestroyed) or orphaned (the recorder closed it).

- **Checks**: `clock_non_negative`
- **Writes**: `matches.end_kind`
- **Evidence**: Every match resets the clock to 0 just before MatchEnded: a full match counts down through 1, a forfeit jumps from where it stopped; in overtime the clock counts up.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `overtime` · v1 · recorded

A match went to overtime when any clock reading (a state or ClockUpdatedSeconds) has bOvertime.

- **Writes**: `matches.overtime`
- **Evidence**: bOvertime is the game's own flag.
- **Decided in**: `docs/plans/2026-10-20-wp4a-match-records.md`

### `joined_in_progress` · v1 · recorded

A match whose stored events have no MatchInitialized was joined in progress.

- **Writes**: `matches.joined_in_progress`
- **Evidence**: MatchInitialized comes once at the start; re-derived from the stored events so recompute needs only raw.db.
- **Decided in**: `docs/plans/2026-10-19-wp3a-recorder.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `playlist_and_arena` · v1 · recorded

playlist_id is the last non-zero PlaylistId and arena the last Arena in the states before MatchEnded, both stored raw.

- **Checks**: `playlist_present`
- **Writes**: `matches.playlist_id`, `matches.arena`
- **Evidence**: The playlist map is applied when a page reads it, so a corrected map reaches old matches.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `winner` · v1 · recorded

The winner is MatchEnded's WinnerTeamNum when it names a real team (a no contest names none); without MatchEnded, the team ahead when the clock had reached 0 or it was overtime ("decided").

- **Checks**: `winner_valid`
- **Writes**: `matches.winner_team_num`, `matches.winner_source`, `matches.mvp_key`, `matches.mvp_source`
- **Evidence**: Every MatchEnded match on the captures has a winner; a one-goal lead at 0 s could in theory still be equalised, which the feature map accepts.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `mvp` · v1 · recorded

The MVP is the MVP statfeed's target; with none, the winning team's unique top scorer among players present at the end; a tie or no winner gives none.

- **Checks**: `mvp_count`, `mvp_on_roster`
- **Writes**: `matches.mvp_key`, `matches.mvp_source`
- **Evidence**: The game awards the MVP on the podium, and a match can end without one.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `your_result` · v1 · read

Your result: a winner decides it; without one, a leave, a superseded close or a timeout is a loss, a restart is unknown, and any other end has no result.

- **Evidence**: After a restart the tracker was down and play may have gone on, so a loss would be a guess (user's choice).
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `playlist_map` · v1 · read

A playlist id maps to a name and group when a page reads it; an unmapped id is logged once per run with the team sizes.

- **Evidence**: From community lists checked against live play; the game reuses ids (4 was Chaos, now Casual Quads).
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/research/2026-10-15-rl-playlist-ids.md`
## Identity

### `player_key` · v1 · recorded

A player's key within a match is their PrimaryId; bots, which all share Unknown|0|0, are keyed bot:<Name>.

- **Writes**: `match_players.player_key`, `match_players.is_bot`
- **Evidence**: Every bot has the PrimaryId Unknown|0|0.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `target_resolution` · v1 · recorded

An event's player reference (Name, Shortcut, TeamNum, no id) is the player with that Shortcut in the latest state when name and team agree, else the one roster player with that name and team, else unresolved.

- **Checks**: `statfeed_resolved`, `mvp_on_roster`
- **Writes**: `match_player_statfeed.count`, `matches.mvp_key`, `matches.camera_primary_id`, `match_goals.scorer_key`, `match_goals.assister_key`, `match_goals.aerial`, `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`, `match_players.hardest_shot_kmh`
- **Evidence**: Statfeed targets, hitters, scorers and assisters carry no PrimaryId, only Name, Shortcut and TeamNum; the roster is keyed by PrimaryId.
- **Decided in**: `docs/plans/2026-10-20-wp4a-match-records.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `camera_identity` · v1 · recorded · dense

The camera's player is the roster player holding at least this share of the resolved camera targets in play (replays and the podium don't count, unresolved targets say nothing); a bot or no such player gives none.

- **Constants**: `CAMERA_SHARE` = 0.95
- **Checks**: `camera_on_roster`, `thinned_snapshot_on_roster`
- **Writes**: `matches.camera_primary_id`
- **Evidence**: The user's own matches had 100% of targets on one player and a spectated private 1v1 71%; counting unresolved targets put a real match at 94.6%.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `pending_guess` · v1 · recorded

The camera's PrimaryId becomes a pending my_ids guess unless it is already in my_ids (any status) or a confirmed id played the match.

- **Evidence**: 46 real matches gave exactly one pending guess, the user's.
- **Decided in**: `docs/decisions/2026-10-20-match-records-per-player.md`, `docs/plans/2026-10-20-wp4a-match-records.md`

### `your_row` · v1 · read

You, in a match, are the player whose PrimaryId is in my_ids and not rejected (a pending guess counts); none is a spectated match, with no result and not in your stats. Two of your ids in one match: the camera's is you, else the lowest key, logged once per match.

- **Evidence**: Found at read time, so confirming or rejecting an id re-labels every match. Two ids in one lobby has never been seen; it is logged (query/two_yous) to fit the rule when it happens.
- **Decided in**: `docs/plans/2026-10-20-wp4a-match-records.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`
## Attribution

### `live_play_window` · v1 · recorded

Only live play counts for the extras: from RoundStarted to the live GoalScored or MatchEnded, less pauses; a match joined in progress starts in play.

- **Checks**: `extras_computed`
- **Writes**: `match_players.hardest_shot_kmh`, `match_players.woodwork_hits`, `match_players.aerial_touches`, `match_players.car_ms`, `match_players.boost_avg`, `match_players.supersonic_ms`, `match_players.empty_boost_ms`, `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`, `match_goals.aerial`
- **Evidence**: 212 of 212 BallHits in the completed fixture fell in live play; CrossbarHit fires in replays and on the podium too.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `every_entry_a_hitter` · v1 · recorded

Every entry of BallHit.Players is a hitter, so a 50/50 credits both players.

- **Writes**: `match_players.hardest_shot_kmh`, `match_players.aerial_touches`, `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`
- **Evidence**: 100 of 1,164 fixture hits list two players; crediting only the first made a kickoff 50/50 look like an own goal.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `reference_resolution` · v1 · recorded

A hit, shot, woodwork or goal-last-touch reference that isn't an object is missing and not counted; a player object off the roster counts as unresolved under its kind; a hit's non-object Players entry counts as an unidentified hitter.

- **Checks**: `touches_resolved`
- **Writes**: `match_players.hardest_shot_kmh`, `match_players.woodwork_hits`, `match_players.aerial_touches`, `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`
- **Evidence**: A stat credited to a guessed player would be wrong without a trace, so an unknown reference counts toward touches_resolved instead. No unresolved reference on the 46 captured matches.
- **Decided in**: `docs/plans/2026-10-20-wp4b-match-extras.md`

### `last_touch_comparison` · v1 · recorded

A goal's BallLastTouch is compared with the last hit only when both are known (the last touch and every last hitter resolve, or no hit came since a seen kickoff); it disagrees when it isn't among the last hit's hitters.

- **Checks**: `goal_last_touch_agrees`
- **Evidence**: An unknown side can't show a disagreement, and counting it either way would flag correct matches or hide wrong ones. No missing BallLastTouch in 432 real GoalScoreds.
- **Decided in**: `docs/plans/2026-10-20-wp4b-match-extras.md`

### `touch_merge` · v1 · recorded

A player's hit counts as a new touch only when someone else hit since their last counted one, or this long has passed.

- **Constants**: `TOUCH_MERGE_MS` = 1000
- **Checks**: `extras_in_range`
- **Writes**: `match_players.aerial_touches`
- **Evidence**: The game sends a BallHit per contact, 1.2–1.8× its own touch count.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`
## Extras

### `hardest_shot` · v1 · recorded

Hardest shot is the fastest PostHitSpeed (km/h) over each Shot statfeed's last live hit by the shooter since the kickoff and each goal's origin hit; checked against the maximum.

- **Constants**: `HARDEST_SHOT_MAX_KMH` = 250
- **Checks**: `shots_have_touch`, `extras_in_range`
- **Writes**: `match_players.hardest_shot_kmh`
- **Evidence**: The Shot statfeed arrives 0.1–1.7 s after the touch; PostHitSpeed peaked at 177 km/h (p99 131) on the captures. Every hit would count dribbles and clears.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `aerial_touch` · v1 · recorded

A counted touch is aerial when the ball is at least AERIAL_MIN_Z high and at least WALL_MARGIN from every wall (|x| ≤ SIDE_WALL_X − WALL_MARGIN, |y| ≤ GOAL_LINE_Y − WALL_MARGIN), including the 45° corners (|x| + |y| ≤ CORNER_MAX_XY_SUM).

- **Constants**: `AERIAL_MIN_Z` = 550, `WALL_MARGIN` = 300, `SIDE_WALL_X` = 4096, `GOAL_LINE_Y` = 5120, `CORNER_MAX_XY_SUM` = 7640
- **Checks**: `extras_in_range`
- **Writes**: `match_players.aerial_touches`
- **Evidence**: Every AerialGoal's scoring touch was at Z 558–1066 and all but 5 other goals at ≤ 430; 334 of 768 touches at Z ≥ 550 were within 300 of a wall. Some real aerials off the backboard are missed.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `woodwork` · v1 · recorded

A CrossbarHit in live play counts one woodwork hit for its BallLastTouch player, at most once per window.

- **Constants**: `WOODWORK_WINDOW_MS` = 1000
- **Checks**: `touches_resolved`
- **Writes**: `match_players.woodwork_hits`
- **Evidence**: CrossbarHit fires for the posts too, and repeatedly while the ball rolls along the bar.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `car_sampling` · v1 · recorded · dense

Car samples come from the in-play, non-replay UpdateStates of players with bHasCar, each weighted by the gap to the next state, capped; a player with no samples (the other team) has null car stats.

- **Constants**: `CAR_SAMPLE_CAP_MS` = 1000
- **Checks**: `extras_in_range`, `thinned_snapshot_on_roster`
- **Writes**: `match_players.car_ms`, `match_players.boost_avg`, `match_players.supersonic_ms`, `match_players.empty_boost_ms`
- **Evidence**: Car state comes only for your own team; car time covers 0.98–0.997 of live play on the 46 captured matches.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `car_stats` · v1 · recorded · dense

car_ms is the samples' total weight, boost_avg the weighted mean Boost (0–100), supersonic_ms and empty_boost_ms the weight with bSupersonic and with Boost 0.

- **Checks**: `extras_in_range`, `thinned_snapshot_on_roster`
- **Writes**: `match_players.car_ms`, `match_players.boost_avg`, `match_players.supersonic_ms`, `match_players.empty_boost_ms`
- **Evidence**: Stored as ms beside car_ms, so a share across matches is a ratio of sums.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `car_share_aggregate` · v1 · read

Across matches, average boost is weighted by car_ms, and the supersonic and empty-boost shares are summed ms over summed car_ms, over matches with car_ms; the extras count only matches that have them computed (woodwork_hits not null).

- **Evidence**: A plain mean of per-match boost would weigh a forfeit like a full match.
- **Decided in**: `docs/plans/2026-10-20-wp4b-match-extras.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`
## Goals

### `goal_origin` · v1 · recorded

A goal's point is the scoring team's last hit since the kickoff, preferring the scorer among a 50/50's hitters; the ball's location there is its position.

- **Checks**: `goals_per_team_equal_score`
- **Writes**: `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`, `match_players.hardest_shot_kmh`
- **Evidence**: The game's own last touch disagrees with the hits on 50/50s; the scoring team's last hit placed all 214 goals on the captures.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `goal_distance` · v1 · recorded

A goal's distance is from its point to the centre of the goal attacked; team 0 attacks +Y and team 1 −Y, the goal line at ±GOAL_LINE_Y.

- **Constants**: `GOAL_LINE_Y` = 5120
- **Writes**: `match_goals.distance`
- **Evidence**: Field orientation measured on the captures.
- **Decided in**: `docs/plans/2026-10-20-wp4b-match-extras.md`

### `deflected` · v1 · recorded

A goal is deflected when the other team hit the ball after its origin hit; the other player in a 50/50 origin doesn't count.

- **Writes**: `match_goals.deflected`
- **Evidence**: 38 of 214 captured goals.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `own_goal` · v1 · recorded

A goal is an own goal when the scoring team never hit the ball since a seen kickoff; it then has no point. Joined before the first kickoff, it isn't one.

- **Writes**: `match_goals.toucher_key`, `match_goals.x`, `match_goals.y`, `match_goals.z`, `match_goals.distance`, `match_goals.deflected`, `match_goals.own_goal`
- **Evidence**: 0 of 214 captured goals.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `aerial_goal` · v1 · recorded

A goal is aerial when its scorer has a pending AerialGoal statfeed from live play, which the goal consumes; pending ones clear at each kickoff.

- **Checks**: `aerial_goals_match_statfeed`
- **Writes**: `match_goals.aerial`
- **Evidence**: 24 of 24 AerialGoal statfeeds marked on the captures; the statfeed comes just before its GoalScored.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `goal_speed` · v1 · recorded

A goal's speed is the live GoalScored's GoalSpeed, in km/h.

- **Writes**: `match_goals.speed_kmh`
- **Evidence**: The replay's copy has GoalSpeed 0 and is dropped by dedup.
- **Decided in**: `docs/plans/2026-10-20-wp4b-match-extras.md`

### `unresolved_scorer_dropped` · v1 · recorded

A goal whose scorer isn't a roster player with a team gets no goal row; it is counted and flagged rather than given a team.

- **Checks**: `goals_placed`, `goals_per_team_equal_score`
- **Writes**: `match_players.hardest_shot_kmh`
- **Evidence**: None seen in 214 captured goals; each way of inferring the team from other events broke on some event order, so a guess could credit the wrong team.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`

### `goal_range` · v1 · read

A goal is close under CLOSE_UNDER (a quarter of the pitch), long from LONG_FROM (half the pitch), else mid, from its stored distance.

- **Constants**: `CLOSE_UNDER` = 2560, `LONG_FROM` = 5120
- **Evidence**: The game's LongGoal follows no simple distance rule, so the classes are ours.
- **Decided in**: `docs/decisions/2026-10-20-match-extras-play-view.md`, `docs/plans/2026-10-20-wp4b-match-extras.md`
## Queries

### `session_cut` · v1 · read

A match starts a new session when it begins more than SESSION_GAP_MS after the latest end so far, or after a manual break placed since the previous match began. Sessions are cut over every match, any playlist and spectated too; one with none of your matches under the filter isn't listed.

- **Constants**: `SESSION_GAP_MS` = 1800000
- **Evidence**: A session is time at the PC; a break during a match cuts before the next one.
- **Decided in**: `docs/plans/2026-10-15-rl-tracker-features-map.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `session_key` · v1 · read

A session's key is its first match's GUID.

- **Evidence**: Stable across recomputes; a re-cut that moves the first match gives a new key and fresh remark picks (user's choice).
- **Decided in**: `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `local_day` · v1 · read

A local day starts at DAY_CUTOFF_HOUR, so late-night play counts toward the day before; days are counted on calendar fields, so edges stay at the cutoff across DST.

- **Constants**: `DAY_CUTOFF_HOUR` = 4
- **Evidence**: The map's display rule: local time with a 4am cutoff, so a session past midnight stays on its evening's day.
- **Decided in**: `docs/plans/2026-10-15-rl-tracker-features-map.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `week_start` · v1 · read

A week starts on WEEK_START_DAY (Date.getDay numbering) at the day cutoff; months and years start on the 1st at the cutoff.

- **Constants**: `WEEK_START_DAY` = 1
- **Evidence**: The map: weeks start Monday, calendar months. With the cutoff, Monday 03:30 is still the week before.
- **Decided in**: `docs/plans/2026-10-15-rl-tracker-features-map.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `season_range` · v1 · read

A season runs from its start date's day start to the next season's, ordered by start date; the last one is open-ended.

- **Evidence**: Season dates come from the editable seasons table, so order is by date, not id.
- **Decided in**: `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `rolling_periods` · v1 · read

The rolling periods are today and the days before it, ROLLING_SHORT_DAYS and ROLLING_LONG_DAYS local days in all, from the first day's start to now.

- **Constants**: `ROLLING_SHORT_DAYS` = 7, `ROLLING_LONG_DAYS` = 30
- **Evidence**: Counted in local days, not 24 h steps, so a window across DST still starts at the cutoff.
- **Decided in**: `docs/plans/2026-10-15-rl-tracker-features-map.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `playlist_filters` · v1 · read

Everything leaves out private (6, 26) and offline playlists; ranked is the ranked group without Official Tournament; casual is ids 1–4; extra modes include the LTMs; any single playlist can be picked.

- **Evidence**: Friends' lobbies and bot games would skew overall stats and the baseline, and extra modes per-game stats (map; user's choices); Official Tournament has its own rank.
- **Decided in**: `docs/plans/2026-10-15-rl-tracker-features-map.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `baseline_30_day` · v1 · read

A session's baseline is your matches under the same filters from the same local time BASELINE_DAYS days before the session's start, up to that start.

- **Constants**: `BASELINE_DAYS` = 30
- **Evidence**: The session isn't compared with itself, and an old session is compared with its own era (user's choice).
- **Decided in**: `docs/plans/2026-10-15-rl-tracker-features-map.md`, `docs/plans/2026-10-21-wp5a-a-query-logic.md`

### `streaks` · v1 · read

Win and loss streaks run in start order; a match with no result neither extends nor breaks one.

- **Evidence**: A restart leaves the result unknown, which says nothing about the run.
- **Decided in**: `docs/plans/2026-10-21-wp5a-a-query-logic.md`
