import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openStorage, type Storage } from "../storage";
import { memoryLogger } from "../testing";
import type { TeamNum } from "../recorder/summary";
import type { MatchRecord, PlayerRow } from "./record";
import { createRecordWriter } from "./save";

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-save-"));
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

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
  shots: 1,
  assists: 0,
  saves: 0,
  touches: 5,
  demos: 0,
  ...over,
});

const record = (guid = "G", over: Partial<MatchRecord["match"]> = {}): MatchRecord => ({
  match: {
    guid,
    startedAt: 1000,
    endedAt: 2000,
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
    mvpKey: "Epic|me|0",
    mvpSource: "statfeed",
    cameraPrimaryId: "Epic|me|0",
    checkFlags: [],
    ...over,
  },
  players: [player("Epic|me|0", 0), player("Epic|them|0", 1)],
  statfeed: [
    { playerKey: "Epic|me|0", eventName: "Goal", count: 1 },
    { playerKey: "Epic|them|0", eventName: "Goal", count: 1 },
  ],
});

function setup() {
  const logger = memoryLogger();
  const writer = createRecordWriter({ tracker: storage.tracker, logger, now: () => 5000 });
  const fields = (event: string) => logger.lines.filter((l) => l.cat === "records" && l.event === event).map((l) => l.fields);
  return { writer, logger, fields };
}

const count = (table: string) => storage.tracker.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n;
const myIds = () => storage.tracker.all("SELECT primary_id, name, status, added_at FROM my_ids ORDER BY primary_id");

describe("record writer", () => {
  test("stores the match, its players and statfeed counts", () => {
    const { writer, fields } = setup();
    writer.save(record("G", { checkFlags: ["camera_on_roster"] }));
    expect(storage.tracker.get("SELECT * FROM matches")).toEqual({
      guid: "G",
      started_at: 1000,
      ended_at: 2000,
      playlist_id: 13,
      arena: "cs_p",
      end_kind: "completed",
      closed_via: "destroyed",
      joined_in_progress: 0,
      overtime: 0,
      score_team0: 1,
      score_team1: 1,
      winner_team_num: 0,
      winner_source: "match_ended",
      mvp_key: "Epic|me|0",
      mvp_source: "statfeed",
      camera_primary_id: "Epic|me|0",
      check_flags: '["camera_on_roster"]',
    });
    expect(storage.tracker.get("SELECT * FROM match_players WHERE player_key = 'Epic|them|0'")).toEqual({
      match_guid: "G",
      player_key: "Epic|them|0",
      primary_id: "Epic|them|0",
      name: "Epic|them|0",
      is_bot: 0,
      team_num: 1,
      teams_seen: 2,
      present_at_end: 1,
      score: 100,
      goals: 1,
      shots: 1,
      assists: 0,
      saves: 0,
      touches: 5,
      demos: 0,
    });
    expect(storage.tracker.all("SELECT match_guid, player_key, event_name, count FROM match_player_statfeed ORDER BY player_key")).toEqual([
      { match_guid: "G", player_key: "Epic|me|0", event_name: "Goal", count: 1 },
      { match_guid: "G", player_key: "Epic|them|0", event_name: "Goal", count: 1 },
    ]);
    expect(fields("written")).toEqual([expect.objectContaining({ guid: "G", players: 2, winnerSource: "match_ended", mvpSource: "statfeed", checkFlags: ["camera_on_roster"], ms: expect.any(Number) as unknown })]);
  });

  test("saving a guid again (a Reconnect) replaces its rows rather than adding to them", () => {
    const { writer } = setup();
    writer.save(record("G"));
    writer.save(record("Other"));
    const again = record("G", { scoreTeam0: 3, endKind: "left" });
    again.players = [player("Epic|me|0", 0, { goals: 3 })];
    again.statfeed = [{ playerKey: "Epic|me|0", eventName: "Goal", count: 3 }];
    writer.save(again);
    expect(storage.tracker.all("SELECT guid, score_team0, end_kind FROM matches ORDER BY guid")).toEqual([
      { guid: "G", score_team0: 3, end_kind: "left" },
      { guid: "Other", score_team0: 1, end_kind: "completed" },
    ]);
    expect(storage.tracker.all("SELECT player_key, goals FROM match_players WHERE match_guid = 'G'")).toEqual([{ player_key: "Epic|me|0", goals: 3 }]);
    expect(storage.tracker.all("SELECT player_key, count FROM match_player_statfeed WHERE match_guid = 'G'")).toEqual([{ player_key: "Epic|me|0", count: 3 }]);
    expect(count("match_players")).toBe(3);
  });

  test("a write that fails leaves the match as it was and throws to the caller", () => {
    const { writer } = setup();
    writer.save(record("G"));
    const bad = record("G", { scoreTeam0: 9 });
    // Two rows with one key break the primary key midway through the write.
    bad.players = [player("Epic|me|0", 0), player("Epic|me|0", 0)];
    expect(() => {
      writer.save(bad);
    }).toThrow();
    expect(storage.tracker.get("SELECT score_team0 FROM matches")).toEqual({ score_team0: 1 });
    expect(count("match_players")).toBe(2);
  });

  describe("the pending guess at your ID", () => {
    test("the camera's id becomes a pending guess when no confirmed id played", () => {
      const { writer, fields } = setup();
      writer.save(record("G"));
      expect(myIds()).toEqual([{ primary_id: "Epic|me|0", name: "Epic|me|0", status: "pending", added_at: 5000 }]);
      expect(fields("pending_guess")).toEqual([{ guid: "G", primaryId: "Epic|me|0", name: "Epic|me|0" }]);
      writer.save(record("H"));
      expect(fields("pending_guess")).toHaveLength(1);
    });

    test("no guess when a confirmed id is among the players (spectating a friend, say)", () => {
      storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES ('Epic|them|0', 'them', 'confirmed', 1)");
      setup().writer.save(record("G"));
      expect(myIds()).toEqual([expect.objectContaining({ primary_id: "Epic|them|0", status: "confirmed" })]);
    });

    test("a rejected id is never guessed again, and no camera id means no guess", () => {
      storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES ('Epic|me|0', 'me', 'rejected', 1)");
      const { writer } = setup();
      writer.save(record("G"));
      writer.save(record("H", { cameraPrimaryId: null }));
      expect(myIds()).toEqual([expect.objectContaining({ primary_id: "Epic|me|0", status: "rejected", added_at: 1 })]);
    });
  });

  test("an unmapped playlist id is logged once per writer, with the arena and team sizes", () => {
    const { writer, fields } = setup();
    writer.save(record("G", { playlistId: 999, arena: "new_p" }));
    writer.save(record("H", { playlistId: 999 }));
    writer.save(record("I", { playlistId: null }));
    expect(fields("unknown_playlist")).toEqual([
      { guid: "G", playlistId: 999, arena: "new_p", teamSizes: [1, 1] },
      { guid: "I", playlistId: null, arena: "cs_p", teamSizes: [1, 1] },
    ]);
    // Once per run: the next run's writer reports it again.
    const next = memoryLogger();
    createRecordWriter({ tracker: storage.tracker, logger: next }).save(record("J", { playlistId: 999 }));
    expect(next.events()).toContain("records/unknown_playlist");
  });
});
