import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDb } from "./sqlite";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-sqlite-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openDb", () => {
  test("sets WAL, foreign keys and the busy timeout", () => {
    const db = openDb(join(dir, "a.db"));
    expect(db.pragma("journal_mode")).toBe("wal");
    expect(db.pragma("foreign_keys")).toBe(1);
    expect(db.pragma("busy_timeout")).toBe(5000);
    expect(db.pragma("auto_vacuum")).toBe(0);
    db.close();
  });

  test("autoVacuum: incremental on a new file survives WAL and table creation", () => {
    const path = join(dir, "raw.db");
    const db = openDb(path, { autoVacuum: "incremental", busyTimeoutMs: 100 });
    db.run("CREATE TABLE t(x)");
    expect(db.pragma("busy_timeout")).toBe(100);
    db.close();
    const again = openDb(path);
    expect(again.pragma("auto_vacuum")).toBe(2);
    again.close();
  });

  test("run, get and all bind parameters", () => {
    const db = openDb(join(dir, "a.db"));
    db.run("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)");
    expect(db.run("INSERT INTO t(name) VALUES (?), (?)", "a", "b").changes).toBe(2);
    expect(db.get<{ name: string }>("SELECT name FROM t WHERE id = ?", 2)).toEqual({ name: "b" });
    expect(db.get("SELECT name FROM t WHERE id = ?", 9)).toBeUndefined();
    expect(db.all<{ id: number }>("SELECT id FROM t ORDER BY id")).toEqual([{ id: 1 }, { id: 2 }]);
    db.close();
  });

  test("exec runs several statements", () => {
    const db = openDb(join(dir, "a.db"));
    db.exec("CREATE TABLE a(x); CREATE TABLE b(y); INSERT INTO a VALUES (1);");
    expect(db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).toEqual([{ name: "a" }, { name: "b" }]);
    db.close();
  });

  test("transaction commits its result, and rolls back on throw", () => {
    const db = openDb(join(dir, "a.db"));
    db.run("CREATE TABLE t(x)");
    expect(db.transaction(() => db.run("INSERT INTO t VALUES (1)").changes)).toBe(1);
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t VALUES (2)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.all("SELECT x FROM t")).toEqual([{ x: 1 }]);
    // An async callback would commit before its awaits run, so the type rejects it.
    // @ts-expect-error: async fn
    expect(() => db.transaction(async () => Promise.resolve())).toThrow();
    // Its later rejection must not surface as an unhandled rejection (vitest fails the run on one).
    // @ts-expect-error: async fn
    expect(() => db.transaction(async () => Promise.reject(new Error("late")))).toThrow(TypeError);
    // The type only catches PromiseLike; the runtime check catches any thenable.
    expect(() => db.transaction(() => ({ then: () => undefined }))).toThrow(TypeError);
    db.close();
  });

  test("throws when the file can't use WAL", () => {
    // An in-memory DB reports journal_mode "memory", like a filesystem without WAL support.
    expect(() => openDb(":memory:")).toThrow(/journal_mode/);
  });
});
