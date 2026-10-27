import { describe, expect, test } from "vitest";
import type { SessionSummary } from "../../shared/schemas/responses";
import { groupByDay, monthRange, strip } from "./picker";

const s = (key: string, day: string): SessionSummary => ({ key, day, ordinal: 1, ofDay: 1, startedAt: 0, endedAt: 0, matches: 1, wins: 1, losses: 0, results: ["win"] });

describe("groupByDay", () => {
  test("keeps the list's order (newest first) and starts a group on each new day", () => {
    const groups = groupByDay([s("c", "2026-10-25"), s("b", "2026-10-25"), s("a", "2026-10-24")]);
    expect(groups.map((g) => [g.day, g.sessions.map((x) => x.key)])).toEqual([
      ["2026-10-25", ["c", "b"]],
      ["2026-10-24", ["a"]],
    ]);
  });
});

describe("strip", () => {
  test("up to 24 squares, then the rest as +N", () => {
    expect(strip(["win", "loss", null], 24)).toEqual({ squares: ["win", "loss", null], more: 0 });
    const long = Array.from({ length: 30 }, () => "win" as const);
    expect(strip(long, 24)).toEqual({ squares: long.slice(0, 24), more: 6 });
  });
});

describe("monthRange", () => {
  test("a month's first and last day, across a year end and a leap February", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
