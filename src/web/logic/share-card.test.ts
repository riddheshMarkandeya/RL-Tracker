import { describe, expect, test } from "vitest";
import type { AggregateWire } from "../../shared/schemas/responses";
import { clock, dayLabel } from "./format";
import { formLine, shareCard, shareFilename, type ShareCardInput } from "./share-card";

const agg = (over: Partial<AggregateWire>): AggregateWire => ({
  matches: 4, wins: 3, losses: 1, noResult: 0, winPct: 0.75, leftEarly: 0, mvps: 2,
  totals: { goals: 4, assists: 1, saves: 3, shots: 10, demos: 2, score: 1600 },
  perGame: { goals: 1, assists: 0.25, saves: 0.75, shots: 2.5, demos: 0.5, score: 400 },
  shootingPct: 0.4, bestWinStreak: 3, bestLossStreak: 1, endedOn: { result: "win", length: 2 },
  extrasMatches: 0, hardestShotKmh: null, fastestGoalKmh: null, woodworkHits: null, aerialTouches: null, boostAvg: null, supersonicShare: null, emptyBoostShare: null,
  statfeed: {},
  ...over,
});
const noBaseline = agg({ matches: 0 });
const START = new Date(2026, 9, 27, 20, 10).getTime();
const input = (over: { aggregate?: Partial<AggregateWire>; baseline?: AggregateWire; current?: boolean } & Partial<Omit<ShareCardInput, "detail">> = {}): ShareCardInput => ({
  detail: { day: "2026-10-27", startedAt: START, endedAt: START + 155 * 60_000, current: over.current ?? false, aggregate: agg(over.aggregate ?? {}), baseline: over.baseline ?? noBaseline },
  summary: over.summary ?? { wins: 3, losses: 1, results: ["win", "win", "loss", "win"] },
  filter: over.filter ?? "everything",
  name: over.name === undefined ? "Ridd" : over.name,
  mood: over.mood === undefined ? "Tonight you were the ball's favorite." : over.mood,
});
const tiles = (i: ShareCardInput) => shareCard(i).tiles.map((t) => [t.label, t.value, t.sub]);

describe("formLine", () => {
  test("running wins minus losses from 0; no result keeps the level and is hollow", () => {
    // 100×50: x = 7 + 21.5i; levels 0,1,2,1,1 over −1..2, so y = 7 + (2 − level) × 12.
    const f = formLine(["win", "win", "loss", null], 100, 50);
    expect(f.points).toEqual([{ x: 7, y: 31 }, { x: 28.5, y: 19 }, { x: 50, y: 7 }, { x: 71.5, y: 19 }, { x: 93, y: 19 }]);
    expect(f.dots.map((d) => [d.x, d.y, d.kind])).toEqual([[28.5, 19, "win"], [50, 7, "win"], [71.5, 19, "loss"], [93, 19, "none"]]);
    expect(f.zeroY).toBe(31);
  });

  test("the range is at least −1..1, so one win sits a third of the way down, not on the edge", () => {
    // levels 0,1 over −1..1 in 50px: y = 7 + (1 − level) × 18.
    const f = formLine(["win"], 100, 50);
    expect(f.points.map((p) => p.y)).toEqual([25, 7]);
    expect(f.zeroY).toBe(25);
  });

  test("the dot radius follows the step between matches, held between 1.6 and 3.6", () => {
    const r = (n: number) => formLine(Array<"win">(n).fill("win"), 316, 48).dots[0]?.r;
    expect(r(1)).toBe(3.6);
    expect(r(10)).toBe(3.6);
    expect(r(48)).toBeCloseTo((302 / 48) * 0.35, 6);
    expect(r(200)).toBe(1.6);
  });
});

describe("shareCard tiles", () => {
  test("seven fixed tiles in order, shots with its scored share", () => {
    expect(tiles(input())).toEqual([
      ["Best streak", "W3", null],
      ["Goals", "4", null],
      ["Assists", "1", null],
      ["Saves", "3", null],
      ["Shots", "10", "40% scored"],
      ["MVPs", "2", null],
      ["Demos", "2", null],
    ]);
  });

  test("a winless night is W0; no shooting share leaves the shots tile bare", () => {
    const t = tiles(input({ aggregate: { bestWinStreak: 0, shootingPct: null } }));
    expect(t[0]).toEqual(["Best streak", "W0", null]);
    expect(t[4]).toEqual(["Shots", "10", null]);
  });

  test("a fixed stat that is null shows a dash and is listed, so the grid holds", () => {
    const card = shareCard(input({ aggregate: { mvps: null, bestWinStreak: null, totals: { goals: 4, assists: 1, saves: 3, shots: 10, demos: null, score: 1600 } } }));
    expect(card.tiles.map((t) => t.value)).toEqual(["–", "4", "1", "3", "10", "–", "–"]);
    expect(card.nullStats).toEqual(["streak", "mvps", "demos"]);
    expect(shareCard(input()).nullStats).toEqual([]);
  });

  test("the 8th tile is the first of aerial goals, crossbar hits, aerial touches, epic saves that happened", () => {
    const eighth = (a: Partial<AggregateWire>) => tiles(input({ aggregate: a }))[7] ?? null;
    const all = { statfeed: { AerialGoal: 2, EpicSave: 1 }, woodworkHits: 3, aerialTouches: 9 };
    expect(eighth(all)).toEqual(["Aerial goals", "2", null]);
    expect(eighth({ ...all, statfeed: { EpicSave: 1 } })).toEqual(["Crossbar hits", "3", null]);
    expect(eighth({ ...all, statfeed: { AerialGoal: 0, EpicSave: 1 }, woodworkHits: 0 })).toEqual(["Aerial touches", "9", null]);
    expect(eighth({ ...all, statfeed: { EpicSave: 1 }, woodworkHits: null, aerialTouches: null })).toEqual(["Epic saves", "1", null]);
    expect(eighth({ statfeed: { EpicSave: 0 }, woodworkHits: 0, aerialTouches: 0 })).toBeNull();
    expect(tiles(input())).toHaveLength(7);
  });
});

describe("shareCard stood out", () => {
  const base = agg({ perGame: { goals: 1, assists: 0.25, saves: 0.5, shots: 2.5, demos: 0.5, score: 400 } });

  test("the stat furthest from the 30-day average, in words", () => {
    // saves 0.75 against 0.5 is +50%.
    expect(shareCard(input({ baseline: base })).stood).toEqual({ label: "Saves", text: "0.75 per game, 50% above your 30-day average" });
    const low = agg({ perGame: { goals: 1, assists: 0.25, saves: 1.5, shots: 2.5, demos: 0.5, score: 400 } });
    expect(shareCard(input({ baseline: low })).stood).toEqual({ label: "Saves", text: "0.75 per game, 50% below your 30-day average" });
  });

  test("with nothing that stood out, or no baseline, the hardest shot; with neither, none", () => {
    expect(shareCard(input({ aggregate: { hardestShotKmh: 134.24 } })).stood).toEqual({ label: "Hardest shot", text: "134 km/h" });
    expect(shareCard(input({ baseline: agg({}), aggregate: { hardestShotKmh: 98.46 } })).stood).toEqual({ label: "Hardest shot", text: "98.46 km/h" });
    expect(shareCard(input()).stood).toBeNull();
  });
});

describe("shareCard header and record", () => {
  test("the record from the summary, win % whole, and a smaller record past four digits", () => {
    const c = shareCard(input());
    expect([c.wins, c.losses, c.winPct, c.smallRecord]).toEqual([3, 1, 75, false]);
    expect(shareCard(input({ summary: { wins: 26, losses: 22, results: [] } })).smallRecord).toBe(false);
    expect(shareCard(input({ summary: { wins: 126, losses: 22, results: [] } })).smallRecord).toBe(true);
    expect(shareCard(input({ aggregate: { winPct: null } })).winPct).toBeNull();
  });

  test("when it was and how long; a live session says so far", () => {
    expect(shareCard(input()).when).toBe(`${dayLabel("2026-10-27")} · ${clock(START)} · 2 h 35 min`);
    const live = shareCard(input({ current: true }));
    expect([live.when, live.live]).toEqual([`${dayLabel("2026-10-27")} · ${clock(START)} · 2 h 35 min so far`, true]);
  });

  test("the filter's label, the name and the mood pass through; missing ones stay null", () => {
    const c = shareCard(input({ filter: { playlist: 11 } }));
    expect([c.label, c.name, c.mood]).toEqual(["Ranked Doubles", "Ridd", "Tonight you were the ball's favorite."]);
    expect(shareCard(input({ filter: "ranked" })).label).toBe("All ranked");
    const bare = shareCard(input({ name: null, mood: null }));
    expect([bare.label, bare.name, bare.mood]).toEqual([null, null, null]);
  });
});

describe("shareFilename", () => {
  test("local start time and the filter as a slug", () => {
    const at = { startedAt: new Date(2026, 9, 7, 9, 5).getTime() };
    expect(shareFilename(at, "everything")).toBe("rl-session-2026-10-07-0905-all.png");
    expect(shareFilename(at, "ranked")).toBe("rl-session-2026-10-07-0905-ranked.png");
    expect(shareFilename({ startedAt: START }, { playlist: 11 })).toBe("rl-session-2026-10-27-2010-ranked-doubles.png");
    expect(shareFilename(at, { playlist: 99 })).toBe("rl-session-2026-10-07-0905-unknown-playlist-99.png");
  });
});
