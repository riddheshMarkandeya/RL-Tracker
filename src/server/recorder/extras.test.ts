import { describe, expect, test } from "vitest";
import { computeExtras, PLAYER_EXTRAS, playerExtras } from "./extras";
import { emptyPlay, type Play, type Pos } from "./play";
import type { RosterEntry } from "./summary";

const playOf = (over: Partial<Play> = {}): Play => ({ ...emptyPlay(), ...over });
const at = (x: number, y: number, z: number): Pos => ({ x, y, z });

describe("player extras", () => {
  test("an opponent without car state or shots has nulls for those, zeros for counts", () => {
    expect(playerExtras(playOf(), "B")).toEqual({
      hardest_shot_kmh: null,
      woodwork_hits: 0,
      aerial_touches: 0,
      car_ms: null,
      boost_avg: null,
      supersonic_ms: null,
      empty_boost_ms: null,
    });
  });

  test("hardest shot, woodwork and the car stats", () => {
    const play = playOf({
      hardestShot: { A: 140 },
      woodwork: { A: 2 },
      samples: [
        { key: "A", boost: 0, supersonic: false, weightMs: 500 },
        { key: "A", boost: 100, supersonic: true, weightMs: 1000 },
        { key: "A", boost: 40, supersonic: false, weightMs: 500 },
        { key: "B", boost: 77, supersonic: true, weightMs: 500 },
      ],
    });
    expect(playerExtras(play, "A")).toMatchObject({
      hardest_shot_kmh: 140,
      woodwork_hits: 2,
      car_ms: 2000,
      boost_avg: (0 * 500 + 100 * 1000 + 40 * 500) / 2000,
      supersonic_ms: 1000,
      empty_boost_ms: 500,
    });
  });

  test("a car with samples but no time weighs nothing: its average boost is null, not 0", () => {
    const play = playOf({ samples: [{ key: "A", boost: 60, supersonic: false, weightMs: 0 }] });
    expect(playerExtras(play, "A")).toMatchObject({ car_ms: 0, boost_avg: null });
  });

  test("aerial touches: high, and 300 uu off the side, back and corner walls", () => {
    const touches = [
      at(0, 0, 600), // aerial
      at(0, 0, 549), // too low
      at(3796, 0, 800), // at the side-wall limit
      at(3800, 0, 800), // wall ride
      at(0, 4821, 800), // backboard
      at(3000, 4640, 800), // |x|+|y| 7640: at the corner limit
      at(3001, 4640, 800), // corner
      at(-2000, -3000, 1500), // aerial, mirrored side
    ];
    expect(playerExtras(playOf({ touches: { A: touches } }), "A").aerial_touches).toBe(4);
  });

  test("every registry column is a snake_case name, once", () => {
    const cols = PLAYER_EXTRAS.map((e) => e.column);
    expect(new Set(cols).size).toBe(cols.length);
    for (const c of cols) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

test("computeExtras gives every roster player a row, and the match's goals", () => {
  const roster = [
    { key: "Epic|A|0", name: "A", teamNum: 0 },
    { key: "Epic|B|0", name: "B", teamNum: 1 },
  ] as RosterEntry[];
  const events = [
    { seq: 0, ts: 0, name: "RoundStarted", data: {} },
    { seq: 1, ts: 100, name: "BallHit", data: { Players: [{ Name: "A", Shortcut: 1, TeamNum: 0 }], Ball: { PostHitSpeed: 120, Location: { X: 0, Y: 0, Z: 93 } } } },
    { seq: 2, ts: 200, name: "GoalScored", data: { GoalSpeed: 100, Scorer: { Name: "A", Shortcut: 1, TeamNum: 0 }, BallLastTouch: { Player: { Name: "A", Shortcut: 1, TeamNum: 0 } } } },
  ];
  const x = computeExtras(events, { roster, joinedInProgress: false });
  expect(Object.keys(x.players)).toEqual(["Epic|A|0", "Epic|B|0"]);
  expect(x.players["Epic|A|0"]?.hardest_shot_kmh).toBe(120);
  expect(x.goals).toMatchObject([{ teamNum: 0, scorerKey: "Epic|A|0", distance: 5120, ownGoal: false }]);
});
