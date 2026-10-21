// The stat rules as data: our own reading of the game's events, one entry per rule, with what it
// rests on. The definitions doc is generated from here, and a test keeps the two in sync. The
// constants are the values the code runs on, not copies.
import { GOAL_LINE_Y } from "../../shared/constants";
import { CLOSE_UNDER, LONG_FROM } from "../../shared/goal-range";
import { AERIAL_MIN_Z, CORNER_MAX_XY_SUM, HARDEST_SHOT_MAX_KMH, SIDE_WALL_X, WALL_MARGIN } from "../recorder/extras";
import { CAR_SAMPLE_CAP_MS, TOUCH_MERGE_MS, WOODWORK_WINDOW_MS } from "../recorder/play";
import { ORPHAN_TIMEOUT_MS } from "../recorder/recorder";
import { UPDATE_STATE_INTERVAL_MS } from "../recorder/sampler";
import { CAMERA_SHARE } from "../recorder/summary";

/**
 * When a rule takes effect. "stored": while recording, into raw.db, so recompute can't change it.
 * "recorded": when a match's record is computed, live or by recompute; these rules' versions are
 * stored with each match. "read": when a page reads the record, so it always runs at its current version.
 */
export type Applied = "stored" | "recorded" | "read";

/** The order the generated doc lists the areas in. */
export const AREAS = ["recording", "match", "identity", "attribution", "extras", "goals"] as const;

export type Area = (typeof AREAS)[number];

export interface Rule {
  /** snake_case, stable: the per-match version map is keyed by it. */
  id: string;
  area: Area;
  /** The rule in one line. */
  rule: string;
  constants?: Readonly<Record<string, number>>;
  /** The check ids that flag a match this rule may have got wrong. */
  checks: readonly string[];
  /** What the rule rests on, with figures. */
  evidence: string;
  /** Bumped on any change that can move a stored value. */
  version: number;
  applied: Applied;
  /**
   * The stored columns ("table.column") this rule helps write, best-effort: rules feed each other.
   * rules-diff lists a moved column none of whose rules was bumped as one to review. A recorded rule
   * without them only decides which records or rows exist, or sets a check flag.
   */
  outputs?: readonly string[];
  /** Where it was decided, repo-relative: the dated history behind the current entry. */
  refs: readonly string[];
}

const ADR_RECORDER = "docs/decisions/2026-10-19-recorder-websocket-raw-store.md";
const PLAN_WP3A = "docs/plans/2026-10-19-wp3a-recorder.md";
const CAPTURES = "docs/research/2026-10-19-weekend-captures.md";
const ADR_RECORDS = "docs/decisions/2026-10-20-match-records-per-player.md";
const PLAN_WP4A = "docs/plans/2026-10-20-wp4a-match-records.md";
const ADR_EXTRAS = "docs/decisions/2026-10-20-match-extras-play-view.md";
const PLAN_WP4B = "docs/plans/2026-10-20-wp4b-match-extras.md";

const p = (column: string) => `match_players.${column}`;
const m = (column: string) => `matches.${column}`;
const g = (column: string) => `match_goals.${column}`;

const CAR_STATS = [p("car_ms"), p("boost_avg"), p("supersonic_ms"), p("empty_boost_ms")];
const HIT_STATS = [p("hardest_shot_kmh"), p("woodwork_hits"), p("aerial_touches")];
const GOAL_POINT = [g("toucher_key"), g("x"), g("y"), g("z"), g("distance"), g("deflected"), g("own_goal")];
const SCOREBOARD_STATS = ["score", "goals", "shots", "assists", "saves", "touches", "demos"].map(p);

export const RULES: readonly Rule[] = [
  // recording
  {
    id: "update_state_sampling",
    area: "recording",
    rule: "UpdateState is stored about once per interval; the latest dropped one is held and written just before the next other event (and before any close), so the scoreboard at a goal, MatchEnded or a close is never lost.",
    constants: { UPDATE_STATE_INTERVAL_MS },
    checks: [],
    evidence: "About 2 states a second follows the scoreboard; the car stats weigh each sample by the gap to the next, and car time covers 0.98–0.997 of live play on the 46 captured matches.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "loadout_once",
    area: "recording",
    rule: "Each player's Loadout is stored only the first time they appear in a match's states.",
    checks: [],
    evidence: "Loadout is constant within a match and makes up most of an UpdateState's size.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "menu_states_dropped",
    area: "recording",
    rule: "UpdateStates still showing the menu's PlaylistId 0, before the match's first non-zero one, are not stored.",
    checks: [],
    evidence: "They carry the menu, not the match.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "open_match_owns_events",
    area: "recording",
    rule: "One match is open at a time, and it owns every event, whatever guid the event carries, until a MatchDestroyed (any guid) closes it.",
    checks: [],
    evidence: "After a private game the old match's teardown arrives under the next match's guid: 5 retagged teardowns on the 4 weekend captures, each kept with its match.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A, CAPTURES],
  },
  {
    id: "match_superseded",
    area: "recording",
    rule: "A MatchCreated with another guid closes the open match, whatever its phase, with cause superseded.",
    checks: [],
    evidence: "Never seen on the captures; a safety net against a lost MatchDestroyed.",
    version: 1,
    applied: "stored",
    refs: [PLAN_WP3A],
  },
  {
    id: "orphan_timeout",
    area: "recording",
    rule: "The recorder closes the open match itself with cause timeout after this long with no events, and with cause restart when it starts with a match left open.",
    constants: { ORPHAN_TIMEOUT_MS },
    checks: [],
    evidence: "Matches are serial, so only the last match can be left open; a restart on a real data dir closed its open match as restart.",
    version: 1,
    applied: "stored",
    refs: [PLAN_WP3A],
  },
  {
    id: "close_cause",
    area: "recording",
    rule: "closed_via is destroyed when the game's MatchDestroyed closed the match, else the recorder's cause (timeout, restart, superseded), stored with its RecorderClosed marker.",
    checks: [],
    evidence: "The cause tells a leave from a lost ending: it feeds the end kind (left vs orphaned) and your result.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A, ADR_RECORDS],
  },
  {
    id: "lobby_no_record",
    area: "recording",
    rule: "A match that closes before any live trigger (MatchInitialized, CountdownBegin, RoundStarted, GoalScored) is a lobby and gets no record; recompute keeps a lobby's existing record and warns.",
    checks: [],
    evidence: "A lobby opened and closed with no game on the captures.",
    version: 1,
    applied: "recorded",
    refs: [PLAN_WP3A, ADR_RECORDS],
  },
  {
    id: "only_latest_match_open",
    area: "recording",
    rule: "Recompute skips a match with no close marker as still open; only the match with the latest event can be live, so another unclosed one is warned about.",
    checks: [],
    evidence: "Matches are serial: an unclosed match that isn't the latest lost its close marker in a failed write.",
    version: 1,
    applied: "recorded",
    refs: [PLAN_WP3A, PLAN_WP4A],
  },
  {
    id: "dedup_replay_goal",
    area: "recording",
    rule: "A GoalScored with an empty scorer name, GoalSpeed 0 and GoalTime 0 is the replay's copy, dropped on read.",
    checks: ["goal_events_equal_score"],
    evidence: "Every goal is sent twice, the copy when the replay ends or is skipped; the three markers always come together on the captures.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh")],
    refs: [ADR_RECORDER, PLAN_WP3A, CAPTURES],
  },
  {
    id: "dedup_repeat_crossbar",
    area: "recording",
    rule: "A CrossbarHit whose data equals the previous CrossbarHit's is dropped on read.",
    checks: [],
    evidence: "The game repeats CrossbarHit with identical data.",
    version: 1,
    applied: "recorded",
    outputs: [p("woodwork_hits")],
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "dedup_repeat_ballhit",
    area: "recording",
    rule: "A BallHit whose data equals the previous BallHit's is dropped on read.",
    checks: [],
    evidence: "The game repeats BallHit with identical data.",
    version: 1,
    applied: "recorded",
    outputs: [...HIT_STATS, ...GOAL_POINT],
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  // match
  {
    id: "roster",
    area: "match",
    rule: "The roster is every player in a state before MatchEnded: team_num is their last real team, teams_seen has bit 1 << team for each team they were on, present_at_end says they were in the last state before MatchEnded.",
    checks: [],
    evidence: "Records cover every player, so pages resolve \"you\" and \"with you\" at read time; about 5 rows per match.",
    version: 1,
    applied: "recorded",
    outputs: [p("primary_id"), p("name"), p("team_num"), p("teams_seen"), p("present_at_end")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "real_teams_only",
    area: "match",
    rule: "Only TeamNum 0 and 1 are teams, wherever a team number is read; 255 (not on a team yet), -1 (no contest) and anything else are no team.",
    checks: ["winner_valid"],
    evidence: "A winner no player is on would show every player a loss (user's choice).",
    version: 1,
    applied: "recorded",
    outputs: [p("team_num"), p("teams_seen"), m("winner_team_num"), m("winner_source"), m("mvp_key"), m("mvp_source"), g("team_num"), ...GOAL_POINT, p("hardest_shot_kmh")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "score_last_full_scoreboard",
    area: "match",
    rule: "The score is the last scoreboard before MatchEnded with both teams' goals whole and non-negative; a scoreboard without them is rejected and counted.",
    checks: ["scoreboards_complete", "goal_events_equal_score", "player_goals_equal_score", "assists_within_goals"],
    evidence: "A scoreboard missing a team's goals says nothing reliable; none was rejected on the 46 captured matches.",
    version: 1,
    applied: "recorded",
    outputs: [m("score_team0"), m("score_team1")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "final_player_stats",
    area: "match",
    rule: "Each scoreboard stat is the last state before MatchEnded raised to its highest value in the states after it, for players still in them.",
    checks: ["statfeed_matches_scoreboard", "player_goals_equal_score", "assists_within_goals", "player_stats_non_negative"],
    evidence: "In two real matches a shot under 0.5 s before MatchEnded reached the scoreboard only afterwards; teardown states can carry reset counters, so the highest value is kept.",
    version: 1,
    applied: "recorded",
    outputs: SCOREBOARD_STATS,
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "statfeed_counts",
    area: "match",
    rule: "Each StatfeedEvent counts once for its resolved target, by event name; one whose target doesn't resolve is counted apart.",
    checks: ["statfeed_resolved", "statfeed_matches_scoreboard"],
    evidence: "The statfeed matched the scoreboard on every captured match recorded from its start.",
    version: 1,
    applied: "recorded",
    outputs: ["match_player_statfeed.count"],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "end_kind",
    area: "match",
    rule: "With MatchEnded, a match ended early when, outside overtime, the last clock reading before it is above 0 or the one before that above 1, else it completed; without MatchEnded it was left (MatchDestroyed) or orphaned (the recorder closed it).",
    checks: ["clock_non_negative"],
    evidence: "Every match resets the clock to 0 just before MatchEnded: a full match counts down through 1, a forfeit jumps from where it stopped; in overtime the clock counts up.",
    version: 1,
    applied: "recorded",
    outputs: [m("end_kind")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "overtime",
    area: "match",
    rule: "A match went to overtime when any clock reading (a state or ClockUpdatedSeconds) has bOvertime.",
    checks: [],
    evidence: "bOvertime is the game's own flag.",
    version: 1,
    applied: "recorded",
    outputs: [m("overtime")],
    refs: [PLAN_WP4A],
  },
  {
    id: "joined_in_progress",
    area: "match",
    rule: "A match whose stored events have no MatchInitialized was joined in progress.",
    checks: [],
    evidence: "MatchInitialized comes once at the start; re-derived from the stored events so recompute needs only raw.db.",
    version: 1,
    applied: "recorded",
    outputs: [m("joined_in_progress")],
    refs: [PLAN_WP3A, PLAN_WP4A],
  },
  {
    id: "playlist_and_arena",
    area: "match",
    rule: "playlist_id is the last non-zero PlaylistId and arena the last Arena in the states before MatchEnded, both stored raw.",
    checks: ["playlist_present"],
    evidence: "The playlist map is applied when a page reads it, so a corrected map reaches old matches.",
    version: 1,
    applied: "recorded",
    outputs: [m("playlist_id"), m("arena")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "winner",
    area: "match",
    rule: "The winner is MatchEnded's WinnerTeamNum when it names a real team (a no contest names none); without MatchEnded, the team ahead when the clock had reached 0 or it was overtime (\"decided\").",
    checks: ["winner_valid"],
    evidence: "Every MatchEnded match on the captures has a winner; a one-goal lead at 0 s could in theory still be equalised, which the feature map accepts.",
    version: 1,
    applied: "recorded",
    outputs: [m("winner_team_num"), m("winner_source"), m("mvp_key"), m("mvp_source")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "mvp",
    area: "match",
    rule: "The MVP is the MVP statfeed's target; with none, the winning team's unique top scorer among players present at the end; a tie or no winner gives none.",
    checks: ["mvp_count", "mvp_on_roster"],
    evidence: "The game awards the MVP on the podium, and a match can end without one.",
    version: 1,
    applied: "recorded",
    outputs: [m("mvp_key"), m("mvp_source")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "your_result",
    area: "match",
    rule: "Your result: a winner decides it; without one, a leave, a superseded close or a timeout is a loss, a restart is unknown, and any other end has no result.",
    checks: [],
    evidence: "After a restart the tracker was down and play may have gone on, so a loss would be a guess (user's choice).",
    version: 1,
    applied: "read",
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "playlist_map",
    area: "match",
    rule: "A playlist id maps to a name and group when a page reads it; an unmapped id is logged once per run with the team sizes.",
    checks: [],
    evidence: "From community lists checked against live play; the game reuses ids (4 was Chaos, now Casual Quads).",
    version: 1,
    applied: "read",
    refs: [ADR_RECORDS, "docs/research/2026-10-15-rl-playlist-ids.md"],
  },
  // identity
  {
    id: "player_key",
    area: "identity",
    rule: "A player's key within a match is their PrimaryId; bots, which all share Unknown|0|0, are keyed bot:<Name>.",
    checks: [],
    evidence: "Every bot has the PrimaryId Unknown|0|0.",
    version: 1,
    applied: "recorded",
    outputs: [p("player_key"), p("is_bot")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "target_resolution",
    area: "identity",
    rule: "An event's player reference (Name, Shortcut, TeamNum, no id) is the player with that Shortcut in the latest state when name and team agree, else the one roster player with that name and team, else unresolved.",
    checks: ["statfeed_resolved", "mvp_on_roster"],
    evidence: "Statfeed targets, hitters, scorers and assisters carry no PrimaryId, only Name, Shortcut and TeamNum; the roster is keyed by PrimaryId.",
    version: 1,
    applied: "recorded",
    outputs: ["match_player_statfeed.count", m("mvp_key"), m("camera_primary_id"), g("scorer_key"), g("assister_key"), g("aerial"), ...GOAL_POINT, p("hardest_shot_kmh")],
    refs: [PLAN_WP4A, PLAN_WP4B],
  },
  {
    id: "camera_identity",
    area: "identity",
    rule: "The camera's player is the roster player holding at least this share of the resolved camera targets in play (replays and the podium don't count, unresolved targets say nothing); a bot or no such player gives none.",
    constants: { CAMERA_SHARE },
    checks: ["camera_on_roster"],
    evidence: "The user's own matches had 100% of targets on one player and a spectated private 1v1 71%; counting unresolved targets put a real match at 94.6%.",
    version: 1,
    applied: "recorded",
    outputs: [m("camera_primary_id")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "pending_guess",
    area: "identity",
    rule: "The camera's PrimaryId becomes a pending my_ids guess unless it is already in my_ids (any status) or a confirmed id played the match.",
    checks: [],
    evidence: "46 real matches gave exactly one pending guess, the user's.",
    version: 1,
    applied: "recorded",
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  // attribution
  {
    id: "live_play_window",
    area: "attribution",
    rule: "Only live play counts for the extras: from RoundStarted to the live GoalScored or MatchEnded, less pauses; a match joined in progress starts in play.",
    checks: ["extras_computed"],
    evidence: "212 of 212 BallHits in the completed fixture fell in live play; CrossbarHit fires in replays and on the podium too.",
    version: 1,
    applied: "recorded",
    outputs: [...HIT_STATS, ...CAR_STATS, ...GOAL_POINT, g("aerial")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "every_entry_a_hitter",
    area: "attribution",
    rule: "Every entry of BallHit.Players is a hitter, so a 50/50 credits both players.",
    checks: [],
    evidence: "100 of 1,164 fixture hits list two players; crediting only the first made a kickoff 50/50 look like an own goal.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh"), p("aerial_touches"), ...GOAL_POINT],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "reference_resolution",
    area: "attribution",
    rule: "A hit, shot, woodwork or goal-last-touch reference that isn't an object is missing and not counted; a player object off the roster counts as unresolved under its kind; a hit's non-object Players entry counts as an unidentified hitter.",
    checks: ["touches_resolved"],
    evidence: "A stat credited to a guessed player would be wrong without a trace, so an unknown reference counts toward touches_resolved instead. No unresolved reference on the 46 captured matches.",
    version: 1,
    applied: "recorded",
    outputs: [...HIT_STATS, ...GOAL_POINT],
    refs: [PLAN_WP4B],
  },
  {
    id: "last_touch_comparison",
    area: "attribution",
    rule: "A goal's BallLastTouch is compared with the last hit only when both are known (the last touch and every last hitter resolve, or no hit came since a seen kickoff); it disagrees when it isn't among the last hit's hitters.",
    checks: ["goal_last_touch_agrees"],
    evidence: "An unknown side can't show a disagreement, and counting it either way would flag correct matches or hide wrong ones. No missing BallLastTouch in 432 real GoalScoreds.",
    version: 1,
    applied: "recorded",
    refs: [PLAN_WP4B],
  },
  {
    id: "touch_merge",
    area: "attribution",
    rule: "A player's hit counts as a new touch only when someone else hit since their last counted one, or this long has passed.",
    constants: { TOUCH_MERGE_MS },
    checks: ["extras_in_range"],
    evidence: "The game sends a BallHit per contact, 1.2–1.8× its own touch count.",
    version: 1,
    applied: "recorded",
    outputs: [p("aerial_touches")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  // extras
  {
    id: "hardest_shot",
    area: "extras",
    rule: "Hardest shot is the fastest PostHitSpeed (km/h) over each Shot statfeed's last live hit by the shooter since the kickoff and each goal's origin hit; checked against the maximum.",
    constants: { HARDEST_SHOT_MAX_KMH },
    checks: ["shots_have_touch", "extras_in_range"],
    evidence: "The Shot statfeed arrives 0.1–1.7 s after the touch; PostHitSpeed peaked at 177 km/h (p99 131) on the captures. Every hit would count dribbles and clears.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "aerial_touch",
    area: "extras",
    rule: "A counted touch is aerial when the ball is at least AERIAL_MIN_Z high and at least WALL_MARGIN from every wall (|x| ≤ SIDE_WALL_X − WALL_MARGIN, |y| ≤ GOAL_LINE_Y − WALL_MARGIN), including the 45° corners (|x| + |y| ≤ CORNER_MAX_XY_SUM).",
    constants: { AERIAL_MIN_Z, WALL_MARGIN, SIDE_WALL_X, GOAL_LINE_Y, CORNER_MAX_XY_SUM },
    checks: ["extras_in_range"],
    evidence: "Every AerialGoal's scoring touch was at Z 558–1066 and all but 5 other goals at ≤ 430; 334 of 768 touches at Z ≥ 550 were within 300 of a wall. Some real aerials off the backboard are missed.",
    version: 1,
    applied: "recorded",
    outputs: [p("aerial_touches")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "woodwork",
    area: "extras",
    rule: "A CrossbarHit in live play counts one woodwork hit for its BallLastTouch player, at most once per window.",
    constants: { WOODWORK_WINDOW_MS },
    checks: ["touches_resolved"],
    evidence: "CrossbarHit fires for the posts too, and repeatedly while the ball rolls along the bar.",
    version: 1,
    applied: "recorded",
    outputs: [p("woodwork_hits")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "car_sampling",
    area: "extras",
    rule: "Car samples come from the in-play, non-replay UpdateStates of players with bHasCar, each weighted by the gap to the next state, capped; a player with no samples (the other team) has null car stats.",
    constants: { CAR_SAMPLE_CAP_MS },
    checks: ["extras_in_range"],
    evidence: "Car state comes only for your own team; car time covers 0.98–0.997 of live play on the 46 captured matches.",
    version: 1,
    applied: "recorded",
    outputs: CAR_STATS,
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "car_stats",
    area: "extras",
    rule: "car_ms is the samples' total weight, boost_avg the weighted mean Boost (0–100), supersonic_ms and empty_boost_ms the weight with bSupersonic and with Boost 0.",
    checks: ["extras_in_range"],
    evidence: "Stored as ms beside car_ms, so a share across matches is a ratio of sums.",
    version: 1,
    applied: "recorded",
    outputs: CAR_STATS,
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  // goals
  {
    id: "goal_origin",
    area: "goals",
    rule: "A goal's point is the scoring team's last hit since the kickoff, preferring the scorer among a 50/50's hitters; the ball's location there is its position.",
    checks: ["goals_per_team_equal_score"],
    evidence: "The game's own last touch disagrees with the hits on 50/50s; the scoring team's last hit placed all 214 goals on the captures.",
    version: 1,
    applied: "recorded",
    outputs: [...GOAL_POINT, p("hardest_shot_kmh")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "goal_distance",
    area: "goals",
    rule: "A goal's distance is from its point to the centre of the goal attacked; team 0 attacks +Y and team 1 −Y, the goal line at ±GOAL_LINE_Y.",
    constants: { GOAL_LINE_Y },
    checks: [],
    evidence: "Field orientation measured on the captures.",
    version: 1,
    applied: "recorded",
    outputs: [g("distance")],
    refs: [PLAN_WP4B],
  },
  {
    id: "deflected",
    area: "goals",
    rule: "A goal is deflected when the other team hit the ball after its origin hit; the other player in a 50/50 origin doesn't count.",
    checks: [],
    evidence: "38 of 214 captured goals.",
    version: 1,
    applied: "recorded",
    outputs: [g("deflected")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "own_goal",
    area: "goals",
    rule: "A goal is an own goal when the scoring team never hit the ball since a seen kickoff; it then has no point. Joined before the first kickoff, it isn't one.",
    checks: [],
    evidence: "0 of 214 captured goals.",
    version: 1,
    applied: "recorded",
    outputs: GOAL_POINT,
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "aerial_goal",
    area: "goals",
    rule: "A goal is aerial when its scorer has a pending AerialGoal statfeed from live play, which the goal consumes; pending ones clear at each kickoff.",
    checks: ["aerial_goals_match_statfeed"],
    evidence: "24 of 24 AerialGoal statfeeds marked on the captures; the statfeed comes just before its GoalScored.",
    version: 1,
    applied: "recorded",
    outputs: [g("aerial")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "goal_speed",
    area: "goals",
    rule: "A goal's speed is the live GoalScored's GoalSpeed, in km/h.",
    checks: [],
    evidence: "The replay's copy has GoalSpeed 0 and is dropped by dedup.",
    version: 1,
    applied: "recorded",
    outputs: [g("speed_kmh")],
    refs: [PLAN_WP4B],
  },
  {
    id: "unresolved_scorer_dropped",
    area: "goals",
    rule: "A goal whose scorer isn't a roster player with a team gets no goal row; it is counted and flagged rather than given a team.",
    checks: ["goals_placed", "goals_per_team_equal_score"],
    evidence: "None seen in 214 captured goals; each way of inferring the team from other events broke on some event order, so a guess could credit the wrong team.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "goal_range",
    area: "goals",
    rule: "A goal is close under CLOSE_UNDER (a quarter of the pitch), long from LONG_FROM (half the pitch), else mid, from its stored distance.",
    constants: { CLOSE_UNDER, LONG_FROM },
    checks: [],
    evidence: "The game's LongGoal follows no simple distance rule, so the classes are ours.",
    version: 1,
    applied: "read",
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
];

/** The versions stored with each match's record: the rules recompute can change. */
export const RECORDED_RULE_VERSIONS: Readonly<Record<string, number>> = Object.fromEntries(
  RULES.filter((r) => r.applied === "recorded").map((r) => [r.id, r.version]),
);
