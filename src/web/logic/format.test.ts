import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { dayLabel, decimal, durationText, monthLabel, ordinal, plural, timeRange } from "./format";

beforeAll(() => {
  vi.stubEnv("TZ", "UTC");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("text", () => {
  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  test("a session's length in hours and minutes", () => {
    const MIN = 60_000;
    expect(durationText(45 * MIN)).toBe("45 min");
    expect(durationText(80 * MIN)).toBe("1 h 20 min");
    expect(durationText(120 * MIN)).toBe("2 h");
    expect(durationText(20_000)).toBe("1 min");
  });

  test("local time range and day label", () => {
    const at = Date.UTC(2026, 9, 19, 23, 4);
    expect(timeRange(at, at + 65 * 60_000, "en-GB")).toBe("23:04 – 00:09");
    expect(dayLabel("2026-10-19", "en-GB")).toBe("Mon 19 Oct");
  });

  test("a count with its noun", () => {
    expect([plural(1, "win"), plural(2, "win"), plural(0, "loss", "losses"), plural(1, "loss", "losses")]).toEqual(["1 win", "2 wins", "0 losses", "1 loss"]);
  });

  test("month label", () => {
    expect(monthLabel("2026-09", "en-GB")).toBe("September 2026");
  });
});

test("decimal: whole from 100, else up to 2 decimals without trailing zeros", () => {
  expect([decimal(412.6), decimal(100), decimal(1.04), decimal(1.5), decimal(2), decimal(0.333), decimal(0)]).toEqual(["413", "100", "1.04", "1.5", "2", "0.33", "0"]);
});
