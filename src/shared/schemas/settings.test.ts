import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_SECTIONS, settingsPatch, settingsSchema, windowParam } from "./settings";

describe("settings", () => {
  test("the defaults are a valid settings object, and every key is in one section", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    const keys = Object.values(SETTINGS_SECTIONS).flat().sort();
    expect(keys).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  test("the defaults: carbon, 24h, km/h, recap, everything / ranked, 20, remarks and mood on", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: "carbon",
      clock: "24h",
      speed: "kmh",
      startPage: "recap",
      recapFilter: "everything",
      trendsFilter: "ranked",
      rollingWindow: 20,
      remarks: true,
      moodLine: true,
    });
  });
});

describe("settingsPatch", () => {
  test("a one-key patch parses to exactly that key: the others are not filled with defaults", () => {
    expect(settingsPatch.parse({ speed: "mph" })).toEqual({ speed: "mph" });
  });

  test("query strings become typed values", () => {
    expect(settingsPatch.parse({ rollingWindow: "35", remarks: "false", moodLine: "true", trendsFilter: "casual" })).toEqual({
      rollingWindow: 35,
      remarks: false,
      moodLine: true,
      trendsFilter: "casual",
    });
  });

  test("bad values, an unknown key and an empty patch are refused", () => {
    const bad: Record<string, string>[] = [
      { rollingWindow: "4" },
      { rollingWindow: "101" },
      { rollingWindow: "2.5" },
      { rollingWindow: "x" },
      { rollingWindow: "" },
      { remarks: "yes" },
      { theme: "midnight" },
      { recapFilter: "13" },
      { clock: "24H" },
      { colour: "red" },
      {},
    ];
    for (const b of bad) expect(settingsPatch.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe("windowParam", () => {
  test("a whole number from 5 to 100", () => {
    expect(windowParam.parse("5")).toBe(5);
    expect(windowParam.parse("100")).toBe(100);
    for (const bad of ["4", "101", "007x", "1e2", "-5", " 20"]) expect(windowParam.safeParse(bad).success, bad).toBe(false);
  });
});
