import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RETENTION_DAYS } from "../../shared/constants";
import { openStorage, type Storage } from "../storage";
import { memoryLogger } from "../testing";
import { rawMigrations } from "./migrations";
import { runRetention } from "./retention";
import { openDb } from "./sqlite";

const DAY = 24 * 3600_000;
const NOW = new Date("2026-10-16T12:00:00.000Z");
const now = () => NOW;
const yieldFn = () => Promise.resolve();

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-retention-"));
  storage = openStorage({ dir, logger: memoryLogger(), now });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Inserts `n` events at `ts`, each with `bytes` of data. */
function insert(ts: number, n: number, bytes = 10, guid = `m${String(ts)}`) {
  storage.raw.transaction(() => {
    for (let i = 0; i < n; i++) storage.raw.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES (?, ?, ?, 'UpdateState', ?)", guid, i, ts, "x".repeat(bytes));
  });
}
const count = () => storage.raw.get<{ n: number }>("SELECT count(*) AS n FROM events")?.n;
const cutoff = NOW.getTime() - RETENTION_DAYS * DAY;

describe("runRetention", () => {
  test("deletes events older than the retention window and keeps the rest", async () => {
    insert(cutoff - 1, 3);
    insert(cutoff, 2); // exactly at the edge: kept
    insert(NOW.getTime() - DAY, 4);
    const logger = memoryLogger();
    const result = await runRetention(storage.raw, { now, isRecording: () => false, logger, yieldFn });
    expect(result).toMatchObject({ status: "done", events: 3 });
    expect(count()).toBe(6);
    expect(logger.lines).toMatchObject([{ level: "info", cat: "retention", event: "done", fields: { events: 3 } }]);
  });

  test("works through several batches", async () => {
    insert(cutoff - DAY, 5);
    const logger = memoryLogger();
    const result = await runRetention(storage.raw, { now, isRecording: () => false, logger, yieldFn, batchSize: 2 });
    expect(result).toMatchObject({ status: "done", events: 5, batches: 3 });
    expect(count()).toBe(0);
  });

  test("finishes on a file without incremental auto_vacuum, where vacuum frees nothing", async () => {
    const plain = openDb(join(dir, "plain.db"));
    plain.exec(rawMigrations.join(";"));
    plain.transaction(() => {
      for (let i = 0; i < 500; i++) plain.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES ('m', ?, ?, 'UpdateState', ?)", i, cutoff - DAY, "x".repeat(1000));
    });
    const logger = memoryLogger();
    const result = await runRetention(plain, { now, isRecording: () => false, logger, yieldFn, vacuumPages: 10 });
    expect(result).toMatchObject({ status: "done", events: 500 });
    expect(logger.events()).toEqual(["retention/vacuum_noop", "retention/done"]);
    expect(plain.pragma("freelist_count")).toBeGreaterThan(0);
    plain.close();
  });

  test("frees pages with incremental_vacuum and reports the MB removed", async () => {
    insert(cutoff - DAY, 2000, 1000);
    insert(NOW.getTime(), 10);
    const pagesBefore = storage.raw.pragma("page_count") as number;
    const logger = memoryLogger();
    const result = await runRetention(storage.raw, { now, isRecording: () => false, logger, yieldFn });
    const pagesAfter = storage.raw.pragma("page_count") as number;
    expect(pagesAfter).toBeLessThan(pagesBefore / 10);
    const pageSize = storage.raw.pragma("page_size") as number;
    const expectedMb = ((pagesBefore - pagesAfter) * pageSize) / 1024 / 1024;
    expect(result).toMatchObject({ status: "done", events: 2000 });
    expect(logger.lines[0]?.fields.mb).toBeCloseTo(expectedMb, 1);
    expect(expectedMb).toBeGreaterThan(1.5); // 2000 x 1 KB rows
  });

  test("pages the recorder reuses while the vacuum yields don't count as removed", async () => {
    insert(cutoff - DAY, 2000, 1000);
    const pagesBefore = storage.raw.pragma("page_count") as number;
    const logger = memoryLogger();
    let yields = 0;
    // On the first yield, ~300 KB of inserts take pages off the freelist without growing the file.
    const recorderYield = () => {
      if (yields++ === 0) insert(NOW.getTime(), 300, 1000);
      return Promise.resolve();
    };
    await runRetention(storage.raw, { now, isRecording: () => false, logger, yieldFn: recorderYield, vacuumPages: 10 });
    const removedMb = ((pagesBefore - (storage.raw.pragma("page_count") as number)) * (storage.raw.pragma("page_size") as number)) / 1024 / 1024;
    expect(logger.lines.find((l) => l.event === "done")?.fields.mb).toBeCloseTo(removedMb, 1);
  });

  test("skips entirely while a match is recording, logged", async () => {
    insert(cutoff - DAY, 3);
    const logger = memoryLogger();
    const result = await runRetention(storage.raw, { now, isRecording: () => true, logger, yieldFn });
    expect(result).toMatchObject({ status: "skipped", events: 0 });
    expect(count()).toBe(3);
    expect(logger.events()).toEqual(["retention/skipped_recording"]);
  });

  test("stops between batches when a match starts recording", async () => {
    insert(cutoff - DAY, 6);
    let checks = 0;
    const logger = memoryLogger();
    const result = await runRetention(storage.raw, { now, isRecording: () => ++checks > 2, logger, yieldFn, batchSize: 2 });
    expect(result).toMatchObject({ status: "stopped", events: 4, batches: 2 });
    expect(count()).toBe(2);
    expect(logger.lines).toMatchObject([{ event: "stopped", fields: { reason: "recording", events: 4, batches: 2 } }]);
  });

  test("stops between batches when shutdown begins", async () => {
    insert(cutoff - DAY, 6);
    let shuttingDown = false;
    const logger = memoryLogger();
    const yieldOnce = () => {
      shuttingDown = true;
      return Promise.resolve();
    };
    const result = await runRetention(storage.raw, { now, isRecording: () => false, stopping: () => shuttingDown, logger, yieldFn: yieldOnce, batchSize: 2 });
    expect(result).toMatchObject({ status: "stopped", events: 2, batches: 1 });
    expect(logger.lines).toMatchObject([{ event: "stopped", fields: { reason: "shutdown" } }]);
  });

  test("vacuums in steps, and a run that stops mid-vacuum leaves the rest to the next run", async () => {
    insert(cutoff - DAY, 2000, 1000);
    const pagesBefore = storage.raw.pragma("page_count") as number;
    let checks = 0;
    const first = await runRetention(storage.raw, { now, isRecording: () => ++checks > 1, logger: memoryLogger(), yieldFn, vacuumPages: 10 });
    expect(first).toMatchObject({ status: "stopped", events: 2000 });
    expect(storage.raw.pragma("freelist_count")).toBeGreaterThan(0);
    const second = await runRetention(storage.raw, { now, isRecording: () => false, logger: memoryLogger(), yieldFn, vacuumPages: 10 });
    expect(second).toMatchObject({ status: "done", events: 0 });
    expect(storage.raw.pragma("freelist_count")).toBe(0);
    expect(storage.raw.pragma("page_count")).toBeLessThan(pagesBefore / 10);
  });

  test("a SQLite failure is logged and rethrown", async () => {
    storage.raw.exec("DROP TABLE events");
    const logger = memoryLogger();
    await expect(runRetention(storage.raw, { now, isRecording: () => false, logger, yieldFn })).rejects.toThrow(/events/);
    expect(logger.events()).toEqual(["retention/failed"]);
  });
});
