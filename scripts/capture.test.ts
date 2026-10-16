import { describe, expect, test } from "bun:test";
import { createUpdateStateSampler, eventNameOf, matchGuidOf } from "./capture";

describe("eventNameOf", () => {
  test("returns the Event of a real envelope line", () => {
    const frame = '{"Event":"MatchEnded","Data":"{\\"WinnerTeamNum\\":1}"}';
    expect(eventNameOf(frame)).toBe("MatchEnded");
  });

  test("returns null for junk", () => {
    expect(eventNameOf("not json")).toBeNull();
    expect(eventNameOf("[1,2]")).toBeNull();
    expect(eventNameOf('{"Data":{}}')).toBeNull();
  });
});

const state = (t: number) => ({ t, raw: `state@${t}`, event: "UpdateState" });
const other = (t: number, event: string | null = "GoalScored") => ({ t, raw: `${event}@${t}`, event });

describe("matchGuidOf", () => {
  test("reads MatchGuid from the nested Data string", () => {
    expect(matchGuidOf('{"Event":"MatchDestroyed","Data":"{\\"MatchGuid\\":\\"89C6\\"}"}')).toBe("89C6");
  });

  test("returns null when Data is missing or not JSON", () => {
    expect(matchGuidOf('{"Event":"MatchDestroyed"}')).toBeNull();
    expect(matchGuidOf("not json")).toBeNull();
  });
});

describe("createUpdateStateSampler", () => {
  test("keeps every non-UpdateState line, even in a burst", () => {
    const s = createUpdateStateSampler(500);
    expect(s.offer(other(0))).toEqual([other(0)]);
    expect(s.offer(other(1, "BallHit"))).toEqual([other(1, "BallHit")]);
    expect(s.offer(other(2, null))).toEqual([other(2, null)]);
  });

  test("keeps the first UpdateState, holds one 34 ms later, keeps one at exactly 500 ms", () => {
    const s = createUpdateStateSampler(500);
    expect(s.offer(state(1000))).toEqual([state(1000)]);
    expect(s.offer(state(1034))).toEqual([]);
    expect(s.offer(state(1500))).toEqual([state(1500)]);
  });

  test("writes the held UpdateState just before the next non-UpdateState line", () => {
    const s = createUpdateStateSampler(500);
    s.offer(state(0));
    s.offer(state(34));
    s.offer(state(68));
    expect(s.offer(other(80, "MatchEnded"))).toEqual([state(68), other(80, "MatchEnded")]);
    // already written, so not repeated before the next event
    expect(s.offer(other(90, "MatchDestroyed"))).toEqual([other(90, "MatchDestroyed")]);
  });

  test("holds nothing right after a kept UpdateState", () => {
    const s = createUpdateStateSampler(500);
    s.offer(state(0));
    expect(s.offer(other(10))).toEqual([other(10)]);
    expect(s.flush()).toBeNull();
  });

  test("flush returns the held UpdateState once, then nothing", () => {
    const s = createUpdateStateSampler(500);
    s.offer(state(0));
    s.offer(state(34));
    expect(s.flush()).toEqual(state(34));
    expect(s.flush()).toBeNull();
  });

  test("a newer kept UpdateState replaces the held one, so a stale state is never written", () => {
    const s = createUpdateStateSampler(500);
    s.offer(state(0));
    s.offer(state(300));
    s.offer(state(500));
    expect(s.offer(other(510))).toEqual([other(510)]);
  });

  test("writing a held UpdateState restarts the interval", () => {
    const s = createUpdateStateSampler(500);
    s.offer(state(0));
    s.offer(state(300));
    expect(s.offer(other(310, "ClockUpdatedSeconds"))).toEqual([state(300), other(310, "ClockUpdatedSeconds")]);
    expect(s.offer(state(600))).toEqual([]);
    expect(s.offer(state(800))).toEqual([state(800)]);
  });

  test("keeps an UpdateState when the clock has stepped backwards", () => {
    const s = createUpdateStateSampler(500);
    s.offer(state(10_000));
    expect(s.offer(state(5_000))).toEqual([state(5_000)]);
  });

  test("a 30/s stream with a clock event every second still writes about 2 states/s", () => {
    const s = createUpdateStateSampler(500);
    let states = 0;
    for (let i = 0; i < 300; i++) {
      const t = Math.round(i * (1000 / 30));
      const lines = i % 30 === 20 ? s.offer(other(t, "ClockUpdatedSeconds")) : s.offer(state(t));
      states += lines.filter((l) => l.event === "UpdateState").length;
    }
    expect(states).toBeLessThanOrEqual(22);
  });

  test("a 30/s stream over 10 s keeps about 2/s", () => {
    const s = createUpdateStateSampler(500);
    let kept = 0;
    for (let i = 0; i < 300; i++) kept += s.offer(state(Math.round(i * (1000 / 30)))).length;
    expect(kept).toBeGreaterThanOrEqual(19);
    expect(kept).toBeLessThanOrEqual(21);
  });
});
