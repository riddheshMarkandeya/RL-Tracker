import { describe, expect, test } from "vitest";
import type { Goal, MyMatchWire } from "../../shared/schemas/responses";
import { goalMarks, goalSummary, MAP_H, MAP_W, markScale, toScreen } from "./goal-map";

const match = (guid: string, teamNum: number | null, playerKey = "me") => ({ guid, me: { playerKey, teamNum } }) as unknown as MyMatchWire;
let idx = 0;
const goal = (matchGuid: string, over: Partial<Goal>): Goal => ({
  matchGuid,
  idx: idx++,
  teamNum: 0,
  scorerKey: "me",
  assisterKey: null,
  toucherKey: "me",
  pos: { x: 0, y: 4000, z: 93 },
  distance: 1200,
  speedKmh: 112.4,
  deflected: false,
  aerial: false,
  ownGoal: false,
  ...over,
});

test("the map keeps the pitch's proportions", () => {
  expect([MAP_W, MAP_H]).toEqual([560, 448]);
});

describe("toScreen", () => {
  test("your goal is on the left for either team", () => {
    expect(toScreen({ x: 0, y: -5120 }, 0)).toEqual({ x: 0, y: 224 });
    expect(toScreen({ x: 0, y: 5120 }, 1)).toEqual({ x: 0, y: 224 });
    expect(toScreen({ x: 0, y: 5120 }, 0)).toEqual({ x: 560, y: 224 });
  });
  test("team 1 is turned half a circle, not mirrored", () => {
    expect(toScreen({ x: 4096, y: 0 }, 0)).toEqual({ x: 280, y: 0 });
    expect(toScreen({ x: 4096, y: 0 }, 1)).toEqual({ x: 280, y: 448 });
  });
  test("a touch inside the goal mouth is drawn on the goal line", () => {
    expect(toScreen({ x: 0, y: 5173 }, 0).x).toBe(560);
    expect(toScreen({ x: 0, y: -5173 }, 1).x).toBe(560);
  });
});

describe("goalMarks", () => {
  test("a mark per placed goal: side, yours or a teammate's, and its title", () => {
    const ms = [match("a", 0), match("b", 1)];
    const { marks, skipped } = goalMarks(ms, [
      goal("a", {}),
      goal("a", { scorerKey: "mate", deflected: true, speedKmh: null }),
      goal("b", { teamNum: 0, scorerKey: "opp", pos: { x: 0, y: -2000, z: 700 }, distance: 7120, aerial: true, deflected: true }),
    ]);
    expect(skipped).toEqual([]);
    expect(marks.map((m) => [m.matchGuid, m.side, m.yours, m.aerial, m.deflected])).toEqual([
      ["a", "scored", true, false, false],
      ["a", "scored", false, false, true],
      ["b", "conceded", false, true, true],
    ]);
    expect(marks.map((m) => m.title)).toEqual([
      "Match 1 · your goal · 112 km/h · 12 m out",
      "Match 1 · a teammate's goal · 12 m out · an opponent touched it last",
      "Match 2 · conceded · 112 km/h · 71 m out · aerial, 7 m up · your team touched it last",
    ]);
  });

  test("own goals and unplaced goals get no mark", () => {
    const { marks } = goalMarks([match("a", 0)], [goal("a", { ownGoal: true, pos: null, distance: null }), goal("a", { pos: null, distance: null })]);
    expect(marks).toEqual([]);
  });

  test("a match with no team for you is skipped, with its goal count", () => {
    const { marks, skipped } = goalMarks([match("a", null), match("b", 0)], [goal("a", {}), goal("a", {}), goal("b", {})]);
    expect(marks.map((m) => m.key.split(":")[0])).toEqual(["b"]);
    expect(skipped).toEqual([{ guid: "a", goals: 2 }]);
  });
});

describe("goalSummary", () => {
  test("ranges over placed goals; own and unplaced goals counted apart; totals include them", () => {
    const s = goalSummary([match("a", 0)], [
      goal("a", { distance: 2559 }),
      goal("a", { distance: 2560, aerial: true }),
      goal("a", { distance: 5120, scorerKey: "mate" }),
      goal("a", { scorerKey: "opp", ownGoal: true, pos: null, distance: null }),
      goal("a", { pos: null, distance: null }),
      goal("a", { teamNum: 1, scorerKey: "opp", distance: 900 }),
      goal("a", { teamNum: 1, scorerKey: "me", ownGoal: true, pos: null, distance: null }),
    ]);
    expect(s).toEqual({
      scored: { total: 5, close: 1, mid: 1, long: 1, aerial: 1, ownGoals: 1, unplaced: 1 },
      conceded: { total: 2, close: 1, mid: 0, long: 0, aerial: 0, ownGoals: 1, unplaced: 0 },
      yours: 3,
    });
  });

  test("a skipped match counts on neither side", () => {
    expect(goalSummary([match("a", null)], [goal("a", {})]).scored.total).toBe(0);
  });
});

test("marks shrink past 60 goals", () => {
  expect([markScale(60), markScale(61)]).toEqual([1, 0.65]);
});
