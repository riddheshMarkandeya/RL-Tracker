import { describe, expect, test } from "vitest";
import type { Season } from "../../shared/periods";
import type { TrendStats } from "../../shared/trends";
import {
  comparedText,
  metricDelta,
  metricValue,
  parseTrends,
  periodTitle,
  quickPicks,
  rangeText,
  sparkPath,
  specEqual,
  stepTarget,
  stripYear,
  trendsPath,
  yearStrip,
  type TrendsState,
} from "./trends";

const seasons: Season[] = [
  { id: 1, name: "S22", startDate: "2026-03-11" },
  { id: 2, name: "S23", startDate: "2026-06-09" },
  { id: 3, name: "S24", startDate: "2026-09-23" },
];
const TODAY = "2026-10-27"; // a Tuesday

const parse = (q: string) => parseTrends(new URLSearchParams(q));

describe("the URL", () => {
  test("left out: last 30 days, all ranked, win %, the strip on the period's year", () => {
    expect(parse("")).toEqual({ state: { spec: { kind: "last30" }, filter: "ranked", metric: "win", year: null }, bad: [] });
  });

  test("a week is stored as its Monday and a month as its 1st", () => {
    expect(parse("kind=week&day=2026-10-29").state.spec).toEqual({ kind: "week", day: "2026-10-26" });
    expect(parse("kind=month&day=2026-10-29").state.spec).toEqual({ kind: "month", day: "2026-10-01" });
    expect(parse("kind=season&season=2").state.spec).toEqual({ kind: "season", id: 2 });
  });

  test("bad values fall back to the default, each named once", () => {
    const { state, bad } = parse("kind=year&day=2026-01-01&filter=nope&metric=demos&year=26");
    expect(state).toEqual({ spec: { kind: "last30" }, filter: "ranked", metric: "win", year: null });
    expect(bad).toEqual(["kind", "filter", "metric", "year"]);
    expect(parse("kind=week&day=2026-02-30").bad).toEqual(["kind"]);
  });

  test("round trip, defaults left out", () => {
    const state: TrendsState = { spec: { kind: "week", day: "2026-10-26" }, filter: { playlist: 13 }, metric: "saves", year: 2025 };
    expect(trendsPath(state)).toBe("/trends?kind=week&day=2026-10-26&filter=13&metric=saves&year=2025");
    expect(parse(trendsPath(state).slice("/trends?".length)).state).toEqual(state);
    expect(trendsPath({ spec: { kind: "last30" }, filter: "ranked", metric: "win", year: null })).toBe("/trends");
    expect(trendsPath({ spec: { kind: "season", id: 3 }, filter: "everything", metric: "win", year: null })).toBe("/trends?kind=season&season=3&filter=everything");
  });
});

describe("quick picks", () => {
  test("this week and last week from today; each pick pressed only on its own period", () => {
    const picks = quickPicks(TODAY);
    expect(picks.map((p) => p.label)).toEqual(["Last 7 days", "Last 30 days", "This week", "Last week", "This year", "All time"]);
    expect(picks[2]?.spec).toEqual({ kind: "week", day: "2026-10-26" });
    expect(picks[3]?.spec).toEqual({ kind: "week", day: "2026-10-19" });
    expect(picks.map((p) => specEqual(p.spec, { kind: "week", day: "2026-10-19" }))).toEqual([false, false, false, true, false, false]);
  });

  test("02:00 on a Monday is still the week before", () => {
    // dayOf(Monday 02:00) is the Sunday, so This week is the week before.
    expect(quickPicks("2026-10-25")[2]?.spec).toEqual({ kind: "week", day: "2026-10-19" });
  });
});

describe("stepping", () => {
  const bounds = { seasons, firstDay: "2026-08-14", today: TODAY };

  test("weeks and months step until the first played day and today", () => {
    expect(stepTarget({ kind: "week", day: "2026-10-26" }, 1, bounds)).toBeNull();
    expect(stepTarget({ kind: "week", day: "2026-10-19" }, 1, bounds)).toEqual({ kind: "week", day: "2026-10-26" });
    expect(stepTarget({ kind: "week", day: "2026-08-17" }, -1, bounds)).toEqual({ kind: "week", day: "2026-08-10" });
    expect(stepTarget({ kind: "week", day: "2026-08-10" }, -1, bounds)).toBeNull();
    expect(stepTarget({ kind: "month", day: "2026-08-01" }, -1, bounds)).toBeNull();
    expect(stepTarget({ kind: "month", day: "2026-10-01" }, 1, bounds)).toBeNull();
    expect(stepTarget({ kind: "month", day: "2026-09-01" }, 1, bounds)).toEqual({ kind: "month", day: "2026-10-01" });
  });

  test("seasons follow the table; other kinds don't step", () => {
    expect(stepTarget({ kind: "season", id: 1 }, -1, bounds)).toBeNull();
    expect(stepTarget({ kind: "season", id: 2 }, -1, bounds)).toEqual({ kind: "season", id: 1 });
    expect(stepTarget({ kind: "season", id: 3 }, 1, bounds)).toBeNull();
    expect(stepTarget({ kind: "last7" }, -1, bounds)).toBeNull();
  });

  test("without a played match nothing steps back", () => {
    expect(stepTarget({ kind: "month", day: "2026-10-01" }, -1, { ...bounds, firstDay: null })).toBeNull();
  });
});

describe("the header text", () => {
  const ctx = { today: TODAY, seasons, locale: "en-GB" };

  test("titles", () => {
    expect(periodTitle({ kind: "last7" }, ctx)).toBe("Last 7 days");
    expect(periodTitle({ kind: "week", day: "2026-10-26" }, ctx)).toBe("This week");
    expect(periodTitle({ kind: "week", day: "2026-10-19" }, ctx)).toBe("Last week");
    expect(periodTitle({ kind: "week", day: "2026-10-12" }, ctx)).toBe("Week of Mon 12 Oct");
    expect(periodTitle({ kind: "month", day: "2026-09-01" }, ctx)).toBe("September 2026");
    expect(periodTitle({ kind: "season", id: 3 }, ctx)).toBe("Season 24");
    expect(periodTitle({ kind: "season", id: 99 }, ctx)).toBe("Season");
    expect(periodTitle({ kind: "all" }, ctx)).toBe("All time");
  });

  test("a range's days, with the year only when it isn't this one", () => {
    expect(rangeText({ from: "2026-10-19", last: "2026-10-25" }, ctx)).toBe("Mon 19 Oct – Sun 25 Oct");
    expect(rangeText({ from: "2025-12-29", last: "2026-01-04" }, ctx)).toBe("Mon 29 Dec 2025 – Sun 4 Jan 2026");
    expect(rangeText({ from: "2025-03-03", last: "2025-03-09" }, ctx)).toBe("Mon 3 Mar – Sun 9 Mar 2025");
  });

  test("compared with, or nothing earlier, or an empty previous period", () => {
    expect(comparedText({ kind: "week", day: "2026-10-26" }, { hasPrevious: true, previousMatches: 3 }, ctx)).toBe("compared with last week");
    expect(comparedText({ kind: "week", day: "2026-10-19" }, { hasPrevious: true, previousMatches: 0 }, ctx)).toBe("the week before had no matches here");
    expect(comparedText({ kind: "last7" }, { hasPrevious: true, previousMatches: 1 }, ctx)).toBe("compared with the 7 days before");
    expect(comparedText({ kind: "month", day: "2026-10-01" }, { hasPrevious: true, previousMatches: 1 }, ctx)).toBe("compared with September 2026");
    expect(comparedText({ kind: "season", id: 3 }, { hasPrevious: true, previousMatches: 1 }, ctx)).toBe("compared with Season 23");
    expect(comparedText({ kind: "this_year" }, { hasPrevious: false, previousMatches: 0 }, ctx)).toBe("nothing earlier");
  });
});

const stats = (s: Partial<Omit<TrendStats, "perGame">> & { perGame?: Partial<TrendStats["perGame"]> }): TrendStats => ({
  matches: 5,
  wins: 3,
  losses: 2,
  winPct: 0.6,
  shootingPct: 0.25,
  ...s,
  perGame: { goals: 1, assists: 0.5, saves: 2, shots: 4, ...s.perGame },
});

describe("tiles", () => {
  test("values: rates in whole percent, per game to 2 decimals", () => {
    expect(metricValue("win", stats({}))).toBe("60%");
    expect(metricValue("shooting", stats({}))).toBe("25%");
    expect(metricValue("goals", stats({ perGame: { goals: 1.256 } }))).toBe("1.26");
    expect(metricValue("saves", stats({ matches: 0, perGame: { saves: null } }))).toBe("–");
  });

  test("rates move in points, ≈ under 1; per game in percent, ≈ under 3%", () => {
    expect(metricDelta("win", stats({ winPct: 0.65 }), stats({ winPct: 0.6 }))).toEqual({ dir: "up", text: "5 pts" });
    expect(metricDelta("win", stats({ winPct: 0.604 }), stats({ winPct: 0.6 }))).toEqual({ dir: "same", text: "≈" });
    expect(metricDelta("goals", stats({ perGame: { goals: 0.9 } }), stats({}))).toEqual({ dir: "down", text: "10%" });
    expect(metricDelta("goals", stats({ perGame: { goals: 1.02 } }), stats({}))).toEqual({ dir: "same", text: "≈" });
  });

  test("no delta without a previous period, an empty one, or a 0 to compare with", () => {
    expect(metricDelta("win", stats({}), null)).toBeNull();
    expect(metricDelta("win", stats({}), stats({ matches: 0, winPct: null }))).toBeNull();
    expect(metricDelta("assists", stats({}), stats({ perGame: { assists: 0 } }))).toBeNull();
    expect(metricDelta("win", stats({ matches: 0, winPct: null }), stats({}))).toBeNull();
  });

  test("the sparkline skips empty buckets rather than plotting 0", () => {
    const empty = stats({ matches: 0, winPct: null });
    expect(sparkPath("win", [stats({ winPct: 0.5 }), empty, stats({ winPct: 1 })])).toBe("M0.0 22.0L100.0 2.0");
    expect(sparkPath("win", [stats({}), empty])).toBeNull();
    expect(sparkPath("win", [stats({ winPct: 0.5 }), stats({ winPct: 0.5 })])).toBe("M0.0 22.0L100.0 22.0");
  });
});

describe("the year strip", () => {
  test("its year: the one asked for, else the period's last day's, never past today's", () => {
    expect(stripYear(2024, "2026-10-31", "2026-10-27")).toBe(2024);
    expect(stripYear(null, "2026-09-30", "2026-10-27")).toBe(2026);
    expect(stripYear(null, "2027-01-03", "2026-12-29")).toBe(2026);
  });

  const strip = (over: Partial<Parameters<typeof yearStrip>[0]> = {}) =>
    yearStrip({ year: 2026, today: TODAY, seasons, spec: { kind: "month", day: "2026-09-01" }, selected: { from: "2026-09-01", to: "2026-10-01" }, days: [], locale: "en-GB", ...over });

  test("a disabled band before the first season, then each season clipped to the year", () => {
    const { seasons: bands } = strip();
    expect(bands.map((b) => [b.label, b.id, b.disabled])).toEqual([
      ["Before S22", null, true],
      ["S22", 1, false],
      ["S23", 2, false],
      ["S24", 3, false],
    ]);
    expect(bands[0]?.left).toBe(0);
    expect((bands.at(-1)?.left ?? 0) + (bands.at(-1)?.width ?? 0)).toBeCloseTo(100);
    // A year before the first season is one disabled band.
    expect(strip({ year: 2025 }).seasons.map((b) => b.label)).toEqual(["Before S22"]);
  });

  test("twelve months, the future ones disabled, the selected one pressed", () => {
    const { months } = strip();
    expect(months).toHaveLength(12);
    expect(months.filter((m) => m.disabled).map((m) => m.label)).toEqual(["Nov", "Dec"]);
    expect(months.filter((m) => m.pressed).map((m) => m.day)).toEqual(["2026-09-01"]);
    expect(months[0]?.left).toBe(0);
  });

  test("day ticks by match count, the selection shaded, today marked only in its year", () => {
    const s = strip({ days: [{ day: "2026-07-02", matches: 1 }, { day: "2026-07-03", matches: 20 }] });
    expect(s.ticks.map((t) => t.height)).toEqual([6, 22]);
    expect(s.selected?.left).toBeCloseTo((100 * 243) / 365);
    expect(s.selected?.width).toBeCloseTo((100 * 30) / 365);
    expect(s.today).toBeCloseTo((100 * 300) / 365);
    expect(strip({ year: 2025 }).today).toBeNull();
    expect(strip({ year: 2025 }).selected).toBeNull();
  });
});
