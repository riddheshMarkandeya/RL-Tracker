import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/schemas/settings";
import { createSettings } from "./settings";
import { openStorage, type Storage } from "./storage";
import { memoryLogger } from "./testing";

let dir: string;
let storage: Storage;
let logger: ReturnType<typeof memoryLogger>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-settings-"));
  logger = memoryLogger();
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const settings = () => createSettings({ tracker: storage.tracker, logger });

describe("settings store", () => {
  test("an empty table gives the defaults", () => {
    expect(settings().get()).toEqual(DEFAULT_SETTINGS);
    expect(logger.lines).toEqual([]);
  });

  test("a save comes back from get, and from a new store on the same db", () => {
    const saved = settings().save({ theme: "slate", rollingWindow: 35, remarks: false });
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, theme: "slate", rollingWindow: 35, remarks: false });
    expect(settings().get()).toEqual(saved);
    expect(logger.lines.find((l) => l.event === "saved")?.fields).toEqual({ changes: { theme: "slate", rollingWindow: 35, remarks: false } });
  });

  test("saving one key leaves the others as they were", () => {
    const s = settings();
    s.save({ theme: "oled" });
    expect(s.save({ speed: "mph" })).toEqual({ ...DEFAULT_SETTINGS, theme: "oled", speed: "mph" });
  });

  test("a bad JSON value, a value the schema refuses and an unknown key fall back to the defaults and are logged", () => {
    const put = (key: string, value: string) => storage.tracker.run("INSERT INTO settings (key, value) VALUES (?, ?)", key, value);
    put("theme", "{not json");
    put("rollingWindow", "500");
    put("colour", '"red"');
    put("speed", '"mph"');
    expect(settings().get()).toEqual({ ...DEFAULT_SETTINGS, speed: "mph" });
    expect(logger.lines.filter((l) => l.event === "bad_stored").map((l) => [l.level, l.fields.key, l.fields.reason])).toEqual([
      ["warn", "colour", "unknown_key"],
      ["warn", "rollingWindow", "rejected"],
      ["warn", "theme", "bad_json"],
    ]);
  });

  test("a save is one transaction: a failing write leaves nothing half-saved", () => {
    storage.tracker.exec("CREATE TRIGGER no_clock BEFORE INSERT ON settings WHEN NEW.key = 'clock' BEGIN SELECT RAISE(ABORT, 'nope'); END");
    expect(() => settings().save({ theme: "slate", clock: "12h" })).toThrow();
    expect(settings().get()).toEqual(DEFAULT_SETTINGS);
  });
});
