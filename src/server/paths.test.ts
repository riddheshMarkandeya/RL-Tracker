import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { dashboardPort, dataDir, staticDir } from "./paths";

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

describe("dashboardPort", () => {
  test("defaults to 49100, and RLTRACKER_PORT moves it (a dev run beside the background one)", () => {
    expect(dashboardPort({})).toBe(49100);
    expect(dashboardPort({ RLTRACKER_PORT: "49101" })).toBe(49101);
  });

  test("a port that isn't a whole number in 1-65535 fails at startup", () => {
    for (const bad of ["", "abc", "0", "65536", "49101.5", "-1", " 49101x"]) {
      expect(() => dashboardPort({ RLTRACKER_PORT: bad }), bad).toThrow(/RLTRACKER_PORT/);
    }
  });
});

describe("staticDir", () => {
  test("RLTRACKER_STATIC_DIR wins", () => {
    expect(staticDir({ RLTRACKER_STATIC_DIR: "D:/rl/dist", RLTRACKER_DATA_DIR: "D:\\x" })).toBe("D:/rl/dist");
  });

  test("defaults to the web build beside the installed exes, following the data dir", () => {
    expect(staticDir({ RLTRACKER_DATA_DIR: "D:\\x" })).toBe(join("D:\\x", "bin", "web"));
    expect(staticDir({ LOCALAPPDATA: "C:\\L" })).toBe(join("C:\\L", "RLTracker", "bin", "web"));
  });

  test("an empty RLTRACKER_STATIC_DIR counts as unset", () => {
    expect(staticDir({ RLTRACKER_STATIC_DIR: "", LOCALAPPDATA: "C:\\L" })).toBe(join("C:\\L", "RLTracker", "bin", "web"));
  });
});
