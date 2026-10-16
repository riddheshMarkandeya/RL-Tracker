import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { dataDir } from "./paths";

describe("dataDir", () => {
  test("RLTRACKER_DATA_DIR wins", () => {
    expect(dataDir({ RLTRACKER_DATA_DIR: "D:\\x", LOCALAPPDATA: "C:\\L" })).toBe("D:\\x");
  });

  test("LOCALAPPDATA\\RLTracker otherwise", () => {
    expect(dataDir({ LOCALAPPDATA: "C:\\L" })).toBe(join("C:\\L", "RLTracker"));
  });

  test("falls back to the home dir when LOCALAPPDATA is missing", () => {
    expect(dataDir({})).toBe(join(homedir(), "AppData", "Local", "RLTracker"));
  });

  test("an empty LOCALAPPDATA counts as missing, so the path never goes relative", () => {
    expect(dataDir({ LOCALAPPDATA: "" })).toBe(join(homedir(), "AppData", "Local", "RLTracker"));
  });
});
