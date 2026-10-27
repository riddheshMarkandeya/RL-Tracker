import { describe, expect, test } from "vitest";
import { runChecks } from "./checks";
import type { ExtraValues } from "./extras";
import { emptyFacts, type GoalPoint } from "./play";
import type { MatchSummary, RosterEntry, TeamNum } from "./summary";

const entry = (key: string, teamNum: TeamNum, goals: number, assists = 0): RosterEntry => ({
  key,
  primaryId: key,
  name: key,
  teamNum,
  teamsSeen: 1 << teamNum,
  isBot: false,
  presentAtEnd: true,
  stats: { score: 100 * goals, goals, shots: goals, assists, saves: 0, touches: 1, demos: 0 },
});

const point = (teamNum: TeamNum, scorerKey: string): GoalPoint => ({
  teamNum,
  scorerKey,
  assisterKey: null,
  toucherKey: scorerKey,
  pos: { x: 0, y: 0, z: 93 },
  distance: 5120,
  speedKmh: 90,
  deflected: false,
  aerial: false,
  ownGoal: false,
});
const extrasFor = (car: boolean): ExtraValues => ({
  hardest_shot_kmh: 120,
  woodwork_hits: 0,
  aerial_touches: 1,
  car_ms: car ? 60_000 : null,
  boost_avg: car ? 40 : null,
  supersonic_ms: car ? 5000 : null,
  empty_boost_ms: car ? 3000 : null,
});

/** A finished 2–1 match that passes every check. */
const clean = (): MatchSummary => ({
  guid: "G",
  playlistId: 13,
  arena: "cs_p",
  startedAt: 0,
  endedAt: 1,
  endKind: "completed",
  closedVia: "destroyed",
  joinedInProgress: false,
  overtime: false,
  score: [2, 1],
  winner: { teamNum: 0, source: "match_ended" },
  mvp: { name: "a", teamNum: 0, key: "a", source: "statfeed" },
  roster: [entry("a", 0, 2), entry("b", 0, 0, 1), entry("c", 1, 1)],
  statfeed: { a: { Goal: 2, Shot: 2, MVP: 1 }, b: { Assist: 1 }, c: { Goal: 1, Shot: 1 } },
  cameraKey: "a",
  facts: { sawMatchEnded: true, endedWinnerTeamNum: 0, mvpCount: 1, liveGoals: 3, minClock: 0, unresolvedStatfeed: 0, rejectedScoreboards: 0, cameraTargets: 10, replayShare: 0.2 },
  dedupDropped: {},
  extras: {
    players: { a: { ...extrasFor(true), woodwork_hits: 1 }, b: extrasFor(true), c: extrasFor(false) },
    goals: [point(0, "a"), point(1, "c"), point(0, "a")],
    facts: { ...emptyFacts(), playMs: 60_000 },
  },
  extrasError: null,
  thinned: null,
  flags: [],
});
function x(s: MatchSummary) {
  if (!s.extras) throw new Error("clean() always has extras");
  return s.extras;
}
function player(s: MatchSummary, k: string): ExtraValues {
  const v = x(s).players[k];
  if (!v) throw new Error(`no extras for ${k}`);
  return v;
}

const ids = (s: MatchSummary) => runChecks(s).map((f) => f.id);

describe("runChecks", () => {
  test("a clean finished match passes every check", () => {
    expect(runChecks(clean())).toEqual([]);
  });

  test("replay_playback flags a stretch of states nearly all replay, unless thinned (bReplay is gone)", () => {
    const at = (replayShare: number | null, thinned: MatchSummary["thinned"] = null) => ids({ ...clean(), thinned, facts: { ...clean().facts, replayShare } });
    expect(at(0.9)).toContain("replay_playback");
    expect(at(1)).toContain("replay_playback");
    expect(at(0.89)).not.toContain("replay_playback");
    expect(at(null)).not.toContain("replay_playback");
    expect(at(1, { ruleVersions: {}, offRoster: [], unsnapshotted: [] })).not.toContain("replay_playback");
  });

  test("a left match with no winner, MVP or podium passes", () => {
    const s = { ...clean(), endKind: "left" as const, winner: null, mvp: null, facts: { ...clean().facts, sawMatchEnded: false, mvpCount: 0 } };
    expect(runChecks(s)).toEqual([]);
  });

  test("a no contest (MatchEnded winner -1) passes with no winner", () => {
    const s = { ...clean(), winner: null, mvp: null, facts: { ...clean().facts, endedWinnerTeamNum: -1, mvpCount: 0 } };
    expect(runChecks(s)).toEqual([]);
  });

  test.each<[string, (s: MatchSummary) => void]>([
    ["winner_valid", (s) => ((s.winner = null), (s.facts.endedWinnerTeamNum = 2))],
    ["winner_valid", (s) => ((s.winner = null), (s.facts.endedWinnerTeamNum = null))],
    ["winner_valid", (s) => ((s.winner = null), (s.facts.endedWinnerTeamNum = 255))],
    ["mvp_count", (s) => (s.facts.mvpCount = 2)],
    ["mvp_on_roster", (s) => (s.mvp = { name: "x", teamNum: 0, key: null, source: "statfeed" })],
    ["statfeed_resolved", (s) => (s.facts.unresolvedStatfeed = 1)],
    ["scoreboards_complete", (s) => (s.facts.rejectedScoreboards = 1)],
    ["statfeed_matches_scoreboard", (s) => (s.statfeed.a = { Goal: 1, Shot: 2 })],
    ["statfeed_matches_scoreboard", (s) => (s.statfeed.b = {})],
    ["statfeed_matches_scoreboard", (s) => (s.statfeed.c = { Goal: 1, Shot: 1, Save: 1 })],
    ["statfeed_matches_scoreboard", (s) => (s.statfeed.c = { Goal: 1, Shot: 1, Demolish: 1 })],
    ["statfeed_matches_scoreboard", (s) => (s.statfeed.c = { Goal: 1 })],
    ["camera_on_roster", (s) => (s.cameraKey = null)],
    ["goal_events_equal_score", (s) => (s.facts.liveGoals = 6)],
    ["player_goals_equal_score", (s) => (s.roster = [entry("a", 0, 1), entry("b", 0, 0, 1), entry("c", 1, 1)])],
    ["assists_within_goals", (s) => (s.roster = [entry("a", 0, 2, 3), entry("c", 1, 1)])],
    ["player_stats_non_negative", (s) => (s.roster = [...s.roster, { ...entry("d", 1, 0), stats: { ...entry("d", 1, 0).stats, saves: -1 } }])],
    ["clock_non_negative", (s) => (s.facts.minClock = -1)],
    ["playlist_present", (s) => (s.playlistId = null)],
    ["goals_per_team_equal_score", (s) => x(s).goals.pop()],
    ["goals_per_team_equal_score", (s) => (x(s).goals[1] = point(0, "a"))],
    ["extras_computed", (s) => ((s.extras = null), (s.extrasError = "TypeError: boom"))],
    ["goals_placed", (s) => (x(s).facts.droppedGoals = 1)],
    ["touches_resolved", (s) => (x(s).facts.unresolved.hit = 1)],
    ["touches_resolved", (s) => (x(s).facts.unresolved.shot = 1)],
    ["touches_resolved", (s) => (x(s).facts.unresolved.woodwork = 1)],
    ["touches_resolved", (s) => (x(s).facts.unresolved.lastTouch = 1)],
    ["shots_have_touch", (s) => (x(s).facts.shotsWithoutTouch = 1)],
    ["aerial_goals_match_statfeed", (s) => (x(s).goals[0] = { ...point(0, "a"), aerial: true })],
    ["aerial_goals_match_statfeed", (s) => (s.statfeed.c = { ...s.statfeed.c, AerialGoal: 1 })],
    ["goal_last_touch_agrees", (s) => (x(s).facts.lastTouchDisagrees = 1)],
    ["extras_in_range", (s) => (player(s, "a").hardest_shot_kmh = 251)],
    ["extras_in_range", (s) => (player(s, "a").hardest_shot_kmh = -1)],
    ["extras_in_range", (s) => (player(s, "a").boost_avg = 101)],
    ["extras_in_range", (s) => (player(s, "a").aerial_touches = 2)],
    ["extras_in_range", (s) => (player(s, "a").car_ms = 61_001)],
  ])("%s fails on a summary built to break it", (id, breakIt) => {
    const s = clean();
    breakIt(s);
    // A broken roster also disagrees with its statfeed, which has its own rows.
    expect(ids(s).filter((x) => x === id || x !== "statfeed_matches_scoreboard")).toEqual([id]);
    expect(runChecks(s)[0]?.detail).toEqual(expect.any(String));
  });

  test("touches_resolved names only the kinds with unidentified players", () => {
    const s = clean();
    x(s).facts.unresolved.hit = 1;
    x(s).facts.unresolved.lastTouch = 2;
    expect(runChecks(s).find((f) => f.id === "touches_resolved")?.detail).toBe("unidentified: 1 hitter(s), 2 goal last toucher(s)");
  });

  test("a podium without an MVP award is fine (the game holds it back when the winning top scorer left)", () => {
    const s = clean();
    s.facts.mvpCount = 0;
    s.mvp = null;
    expect(runChecks(s)).toEqual([]);
  });

  test("saves on the scoreboard are Save plus EpicSave statfeeds", () => {
    const s = clean();
    s.roster = [entry("a", 0, 2), entry("b", 0, 0, 1), { ...entry("c", 1, 1), stats: { ...entry("c", 1, 1).stats, saves: 3 } }];
    s.statfeed.c = { Goal: 1, Shot: 1, Save: 2, EpicSave: 1 };
    expect(runChecks(s)).toEqual([]);
  });

  test("no camera target at all is not a camera failure", () => {
    const s = clean();
    s.cameraKey = null;
    s.facts.cameraTargets = 0;
    expect(runChecks(s)).toEqual([]);
  });

  test("goal events aren't compared when joined in progress: earlier goals were never seen", () => {
    const s = clean();
    s.joinedInProgress = true;
    s.facts.liveGoals = 1;
    // Statfeeds before the recording began were never seen either.
    s.statfeed = {};
    expect(runChecks(s)).toEqual([]);
  });

  test("joined in progress, the roster's goals may fall short of the score but never pass it (B58BBD70)", () => {
    const s = clean();
    s.joinedInProgress = true;
    // A team-0 goal by someone who left before the recording began.
    s.roster = [entry("a", 0, 1), entry("c", 1, 1)];
    expect(runChecks(s)).toEqual([]);
    s.roster = [entry("a", 0, 3), entry("c", 1, 1)];
    expect(ids(s)).toEqual(["player_goals_equal_score"]);
  });

  test("joined in progress, the goal map isn't compared with the score", () => {
    const s = clean();
    s.joinedInProgress = true;
    x(s).goals.pop();
    expect(ids(s).filter((i) => i.startsWith("goals_"))).toEqual([]);
  });

  test("car time up to play time plus one sample cap passes", () => {
    const s = clean();
    player(s, "a").car_ms = 61_000;
    expect(ids(s)).toEqual([]);
  });

  test("a summary without extras skips their checks", () => {
    expect(runChecks({ ...clean(), extras: null })).toEqual([]);
  });

  test("score checks are skipped when no state was stored", () => {
    const s = { ...clean(), score: null, winner: null, facts: { ...clean().facts, sawMatchEnded: false } };
    expect(ids(s)).toEqual([]);
  });
});
