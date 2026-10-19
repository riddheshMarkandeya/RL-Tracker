import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDb } from "./db/sqlite";
import { rawMigrations, trackerMigrations } from "./db/migrations";
import { openStorage, type Storage } from "./storage";
import { memoryLogger } from "./testing";

let dir: string;
let storage: Storage | undefined;
const now = () => new Date("2026-10-16T12:00:00.000Z");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-storage-"));
});
afterEach(() => {
  storage?.close();
  storage = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("openStorage", () => {
  test("a fresh start creates both DBs at v1 with their tables and the season seed", () => {
    const logger = memoryLogger();
    storage = openStorage({ dir, logger, now });
    const { tracker, raw } = storage;
    expect(existsSync(join(dir, "tracker.db"))).toBe(true);
    expect(existsSync(join(dir, "raw.db"))).toBe(true);
    expect(tracker.pragma("user_version")).toBe(1);
    expect(raw.pragma("user_version")).toBe(1);
    expect(raw.pragma("auto_vacuum")).toBe(2);
    expect(tracker.all("SELECT id, name, start_date FROM seasons ORDER BY start_date")).toEqual([
      { id: 1, name: "S22", start_date: "2026-03-11" },
      { id: 2, name: "S23", start_date: "2026-06-09" },
      { id: 3, name: "S24", start_date: "2026-09-23" },
    ]);
    const names = (d: typeof tracker) => d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
    expect(names(tracker)).toEqual(["my_ids", "seasons", "session_breaks", "settings"]);
    expect(names(raw)).toEqual(["events"]);
    expect(logger.lines.filter((l) => l.event === "migrated").map((l) => l.fields)).toMatchObject([
      { db: "tracker", from: 0, to: 1 },
      { db: "raw", from: 0, to: 1 },
    ]);
    expect(logger.lines.filter((l) => l.event === "opened").map((l) => l.fields)).toMatchObject([
      { db: "tracker", version: 1 },
      { db: "raw", version: 1 },
    ]);
  });

  test("the schemas enforce their constraints", () => {
    storage = openStorage({ dir, logger: memoryLogger(), now });
    const { tracker, raw } = storage;
    expect(() => tracker.run("INSERT INTO my_ids(primary_id, status, added_at) VALUES ('x', 'maybe', 1)")).toThrow(/CHECK/);
    expect(() => tracker.run("INSERT INTO seasons(name, start_date) VALUES ('S25', '2026-09-23')")).toThrow(/UNIQUE/);
    raw.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES ('m', 1, 1, 'UpdateState', '{}')");
    expect(() => raw.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES ('m', 1, 2, 'UpdateState', '{}')")).toThrow(/UNIQUE/);
  });

  test("reopening the same data dir (a reinstall) keeps rows and runs no migration", () => {
    storage = openStorage({ dir, logger: memoryLogger(), now });
    storage.tracker.run("INSERT INTO my_ids(primary_id, name, status, added_at) VALUES ('Epic|abc|0', 'me', 'confirmed', 1)");
    storage.close();
    const logger = memoryLogger();
    storage = openStorage({ dir, logger, now });
    expect(storage.tracker.all("SELECT primary_id FROM my_ids")).toEqual([{ primary_id: "Epic|abc|0" }]);
    expect(storage.tracker.get("SELECT count(*) AS n FROM seasons")).toEqual({ n: 3 });
    expect(logger.events()).not.toContain("db/migrated");
  });

  test("a data dir that is a file fails to open, logged", () => {
    const file = join(dir, "notadir");
    writeFileSync(file, "x");
    const logger = memoryLogger();
    expect(() => openStorage({ dir: file, logger, now })).toThrow();
    expect(logger.events()).toEqual(["db/open_failed"]);
    expect(logger.lines[0]?.fields).toMatchObject({ path: file });
  });
});

describe("openStorage backups", () => {
  const backups = () => join(dir, "backups");
  const list = () => readdirSync(backups()).sort();
  const clock = (iso: string) => () => new Date(iso);
  const fakeV2 = { tracker: [...trackerMigrations, "CREATE TABLE extra(x);"], raw: rawMigrations };

  test("a fresh start makes one daily backup and no pre-migration one", () => {
    const logger = memoryLogger();
    storage = openStorage({ dir, logger, now });
    expect(list()).toEqual(["tracker-20261016-120000-000-daily.db"]);
    expect(logger.events().filter((e) => e.startsWith("backup/"))).toEqual(["backup/created"]);
  });

  test("a restart well within 24 h makes no backup; one at 24 h (less 5 min slack) makes a daily one", () => {
    storage = openStorage({ dir, logger: memoryLogger(), now: clock("2026-10-16T12:00:00.000Z") });
    storage.close();
    storage = openStorage({ dir, logger: memoryLogger(), now: clock("2026-10-17T11:54:59.000Z") });
    storage.close();
    expect(list()).toHaveLength(1);
    storage = openStorage({ dir, logger: memoryLogger(), now: clock("2026-10-17T11:55:00.000Z") });
    expect(list()).toEqual(["tracker-20261016-120000-000-daily.db", "tracker-20261017-115500-000-daily.db"]);
  });

  test("pending migrations on an existing DB back it up first, at its old version", () => {
    storage = openStorage({ dir, logger: memoryLogger(), now: clock("2026-10-16T12:00:00.000Z") });
    storage.close();
    const logger = memoryLogger();
    storage = openStorage({ dir, logger, now: clock("2026-10-16T13:00:00.000Z"), migrations: fakeV2 });
    expect(storage.tracker.pragma("user_version")).toBe(2);
    expect(list()).toEqual(["tracker-20261016-120000-000-daily.db", "tracker-20261016-130000-000-premigration.db"]);
    const copy = openDb(join(backups(), "tracker-20261016-130000-000-premigration.db"));
    expect(copy.pragma("user_version")).toBe(1);
    copy.close();
    expect(logger.events().indexOf("backup/created")).toBeLessThan(logger.events().indexOf("db/migrated"));
  });

  test("a failed pre-migration backup aborts startup before migrating, logged", () => {
    storage = openStorage({ dir, logger: memoryLogger(), now });
    storage.close();
    storage = undefined;
    rmSync(backups(), { recursive: true });
    writeFileSync(backups(), "a file where the backups dir should be");
    const logger = memoryLogger();
    expect(() => openStorage({ dir, logger, now, migrations: fakeV2 })).toThrow();
    expect(logger.lines.find((l) => l.event === "failed")).toMatchObject({ cat: "backup", fields: { reason: "premigration" } });
    expect(logger.events()).not.toContain("db/migrated");
    const tracker = openDb(join(dir, "tracker.db"));
    expect(tracker.pragma("user_version")).toBe(1);
    tracker.close();
  });

  test("a failed daily backup is logged and startup continues", () => {
    writeFileSync(backups(), "a file where the backups dir should be");
    const logger = memoryLogger();
    storage = openStorage({ dir, logger, now });
    expect(storage.tracker.pragma("user_version")).toBe(1);
    expect(logger.lines.find((l) => l.cat === "backup")).toMatchObject({ event: "failed", fields: { reason: "daily" } });
  });
});
