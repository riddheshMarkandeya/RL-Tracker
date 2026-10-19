import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { backupName, backupTracker, dailyBackupDue, pruneBackups, runDailyBackup } from "./backup";
import { openDb, type Db } from "./sqlite";

let dir: string;
let backups: string;
const open: Db[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-backup-"));
  backups = join(dir, "backups");
});
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const HOUR = 3600_000;
/** Creates empty backup files dated at each of `isos`. */
const seed = (...isos: string[]) => {
  mkdirSync(backups, { recursive: true });
  for (const iso of isos) writeFileSync(join(backups, backupName(at(iso), "daily")), "");
};

describe("backupName", () => {
  test("is tracker-<UTC yyyyMMdd-HHmmss-SSS>-<reason>.db", () => {
    expect(backupName(at("2026-10-16T09:05:03.007Z"), "premigration")).toBe("tracker-20261016-090503-007-premigration.db");
  });

  test("sorts chronologically", () => {
    const isos = ["2026-12-01T00:00:00.000Z", "2026-02-10T23:59:59.999Z", "2026-10-16T09:05:03.007Z"];
    const names = isos.map((i) => backupName(at(i), "daily"));
    expect([...names].sort()).toEqual([names[1], names[2], names[0]]);
  });
});

describe("backupTracker", () => {
  test("writes a copy that opens with the same rows, and logs it", () => {
    const logger = memoryLogger();
    const db = openDb(join(dir, "tracker.db"));
    open.push(db);
    db.exec("CREATE TABLE t(x); INSERT INTO t VALUES (42);");
    const path = backupTracker(db, { dir: backups, reason: "daily", now: () => at("2026-10-16T12:00:00.000Z"), logger });
    expect(path).toBe(join(backups, "tracker-20261016-120000-000-daily.db"));
    const copy = openDb(path);
    open.push(copy);
    expect(copy.all("SELECT x FROM t")).toEqual([{ x: 42 }]);
    expect(logger.lines[0]).toMatchObject({ event: "created", fields: { reason: "daily", path, bytes: expect.any(Number) as unknown } });
    expect(logger.lines[0]?.fields.bytes).toBeGreaterThan(0);
  });

  test("a failure is logged and rethrown", () => {
    const logger = memoryLogger();
    const db = openDb(join(dir, "tracker.db"));
    open.push(db);
    writeFileSync(backups, "not a dir");
    expect(() => backupTracker(db, { dir: backups, reason: "premigration", now: () => at("2026-10-16T12:00:00.000Z"), logger })).toThrow();
    expect(logger.lines).toMatchObject([{ level: "error", cat: "backup", event: "failed", fields: { reason: "premigration" } }]);
  });

  test("a copy that fails part-way leaves no file that looks like a backup", () => {
    const logger = memoryLogger();
    const db = openDb(join(dir, "tracker.db"));
    open.push(db);
    // Stands in for VACUUM INTO hitting a full disk after writing some of the file.
    const failing: Db = {
      ...db,
      run: (_sql, target) => {
        writeFileSync(String(target), "partial");
        throw new Error("database or disk is full");
      },
    };
    expect(() => backupTracker(failing, { dir: backups, reason: "daily", now: () => at("2026-10-16T12:00:00.000Z"), logger })).toThrow(/disk is full/);
    expect(readdirSync(backups)).toEqual([]);
    expect(dailyBackupDue(backups, at("2026-10-16T12:00:01.000Z"))).toBe(true);
  });
});

describe("pruneBackups", () => {
  test("keeps the newest 7 backups and leaves other files alone", () => {
    const days = Array.from({ length: 9 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`);
    seed(...days);
    writeFileSync(join(backups, "notes.txt"), "");
    writeFileSync(join(backups, "raw-20260101-000000-000-daily.db"), "");
    // Left by a backup that was killed mid-copy.
    const partial = `${backupName(at("2026-09-01T00:00:00.000Z"), "daily")}.partial`;
    writeFileSync(join(backups, partial), "");
    const logger = memoryLogger();
    pruneBackups(backups, { logger });
    const left = readdirSync(backups).sort();
    expect(left).toEqual([...days.slice(2).map((d) => backupName(at(d), "daily")), "notes.txt", "raw-20260101-000000-000-daily.db"].sort());
    expect(logger.lines).toMatchObject([{ event: "pruned", fields: { removed: [partial, backupName(at(days[0] ?? ""), "daily"), backupName(at(days[1] ?? ""), "daily")] } }]);
  });

  test("no backups dir yet: nothing removed, nothing logged", () => {
    const logger = memoryLogger();
    pruneBackups(backups, { logger });
    expect(logger.lines).toEqual([]);
  });

  test("seven or fewer: nothing removed, nothing logged", () => {
    seed("2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");
    const logger = memoryLogger();
    pruneBackups(backups, { logger });
    expect(readdirSync(backups)).toHaveLength(2);
    expect(logger.lines).toEqual([]);
  });

  test("a file that can't be deleted (open elsewhere) is logged, not thrown", () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`);
    mkdirSync(backups);
    const oldest = join(backups, backupName(at(days[0] ?? ""), "daily"));
    open.push(openDb(oldest)); // Windows refuses to delete a file another handle holds open
    seed(...days.slice(1));
    const logger = memoryLogger();
    expect(() => {
      pruneBackups(backups, { logger });
    }).not.toThrow();
    expect(logger.events()).toEqual(["backup/prune_failed"]);
    expect(logger.lines[0]?.fields).toMatchObject({ path: oldest });
  });
});

describe("dailyBackupDue", () => {
  const now = at("2026-10-16T12:00:00.000Z");
  test("due when there is no backups dir or no backup", () => {
    expect(dailyBackupDue(backups, now)).toBe(true);
    mkdirSync(backups);
    writeFileSync(join(backups, "notes.txt"), "");
    expect(dailyBackupDue(backups, now)).toBe(true);
  });

  test("not due when the newest backup is under 24 h old, whatever its reason", () => {
    seed("2026-10-10T00:00:00.000Z");
    writeFileSync(join(backups, backupName(new Date(now.getTime() - 23 * HOUR), "premigration")), "");
    expect(dailyBackupDue(backups, now)).toBe(false);
  });

  test("due a few minutes short of 24 h, so a check that fires a little early doesn't slip an hour", () => {
    seed(new Date(now.getTime() - 24 * HOUR + 60_000).toISOString());
    expect(dailyBackupDue(backups, now)).toBe(true);
  });

  test("not due just outside the 5-minute slack", () => {
    seed(new Date(now.getTime() - 24 * HOUR + 5 * 60_000 + 1).toISOString());
    expect(dailyBackupDue(backups, now)).toBe(false);
  });

  test("due when the newest backup is 24 h old or more", () => {
    seed(new Date(now.getTime() - 24 * HOUR).toISOString());
    expect(dailyBackupDue(backups, now)).toBe(true);
  });

  test("due when the newest backup is dated in the future (the clock moved back)", () => {
    seed(new Date(now.getTime() + HOUR).toISOString());
    expect(dailyBackupDue(backups, now)).toBe(true);
  });
});

describe("runDailyBackup", () => {
  test("stamps the backup with the instant it checked, so tomorrow's check finds it exactly 24 h old", () => {
    const db = openDb(join(dir, "tracker.db"));
    open.push(db);
    let t = Date.parse("2026-10-16T12:00:00.000Z");
    const ticking = () => new Date(t++); // each call 1 ms later
    runDailyBackup(db, { dir: backups, now: ticking, logger: memoryLogger() });
    expect(readdirSync(backups)).toEqual(["tracker-20261016-120000-000-daily.db"]);
  });

  test("a due backup waits while a match is recording, logged", () => {
    const db = openDb(join(dir, "tracker.db"));
    open.push(db);
    const logger = memoryLogger();
    runDailyBackup(db, { dir: backups, now: () => at("2026-10-16T12:00:00.000Z"), logger, isRecording: () => true });
    expect(dailyBackupDue(backups, at("2026-10-16T12:00:00.000Z"))).toBe(true);
    expect(logger.events()).toEqual(["backup/skipped_recording"]);
  });

  test("a throwing isRecording is logged, not thrown", () => {
    const db = openDb(join(dir, "tracker.db"));
    open.push(db);
    const logger = memoryLogger();
    const isRecording = () => {
      throw new Error("recorder gone");
    };
    expect(() => {
      runDailyBackup(db, { dir: backups, now: () => at("2026-10-16T12:00:00.000Z"), logger, isRecording });
    }).not.toThrow();
    expect(logger.events()).toEqual(["backup/failed"]);
  });
});
