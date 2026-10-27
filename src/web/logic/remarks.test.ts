import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fillRemark } from "./remarks";

beforeAll(() => {
  vi.stubEnv("TZ", "UTC");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("fillRemark", () => {
  test("fills numbers; leaves text without placeholders alone", () => {
    expect(fillRemark("{n} saves, {w}–{l}.", { n: 3, w: 2, l: 1 })).toBe("3 saves, 2–1.");
    expect(fillRemark("Plain.", {})).toBe("Plain.");
  });

  test("the speed gets its unit", () => {
    expect(fillRemark("A {speed} shot.", { speed: 142 })).toBe("A 142 km/h shot.");
  });

  test("the time is a local clock time", () => {
    expect(fillRemark("Off at {time}.", { time: Date.UTC(2026, 9, 27, 1, 30) }, "en-GB")).toBe("Off at 01:30.");
  });

  test("(s) and (es) follow {n}", () => {
    expect(fillRemark("{n} win(s), {n} loss(es).", { n: 1 })).toBe("1 win, 1 loss.");
    expect(fillRemark("{n} win(s), {n} match(es).", { n: 2 })).toBe("2 wins, 2 matches.");
  });

  test("a value the line needs but didn't get stays visible rather than blank", () => {
    expect(fillRemark("{hours} hours.", {})).toBe("{hours} hours.");
  });
});
