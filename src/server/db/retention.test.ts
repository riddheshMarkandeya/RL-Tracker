import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RETENTION_DAYS } from "../../shared/constants";
import { feed } from "../recorder/feed";
import { createRecorder } from "../recorder/recorder";
import { createRawStore } from "../recorder/store";
import { openStorage, type Storage } from "../storage";
import { memoryLogger, readFixture } from "../testing";
import { rawMigrations } from "./migrations";
import { runRetention, type RetentionOptions } from "./retention";
import { openDb } from "./sqlite";

const DAY = 24 * 3600_000;
const NOW = new Date("2027-06-01T12:00:00.000Z");
const now = () => NOW;
const yieldFn = () => Promise.resolve();
const cutoff = NOW.getTime() - RETENTION_DAYS * DAY;
const OLD = cutoff - 10 * DAY;

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

const run = (over: Partial<RetentionOptions> = {}) => runRetention(storage.raw, { now, isRecording: () => false, logger: memoryLogger(), yieldFn, ...over });

/** Inserts `names` (with data) as `guid`'s events from `seq0`, one second apart from `ts`. */
function insertMatch(guid: string, ts: number, events: readonly (string | [string, unknown])[], seq0 = 0) {
  storage.raw.transaction(() => {
    events.forEach((e, i) => {
      const [name, data] = typeof e === "string" ? [e, {}] : e;
      storage.raw.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES (?, ?, ?, ?, ?)", guid, seq0 + i, ts + i * 1000, name, JSON.stringify(data));
    });
  });
}
/** A closed match no playlist was seen in, so it is flagged. */
function flaggedMatch(guid: string, ts: number) {
  const state: [string, unknown] = ["UpdateState", { Players: [], Game: {} }];
  insertMatch(guid, ts, ["MatchCreated", "MatchInitialized", state, state, state, ["MatchEnded", { WinnerTeamNum: 0 }], "MatchDestroyed"]);
}

/** The completed fixture, recorded and then moved to `ts`. Its one match is unflagged. */
function completedAt(ts: number): string {
  const recorder = createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished: () => undefined });
  feed(recorder, readFixture("completed"));
  recorder.flush();
  const guid = createRawStore(storage.raw).matches()[0]?.guid ?? "";
  const first = storage.raw.get<{ ts: number }>("SELECT MIN(ts) AS ts FROM events WHERE match_guid = ?", guid)?.ts ?? 0;
  storage.raw.run("UPDATE events SET ts = ts - ? + ? WHERE match_guid = ?", first, ts, guid);
  return guid;
}

const rows = (guid: string, where = "1") => storage.raw.all<{ seq: number; ts: number; name: string; data: string }>(`SELECT seq, ts, name, data FROM events WHERE match_guid = ? AND ${where} ORDER BY seq`, guid);
const decision = (guid: string) => storage.raw.get("SELECT * FROM retention_matches WHERE match_guid = ?", guid);

describe("runRetention", () => {
  test("thins an old unflagged match: other events untouched, kept states byte-equal, the snapshot stored", async () => {
    const guid = completedAt(OLD);
    const others = rows(guid, "name <> 'UpdateState'");
    const states = rows(guid, "name = 'UpdateState'");
    const logger = memoryLogger();
    const result = await run({ logger });
    const kept = rows(guid, "name = 'UpdateState'");
    expect(result).toMatchObject({ status: "done", thinned: 1, exempt: 0, states: states.length - kept.length });
    expect(kept.length).toBeLessThan(states.length);
    expect(rows(guid, "name <> 'UpdateState'")).toEqual(others);
    for (const k of kept) expect(states.find((s) => s.seq === k.seq)).toEqual(k);
    expect(kept[0]).toEqual(states[0]);
    expect(kept.at(-1)).toEqual(states.at(-1));
    const row = decision(guid);
    expect(row).toMatchObject({ status: "thinned", decided_at: NOW.getTime(), states_before: states.length, states_after: kept.length, flags: null });
    const outputs = JSON.parse(String(row?.outputs)) as { cameraKey: string | null; players: Record<string, Record<string, number | null>> };
    expect(outputs.cameraKey).not.toBeNull();
    expect(Object.keys(Object.values(outputs.players)[0] ?? {}).sort()).toEqual(["boost_avg", "car_ms", "empty_boost_ms", "supersonic_ms"]);
    expect(logger.lines.find((l) => l.event === "thinned")?.fields).toMatchObject({ guid, before: states.length, after: kept.length });
  });

  test("an old flagged match stays whole, with an exempt row naming its flags", async () => {
    flaggedMatch("F", OLD);
    const before = rows("F");
    const logger = memoryLogger();
    const result = await run({ logger });
    expect(result).toMatchObject({ status: "done", exempt: 1, thinned: 0, states: 0 });
    expect(rows("F")).toEqual(before);
    expect(decision("F")).toMatchObject({ status: "exempt", outputs: null });
    expect(JSON.parse(String(decision("F")?.flags))).toContain("playlist_present");
    expect(logger.lines.find((l) => l.event === "exempt")?.fields).toMatchObject({ guid: "F" });
  });

  test("an exempt match is re-checked only when the rule versions changed", async () => {
    flaggedMatch("F", OLD);
    await run();
    const same = memoryLogger();
    expect(await run({ logger: same })).toMatchObject({ exempt: 0 });
    expect(same.events()).not.toContain("retention/exempt");
    // The same versions in another key order are no change.
    const versions = JSON.parse(String(decision("F")?.rule_versions)) as Record<string, number>;
    storage.raw.run("UPDATE retention_matches SET rule_versions = ?", JSON.stringify(Object.fromEntries(Object.entries(versions).reverse())));
    expect(await run()).toMatchObject({ exempt: 0 });
    storage.raw.run("UPDATE retention_matches SET rule_versions = ?", JSON.stringify({ ...versions, car_sampling: 0 }));
    const changed = memoryLogger();
    expect(await run({ logger: changed })).toMatchObject({ exempt: 1 });
    expect(changed.events()).toContain("retention/exempt");
    expect(JSON.parse(String(decision("F")?.rule_versions))).toEqual(versions);
  });

  test("a recent match and one whose last event is inside the window are untouched", async () => {
    flaggedMatch("recent", NOW.getTime() - DAY);
    flaggedMatch("straddles", cutoff - 3000);
    const result = await run();
    expect(result).toMatchObject({ status: "done", thinned: 0, exempt: 0, keptWhole: 0 });
    expect(decision("recent")).toBeUndefined();
    expect(decision("straddles")).toBeUndefined();
    expect(rows("straddles")).toHaveLength(7);
  });

  test("a lobby, an open match and a trimmed match stay whole, each logged with its reason", async () => {
    insertMatch("lobby", OLD, ["MatchCreated", "UpdateState", "MatchDestroyed"]);
    insertMatch("open", OLD, ["MatchCreated", "MatchInitialized", "UpdateState", "UpdateState"]);
    insertMatch("trimmed", OLD, ["UpdateState", "UpdateState", ["MatchEnded", { WinnerTeamNum: 0 }], "MatchDestroyed"], 5);
    const logger = memoryLogger();
    const result = await run({ logger });
    expect(result).toMatchObject({ status: "done", keptWhole: 3, thinned: 0, exempt: 0 });
    expect(storage.raw.get<{ n: number }>("SELECT count(*) AS n FROM events")?.n).toBe(11);
    expect(storage.raw.get<{ n: number }>("SELECT count(*) AS n FROM retention_matches")?.n).toBe(0);
    const kept = logger.lines.filter((l) => l.event === "kept_whole").map((l) => [l.level, l.fields.guid, l.fields.reason]);
    expect(kept).toEqual([
      ["info", "lobby", "lobby"],
      ["warn", "open", "open"],
      ["warn", "trimmed", "trimmed"],
    ]);
  });

  test("a match whose read throws stays whole, is logged, and the run goes on", async () => {
    insertMatch("bad", OLD, ["MatchCreated", "MatchInitialized", ["UpdateState", null], ["MatchEnded", { WinnerTeamNum: 0 }], "MatchDestroyed"]);
    flaggedMatch("F", OLD + 60_000);
    const logger = memoryLogger();
    const result = await run({ logger });
    expect(result).toMatchObject({ status: "done", failed: 1, exempt: 1 });
    expect(rows("bad")).toHaveLength(5);
    expect(decision("bad")).toBeUndefined();
    expect(logger.lines.find((l) => l.event === "thin_failed")).toMatchObject({ level: "error", fields: { guid: "bad" } });
  });

  test("a second run is a no-op", async () => {
    const guid = completedAt(OLD);
    flaggedMatch("F", OLD);
    await run();
    const before = storage.raw.all("SELECT * FROM events ORDER BY id");
    const decided = storage.raw.all("SELECT * FROM retention_matches ORDER BY 1");
    const logger = memoryLogger();
    expect(await run({ logger })).toEqual({ status: "done", thinned: 0, exempt: 0, keptWhole: 0, failed: 0, states: 0 });
    expect(storage.raw.all("SELECT * FROM events ORDER BY id")).toEqual(before);
    expect(storage.raw.all("SELECT * FROM retention_matches ORDER BY 1")).toEqual(decided);
    expect(logger.events()).toEqual(["retention/done"]);
    expect(decision(guid)?.status).toBe("thinned");
  });

  test("skips entirely while a match is recording, logged", async () => {
    flaggedMatch("F", OLD);
    const logger = memoryLogger();
    const result = await run({ isRecording: () => true, logger });
    expect(result).toMatchObject({ status: "skipped", exempt: 0 });
    expect(decision("F")).toBeUndefined();
    expect(logger.events()).toEqual(["retention/skipped_recording"]);
  });

  test("stops between matches when a match starts recording", async () => {
    flaggedMatch("A", OLD);
    flaggedMatch("B", OLD + 60_000);
    let checks = 0;
    const logger = memoryLogger();
    const result = await run({ isRecording: () => ++checks > 1, logger });
    expect(result).toMatchObject({ status: "stopped", exempt: 1 });
    expect(decision("A")).toBeDefined();
    expect(decision("B")).toBeUndefined();
    expect(logger.lines.find((l) => l.event === "stopped")).toMatchObject({ fields: { reason: "recording", exempt: 1 } });
  });

  test("stops between matches when shutdown begins", async () => {
    flaggedMatch("A", OLD);
    flaggedMatch("B", OLD + 60_000);
    let shuttingDown = false;
    const yieldOnce = () => {
      shuttingDown = true;
      return Promise.resolve();
    };
    const logger = memoryLogger();
    const result = await run({ stopping: () => shuttingDown, logger, yieldFn: yieldOnce });
    expect(result).toMatchObject({ status: "stopped", exempt: 1 });
    expect(logger.lines.find((l) => l.event === "stopped")).toMatchObject({ fields: { reason: "shutdown" } });
  });

  test("a SQLite failure is logged and rethrown", async () => {
    storage.raw.exec("DROP TABLE retention_matches");
    const logger = memoryLogger();
    await expect(run({ logger })).rejects.toThrow(/retention_matches/);
    expect(logger.events()).toEqual(["retention/failed"]);
  });
});

describe("runRetention's vacuum", () => {
  /** Leaves `n` rows of `bytes` each deleted, their pages on the freelist, as a stopped run would. */
  function freed(db: typeof storage.raw, n: number, bytes = 1000) {
    db.transaction(() => {
      for (let i = 0; i < n; i++) db.run("INSERT INTO events(match_guid, seq, ts, name, data) VALUES ('gone', ?, ?, 'UpdateState', ?)", i, NOW.getTime(), "x".repeat(bytes));
    });
    db.run("DELETE FROM events WHERE match_guid = 'gone'");
  }

  test("finishes on a file without incremental auto_vacuum, where vacuum frees nothing", async () => {
    const plain = openDb(join(dir, "plain.db"));
    plain.exec(rawMigrations.join(";"));
    freed(plain, 500);
    const logger = memoryLogger();
    const result = await runRetention(plain, { now, isRecording: () => false, logger, yieldFn, vacuumPages: 10 });
    expect(result).toMatchObject({ status: "done" });
    expect(logger.events()).toEqual(["retention/vacuum_noop", "retention/done"]);
    expect(plain.pragma("freelist_count")).toBeGreaterThan(0);
    plain.close();
  });

  test("frees pages with incremental_vacuum and reports the MB removed", async () => {
    freed(storage.raw, 2000);
    const pagesBefore = storage.raw.pragma("page_count") as number;
    const logger = memoryLogger();
    await run({ logger });
    const pagesAfter = storage.raw.pragma("page_count") as number;
    expect(pagesAfter).toBeLessThan(pagesBefore / 10);
    const expectedMb = ((pagesBefore - pagesAfter) * (storage.raw.pragma("page_size") as number)) / 1024 / 1024;
    expect(logger.lines.find((l) => l.event === "done")?.fields.mb).toBeCloseTo(expectedMb, 1);
    expect(expectedMb).toBeGreaterThan(1.5); // 2000 x 1 KB rows
  });

  test("pages the recorder reuses while the vacuum yields don't count as removed", async () => {
    freed(storage.raw, 2000);
    const pagesBefore = storage.raw.pragma("page_count") as number;
    const logger = memoryLogger();
    let yields = 0;
    // On the first yield, ~300 KB of inserts take pages off the freelist without growing the file.
    const recorderYield = () => {
      if (yields++ === 0) insertMatch("live", NOW.getTime(), Array.from({ length: 300 }, () => ["UpdateState", "x".repeat(1000)] as [string, string]));
      return Promise.resolve();
    };
    await run({ logger, yieldFn: recorderYield, vacuumPages: 10 });
    const removedMb = ((pagesBefore - (storage.raw.pragma("page_count") as number)) * (storage.raw.pragma("page_size") as number)) / 1024 / 1024;
    expect(logger.lines.find((l) => l.event === "done")?.fields.mb).toBeCloseTo(removedMb, 1);
  });

  test("vacuums in steps, and a run that stops mid-vacuum leaves the rest to the next run", async () => {
    freed(storage.raw, 2000);
    const pagesBefore = storage.raw.pragma("page_count") as number;
    let checks = 0;
    const first = await run({ isRecording: () => ++checks > 1, vacuumPages: 10 });
    expect(first).toMatchObject({ status: "stopped" });
    expect(storage.raw.pragma("freelist_count")).toBeGreaterThan(0);
    const second = await run({ vacuumPages: 10 });
    expect(second).toMatchObject({ status: "done" });
    expect(storage.raw.pragma("freelist_count")).toBe(0);
    expect(storage.raw.pragma("page_count")).toBeLessThan(pagesBefore / 10);
  });
});
