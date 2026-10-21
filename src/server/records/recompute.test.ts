import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { feed } from "../recorder/feed";
import { createRecorder } from "../recorder/recorder";
import type { MatchSummary } from "../recorder/summary";
import { openStorage, type Storage } from "../storage";
import { memoryLogger, readFixture } from "../testing";
import { RECORDED_RULE_VERSIONS } from "../rules/registry";
import { toRecord } from "./record";
import { recomputeAll } from "./recompute";
import { createRecordWriter } from "./save";

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-recompute-"));
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const now = () => 42;
const FIXTURES = ["completed", "early-end", "overtime-leavers", "joined-in-progress", "left-early", "left-countdown", "private-series"];
const TABLES = ["matches", "match_players", "match_player_statfeed", "match_goals", "my_ids"];

/** Records the fixtures live, with the hook saving each match the way main does. */
function recordLive(names: readonly string[]): void {
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now });
  const onMatchFinished = (s: MatchSummary) => {
    writer.save(toRecord(s));
  };
  const recorder = createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished });
  for (const name of names) {
    feed(recorder, readFixture(name));
    recorder.flush();
  }
}

const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, storage.tracker.all(`SELECT * FROM ${t} ORDER BY 1, 2, 3`)]));
const clear = () => {
  for (const t of TABLES) storage.tracker.run(`DELETE FROM ${t}`);
};
const guids = (sql: string) => storage.raw.all<{ g: string }>(sql).map((r) => r.g);

describe("recomputeAll", () => {
  // Every fixture, twice over: slow under the full parallel suite.
  test("rebuilds exactly what live recording wrote", { timeout: 30_000 }, () => {
    recordLive(FIXTURES);
    const live = snapshot();
    expect(live.matches).toHaveLength(7);
    expect(live.match_goals?.length).toBeGreaterThan(0);
    clear();
    const logger = memoryLogger();
    const result = recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger, now });
    expect(snapshot()).toEqual(live);
    // private-series ends with a lobby and with the next match still open.
    expect(result).toMatchObject({ written: 7, failed: 0, skipped: { lobby: 1, open: 1 } });
    // That one is the live match, not a lost close marker.
    expect(logger.lines.find((l) => l.fields.reason === "open")?.level).toBe("info");
  });

  test("a lobby and a match half-trimmed by retention are skipped, each with its reason", () => {
    recordLive(["private-series", "completed"]);
    // Retention deletes by time, so a match straddling the cutoff can lose its first rows.
    const [completed] = guids("SELECT match_guid AS g FROM events WHERE name = 'MatchCreated' ORDER BY id DESC LIMIT 1");
    storage.raw.run("DELETE FROM events WHERE match_guid = ? AND seq < 5", completed ?? "");
    const before = storage.tracker.get("SELECT * FROM matches WHERE guid = ?", completed ?? "");
    const logger = memoryLogger();
    const result = recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger, now });
    // completed's MatchCreated superseded private-series' open match, so that one is written too.
    expect(result).toMatchObject({ written: 2, failed: 0, skipped: { trimmed: 1, lobby: 1 } });
    // The trimmed match keeps its good record.
    expect(storage.tracker.get("SELECT * FROM matches WHERE guid = ?", completed ?? "")).toEqual(before);
    const reasons = logger.lines.filter((l) => l.event === "recompute_skipped").map((l) => l.fields.reason);
    expect(reasons.sort()).toEqual(["lobby", "trimmed"]);
    expect(logger.events()).toContain("records/recompute_done");
  });

  test("an open match that isn't the newest lost its close marker, so it's skipped with a warning", () => {
    recordLive(["left-early", "completed"]);
    const [leftEarly] = guids("SELECT match_guid AS g FROM events ORDER BY id LIMIT 1");
    storage.raw.run("DELETE FROM events WHERE match_guid = ? AND name = 'MatchDestroyed'", leftEarly ?? "");
    const logger = memoryLogger();
    const result = recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger, now });
    expect(result).toMatchObject({ written: 1, skipped: { open: 1 } });
    expect(logger.lines.find((l) => l.fields.reason === "open")).toMatchObject({ level: "warn", fields: { guid: leftEarly } });
  });

  test("a lobby that already has a record keeps it and says so", () => {
    recordLive(["private-series"]);
    const [open] = guids("SELECT match_guid AS g FROM events ORDER BY id DESC LIMIT 1");
    const hasRecord = (g: string) => storage.tracker.get("SELECT 1 FROM matches WHERE guid = ?", g) !== undefined;
    const lobby = guids("SELECT DISTINCT match_guid AS g FROM events").find((g) => g !== open && !hasRecord(g));
    if (!lobby) throw new Error("no lobby in the fixture");
    storage.tracker.run("INSERT INTO matches (guid, started_at, ended_at, end_kind, closed_via, joined_in_progress, overtime, check_flags) VALUES (?, 0, 0, 'left', 'destroyed', 0, 0, '[]')", lobby);
    const logger = memoryLogger();
    const result = recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger, now });
    expect(result.skipped).toMatchObject({ lobby_has_record: 1 });
    expect(storage.tracker.get("SELECT guid FROM matches WHERE guid = ?", lobby)).toEqual({ guid: lobby });
    expect(logger.lines.find((l) => l.fields.reason === "lobby_has_record")).toMatchObject({ level: "warn", fields: { guid: lobby } });
  });

  test("refreshes each match's rule versions, including one recorded before they were stored", () => {
    recordLive(["completed"]);
    storage.tracker.run("UPDATE matches SET rule_versions = NULL");
    recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger: memoryLogger(), now });
    const row = storage.tracker.get<{ rule_versions: string }>("SELECT rule_versions FROM matches");
    expect(JSON.parse(row?.rule_versions ?? "null")).toEqual(RECORDED_RULE_VERSIONS);
  });

  test("an orphaned match rebuilds with its close cause from the marker", () => {
    const recorder = createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished: () => undefined });
    feed(
      recorder,
      readFixture("left-early").filter((l) => !l.raw.includes("MatchDestroyed")),
    );
    recorder.checkIdle(Number.MAX_SAFE_INTEGER);
    recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger: memoryLogger(), now });
    expect(storage.tracker.all("SELECT end_kind, closed_via FROM matches")).toEqual([{ end_kind: "orphaned", closed_via: "timeout" }]);
  });

  test("one match failing to write is logged and the rest are still written", () => {
    recordLive(["completed", "early-end"]);
    clear();
    // A trigger that rejects one guid's match row.
    const [first] = guids("SELECT match_guid AS g FROM events ORDER BY id LIMIT 1");
    storage.tracker.exec(`CREATE TRIGGER reject BEFORE INSERT ON matches WHEN NEW.guid = '${first ?? ""}' BEGIN SELECT RAISE(ABORT, 'rejected'); END`);
    const logger = memoryLogger();
    const result = recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger, now });
    expect(result).toMatchObject({ written: 1, failed: 1 });
    expect(logger.lines.find((l) => l.event === "recompute_failed")).toMatchObject({ level: "error", fields: { guid: first, err: expect.anything() as unknown } });
    expect(storage.tracker.all("SELECT guid FROM matches")).toHaveLength(1);
  });
});
