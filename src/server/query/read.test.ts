import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openStorage, type Storage } from "../storage";
import { memoryLogger } from "../testing";
import type { GoalPoint } from "../recorder/play";
import type { TeamNum } from "../recorder/summary";
import type { MatchRecord, PlayerRow } from "../records/record";
import { createRecordWriter } from "../records/save";
import { cutSessions, sessionsPlayed } from "./sessions";
import { createQueryReader } from "./read";

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-read-"));
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const ME = "Epic|me|0";
const ALT = "Steam|alt|0";
const THEM = "Epic|them|0";

const player = (key: string, teamNum: TeamNum, over: Partial<PlayerRow> = {}): PlayerRow => ({
  playerKey: key,
  primaryId: key,
  name: key,
  isBot: false,
  teamNum,
  teamsSeen: 1 << teamNum,
  presentAtEnd: true,
  score: 100,
  goals: 1,
  shots: 2,
  assists: 0,
  saves: 0,
  touches: 5,
  demos: 0,
  extras: { hardest_shot_kmh: 101.5, woodwork_hits: 1, aerial_touches: 2, car_ms: 1000, boost_avg: 33, supersonic_ms: 100, empty_boost_ms: 50 },
  ...over,
});

const goal = (teamNum: TeamNum, scorerKey: string, over: Partial<GoalPoint> = {}): GoalPoint => ({
  teamNum,
  scorerKey,
  assisterKey: null,
  toucherKey: scorerKey,
  pos: { x: 10, y: -20, z: 93 },
  distance: 5000,
  speedKmh: 88,
  deflected: false,
  aerial: false,
  ownGoal: false,
  ...over,
});

const record = (guid: string, startedAt: number, over: Partial<MatchRecord> = {}, match: Partial<MatchRecord["match"]> = {}): MatchRecord => ({
  match: {
    guid,
    startedAt,
    endedAt: startedAt + 300,
    playlistId: 13,
    arena: "cs_p",
    endKind: "completed",
    closedVia: "destroyed",
    joinedInProgress: false,
    overtime: false,
    scoreTeam0: 1,
    scoreTeam1: 1,
    winnerTeamNum: 0,
    winnerSource: "match_ended",
    mvpKey: ME,
    mvpSource: "statfeed",
    cameraPrimaryId: null,
    checkFlags: [],
    ruleVersions: {},
    ...match,
  },
  players: [player(ME, 0), player(THEM, 1)],
  statfeed: [
    { playerKey: ME, eventName: "Goal", count: 1 },
    { playerKey: THEM, eventName: "Goal", count: 1 },
  ],
  goals: [goal(0, ME, { speedKmh: 120 }), goal(1, THEM)],
  ...over,
});

function setup() {
  const logger = memoryLogger();
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  const reader = createQueryReader({ tracker: storage.tracker, logger });
  const addId = (id: string, status: "confirmed" | "pending" | "rejected") =>
    storage.tracker.run("INSERT OR REPLACE INTO my_ids (primary_id, name, status, added_at) VALUES (?, ?, ?, 1)", id, id, status);
  const lines = (event: string) => logger.lines.filter((l) => l.cat === "query" && l.event === event);
  return { writer, reader, addId, lines };
}

describe("readMyMatches", () => {
  test("a pending id is you: your row, result, goals and statfeed", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "pending");
    writer.save(record("G", 1000));
    const [m] = reader.readMyMatches();
    expect(m).toMatchObject({
      guid: "G",
      startedAt: 1000,
      endedAt: 1300,
      playlistId: 13,
      endKind: "completed",
      overtime: false,
      winnerTeamNum: 0,
      mvpKey: ME,
      result: "win",
      goals: [{ speedKmh: 120, ownGoal: false }],
      statfeed: { Goal: 1 },
    });
    expect(m?.me).toEqual({
      playerKey: ME,
      teamNum: 0,
      score: 100,
      goals: 1,
      shots: 2,
      assists: 0,
      saves: 0,
      demos: 0,
      touches: 5,
      hardestShotKmh: 101.5,
      woodworkHits: 1,
      aerialTouches: 2,
      carMs: 1000,
      boostAvg: 33,
      supersonicMs: 100,
      emptyBoostMs: 50,
    });
  });

  test("a rejected id isn't you: the match reads as spectated", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "rejected");
    writer.save(record("G", 1000));
    expect(reader.readMyMatches()).toMatchObject([{ guid: "G", me: null, result: null, goals: [], statfeed: {} }]);
  });

  test("no id of yours in the match: spectated", () => {
    const { writer, reader, addId } = setup();
    addId(ALT, "confirmed");
    writer.save(record("G", 1000));
    expect(reader.readMyMatches()[0]?.me).toBeNull();
  });

  test("a loss on the other team", () => {
    const { writer, reader, addId } = setup();
    addId(THEM, "confirmed");
    writer.save(record("G", 1000));
    const [m] = reader.readMyMatches();
    expect(m?.result).toBe("loss");
    expect(m?.goals).toEqual([{ speedKmh: 88, ownGoal: false }]);
  });

  test("two of your ids in one match: the camera's is you, logged once per match", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    addId(ALT, "confirmed");
    const players = [player(ME, 0), player(ALT, 1), player(THEM, 1)];
    writer.save(record("G", 1000, { players }, { cameraPrimaryId: ALT }));
    writer.save(record("H", 2000, { players }, { cameraPrimaryId: null }));
    expect(reader.readMyMatches().map((m) => [m.guid, m.me?.playerKey, m.result])).toEqual([
      ["G", ALT, "loss"],
      ["H", ME, "win"], // no camera: the lowest key
    ]);
    reader.readMyMatches();
    expect(lines("two_yous").map((l) => [l.level, l.fields])).toEqual([
      ["warn", { guid: "G", keys: [ME, ALT], chosen: ALT }],
      ["warn", { guid: "H", keys: [ME, ALT], chosen: ME }],
    ]);
  });

  test("goals and statfeed go to the right match", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000, { goals: [goal(0, ME, { speedKmh: 70 }), goal(0, ME, { speedKmh: 140, ownGoal: true })] }));
    writer.save(record("H", 2000, { goals: [], statfeed: [{ playerKey: ME, eventName: "Save", count: 3 }] }));
    const [g, h] = reader.readMyMatches();
    expect(g?.goals).toEqual([
      { speedKmh: 70, ownGoal: false },
      { speedKmh: 140, ownGoal: true },
    ]);
    expect(g?.statfeed).toEqual({ Goal: 1 });
    expect(h?.goals).toEqual([]);
    expect(h?.statfeed).toEqual({ Save: 3 });
  });

  test("a range is half-open on the start time, and guids pick matches", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    for (const [guid, at] of [["A", 1000], ["B", 2000], ["C", 3000]] as const) writer.save(record(guid, at));
    expect(reader.readMyMatches({ from: 2000, to: 3000 }).map((m) => m.guid)).toEqual(["B"]);
    expect(reader.readMyMatches({ from: 1500 }).map((m) => m.guid)).toEqual(["B", "C"]);
    expect(reader.readMyMatches({ to: 2000 }).map((m) => m.guid)).toEqual(["A"]);
    expect(reader.readMyMatches({ guids: ["C", "A"] }).map((m) => m.guid)).toEqual(["A", "C"]);
    expect(reader.readMyMatches({ guids: [] })).toEqual([]);
    // The goals follow the same predicate.
    expect(reader.readMyMatches({ from: 2000, to: 3000 })[0]?.goals).toHaveLength(1);
  });

  test("logs each read with its row count", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000));
    reader.readMyMatches();
    expect(lines("read").map((l) => [l.fields.fn, l.fields.rows, typeof l.fields.ms])).toEqual([["readMyMatches", 1, "number"]]);
  });
});

describe("times, breaks and seasons", () => {
  test("match times for cutting, breaks, and seasons from the table", () => {
    const { writer, reader } = setup();
    writer.save(record("B", 2000));
    writer.save(record("A", 1000));
    storage.tracker.run("INSERT INTO session_breaks (at) VALUES (1500)");
    expect(reader.readMatchTimes()).toEqual([
      { guid: "A", startedAt: 1000, endedAt: 1300 },
      { guid: "B", startedAt: 2000, endedAt: 2300 },
    ]);
    expect(reader.readBreaks()).toEqual([1500]);
    expect(reader.readSeasons()).toEqual([
      { id: 1, name: "S22", startDate: "2026-03-11" },
      { id: 2, name: "S23", startDate: "2026-06-09" },
      { id: 3, name: "S24", startDate: "2026-09-23" },
    ]);
  });

  test("a spectated-only session drops out of a filtered list", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("A", 1000));
    // Over an hour later, a lobby you only watched.
    writer.save(record("B", 5_000_000, { players: [player(THEM, 0), player("Epic|x|0", 1)], goals: [], statfeed: [] }));
    const sessions = cutSessions(reader.readMatchTimes(), reader.readBreaks());
    expect(sessions.map((s) => s.key)).toEqual(["A", "B"]);
    expect(sessionsPlayed(sessions, reader.readMyMatches(), "everything").map((s) => s.key)).toEqual(["A"]);
  });
});
