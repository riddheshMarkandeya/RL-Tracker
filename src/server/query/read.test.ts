import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openStorage, type Storage } from "../storage";
import { ALT, goal, ME, memoryLogger, player, record, THEM } from "../testing";
import { createRecordWriter } from "../records/save";
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

describe("breaks and seasons", () => {
  test("from their tables", () => {
    const { reader } = setup();
    storage.tracker.run("INSERT INTO session_breaks (at) VALUES (1500)");
    expect(reader.readBreaks()).toEqual([1500]);
    expect(reader.readSeasons()).toEqual([
      { id: 1, name: "S22", startDate: "2026-03-11" },
      { id: 2, name: "S23", startDate: "2026-06-09" },
      { id: 3, name: "S24", startDate: "2026-09-23" },
    ]);
  });
});

describe("match fields for cards", () => {
  test("the score and whether a check flagged the match", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000, {}, { scoreTeam0: 3, scoreTeam1: 2 }));
    writer.save(record("H", 2000, {}, { checkFlags: ["goals_match_score"], scoreTeam0: null, scoreTeam1: null }));
    expect(reader.readMyMatches().map((m) => [m.guid, m.scoreTeam0, m.scoreTeam1, m.flagged])).toEqual([
      ["G", 3, 2, false],
      ["H", null, null, true],
    ]);
  });
});

describe("readResults", () => {
  test("one row per match: played or not, and your result", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    addId(ALT, "confirmed");
    writer.save(record("A", 1000));
    writer.save(record("B", 2000, { players: [player(THEM, 0), player("Epic|x|0", 1)], goals: [], statfeed: [] }, { playlistId: 6 }));
    // Two of your ids: the camera's is you, as readMyMatches picks.
    writer.save(record("C", 3000, { players: [player(ME, 0), player(ALT, 1)] }, { cameraPrimaryId: ALT, playlistId: null }));
    expect(reader.readResults()).toEqual([
      { guid: "A", startedAt: 1000, endedAt: 1300, playlistId: 13, played: true, result: "win" },
      { guid: "B", startedAt: 2000, endedAt: 2300, playlistId: 6, played: false, result: null },
      { guid: "C", startedAt: 3000, endedAt: 3300, playlistId: null, played: true, result: "loss" },
    ]);
    expect(lines("read").at(-1)?.fields).toMatchObject({ fn: "readResults", rows: 3 });
  });
});

describe("readGoals", () => {
  test("every goal of the matches asked for, in order, with its position", () => {
    const { writer, reader } = setup();
    writer.save(record("G", 1000, { goals: [goal(0, ME, { assisterKey: THEM, deflected: true }), goal(1, THEM, { ownGoal: true, toucherKey: null, pos: null, distance: null, aerial: true })] }));
    writer.save(record("H", 2000));
    writer.save(record("I", 3000));
    const goals = reader.readGoals(["G", "I"]);
    expect(goals.map((g) => [g.matchGuid, g.idx])).toEqual([
      ["G", 0],
      ["G", 1],
      ["I", 0],
      ["I", 1],
    ]);
    expect(goals[0]).toEqual({
      matchGuid: "G",
      idx: 0,
      teamNum: 0,
      scorerKey: ME,
      assisterKey: THEM,
      toucherKey: ME,
      pos: { x: 10, y: -20, z: 93 },
      distance: 5000,
      speedKmh: 88,
      deflected: true,
      aerial: false,
      ownGoal: false,
    });
    expect(goals[1]).toMatchObject({ toucherKey: null, pos: null, distance: null, aerial: true, ownGoal: true });
    expect(reader.readGoals([])).toEqual([]);
  });
});

describe("readMatch", () => {
  test("the match and every player, you marked", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000, { players: [player(ME, 0), player(THEM, 1, { isBot: true, presentAtEnd: false, extras: {} })] }, { checkFlags: ["x"], joinedInProgress: true }));
    const m = reader.readMatch("G");
    expect(m?.match).toEqual({
      guid: "G",
      startedAt: 1000,
      endedAt: 1300,
      playlistId: 13,
      arena: "cs_p",
      endKind: "completed",
      closedVia: "destroyed",
      joinedInProgress: true,
      overtime: false,
      scoreTeam0: 1,
      scoreTeam1: 1,
      winnerTeamNum: 0,
      mvpKey: ME,
      checkFlags: ["x"],
    });
    expect(m?.players.map((p) => [p.playerKey, p.isMe, p.isBot, p.presentAtEnd, p.hardestShotKmh])).toEqual([
      [ME, true, false, true, 101.5],
      [THEM, false, true, false, null],
    ]);
    expect(m?.result).toBe("win");
    expect(reader.readMatch("nope")).toBeNull();
  });

  test("two of your ids: only the picked one is you; spectated: nobody is", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    addId(ALT, "confirmed");
    writer.save(record("G", 1000, { players: [player(ME, 0), player(ALT, 1)] }, { cameraPrimaryId: ALT }));
    writer.save(record("H", 2000, { players: [player(THEM, 0), player("Epic|x|0", 1)] }));
    expect(reader.readMatch("G")?.players.map((p) => [p.playerKey, p.isMe])).toEqual([
      [ME, false],
      [ALT, true],
    ]);
    expect(reader.readMatch("G")?.result).toBe("loss");
    expect(reader.readMatch("H")?.players.some((p) => p.isMe)).toBe(false);
    expect(reader.readMatch("H")?.result).toBeNull();
  });
});
