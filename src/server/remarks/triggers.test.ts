import { describe, expect, test } from "vitest";
import { aggregate, type MyMatch, type MyRow } from "../../shared/aggregate";
import { TRIGGERS, type TriggerId } from "./copy";
import { moodOf, triggersFor, type SessionFacts } from "./triggers";

const ME = "Epic|me|0";
const HOUR = 3_600_000;
const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).getTime();

const me = (over: Partial<MyRow> = {}): MyRow => ({
  playerKey: ME,
  teamNum: 0,
  score: 300,
  goals: 1,
  shots: 2,
  assists: 0,
  saves: 1,
  demos: 0,
  touches: 20,
  hardestShotKmh: 100,
  woodworkHits: 0,
  aerialTouches: 0,
  carMs: 300_000,
  boostAvg: 40,
  supersonicMs: 0,
  emptyBoostMs: 0,
  ...over,
});

let seq = 0;
/** A 2-1 win for team 0 (you), with nothing remarkable in it. */
const match = (over: Partial<MyMatch> = {}, row: Partial<MyRow> = {}): MyMatch => {
  seq += 1;
  return {
    guid: `G${String(seq)}`,
    startedAt: at(20) + seq * 600_000,
    endedAt: at(20) + seq * 600_000 + 300_000,
    playlistId: 11,
    arena: null,
    endKind: "completed",
    closedVia: "destroyed",
    overtime: false,
    scoreTeam0: 2,
    scoreTeam1: 1,
    winnerTeamNum: 0,
    mvpKey: null,
    flags: [],
    me: me(row),
    result: "win",
    goals: [],
    statfeed: {},
    ...over,
  };
};
const loss = (over: Partial<MyMatch> = {}, row: Partial<MyRow> = {}) => match({ result: "loss", winnerTeamNum: 1, scoreTeam0: 1, scoreTeam1: 2, ...over }, row);

/** A 1-hour evening session ending at 21:00 over these matches. */
const facts = (matches: MyMatch[], over: Partial<SessionFacts> = {}): SessionFacts => ({ startedAt: at(20), endedAt: at(21), matches, aggregate: aggregate(matches), ...over });
const fired = (f: SessionFacts) => triggersFor(f).map((t) => t.id);
const firedOne = (f: SessionFacts, id: TriggerId) => triggersFor(f).find((t) => t.id === id);

const wl = (w: number, l: number) => ({ wins: w, losses: l });

describe("moodOf", () => {
  test("under 4 decided matches is the short set, unjudged", () => {
    expect(moodOf(wl(3, 0), { winPct: 0.1 })).toEqual({ band: "short", z: null, n: 3 });
  });

  test("4 matches with one undecided is still short: z counts decided matches", () => {
    const ms = [match(), match(), match(), match({ result: null, winnerTeamNum: null })];
    expect(moodOf(aggregate(ms), { winPct: 0.5 }).band).toBe("short");
  });

  // n = 4 gives a standard error of 25 points, so these land exactly on the edges.
  test.each([
    [3, 1, 0.625, 0.5, "good"],
    [4, 0, 0.625, 1.5, "great"],
    [1, 3, 0.375, -0.5, "rough"],
    [0, 4, 0.375, -1.5, "disaster"],
  ] as const)("%i-%i against %f is z %f: %s", (w, l, base, z, band) => {
    expect(moodOf(wl(w, l), { winPct: base })).toEqual({ band, z, n: 4 });
  });

  test("just inside the edges", () => {
    expect(moodOf(wl(3, 1), { winPct: 0.626 }).band).toBe("usual");
    expect(moodOf(wl(4, 0), { winPct: 0.626 }).band).toBe("good");
    expect(moodOf(wl(1, 3), { winPct: 0.374 }).band).toBe("usual");
    expect(moodOf(wl(0, 4), { winPct: 0.374 }).band).toBe("rough");
  });

  test("with no baseline it compares against 50 %", () => {
    expect(moodOf(wl(4, 0), { winPct: null })).toEqual({ band: "great", z: 2, n: 4 });
    expect(moodOf(wl(2, 2), { winPct: null })).toEqual({ band: "usual", z: 0, n: 4 });
  });
});

describe("triggersFor", () => {
  test("a plain session fires nothing", () => {
    expect(fired(facts([match(), match()]))).toEqual([]);
  });

  test("statfeed legends and rares fire with their counts", () => {
    const f = facts([match({ statfeed: { HatTrick: 1, Savior: 1, EpicSave: 1 } }), match({ statfeed: { EpicSave: 1 } })]);
    expect(firedOne(f, "hat_trick")?.values).toEqual({ n: 1 });
    expect(firedOne(f, "savior")?.values).toEqual({ n: 1 });
    expect(firedOne(f, "epic_saves")?.values).toEqual({ n: 2 });
    expect(fired(facts([match({ statfeed: { EpicSave: 1 } })]))).toEqual([]);
  });

  test("aerial or long names the kinds that fired", () => {
    expect(firedOne(facts([match({ statfeed: { AerialGoal: 1 } })]), "aerial_or_long")?.kinds).toEqual(["aerial"]);
    expect(firedOne(facts([match({ statfeed: { LongGoal: 2 } })]), "aerial_or_long")?.kinds).toEqual(["long"]);
    expect(firedOne(facts([match({ statfeed: { AerialGoal: 1, LongGoal: 1 } })]), "aerial_or_long")?.kinds).toEqual(["aerial", "long"]);
  });

  test("overtime wins and losses count separately", () => {
    const f = facts([match({ overtime: true }), loss({ overtime: true }), loss({ overtime: true }), match()]);
    expect(firedOne(f, "ot_wins")?.values).toEqual({ n: 1 });
    expect(firedOne(f, "ot_losses")?.values).toEqual({ n: 2 });
  });

  test("an MVP haul needs 3 and 40 % of matches", () => {
    const mvp = () => match({ mvpKey: ME });
    expect(firedOne(facts([mvp(), mvp(), mvp(), match(), match(), match(), match()]), "mvp_haul")?.values).toEqual({ n: 3 });
    expect(fired(facts([mvp(), mvp(), mvp(), match(), match(), match(), match(), match()]))).not.toContain("mvp_haul");
    expect(fired(facts([mvp(), mvp()]))).not.toContain("mvp_haul");
  });

  test("a hard shot fires at 130 km/h, rounded", () => {
    expect(firedOne(facts([match({}, { hardestShotKmh: 130 })]), "hard_shot")?.values).toEqual({ speed: 130 });
    expect(firedOne(facts([match({}, { hardestShotKmh: 141.6 })]), "hard_shot")?.values).toEqual({ speed: 142 });
    expect(fired(facts([match({}, { hardestShotKmh: 129.9 })]))).not.toContain("hard_shot");
  });

  test("shut out counts matches where your team scored 0, skipping unknown team or score", () => {
    const f = facts([
      loss({ scoreTeam0: 0, scoreTeam1: 3 }),
      match({ scoreTeam0: 0, scoreTeam1: 2, winnerTeamNum: 1 }, { teamNum: 1 }),
      loss({ scoreTeam0: null, scoreTeam1: null }),
      loss({ scoreTeam0: 0, scoreTeam1: 1 }, { teamNum: null }),
    ]);
    expect(firedOne(f, "shut_out")?.values).toEqual({ n: 1 });
    expect(fired(facts([match()]))).not.toContain("shut_out");
  });

  test("streaks fire at 3", () => {
    expect(firedOne(facts([match(), match(), match()]), "win_streak")?.values).toEqual({ n: 3 });
    expect(fired(facts([match(), match(), loss()]))).not.toContain("win_streak");
    expect(firedOne(facts([loss(), loss(), loss()]), "loss_streak")?.values).toEqual({ n: 3 });
  });

  test("ended on a win needs an earlier loss", () => {
    expect(fired(facts([loss(), match()]))).toContain("ended_win");
    expect(fired(facts([match(), match()]))).not.toContain("ended_win");
  });

  test("ended on a loss, unless the end is itself a 3-loss streak", () => {
    expect(fired(facts([match(), loss(), loss()]))).toContain("ended_loss");
    expect(fired(facts([match(), loss(), loss(), loss()]))).not.toContain("ended_loss");
  });

  test("demos given and crossbars", () => {
    expect(firedOne(facts([match({}, { demos: 3 }), match({}, { demos: 2 })]), "demos_given")?.values).toEqual({ n: 5 });
    expect(fired(facts([match({}, { demos: 4 })]))).not.toContain("demos_given");
    expect(firedOne(facts([match({}, { woodworkHits: 2 })]), "crossbar")?.values).toEqual({ n: 2 });
    expect(fired(facts([match({}, { woodworkHits: 1 })]))).not.toContain("crossbar");
  });

  test("a marathon is 3 hours of session, whatever the filter shows", () => {
    expect(firedOne(facts([match()], { startedAt: at(18), endedAt: at(21, 40) }), "marathon")?.values).toEqual({ hours: 4 });
    expect(fired(facts([match()], { startedAt: at(18), endedAt: at(20, 59) }))).not.toContain("marathon");
  });

  test("late night is a session ending from 01:00 up to 06:00", () => {
    const end = (h: number, m = 0) => facts([match()], { startedAt: at(h) - HOUR, endedAt: at(h, m) });
    expect(firedOne(end(1), "late_night")?.values).toEqual({ time: at(1) });
    expect(fired(end(5, 59))).toContain("late_night");
    expect(fired(end(0, 59))).not.toContain("late_night");
    expect(fired(end(6))).not.toContain("late_night");
  });

  test("inert triggers never fire, however much happened", () => {
    const wild = { HatTrick: 3, Savior: 3, EpicSave: 9, AerialGoal: 3, LongGoal: 3, BicycleHit: 9, BicycleGoal: 9, Demolish: 9 };
    const ms = [loss({ overtime: true, statfeed: wild }, { demos: 9, woodworkHits: 9 }), loss(), loss(), match({ overtime: true, mvpKey: ME }), match({ mvpKey: ME }), match({ mvpKey: ME })];
    const ids = fired(facts(ms, { startedAt: at(1) - 4 * HOUR, endedAt: at(2) }));
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(TRIGGERS[id].inert).toBeUndefined();
  });
});
