import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { aggregate, baseline, byPlaylist, type MyMatch, type MyRow } from "./aggregate";

const me = (over: Partial<MyRow> = {}): MyRow => ({
  playerKey: "Epic|me|0",
  teamNum: 0,
  score: 300,
  goals: 1,
  shots: 2,
  assists: 1,
  saves: 2,
  demos: 0,
  touches: 20,
  hardestShotKmh: 100,
  woodworkHits: 0,
  aerialTouches: 3,
  carMs: 300_000,
  boostAvg: 40,
  supersonicMs: 30_000,
  emptyBoostMs: 15_000,
  ...over,
});

let clock = 0;
const match = (over: Partial<MyMatch> = {}): MyMatch => {
  clock += 600_000;
  return {
    guid: `G${String(clock)}`,
    startedAt: clock,
    endedAt: clock + 360_000,
    playlistId: 13,
    arena: "cs_p",
    endKind: "completed",
    closedVia: "destroyed",
    overtime: false,
    scoreTeam0: 2,
    scoreTeam1: 1,
    winnerTeamNum: 0,
    mvpKey: null,
    flagged: false,
    me: me(),
    result: "win",
    goals: [{ speedKmh: 90, ownGoal: false }],
    statfeed: {},
    ...over,
  };
};
const win = (over: Partial<MyMatch> = {}) => match({ result: "win", ...over });
const loss = (over: Partial<MyMatch> = {}) => match({ result: "loss", winnerTeamNum: 1, ...over });
const noResult = (over: Partial<MyMatch> = {}) => match({ result: null, winnerTeamNum: null, endKind: "orphaned", closedVia: "restart", ...over });

describe("aggregate", () => {
  test("no matches: a count of 0 and nulls, never fake zeros", () => {
    const a = aggregate([]);
    expect(a.matches).toBe(0);
    expect(a.wins).toBeNull();
    expect(a.winPct).toBeNull();
    expect(a.totals.goals).toBeNull();
    expect(a.perGame.goals).toBeNull();
    expect(a.shootingPct).toBeNull();
    expect(a.bestWinStreak).toBeNull();
    expect(a.endedOn).toBeNull();
    expect(a.extrasMatches).toBe(0);
    expect(a.boostAvg).toBeNull();
    expect(a.statfeed).toEqual({});
  });

  test("spectated matches don't count", () => {
    expect(aggregate([match({ me: null, result: null })]).matches).toBe(0);
  });

  test("results, win % over decided matches, MVPs and early leaves", () => {
    const a = aggregate([
      win({ mvpKey: "Epic|me|0" }),
      win({ mvpKey: "Epic|them|0" }),
      loss({ endKind: "left", winnerTeamNum: null }),
      noResult(),
    ]);
    expect([a.matches, a.wins, a.losses, a.noResult]).toEqual([4, 2, 1, 1]);
    expect(a.winPct).toBeCloseTo(2 / 3);
    expect(a.mvps).toBe(1);
    expect(a.leftEarly).toBe(1);
  });

  test("win % is null with only no-result matches", () => {
    expect(aggregate([noResult()]).winPct).toBeNull();
  });

  test("totals, per game and shooting %", () => {
    const a = aggregate([win({ me: me({ goals: 2, shots: 4, score: 500 }) }), loss({ me: me({ goals: 0, shots: 1, assists: 0, demos: 3, score: 100 }) })]);
    expect(a.totals).toEqual({ goals: 2, assists: 1, saves: 4, shots: 5, demos: 3, score: 600 });
    expect(a.perGame).toEqual({ goals: 1, assists: 0.5, saves: 2, shots: 2.5, demos: 1.5, score: 300 });
    expect(a.shootingPct).toBeCloseTo(0.4);
  });

  test("shooting % is null with no shots", () => {
    expect(aggregate([win({ me: me({ goals: 0, shots: 0 }) })]).shootingPct).toBeNull();
  });

  test("streaks run in time order and skip no-result matches", () => {
    // Given out of order: W W (none) W L L W
    const rows = [win(), win(), noResult(), win(), loss(), loss(), win()];
    const a = aggregate([...rows].reverse());
    expect(a.bestWinStreak).toBe(3);
    expect(a.bestLossStreak).toBe(2);
    expect(a.endedOn).toEqual({ result: "win", length: 1 });
  });

  test("ended on a loss streak, with a trailing no-result match ignored", () => {
    const a = aggregate([win(), loss(), loss(), noResult()]);
    expect(a.endedOn).toEqual({ result: "loss", length: 2 });
    expect(a.bestWinStreak).toBe(1);
  });

  test("no decided matches: streaks 0, ended on nothing", () => {
    const a = aggregate([noResult()]);
    expect([a.bestWinStreak, a.bestLossStreak, a.endedOn]).toEqual([0, 0, null]);
  });

  test("statfeed counts are summed", () => {
    const a = aggregate([win({ statfeed: { Goal: 1, Save: 2 } }), win({ statfeed: { Save: 1, EpicSave: 1 } })]);
    expect(a.statfeed).toEqual({ Goal: 1, Save: 3, EpicSave: 1 });
  });
});

describe("aggregate extras", () => {
  const noExtras = (over: Partial<MyMatch> = {}) =>
    win({
      me: me({ hardestShotKmh: null, woodworkHits: null, aerialTouches: null, carMs: null, boostAvg: null, supersonicMs: null, emptyBoostMs: null }),
      goals: [{ speedKmh: 150, ownGoal: false }],
      ...over,
    });

  test("only matches with extras computed count toward them", () => {
    const a = aggregate([win({ me: me({ hardestShotKmh: 110, woodworkHits: 1, aerialTouches: 2 }) }), noExtras()]);
    expect(a.matches).toBe(2);
    expect(a.extrasMatches).toBe(1);
    expect(a.hardestShotKmh).toBe(110);
    expect(a.fastestGoalKmh).toBe(90);
    expect(a.woodworkHits).toBe(1);
    expect(a.aerialTouches).toBe(2);
  });

  test("none computed: all null", () => {
    const a = aggregate([noExtras()]);
    expect(a.extrasMatches).toBe(0);
    expect([a.hardestShotKmh, a.fastestGoalKmh, a.woodworkHits, a.aerialTouches, a.boostAvg, a.supersonicShare, a.emptyBoostShare]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test("the fastest goal ignores own goals and goals without a speed", () => {
    const a = aggregate([
      win({
        goals: [
          { speedKmh: 140, ownGoal: true },
          { speedKmh: null, ownGoal: false },
          { speedKmh: 95, ownGoal: false },
        ],
      }),
    ]);
    expect(a.fastestGoalKmh).toBe(95);
  });

  test("a maximum over more values than a call takes as arguments", () => {
    const goals = Array.from({ length: 300_000 }, (_, i) => ({ speedKmh: i % 1000, ownGoal: false }));
    expect(aggregate([win({ goals })]).fastestGoalKmh).toBe(999);
  });

  test("boost is car-time weighted and shares are ratios of sums", () => {
    // 100 s at 20 boost and 300 s at 60: weighted 50, not the plain mean 40.
    const a = aggregate([
      win({ me: me({ carMs: 100_000, boostAvg: 20, supersonicMs: 10_000, emptyBoostMs: 40_000 }) }),
      win({ me: me({ carMs: 300_000, boostAvg: 60, supersonicMs: 90_000, emptyBoostMs: 0 }) }),
    ]);
    expect(a.boostAvg).toBeCloseTo(50);
    expect(a.supersonicShare).toBeCloseTo(0.25);
    expect(a.emptyBoostShare).toBeCloseTo(0.1);
  });

  test("a computed match without car time (no car state) is left out of car stats only", () => {
    const a = aggregate([win({ me: me({ carMs: null, boostAvg: null, supersonicMs: null, emptyBoostMs: null }) }), win({ me: me({ carMs: 200_000, boostAvg: 30, supersonicMs: 20_000 }) })]);
    expect(a.extrasMatches).toBe(2);
    expect(a.boostAvg).toBeCloseTo(30);
    expect(a.supersonicShare).toBeCloseTo(0.1);
  });
});

describe("byPlaylist", () => {
  test("one aggregate per playlist you played, by id, unknown last", () => {
    const groups = byPlaylist([win({ playlistId: 13 }), loss({ playlistId: 11 }), win({ playlistId: 13 }), win({ playlistId: null }), match({ playlistId: 6, me: null, result: null })]);
    expect(groups.map((g) => [g.playlistId, g.aggregate.matches, g.aggregate.wins])).toEqual([
      [11, 1, 0],
      [13, 2, 2],
      [null, 1, 1],
    ]);
  });
});

describe("baseline in New York", () => {
  const before = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = before;
  });

  const at = (startedAt: number) => win({ startedAt, endedAt: startedAt + 360_000 });

  test("30 calendar days before the session start up to it, across the fall-back change", () => {
    const sessionStart = Date.UTC(2026, 10, 20, 1); // 19 Nov 20:00 EST
    const edge = Date.UTC(2026, 9, 21, 0); // 20 Oct 20:00 EDT: 30 local days before, 30 × 24 h + 1 h
    const rows = [at(edge - 1), at(edge), at(sessionStart - 1), at(sessionStart)];
    const b = baseline(rows, sessionStart);
    expect(b.matches).toBe(2);
  });

  test("nothing before the session: nulls", () => {
    const b = baseline([at(Date.UTC(2026, 10, 20, 2))], Date.UTC(2026, 10, 20, 1));
    expect(b.matches).toBe(0);
    expect(b.winPct).toBeNull();
  });
});
