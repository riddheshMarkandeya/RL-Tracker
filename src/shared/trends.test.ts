import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { aggregate } from "./aggregate";
import { dayStart, periodRange, type PeriodSpec, type Season } from "./periods";
import { bucketKind, buckets, nextSpec, previousRange, previousSpec, trendStats } from "./trends";

function inZone(zone: string) {
  const before = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    process.env.TZ = before;
  });
}

const H = 3_600_000;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
}

describe("bucketKind", () => {
  test.each([
    [{ kind: "last7" }, "day"],
    [{ kind: "last30" }, "day"],
    [{ kind: "week", day: "2026-10-19" }, "day"],
    [{ kind: "month", day: "2026-10-01" }, "day"],
    [{ kind: "season", id: 1 }, "week"],
    [{ kind: "this_year" }, "week"],
    [{ kind: "all" }, "month"],
  ] as [PeriodSpec, string][])("%o buckets by %s", (spec, kind) => {
    expect(bucketKind(spec)).toBe(kind);
  });
});

describe("buckets in London", () => {
  inZone("Europe/London");
  const now = utc(2026, 10, 27, 12); // Tue 27 Oct 12:00 GMT
  const seasons: Season[] = [
    { id: 1, name: "S24", startDate: "2026-10-21" },
    { id: 2, name: "S25", startDate: "2026-11-18" },
  ];
  const of = (spec: PeriodSpec, firstDay: string | null = null) => {
    return buckets(spec, must(periodRange(spec, { now, seasons })), { now, firstDay });
  };

  test("a week across the clock change: seven days, the Saturday 25 h", () => {
    const bs = of({ kind: "week", day: "2026-10-21" });
    expect(bs.map((b) => b.day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(bs[0]?.from).toBe(utc(2026, 10, 19, 3)); // 04:00 BST
    expect(bs.at(-1)?.to).toBe(utc(2026, 10, 26, 4)); // 04:00 GMT
    // The clocks go back at 02:00 BST on Sunday the 25th, before the cutoff, so Saturday's day owns it.
    const saturday = must(bs[5]);
    expect(saturday.to - saturday.from).toBe(25 * H);
    for (let i = 1; i < bs.length; i++) expect(bs[i - 1]?.to).toBe(bs[i]?.from);
  });

  test("a running month runs to the month's end", () => {
    const bs = of({ kind: "month", day: "2026-10-27" });
    expect(bs).toHaveLength(31);
    expect(bs.at(-1)).toEqual({ from: dayStart("2026-10-31"), to: dayStart("2026-11-01"), day: "2026-10-31" });
  });

  test("last 30 days: 30 day buckets ending with today", () => {
    const bs = of({ kind: "last30" });
    expect(bs).toHaveLength(30);
    expect(bs[0]?.day).toBe("2026-09-28");
    expect(bs.at(-1)).toEqual({ from: dayStart("2026-10-27"), to: dayStart("2026-10-28"), day: "2026-10-27" });
  });

  test("a closed season's weeks are clipped to its edges; a bucket's day is its Monday", () => {
    const bs = of({ kind: "season", id: 1 });
    expect(bs.map((b) => b.day)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(bs[0]).toEqual({ from: dayStart("2026-10-21"), to: dayStart("2026-10-26"), day: "2026-10-19" });
    expect(bs.at(-1)).toEqual({ from: dayStart("2026-11-16"), to: dayStart("2026-11-18"), day: "2026-11-16" });
  });

  test("an open season runs to the end of today", () => {
    const later = utc(2026, 11, 25, 12); // Wed
    const range = must(periodRange({ kind: "season", id: 2 }, { now: later, seasons }));
    const bs = buckets({ kind: "season", id: 2 }, range, { now: later, firstDay: null });
    expect(bs.map((b) => b.day)).toEqual(["2026-11-16", "2026-11-23"]);
    expect(bs.at(-1)?.to).toBe(dayStart("2026-11-26"));
  });

  test("a season entered ahead of time gives no buckets", () => {
    const range = must(periodRange({ kind: "season", id: 2 }, { now, seasons }));
    expect(range.to).toBeLessThanOrEqual(must(range.from));
    expect(buckets({ kind: "season", id: 2 }, range, { now, firstDay: null })).toEqual([]);
  });

  test("all time starts at the month of the first match, its last month clipped at the end of today", () => {
    const bs = of({ kind: "all" }, "2026-08-14");
    expect(bs.map((b) => b.day)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(bs[0]?.from).toBe(dayStart("2026-08-01"));
    expect(bs.at(-1)?.to).toBe(dayStart("2026-10-28"));
  });

  test("all time with no matches gives no buckets", () => {
    expect(of({ kind: "all" })).toEqual([]);
  });

  test("this year: weeks from 1 January, the first one clipped", () => {
    const bs = of({ kind: "this_year" });
    expect(bs[0]).toEqual({ from: dayStart("2026-01-01"), to: dayStart("2026-01-05"), day: "2025-12-29" });
    expect(bs.at(-1)).toEqual({ from: dayStart("2026-10-26"), to: dayStart("2026-10-28"), day: "2026-10-26" });
  });
});

describe("previous and next periods", () => {
  inZone("America/New_York");
  const now = utc(2026, 10, 21, 16); // Wed 21 Oct 12:00 EDT
  const seasons: Season[] = [
    { id: 1, name: "S23", startDate: "2026-06-09" },
    { id: 2, name: "S22", startDate: "2026-03-11" },
    { id: 3, name: "S24", startDate: "2026-09-23" },
  ];

  test("a week across a year end, either way", () => {
    expect(previousSpec({ kind: "week", day: "2027-01-06" }, seasons)).toEqual({ kind: "week", day: "2026-12-28" });
    expect(nextSpec({ kind: "week", day: "2026-12-31" }, seasons)).toEqual({ kind: "week", day: "2027-01-04" });
  });

  test("January's previous month is December, and back", () => {
    expect(previousSpec({ kind: "month", day: "2027-01-15" }, seasons)).toEqual({ kind: "month", day: "2026-12-01" });
    expect(nextSpec({ kind: "month", day: "2026-12-15" }, seasons)).toEqual({ kind: "month", day: "2027-01-01" });
  });

  test("seasons step by start date; none past the table's ends", () => {
    expect(previousSpec({ kind: "season", id: 1 }, seasons)).toEqual({ kind: "season", id: 2 });
    expect(nextSpec({ kind: "season", id: 1 }, seasons)).toEqual({ kind: "season", id: 3 });
    expect(previousSpec({ kind: "season", id: 2 }, seasons)).toBeNull();
    expect(nextSpec({ kind: "season", id: 3 }, seasons)).toBeNull();
    expect(previousSpec({ kind: "season", id: 99 }, seasons)).toBeNull();
  });

  test.each([{ kind: "this_year" }, { kind: "all" }, { kind: "last7" }] as PeriodSpec[])("%o has no previous or next spec", (spec) => {
    expect(previousSpec(spec, seasons)).toBeNull();
    expect(nextSpec(spec, seasons)).toBeNull();
  });

  test("the previous range of a week, a month and a season is that period's range", () => {
    for (const spec of [{ kind: "week", day: "2026-10-21" }, { kind: "month", day: "2026-10-21" }, { kind: "season", id: 3 }] as PeriodSpec[]) {
      const range = must(periodRange(spec, { now, seasons }));
      expect(previousRange(spec, range, { now, seasons })).toEqual(periodRange(must(previousSpec(spec, seasons)), { now, seasons }));
    }
  });

  test("last 7 and last 30 days compare with the n days before", () => {
    const r7 = must(periodRange({ kind: "last7" }, { now, seasons }));
    expect(previousRange({ kind: "last7" }, r7, { now, seasons })).toEqual({ from: dayStart("2026-10-08"), to: dayStart("2026-10-15"), running: false });
    const r30 = must(periodRange({ kind: "last30" }, { now, seasons }));
    expect(previousRange({ kind: "last30" }, r30, { now, seasons })).toEqual({ from: dayStart("2026-08-23"), to: dayStart("2026-09-22"), running: false });
  });

  test("this year and all time have no previous range, nor the first season", () => {
    for (const spec of [{ kind: "this_year" }, { kind: "all" }, { kind: "season", id: 2 }] as PeriodSpec[]) {
      expect(previousRange(spec, must(periodRange(spec, { now, seasons })), { now, seasons })).toBeNull();
    }
  });
});

describe("trendStats", () => {
  test("an empty set gives nulls, not zeros", () => {
    expect(trendStats(aggregate([]))).toEqual({
      matches: 0,
      wins: null,
      losses: null,
      winPct: null,
      shootingPct: null,
      perGame: { goals: null, assists: null, saves: null, shots: null },
    });
  });
});
