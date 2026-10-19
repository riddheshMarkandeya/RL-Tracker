import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RETENTION_DAYS } from "../shared/constants";
import { scheduleMaintenance } from "./maintenance";
import { openStorage, type Storage } from "./storage";
import { memoryLogger } from "./testing";

const DAY = 24 * 3600_000;
const HOUR = 3600_000;
const MIN = 60_000;
const NOW = new Date("2026-10-16T12:00:00.000Z");
const yieldFn = () => Promise.resolve();

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-maintenance-"));
  storage = openStorage({ dir, logger: memoryLogger(), now: () => NOW });
});
afterEach(() => {
  vi.useRealTimers();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("scheduleMaintenance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  const clockNow = () => new Date(Date.now());

  test("runs retention 5 min after start, then every 24 h", async () => {
    const logger = memoryLogger();
    const m = scheduleMaintenance({ storage, logger, now: clockNow, yieldFn });
    await vi.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(logger.events()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.events()).toEqual(["retention/done"]);
    await vi.advanceTimersByTimeAsync(DAY - 1);
    expect(logger.events().filter((e) => e === "retention/done")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.events().filter((e) => e === "retention/done")).toHaveLength(2);
    await m.stop();
  });

  test("a run skipped for recording retries after 15 min", async () => {
    let recording = true;
    const logger = memoryLogger();
    const m = scheduleMaintenance({ storage, logger, now: clockNow, yieldFn, isRecording: () => recording });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(logger.events()).toEqual(["retention/skipped_recording"]);
    recording = false;
    await vi.advanceTimersByTimeAsync(15 * MIN - 1);
    expect(logger.events()).toEqual(["retention/skipped_recording"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.events()).toEqual(["retention/skipped_recording", "retention/done"]);
    await m.stop();
  });

  test("a failing run doesn't stop the next one", async () => {
    const logger = memoryLogger();
    let fail = true;
    const raw = {
      ...storage.raw,
      run: (sql: string, ...params: Parameters<Storage["raw"]["run"]>[1][]) => {
        if (fail) throw new Error("disk I/O error");
        return storage.raw.run(sql, ...params);
      },
    };
    const m = scheduleMaintenance({ storage: { ...storage, raw }, logger, now: clockNow, yieldFn });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(logger.events()).toEqual(["retention/failed"]);
    fail = false;
    await vi.advanceTimersByTimeAsync(DAY);
    expect(logger.events()).toContain("retention/done");
    await m.stop();
  });

  test("checks hourly, so a backup that wasn't quite due at startup comes about 24 h after the last", async () => {
    const backups = () => readdirSync(join(dir, "backups"));
    expect(backups()).toHaveLength(1); // made at startup, at NOW
    vi.setSystemTime(NOW.getTime() + 23.5 * HOUR); // the app restarts 23.5 h later: not yet due
    const m = scheduleMaintenance({ storage, logger: memoryLogger(), now: clockNow, yieldFn });
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(backups()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // 24.5 h after the last one
    expect(backups()).toHaveLength(2);
    await m.stop();
  });

  test("a due backup waits while a match is recording, then runs at the next hourly check", async () => {
    const backups = () => readdirSync(join(dir, "backups"));
    vi.setSystemTime(NOW.getTime() + DAY); // due from the first check
    let recording = true;
    const m = scheduleMaintenance({ storage, logger: memoryLogger(), now: clockNow, yieldFn, isRecording: () => recording });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(backups()).toHaveLength(1);
    recording = false;
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(backups()).toHaveLength(2);
    await m.stop();
  });

  test("stop() cancels everything pending", async () => {
    const logger = memoryLogger();
    const m = scheduleMaintenance({ storage, logger, now: clockNow, yieldFn });
    await m.stop();
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(logger.events()).toEqual([]);
  });

  test("stop() waits for a run in progress, which stops at the next batch", async () => {
    // More than one 5000-row batch, so the run pauses between batches.
    storage.raw.transaction(() => {
      for (let i = 0; i < 6000; i++) storage.raw.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES ('old', ?, ?, 'UpdateState', '{}')", i, NOW.getTime() - (RETENTION_DAYS + 1) * DAY);
    });
    let release: () => void = () => undefined;
    const heldYield = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const logger = memoryLogger();
    const m = scheduleMaintenance({ storage, logger, now: clockNow, yieldFn: heldYield });
    await vi.advanceTimersByTimeAsync(5 * MIN); // first batch done, paused
    const stopping = m.stop();
    release();
    await stopping;
    expect(logger.lines).toMatchObject([{ event: "stopped", fields: { reason: "shutdown", events: 5000 } }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
