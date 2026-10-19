import { describe, expect, test } from "vitest";
import { dedupe } from "./dedup";
import type { StoredEvent } from "./store";

let seq = 0;
const ev = (name: string, data: Record<string, unknown> = {}): StoredEvent => ({ seq: seq++, ts: seq, name, data });

const liveGoal = (scorer = "P1") => ev("GoalScored", { Scorer: { Name: scorer }, GoalSpeed: 120.5, GoalTime: 12 });
const replayGoal = () => ev("GoalScored", { Scorer: { Name: "" }, GoalSpeed: 0, GoalTime: 0 });
const crossbar = (x: number) => ev("CrossbarHit", { BallLocation: { X: x }, BallSpeed: 50, ImpactForce: 3 });
const ballHit = (x: number) => ev("BallHit", { Players: [{ Name: "P1" }], Ball: { Location: { X: x } } });

describe("dedupe", () => {
  test("drops the replay GoalScored (blank scorer, zero speed and time) and keeps live goals", () => {
    const events = [liveGoal(), ev("GoalReplayStart"), replayGoal(), liveGoal("P2")];
    const { kept, dropped } = dedupe(events);
    expect(kept).toEqual([events[0], events[1], events[3]]);
    expect(dropped).toEqual({ replay_goal: 1 });
  });

  test("a blank scorer with a real speed is kept: all three markers must agree", () => {
    const odd = ev("GoalScored", { Scorer: { Name: "" }, GoalSpeed: 80, GoalTime: 0 });
    expect(dedupe([odd]).kept).toEqual([odd]);
  });

  test("drops a CrossbarHit identical to the previous one, even with a state in between", () => {
    const events = [crossbar(1), ev("UpdateState"), crossbar(1), crossbar(2), crossbar(1)];
    const { kept, dropped } = dedupe(events);
    expect(kept).toEqual([events[0], events[1], events[3], events[4]]);
    expect(dropped).toEqual({ repeat_crossbar: 1 });
  });

  test("drops a BallHit identical to the previous one", () => {
    const events = [ballHit(1), ballHit(1), ballHit(1), ballHit(3)];
    expect(dedupe(events)).toEqual({ kept: [events[0], events[3]], dropped: { repeat_ballhit: 2 } });
  });

  test("keeps everything when nothing repeats", () => {
    const events = [ev("MatchCreated"), ev("RoundStarted"), ev("RoundStarted"), liveGoal()];
    expect(dedupe(events)).toEqual({ kept: events, dropped: {} });
  });
});
