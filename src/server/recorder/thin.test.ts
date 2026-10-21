import { describe, expect, test } from "vitest";
import { GAME, PLAYER } from "./known-fields";
import type { StoredEvent } from "./store";
import { DENSE_OR_UNREAD, GAME_FIELDS, PLAYER_FIELDS, statesToDrop } from "./thin";

let seq = 0;
const ev = (name: string, data: Record<string, unknown> = {}): StoredEvent => ({ seq: seq++, ts: seq * 500, name, data });

const player = (over: Record<string, unknown> = {}) => ({
  Name: "A",
  PrimaryId: "Epic|A|0",
  Shortcut: 1,
  TeamNum: 0,
  Score: 0,
  Goals: 0,
  Shots: 0,
  Assists: 0,
  Saves: 0,
  Touches: 0,
  Demos: 0,
  Boost: 33,
  bSupersonic: false,
  ...over,
});
const game = (over: Record<string, unknown> = {}) => ({
  Teams: [{ TeamNum: 0, Score: 0 }, { TeamNum: 1, Score: 0 }],
  PlaylistId: 13,
  Arena: "cs_p",
  bOvertime: false,
  TimeSeconds: 300,
  bReplay: false,
  bHasTarget: true,
  Target: { Name: "A", Shortcut: 1, TeamNum: 0 },
  Ball: { Speed: 0 },
  ...over,
});
const state = (p: Record<string, unknown> = {}, g: Record<string, unknown> = {}) => ev("UpdateState", { Players: [player(p)], Game: game(g) });

/** First state, `middle`, last state: the seqs dropped among the middle ones. */
function dropped(...middle: StoredEvent[]): number[] {
  const events = [state(), ...middle, state({ Boost: 1 }, { TimeSeconds: 1 })];
  return statesToDrop(events);
}

describe("statesToDrop", () => {
  test("a state that changes only dense or unread fields is dropped", () => {
    const a = state({ Boost: 80, bSupersonic: true }, { Target: { Name: "B" }, Ball: { Speed: 9 }, bReplay: true, bHasTarget: false });
    expect(dropped(a)).toEqual([a.seq]);
  });

  test.each([
    ["Name", { Name: "A2" }],
    ["PrimaryId", { PrimaryId: "Epic|X|0" }],
    ["Shortcut", { Shortcut: 2 }],
    ["TeamNum", { TeamNum: 1 }],
    ["Score", { Score: 100 }],
    ["Goals", { Goals: 1 }],
    ["Shots", { Shots: 1 }],
    ["Assists", { Assists: 1 }],
    ["Saves", { Saves: 1 }],
    ["Touches", { Touches: 1 }],
    ["Demos", { Demos: 1 }],
  ])("a change to a player's %s keeps the state", (_, change) => {
    expect(dropped(state(change))).toEqual([]);
  });

  test.each([
    ["the score", { Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 0 }] }],
    ["PlaylistId", { PlaylistId: 10 }],
    ["Arena", { Arena: "x" }],
    ["bOvertime", { bOvertime: true }],
  ])("a change to %s keeps the state", (_, change) => {
    expect(dropped(state({}, change))).toEqual([]);
  });

  test("a player joining or leaving keeps the state", () => {
    const joined = ev("UpdateState", { Players: [player(), player({ Name: "B", PrimaryId: "Epic|B|0", Shortcut: 2 })], Game: game() });
    const left = ev("UpdateState", { Players: [player()], Game: game() });
    expect(dropped(joined, left)).toEqual([]);
  });

  test("a missing scoreboard and an incomplete one are told apart", () => {
    const missing = state({}, { Teams: undefined });
    const partial = state({}, { Teams: [{ TeamNum: 0, Score: 0 }] });
    const empty = state({}, { Teams: [] });
    const missingAgain = state({}, { Teams: "nope" });
    expect(dropped(missing, partial, empty, missingAgain)).toEqual([]);
  });

  test("a missing field and an undefined one compare equal", () => {
    const a = ev("UpdateState", { Players: [player({ Demos: undefined })], Game: game() });
    const b = ev("UpdateState", { Players: [Object.fromEntries(Object.entries(player()).filter(([k]) => k !== "Demos"))], Game: game() });
    expect(dropped(a, b)).toEqual([b.seq]);
  });

  test("a clock reading that isn't the running clock keeps the state, from any event", () => {
    const tick = state({}, { TimeSeconds: 299 });
    const same = state({}, { TimeSeconds: 299 });
    const clock = ev("ClockUpdatedSeconds", { TimeSeconds: 298, bOvertime: false });
    const caughtUp = state({}, { TimeSeconds: 298 });
    const back = state({}, { TimeSeconds: 297 });
    expect(dropped(tick, same, clock, caughtUp, back)).toEqual([same.seq, caughtUp.seq]);
  });

  test("a non-numeric clock reading neither keeps the state nor moves the running clock", () => {
    const bad = state({}, { TimeSeconds: "x" });
    const sameAsBefore = state({}, { TimeSeconds: 300 });
    const nullClock = ev("ClockUpdatedSeconds", { TimeSeconds: null });
    const stillSame = state({}, { TimeSeconds: 300 });
    expect(dropped(bad, sameAsBefore, nullClock, stillSame)).toEqual([bad.seq, sameAsBefore.seq, stillSame.seq]);
  });

  test("compares with the previous original state, not the previous kept one", () => {
    // Each differs from the first only in dense fields, so only the first and last stay.
    const a1 = state({ Boost: 50 });
    const a2 = state({ Boost: 60 });
    const a3 = state({ Boost: 70 });
    expect(dropped(a1, a2, a3)).toEqual([a1.seq, a2.seq, a3.seq]);
    // A revert to an earlier value is a change from the state just before it.
    const up = state({ Goals: 1 });
    const down = state({ Goals: 0 });
    expect(dropped(up, down)).toEqual([]);
  });

  test("the first and last states are kept, and other events are never dropped", () => {
    const first = state();
    const goal = ev("GoalScored", { Scorer: { Name: "A" } });
    const last = state();
    expect(statesToDrop([first, goal, last])).toEqual([]);
    expect(statesToDrop([state()])).toEqual([]);
    expect(statesToDrop([])).toEqual([]);
  });
});

describe("thinning fields", () => {
  test("every known Game and player field is projected or listed as dense or unread", () => {
    expect([...GAME].filter((f) => !GAME_FIELDS.includes(f) && !DENSE_OR_UNREAD.game.includes(f))).toEqual([]);
    expect([...PLAYER].filter((f) => !PLAYER_FIELDS.includes(f) && !DENSE_OR_UNREAD.player.includes(f))).toEqual([]);
  });
});
