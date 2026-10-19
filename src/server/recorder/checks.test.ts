import { describe, expect, test } from "vitest";
import { runChecks } from "./checks";
import type { MatchSummary, RosterEntry } from "./summary";

const entry = (key: string, teamNum: number, goals: number, assists = 0): RosterEntry => ({
  key,
  primaryId: key,
  name: key,
  teamNum,
  isBot: false,
  presentAtEnd: true,
  stats: { score: 100 * goals, goals, shots: goals, assists, saves: 0, touches: 1, demos: 0 },
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
  winnerTeamNum: 0,
  mvp: { name: "a", teamNum: 0, key: "a" },
  roster: [entry("a", 0, 2), entry("b", 0, 0, 1), entry("c", 1, 1)],
  facts: { sawMatchEnded: true, sawPodium: true, mvpCount: 1, liveGoals: 3, minClock: 0 },
  dedupDropped: {},
  flags: [],
});

const ids = (s: MatchSummary) => runChecks(s).map((f) => f.id);

describe("runChecks", () => {
  test("a clean finished match passes every check", () => {
    expect(runChecks(clean())).toEqual([]);
  });

  test("a left match with no winner, MVP or podium passes", () => {
    const s = { ...clean(), endKind: "left" as const, winnerTeamNum: null, mvp: null, facts: { ...clean().facts, sawMatchEnded: false, sawPodium: false, mvpCount: 0 } };
    expect(runChecks(s)).toEqual([]);
  });

  test.each<[string, (s: MatchSummary) => void]>([
    ["winner_valid", (s) => (s.winnerTeamNum = 2)],
    ["winner_valid", (s) => (s.winnerTeamNum = null)],
    ["mvp_count", (s) => (s.facts.mvpCount = 2)],
    ["mvp_count", (s) => ((s.facts.mvpCount = 0), (s.mvp = null))],
    ["mvp_on_roster", (s) => (s.mvp = { name: "x", teamNum: 0, key: null })],
    ["goal_events_equal_score", (s) => (s.facts.liveGoals = 6)],
    ["player_goals_equal_score", (s) => (s.roster = [entry("a", 0, 1), entry("b", 0, 0, 1), entry("c", 1, 1)])],
    ["assists_within_goals", (s) => (s.roster = [entry("a", 0, 2, 3), entry("c", 1, 1)])],
    ["player_stats_non_negative", (s) => (s.roster = [...s.roster, { ...entry("d", 1, 0), stats: { ...entry("d", 1, 0).stats, saves: -1 } }])],
    ["clock_non_negative", (s) => (s.facts.minClock = -1)],
    ["playlist_present", (s) => (s.playlistId = null)],
  ])("%s fails on a summary built to break it", (id, breakIt) => {
    const s = clean();
    breakIt(s);
    expect(ids(s)).toEqual([id]);
    expect(runChecks(s)[0]?.detail).toEqual(expect.any(String));
  });

  test("an MVP-less MatchEnded without a podium is fine (seen once: F6FE4498)", () => {
    const s = clean();
    s.facts.sawPodium = false;
    s.facts.mvpCount = 0;
    s.mvp = null;
    expect(runChecks(s)).toEqual([]);
  });

  test("goal events aren't compared when joined in progress: earlier goals were never seen", () => {
    const s = clean();
    s.joinedInProgress = true;
    s.facts.liveGoals = 1;
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

  test("score checks are skipped when no state was stored", () => {
    const s = { ...clean(), score: null, winnerTeamNum: null, facts: { ...clean().facts, sawMatchEnded: false } };
    expect(ids(s)).toEqual([]);
  });
});
