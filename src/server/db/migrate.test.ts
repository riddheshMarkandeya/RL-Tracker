import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { migrate } from "./migrate";
import { openDb, type Db } from "./sqlite";

let dir: string;
const open: Db[] = [];
const db = (name = "t.db", busyTimeoutMs?: number) => {
  const d = openDb(join(dir, name), { busyTimeoutMs });
  open.push(d);
  return d;
};
const tables = (d: Db) => d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-migrate-"));
});
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  rmSync(dir, { recursive: true, force: true });
});

const v1 = "CREATE TABLE a(x); INSERT INTO a VALUES (1);";
const v2 = "CREATE TABLE b(y);";

describe("migrate", () => {
  test("a fresh DB runs every migration and logs from/to", () => {
    const logger = memoryLogger();
    const d = db();
    expect(migrate(d, "t", [v1, v2], { logger })).toEqual({ from: 0, to: 2 });
    expect(d.pragma("user_version")).toBe(2);
    expect(tables(d)).toEqual(["a", "b"]);
    expect(logger.lines).toMatchObject([{ level: "info", cat: "db", event: "migrated", fields: { db: "t", from: 0, to: 2 } }]);
    expect(logger.lines[0]?.fields.ms).toBeTypeOf("number");
  });

  test("an existing v1 DB upgrades to v2 and keeps its rows", () => {
    const logger = memoryLogger();
    const first = db();
    migrate(first, "t", [v1], { logger });
    first.run("INSERT INTO a VALUES (2)");
    first.close();
    open.length = 0;
    const d = db();
    const seen: number[] = [];
    expect(migrate(d, "t", [v1, v2], { logger, beforeMigrate: (from) => seen.push(from) })).toEqual({ from: 1, to: 2 });
    expect(seen).toEqual([1]);
    expect(d.all("SELECT x FROM a ORDER BY x")).toEqual([{ x: 1 }, { x: 2 }]);
    expect(tables(d)).toEqual(["a", "b"]);
  });

  test("an up-to-date DB does nothing and logs nothing", () => {
    const d = db();
    migrate(d, "t", [v1], { logger: memoryLogger() });
    const logger = memoryLogger();
    let called = false;
    expect(migrate(d, "t", [v1], { logger, beforeMigrate: () => (called = true) })).toEqual({ from: 1, to: 1 });
    expect(called).toBe(false);
    expect(logger.lines).toEqual([]);
  });

  test("a throwing migration rolls back its own changes and version, and is logged", () => {
    const logger = memoryLogger();
    const d = db();
    const bad = "CREATE TABLE c(z); INSERT INTO missing VALUES (1);";
    expect(() => migrate(d, "t", [v1, bad], { logger })).toThrow(/missing/);
    expect(d.pragma("user_version")).toBe(1);
    expect(tables(d)).toEqual(["a"]);
    expect(logger.events()).toEqual(["db/migration_failed"]);
    expect(logger.lines[0]?.fields).toMatchObject({ db: "t", version: 2 });
  });

  test("a DB newer than the code throws and is logged", () => {
    const logger = memoryLogger();
    const d = db();
    d.run("PRAGMA user_version = 3");
    expect(() => migrate(d, "t", [v1], { logger })).toThrow(/newer/);
    expect(logger.lines[0]).toMatchObject({ level: "error", event: "newer_than_code", fields: { db: "t", version: 3, known: 1 } });
    expect(tables(d)).toEqual([]);
  });

  test("a second instance that migrated first is seen inside the lock, so the SQL runs once", () => {
    const logger = memoryLogger();
    const a = db();
    const b = db();
    let bResult: unknown;
    const aResult = migrate(a, "t", [v1, v2], {
      logger,
      // A has already seen pending work; B now does all of it before A takes the lock.
      beforeMigrate: () => (bResult = migrate(b, "t", [v1, v2], { logger })),
    });
    expect(bResult).toEqual({ from: 0, to: 2 });
    expect(aResult).toEqual({ from: 2, to: 2 });
    expect(a.all("SELECT x FROM a")).toEqual([{ x: 1 }]);
    expect(logger.events()).toEqual(["db/migrated"]);
  });

  test("a lock held by another connection fails with SQLITE_BUSY, logged", () => {
    const logger = memoryLogger();
    const holder = db();
    const d = db("t.db", 50);
    holder.run("BEGIN EXCLUSIVE");
    try {
      expect(() => migrate(d, "t", [v1], { logger })).toThrow();
    } finally {
      holder.run("ROLLBACK");
    }
    expect(logger.events()).toEqual(["db/migration_failed"]);
    expect(logger.lines[0]?.fields.err).toMatchObject({ code: "SQLITE_BUSY" });
  });
});
