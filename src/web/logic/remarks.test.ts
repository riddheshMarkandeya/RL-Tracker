import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fillRemark } from "./remarks";

const KMH24 = { clock: "24h", speed: "kmh" } as const;

beforeAll(() => {
  vi.stubEnv("TZ", "UTC");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("fillRemark", () => {
  test("fills numbers; leaves text without placeholders alone", () => {
    expect(fillRemark("{n} saves, {w}–{l}.", { n: 3, w: 2, l: 1 }, KMH24)).toBe("3 saves, 2–1.");
    expect(fillRemark("Plain.", {}, KMH24)).toBe("Plain.");
  });

  test("the speed gets its unit, converted and whole in mph", () => {
    expect(fillRemark("A {speed} shot.", { speed: 142 }, KMH24)).toBe("A 142 km/h shot.");
    expect(fillRemark("A {speed} shot.", { speed: 142 }, { ...KMH24, speed: "mph" })).toBe("A 88 mph shot.");
  });

  test("the time is a local clock time in the clock setting", () => {
    const time = Date.UTC(2026, 9, 27, 13, 30);
    expect(fillRemark("Off at {time}.", { time }, KMH24, "en-GB")).toBe("Off at 13:30.");
    expect(fillRemark("Off at {time}.", { time }, { ...KMH24, clock: "12h" }, "en-US")).toMatch(/^Off at 1:30\sPM\.$/);
  });

  test("(s) and (es) follow {n}", () => {
    expect(fillRemark("{n} win(s), {n} loss(es).", { n: 1 }, KMH24)).toBe("1 win, 1 loss.");
    expect(fillRemark("{n} win(s), {n} match(es).", { n: 2 }, KMH24)).toBe("2 wins, 2 matches.");
  });

  test("a value the line needs but didn't get stays visible rather than blank", () => {
    expect(fillRemark("{hours} hours.", {}, KMH24)).toBe("{hours} hours.");
  });
});
