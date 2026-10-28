import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, settingsPatch } from "../../shared/schemas/settings";
import { atDefaults, parseWindow, patchQuery, sectionDefaults } from "./settings";

describe("settings page logic", () => {
  test("a section is at its defaults until one of its own keys changes", () => {
    const changed = { ...DEFAULT_SETTINGS, speed: "mph" } as const;
    expect(atDefaults(DEFAULT_SETTINGS, "appearance")).toBe(true);
    expect(atDefaults(changed, "appearance")).toBe(false);
    expect(atDefaults(changed, "defaults")).toBe(true);
  });

  test("a section's reset is its keys at their defaults, nothing else", () => {
    expect(sectionDefaults("remarks")).toEqual({ remarks: true, moodLine: true });
  });

  test("a patch goes out as the query the server parses back to the same values", () => {
    const patch = { theme: "oled", rollingWindow: 35, remarks: false } as const;
    const q = patchQuery(patch);
    expect(q).toBe("theme=oled&rollingWindow=35&remarks=false");
    expect(settingsPatch.parse(Object.fromEntries(new URLSearchParams(q)))).toEqual(patch);
  });

  test("the window draft: a whole number from 5 to 100, else the message", () => {
    expect(parseWindow("35")).toEqual({ ok: true, value: 35 });
    expect(parseWindow(" 5 ")).toEqual({ ok: true, value: 5 });
    for (const bad of ["4", "101", "2.5", "", "x", "1e2", "-5"]) expect(parseWindow(bad), bad).toEqual({ ok: false, error: "Use a whole number from 5 to 100." });
  });
});
