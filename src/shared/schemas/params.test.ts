import { describe, expect, test } from "vitest";
import { dayParam, filterParam, monthsParams, periodParams, sessionsParams } from "./params";

describe("dayParam", () => {
  test("a real calendar day only", () => {
    expect(dayParam.safeParse("2028-02-29").success).toBe(true);
    for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "26-01-01", "2026-01-01T00:00", ""]) {
      expect(dayParam.safeParse(bad).success, bad).toBe(false);
    }
  });

  test("a year before 1000 is refused: Date maps years 0-99 onto the 1900s", () => {
    expect(dayParam.safeParse("0050-01-01").success).toBe(false);
    expect(dayParam.safeParse("0999-12-31").success).toBe(false);
    expect(dayParam.safeParse("1000-01-01").success).toBe(true);
  });
});

describe("filterParam", () => {
  test("a group, a playlist id, or everything by default", () => {
    expect(filterParam.parse("ranked")).toBe("ranked");
    expect(filterParam.parse("private")).toBe("private");
    expect(filterParam.parse("13")).toEqual({ playlist: 13 });
    expect(filterParam.parse(undefined)).toBe("everything");
    for (const bad of ["Ranked", "-1", "1.5", "1e3", "", "99999999999"]) expect(filterParam.safeParse(bad).success, bad).toBe(false);
  });
});

describe("page params", () => {
  test("sessions: from and to are days, from no later than to", () => {
    expect(sessionsParams.parse({ from: "2026-10-01", to: "2026-10-14" })).toEqual({ filter: "everything", from: "2026-10-01", to: "2026-10-14" });
    expect(sessionsParams.safeParse({ from: "2026-10-01", to: "2026-10-01" }).success).toBe(true);
    expect(sessionsParams.safeParse({ from: "2026-10-15", to: "2026-10-14" }).success).toBe(false);
    expect(sessionsParams.safeParse({ from: "2026-10-01" }).success).toBe(false);
  });

  test("months: a before day", () => {
    expect(monthsParams.parse({ before: "2026-10-01", filter: "casual" })).toEqual({ before: "2026-10-01", filter: "casual" });
    expect(monthsParams.safeParse({}).success).toBe(false);
  });

  test("period: one shape per kind, giving a PeriodSpec", () => {
    expect(periodParams.parse({ kind: "week", day: "2026-10-21" })).toEqual({ spec: { kind: "week", day: "2026-10-21" }, filter: "everything", window: 20 });
    expect(periodParams.parse({ kind: "season", season: "2", filter: "ranked" })).toEqual({ spec: { kind: "season", id: 2 }, filter: "ranked", window: 20 });
    expect(periodParams.parse({ kind: "last30" })).toEqual({ spec: { kind: "last30" }, filter: "everything", window: 20 });
    for (const bad of [{ kind: "week" }, { kind: "season" }, { kind: "season", season: "x" }, { kind: "season", season: "1.5" }, { kind: "decade" }, {}]) {
      expect(periodParams.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  test("period: the rolling window in every kind, 20 when left out", () => {
    expect(periodParams.parse({ kind: "month", day: "2026-10-01", window: "35" }).window).toBe(35);
    expect(periodParams.parse({ kind: "season", season: "2", window: "5" }).window).toBe(5);
    expect(periodParams.parse({ kind: "all", window: "100" }).window).toBe(100);
    expect(periodParams.parse({ kind: "all" }).window).toBe(20);
    for (const window of ["4", "101", "x"]) expect(periodParams.safeParse({ kind: "all", window }).success, window).toBe(false);
  });
});
