import { describe, expect, test } from "vitest";
import { idStatus, seasonInput } from "./tables";

describe("seasonInput", () => {
  test("a name is trimmed; the start is a real day", () => {
    expect(seasonInput.parse({ name: "  S25 ", start: "2026-12-09" })).toEqual({ name: "S25", start: "2026-12-09" });
  });

  test("a blank name, a name over 20 characters and a bad day are refused", () => {
    for (const bad of [
      { name: "   ", start: "2026-12-09" },
      { name: "x".repeat(21), start: "2026-12-09" },
      { name: "S25", start: "2026-02-30" },
      { name: "S25", start: "12/09/2026" },
      { name: "S25" },
    ]) {
      expect(seasonInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(seasonInput.safeParse({ name: "x".repeat(20), start: "2026-12-09" }).success).toBe(true);
  });
});

describe("idStatus", () => {
  test("only confirmed and rejected: a guess can't be un-answered", () => {
    expect(idStatus.parse("confirmed")).toBe("confirmed");
    expect(idStatus.parse("rejected")).toBe("rejected");
    expect(idStatus.safeParse("pending").success).toBe(false);
  });
});
