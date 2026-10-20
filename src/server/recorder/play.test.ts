import { describe, expect, test } from "vitest";
import { buildPlay } from "./play";
import type { StoredEvent } from "./store";
import type { MatchSummary, RosterEntry } from "./summary";

let seq = 0;
const at = (ts: number, name: string, data: Record<string, unknown> = {}): StoredEvent => ({ seq: seq++, ts, name, data });

// A (team 0) and B (team 1) are the default pair; C is A's teammate.
const PEOPLE = {
  A: { Name: "A", PrimaryId: "Epic|A|0", Shortcut: 1, TeamNum: 0 },
  B: { Name: "B", PrimaryId: "Epic|B|0", Shortcut: 2, TeamNum: 1 },
  C: { Name: "C", PrimaryId: "Epic|C|0", Shortcut: 3, TeamNum: 0 },
} as const;
type Who = keyof typeof PEOPLE;
const ref = (who: Who) => {
  const { Name, Shortcut, TeamNum } = PEOPLE[who];
  return { Name, Shortcut, TeamNum };
};
const key = (who: Who) => PEOPLE[who].PrimaryId;

const summary = (over: Partial<MatchSummary> = {}): Pick<MatchSummary, "roster" | "joinedInProgress"> => ({
  roster: Object.values(PEOPLE).map((p) => ({ key: p.PrimaryId, name: p.Name, teamNum: p.TeamNum }) as RosterEntry),
  joinedInProgress: false,
  ...over,
});

interface Car {
  boost?: number;
  supersonic?: boolean;
  hasCar?: boolean;
}
/** A state with A and C carrying car state (your team) and B without; `score` is the scoreboard. */
const state = (ts: number, cars: Partial<Record<Who, Car>> = { A: {} }, game: Record<string, unknown> = {}, score: [number, number] = [0, 0]) =>
  at(ts, "UpdateState", {
    Players: (Object.keys(PEOPLE) as Who[]).map((w) => {
      const car = cars[w];
      const p: Record<string, unknown> = { ...PEOPLE[w] };
      if (car && car.hasCar !== false) p.bHasCar = true;
      if (car?.boost) p.Boost = car.boost;
      if (car?.supersonic) p.bSupersonic = true;
      return p;
    }),
    Game: { Teams: [{ TeamNum: 0, Score: score[0] }, { TeamNum: 1, Score: score[1] }], ...game },
  });
const hit = (ts: number, who: Who[], speed = 50, loc = { X: 0, Y: 0, Z: 93 }) =>
  at(ts, "BallHit", { Players: who.map(ref), Ball: { PreHitSpeed: 0, PostHitSpeed: speed, Location: loc } });
const statfeed = (ts: number, eventName: string, who: Who) => at(ts, "StatfeedEvent", { EventName: eventName, MainTarget: ref(who) });
const goal = (ts: number, scorer: Who | null, last: Who, speed = 80, assister: Who | null = null) =>
  at(ts, "GoalScored", {
    GoalSpeed: speed,
    Scorer: scorer ? ref(scorer) : { Name: "", Shortcut: 0, TeamNum: 255 },
    Assister: assister ? ref(assister) : { Name: "", Shortcut: 0, TeamNum: 255 },
    BallLastTouch: { Player: ref(last), Speed: speed },
  });
const crossbar = (ts: number, who: Who) => at(ts, "CrossbarHit", { BallLocation: { X: 0, Y: 5000, Z: 600 }, BallLastTouch: { Player: ref(who), Speed: 60 } });

/** Each car's summed weight, boost-weighted sum and supersonic weight, by player key. */
function cars(events: StoredEvent[], s = summary()) {
  const out: Record<string, { ms: number; boostMs: number; superMs: number }> = {};
  for (const c of buildPlay(events, s).samples) {
    const o = (out[c.key] ??= { ms: 0, boostMs: 0, superMs: 0 });
    o.ms += c.weightMs;
    o.boostMs += c.boost * c.weightMs;
    if (c.supersonic) o.superMs += c.weightMs;
  }
  return out;
}

describe("buildPlay: phases and car samples", () => {
  test("samples count in play only: countdown, replay, pause and the end are left out", () => {
    const events = [
      at(0, "CountdownBegin"),
      state(100, { A: { boost: 10 } }),
      at(1000, "RoundStarted"),
      state(1000, { A: { boost: 20 } }),
      state(1500, { A: { boost: 40, supersonic: true } }),
      state(2000, { A: { boost: 40 } }),
      at(2100, "MatchPaused"),
      state(2200, { A: { boost: 90 } }),
      at(2300, "MatchUnpaused"),
      state(2400, { A: { boost: 60 } }),
      state(2900, { A: { boost: 60 } }),
      goal(3000, "A", "A"),
      state(3100, { A: { boost: 99 } }, { bReplay: true }),
      at(4000, "CountdownBegin"),
      state(4100, { A: { boost: 99 } }),
      at(5000, "RoundStarted"),
      state(5000, { A: {} }),
      state(5400, { A: {} }),
      at(5500, "MatchEnded"),
      state(5600, { A: { boost: 99 } }),
    ];
    // Stretches: 1000–2000 (pause ends it, its last state weighs 0), 2400–2900 (the goal ends it), 5000–5400.
    expect(cars(events)).toEqual({ [key("A")]: { ms: 1000 + 500 + 400, boostMs: 20 * 500 + 40 * 500 + 60 * 500, superMs: 500 } });
    expect(buildPlay(events, summary()).facts.playMs).toBe(1100 + 700 + 500);
  });

  test("a gap over the cap weighs the cap; a player without a car adds nothing", () => {
    const events = [at(0, "RoundStarted"), state(0, { A: { boost: 50 }, C: { hasCar: false } }), state(3000, { A: {} }), state(3500, { A: {} })];
    expect(cars(events)).toEqual({ [key("A")]: { ms: 1000 + 500, boostMs: 50 * 1000, superMs: 0 } });
  });

  test("joined in progress starts in play", () => {
    const events = [state(0, { A: { boost: 10 } }), state(500, { A: {} })];
    expect(cars(events, summary({ joinedInProgress: true }))).toEqual({ [key("A")]: { ms: 500, boostMs: 5000, superMs: 0 } });
    expect(cars(events)).toEqual({});
  });

  test("nothing after MatchEnded counts, even a RoundStarted", () => {
    const events = [at(0, "RoundStarted"), at(10, "MatchEnded"), at(20, "RoundStarted"), state(30, { A: {} }), state(530, { A: {} }), hit(600, ["A"])];
    const play = buildPlay(events, summary());
    expect(play.samples).toEqual([]);
    expect(play.touches).toEqual({});
  });

  test("a clock stepping back gives no negative time", () => {
    const events = [at(5000, "RoundStarted"), state(5000, { A: {} }), state(4000, { A: {} }), state(4500, { A: {} }), at(4600, "MatchEnded")];
    const play = buildPlay(events, summary());
    expect(play.samples.map((s) => s.weightMs)).toEqual([0, 500]);
    expect(play.facts.playMs).toBe(0);
  });
});

const touchCount = (events: StoredEvent[]) => Object.fromEntries(Object.entries(buildPlay(events, summary()).touches).map(([k, t]) => [k, t.length]));

describe("buildPlay: hits and touches", () => {
  test("every player a hit lists is a hitter, with the hit's speed and ball location", () => {
    const events = [at(0, "RoundStarted"), hit(100, ["A", "B"], 70, { X: 1, Y: 2, Z: 3 }), statfeed(200, "Shot", "A"), statfeed(300, "Shot", "B")];
    const play = buildPlay(events, summary());
    expect(play.touches).toEqual({ [key("A")]: [{ x: 1, y: 2, z: 3 }], [key("B")]: [{ x: 1, y: 2, z: 3 }] });
    expect(play.hardestShot).toEqual({ [key("A")]: 70, [key("B")]: 70 });
  });

  test("a player's hits within 1 s merge into one touch unless someone else touched in between", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"]),
      hit(300, ["A"]), // merged
      hit(1100, ["A"]), // 1 s after the counted one
      hit(1200, ["B"]),
      hit(1300, ["A"]), // B touched since
      hit(1400, ["A"]), // merged
    ];
    expect(touchCount(events)).toEqual({ [key("A")]: 3, [key("B")]: 1 });
  });

  test("hits outside play are ignored", () => {
    const events = [hit(0, ["A"]), at(10, "RoundStarted"), goal(20, "A", "A"), hit(30, ["A"]), at(40, "CountdownBegin"), hit(50, ["A"])];
    expect(touchCount(events)).toEqual({});
  });

  test("an unknown hitter is counted as unresolved and keeps its team", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 1 };
    const events = [at(0, "RoundStarted"), at(10, "BallHit", { Players: [stranger], Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 0 } } }), goal(20, "B", "B")];
    const play = buildPlay(events, summary());
    expect(play.facts.unresolved.hit).toBe(1);
    expect(play.touches).toEqual({});
    // Its team still makes it the goal's origin.
    expect(play.goals).toMatchObject([{ teamNum: 1, toucherKey: null, pos: { x: 0, y: 0, z: 0 }, ownGoal: false }]);
  });
});

describe("buildPlay: shots and woodwork", () => {
  test("a shot's speed is the shooter's last hit since the kickoff; a shot without one is counted", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"], 90),
      hit(200, ["B"], 40),
      statfeed(1500, "Shot", "A"), // arrives late, after B's touch
      statfeed(1600, "Shot", "C"), // C never touched
      goal(2000, "B", "B"),
      at(3000, "CountdownBegin"),
      at(4000, "RoundStarted"),
      statfeed(4100, "Shot", "A"), // A's touch was before this kickoff
    ];
    const play = buildPlay(events, summary());
    expect(play.hardestShot[key("A")]).toBe(90);
    expect(play.facts.shotsWithoutTouch).toBe(2);
  });

  test("woodwork counts once per second, in play only", () => {
    const events = [
      at(0, "RoundStarted"),
      crossbar(100, "A"),
      crossbar(600, "A"), // rolling along the bar
      crossbar(1200, "B"),
      goal(2000, "A", "A"),
      crossbar(2500, "A"), // the replay
    ];
    const play = buildPlay(events, summary());
    expect(play.woodwork).toEqual({ [key("A")]: 1, [key("B")]: 1 });
  });
});

const goalsOf = (events: StoredEvent[]) => buildPlay(events, summary()).goals;

describe("buildPlay: goals", () => {
  test("the origin is the scoring team's last touch; a later touch by the other team deflects it", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"], 95, { X: 300, Y: 1120, Z: 93 }),
      hit(200, ["B"], 60, { X: 0, Y: 4000, Z: 93 }),
      goal(300, "A", "B", 110, "C"),
    ];
    const play = buildPlay(events, summary());
    expect(play.goals).toEqual([
      {
        teamNum: 0,
        scorerKey: key("A"),
        assisterKey: key("C"),
        toucherKey: key("A"),
        pos: { x: 300, y: 1120, z: 93 },
        distance: Math.hypot(300, 4000), // 5120 − 1120
        speedKmh: 110,
        deflected: true,
        aerial: false,
        ownGoal: false,
      },
    ]);
    expect(play.hardestShot[key("A")]).toBe(95);
    expect(play.facts.lastTouchDisagrees).toBe(0);
  });

  test("a 50/50 origin isn't a deflection, and its scoring-team hitter is the toucher", () => {
    const [g] = goalsOf([at(0, "RoundStarted"), hit(100, ["B", "A"]), goal(200, "A", "A")]);
    expect(g).toMatchObject({ toucherKey: key("A"), deflected: false, ownGoal: false });
  });

  test("team 1 attacks −Y", () => {
    const [g] = goalsOf([at(0, "RoundStarted"), hit(100, ["B"], 50, { X: 0, Y: -1120, Z: 93 }), goal(200, "B", "B")]);
    expect(g).toMatchObject({ teamNum: 1, distance: 4000 });
  });

  test("no touch by the scoring team since the kickoff makes an own goal", () => {
    const [g] = goalsOf([at(0, "RoundStarted"), hit(100, ["A"]), at(200, "CountdownBegin"), at(300, "RoundStarted"), hit(400, ["B"]), goal(500, "A", "B")]);
    expect(g).toMatchObject({ teamNum: 0, toucherKey: null, pos: null, distance: null, deflected: false, ownGoal: true });
  });

  test("a goal whose scorer doesn't resolve gets no point, whatever the scoreboard says, and is counted", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 0 };
    const events = [
      at(0, "RoundStarted"),
      state(50, {}, {}, [0, 0]),
      hit(100, ["B"]),
      goal(200, null, "B"), // empty scorer
      state(300, {}, {}, [1, 0]),
      at(400, "RoundStarted"),
      hit(500, ["A"]),
      at(600, "GoalScored", { GoalSpeed: 80, Scorer: stranger, BallLastTouch: { Player: ref("A") } }), // not on the roster
      at(700, "RoundStarted"),
      hit(800, ["A"]),
      goal(900, "A", "A"),
    ];
    const play = buildPlay(events, summary());
    expect(play.goals).toMatchObject([{ teamNum: 0, scorerKey: key("A") }]);
    expect(play.facts.droppedGoals).toBe(2);
  });

  test("a hit's players entry that isn't an object is counted unresolved, but isn't a hitter", () => {
    const hitBy = (ts: number, players: unknown[]) => at(ts, "BallHit", { Players: players, Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 0 } } });
    const play = buildPlay([at(0, "RoundStarted"), hitBy(100, [null, ref("A")]), hitBy(150, [null]), goal(200, "A", "A")], summary());
    expect(Object.keys(play.touches)).toEqual([key("A")]);
    expect(play.facts.unresolved.hit).toBe(2);
    // A kept null entry after the origin would be a team-less hitter, i.e. a deflection.
    expect(play.goals[0]?.deflected).toBe(false);
  });

  test("a dropped goal still checks the game's last touch against the hits", () => {
    const disagrees = buildPlay([at(0, "RoundStarted"), hit(100, ["A"]), goal(200, null, "B")], summary());
    expect(disagrees.facts).toMatchObject({ droppedGoals: 1, lastTouchDisagrees: 1 });
    const agrees = buildPlay([at(0, "RoundStarted"), hit(100, ["A"]), goal(200, null, "A")], summary());
    expect(agrees.facts).toMatchObject({ droppedGoals: 1, lastTouchDisagrees: 0 });
  });

  test("a goal's last touch is compared only when both it and the last hit are known", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 0 };
    const hitBy = (ts: number, players: unknown[]) => at(ts, "BallHit", { Players: players, Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 0 } } });
    const disagreements = (events: StoredEvent[], joinedInProgress = false) => buildPlay(events, summary({ joinedInProgress })).facts.lastTouchDisagrees;
    // Unknown: the game's last touch doesn't resolve, or is missing; the last hitter doesn't resolve,
    // or the last hit names nobody; joined in progress, no hit seen yet.
    expect(disagreements([at(0, "RoundStarted"), hit(100, ["A"]), at(200, "GoalScored", { Scorer: ref("A"), BallLastTouch: { Player: stranger } })])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hit(100, ["A"]), at(200, "GoalScored", { Scorer: ref("A") })])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hitBy(100, [stranger]), goal(200, "A", "A")])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hitBy(100, [null]), goal(200, "A", "A")])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hitBy(100, [ref("A"), null]), goal(200, "A", "B")])).toBe(0);
    expect(disagreements([goal(200, "A", "A")], true)).toBe(0);
    // Known: from a seen kickoff with no hit since, or joined in progress with a hit seen.
    expect(disagreements([at(0, "RoundStarted"), goal(200, "A", "A")])).toBe(1);
    expect(disagreements([hit(100, ["A"]), goal(200, "A", "B")], true)).toBe(1);
  });

  test("a reference naming a player off the roster is counted unresolved, by kind; a missing one isn't", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 0 };
    const kickoff = (ts: number, rest: StoredEvent[]) => [at(ts, "RoundStarted"), hit(ts + 100, ["A"]), ...rest];
    const events = [
      ...kickoff(0, [
        at(200, "StatfeedEvent", { EventName: "Shot", MainTarget: stranger }),
        at(250, "CrossbarHit", { BallLastTouch: { Player: stranger } }),
        at(300, "GoalScored", { Scorer: ref("A"), BallLastTouch: { Player: stranger } }),
      ]),
      // Kickoffs 5 s apart, clear of the woodwork window.
      ...kickoff(5000, [
        at(5200, "StatfeedEvent", { EventName: "Shot" }),
        at(5250, "CrossbarHit", {}),
        at(5300, "GoalScored", { Scorer: ref("A") }),
      ]),
      ...kickoff(10_000, [
        at(10_200, "StatfeedEvent", { EventName: "Shot", MainTarget: "Z" }),
        at(10_250, "CrossbarHit", { BallLastTouch: { Player: "Z" } }),
        at(10_300, "GoalScored", { Scorer: ref("A"), BallLastTouch: { Player: "Z" } }),
      ]),
    ];
    const { facts } = buildPlay(events, summary());
    expect(facts.unresolved).toEqual({ hit: 0, woodwork: 1, shot: 1, lastTouch: 1 });
    expect(facts.lastTouchDisagrees).toBe(0);
  });

  test("joined in progress, a goal before the first kickoff without a scoring-team hit isn't an own goal", () => {
    const events = [hit(100, ["B"]), goal(200, "A", "B")];
    const [g] = buildPlay(events, summary({ joinedInProgress: true })).goals;
    expect(g).toMatchObject({ teamNum: 0, toucherKey: null, pos: null, ownGoal: false });
  });

  test("an AerialGoal statfeed marks the scorer's next goal aerial, once", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"]),
      statfeed(150, "AerialGoal", "A"),
      goal(200, "A", "A"),
      at(300, "RoundStarted"),
      hit(400, ["A"]),
      goal(500, "A", "A"),
    ];
    expect(goalsOf(events).map((g) => g.aerial)).toEqual([true, false]);
  });

  test("a last touch the hits don't show is counted", () => {
    const play = buildPlay([at(0, "RoundStarted"), hit(100, ["A"]), goal(200, "A", "C")], summary());
    expect(play.facts.lastTouchDisagrees).toBe(1);
  });
});
