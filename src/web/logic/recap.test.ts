import { describe, expect, test } from "vitest";
import type { AggregateWire, MyMatchWire } from "../../shared/schemas/responses";
import { isDense, letter, recapPath, resultWord, scoreFor, tilesFor, winPctDelta } from "./recap";

const agg = (over: Partial<AggregateWire>): AggregateWire => ({
  matches: 4, wins: 3, losses: 1, noResult: 0, winPct: 0.75, leftEarly: 0, mvps: 2,
  totals: { goals: 4, assists: 1, saves: 3, shots: 10, demos: 0, score: 1600 },
  perGame: { goals: 1, assists: 0.25, saves: 0.75, shots: 2.5, demos: 0, score: 400 },
  shootingPct: 0.4, bestWinStreak: 3, bestLossStreak: 1, endedOn: { result: "win", length: 2 },
  extrasMatches: 0, hardestShotKmh: null, fastestGoalKmh: null, woodworkHits: null, aerialTouches: null, boostAvg: null, supersonicShare: null, emptyBoostShare: null,
  statfeed: {},
  ...over,
});
const none = agg({ matches: 0, wins: null, losses: null, winPct: null, mvps: null, shootingPct: null, bestWinStreak: null, bestLossStreak: null, endedOn: null });

describe("winPctDelta", () => {
  test("points against the 30-day win %", () => {
    expect(winPctDelta(agg({}), agg({ winPct: 0.5 }))).toEqual({ points: 25, avg: 50 });
    expect(winPctDelta(agg({ winPct: 0.4 }), agg({ winPct: 0.523 }))).toEqual({ points: -12, avg: 52 });
  });

  test("nothing to compare: no baseline matches, or no decided match", () => {
    expect(winPctDelta(agg({}), none)).toBeNull();
    expect(winPctDelta(agg({ winPct: null }), agg({}))).toBeNull();
  });
});

test("a result's letter and word, a dash for no result", () => {
  expect([letter("win"), letter("loss"), letter(null)]).toEqual(["W", "L", "–"]);
  expect([resultWord("win"), resultWord("loss"), resultWord(null)]).toEqual(["win", "loss", "no result"]);
});

describe("tilesFor", () => {
  test("streak, ended on, shooting against the average, your MVPs", () => {
    expect(tilesFor(agg({}), agg({ shootingPct: 0.3 }))).toEqual([
      { id: "streak", label: "Best streak", value: "W3" },
      { id: "ended", label: "Ended on", value: "W2" },
      { id: "shooting", label: "Shooting", value: "40%", vs: { avg: "30%", dir: "up" } },
      { id: "mvps", label: "MVPs", value: "×2" },
    ]);
  });

  test("a tile with nothing to show is left out, never a zero", () => {
    expect(tilesFor(agg({ bestWinStreak: 0, mvps: 0, shootingPct: null, endedOn: { result: "loss", length: 4 } }), none)).toEqual([{ id: "ended", label: "Ended on", value: "L4" }]);
    expect(tilesFor(none, none)).toEqual([]);
  });

  test("shooting without a baseline has no comparison; level with it is 'same'", () => {
    expect(tilesFor(agg({}), none).find((t) => t.id === "shooting")).toEqual({ id: "shooting", label: "Shooting", value: "40%" });
    expect(tilesFor(agg({}), agg({ shootingPct: 0.401 })).find((t) => t.id === "shooting")?.vs).toEqual({ avg: "40%", dir: "same" });
  });
});

describe("scoreFor", () => {
  const m = (teamNum: number | null, s0: number | null, s1: number | null) => ({ scoreTeam0: s0, scoreTeam1: s1, me: teamNum === null ? null : { teamNum } }) as unknown as MyMatchWire;
  test("your team first", () => {
    expect(scoreFor(m(0, 3, 1))).toBe("3–1");
    expect(scoreFor(m(1, 3, 1))).toBe("1–3");
  });
  test("team 0 first when your team is unknown; nothing without a score", () => {
    expect(scoreFor(m(null, 2, 4))).toBe("2–4");
    expect(scoreFor(m(0, null, null))).toBeNull();
  });
});

test("match cards get dense above 24 matches", () => {
  expect(isDense(24)).toBe(false);
  expect(isDense(25)).toBe(true);
});

test("a session's path carries the filter only when it isn't the default", () => {
  expect(recapPath("ABC", "everything")).toBe("/recap/ABC");
  expect(recapPath("ABC", { playlist: 53 })).toBe("/recap/ABC?filter=53");
  expect(recapPath(null, "ranked")).toBe("/recap?filter=ranked");
});
