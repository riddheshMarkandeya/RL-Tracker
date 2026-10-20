import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Param } from "../db/sqlite";
import { openStorage, type Storage } from "../storage";
import { memoryLogger, readFixture as fixture } from "../testing";
import type { CheckFailure } from "./checks";
import { feed, type CaptureLine } from "./feed";
import { createRecorder, ORPHAN_TIMEOUT_MS, type RecorderOptions } from "./recorder";
import type { MatchSummary } from "./summary";


let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-recorder-"));
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Call {
  summary: MatchSummary;
  failures: CheckFailure[];
}

function setup(opts: Partial<RecorderOptions> = {}) {
  const logger = memoryLogger();
  const calls: Call[] = [];
  const recorder = createRecorder({
    raw: storage.raw,
    logger,
    onMatchFinished: (summary, failures) => calls.push({ summary, failures }),
    ...opts,
  });
  const fields = (event: string) => logger.lines.filter((l) => l.event === event).map((l) => l.fields);
  return { recorder, logger, calls, fields };
}

const short = (guid: unknown) => String(guid).slice(0, 4);
const only = (calls: Call[]): Call => {
  expect(calls).toHaveLength(1);
  const [call] = calls;
  if (!call) throw new Error("expected one hook call");
  return call;
};
const countsByName = (guid: string) =>
  Object.fromEntries(storage.raw.all<{ name: string; n: number }>("SELECT name, COUNT(*) AS n FROM events WHERE match_guid = ? GROUP BY name", guid).map((r) => [r.name, r.n]));
const storedGuids = () => storage.raw.all<{ g: string }>("SELECT DISTINCT match_guid AS g FROM events ORDER BY id").map((r) => short(r.g));

/** Synthetic frames, `{t, raw}` as a capture stores them. */
const frame = (t: number, name: string, guid: string, data: Record<string, unknown> = {}): CaptureLine => ({
  t,
  raw: JSON.stringify({ Event: name, Data: JSON.stringify({ MatchGuid: guid, ...data }) }),
});
const state = (t: number, guid: string, score: [number, number], timeSeconds = 200) =>
  frame(t, "UpdateState", guid, {
    Game: { Teams: [{ TeamNum: 0, Score: score[0] }, { TeamNum: 1, Score: score[1] }], PlaylistId: 10, TimeSeconds: timeSeconds, bOvertime: false, Arena: "cs_p" },
    Players: [
      { Name: "A", PrimaryId: "Epic|a|0", Shortcut: 1, TeamNum: 0, Goals: score[0] },
      { Name: "B", PrimaryId: "Epic|b|0", Shortcut: 2, TeamNum: 1, Goals: score[1] },
    ],
  });
/** A match that is live at t=2000 with a 1–0 state at t=3000. */
const liveMatch = (guid: string): CaptureLine[] => [frame(1000, "MatchCreated", guid), frame(2000, "MatchInitialized", guid), state(3000, guid, [1, 0])];

describe("recorder on the fixtures", () => {
  test("completed: one finished match with the result, MVP and roster, passing every check", () => {
    const { recorder, calls } = setup();
    const lines = fixture("completed");
    const recording: boolean[] = [];
    for (const line of lines) {
      feed(recorder, [line]);
      if (recording.at(-1) !== recorder.isRecording()) recording.push(recorder.isRecording());
    }
    expect(recording).toEqual([false, true, false]);
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("CB59");
    expect(summary).toMatchObject({
      playlistId: 13,
      arena: "FF_Dusk_P",
      endKind: "completed",
      closedVia: "destroyed",
      joinedInProgress: false,
      score: [1, 2],
      winner: { teamNum: 1, source: "match_ended" },
      dedupDropped: { replay_goal: 3 },
      flags: [],
      facts: { sawMatchEnded: true, sawPodium: true, mvpCount: 1, liveGoals: 3 },
    });
    expect(summary.mvp?.key).toEqual(expect.any(String));
    expect(summary.roster).toHaveLength(6);
    // Every event under the guid is stored raw, duplicates included.
    expect(countsByName(summary.guid)).toMatchObject({ GoalScored: 6, StatfeedEvent: 37, BallHit: 212, ClockUpdatedSeconds: 300, MatchEnded: 1, MatchDestroyed: 1 });
  });

  test("early-end: MatchEnded's winner stands against the score (a forfeit)", () => {
    const { recorder, calls } = setup();
    feed(recorder, fixture("early-end"));
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("0116");
    expect(summary).toMatchObject({ endKind: "early_end", playlistId: 2, arena: "Stadium_P", score: [2, 3], winner: { teamNum: 0, source: "match_ended" }, facts: { sawPodium: true, liveGoals: 5 } });
  });

  test("overtime-leavers: overtime, no podium, and leavers kept on the roster", () => {
    const { recorder, calls } = setup();
    feed(recorder, fixture("overtime-leavers"));
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("1567");
    expect(summary).toMatchObject({ endKind: "completed", playlistId: 13, overtime: true, score: [5, 4], winner: { teamNum: 0, source: "match_ended" }, facts: { sawPodium: false, liveGoals: 9 } });
    expect(summary.roster).toHaveLength(6);
    expect(summary.roster.filter((r) => r.presentAtEnd)).toHaveLength(2);
  });

  test("joined-in-progress: no MatchCreated or MatchInitialized, so goal events aren't compared", () => {
    const { recorder, calls } = setup();
    feed(recorder, fixture("joined-in-progress"));
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("C8B8");
    expect(summary).toMatchObject({ endKind: "completed", joinedInProgress: true, arena: "TrainStation_P", score: [2, 4], winner: { teamNum: 1, source: "match_ended" }, dedupDropped: { replay_goal: 5 }, facts: { liveGoals: 4 } });
  });

  test("left-early: MatchDestroyed with no MatchEnded is a leave, with no winner", () => {
    const { recorder, calls } = setup();
    feed(recorder, fixture("left-early"));
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("5ABA");
    expect(summary).toMatchObject({ endKind: "left", playlistId: 10, arena: "street_p", score: [0, 4], winner: null, mvp: null, facts: { liveGoals: 4 } });
  });

  test("left-countdown: the menu's PlaylistId 0 states are skipped, and the bot is flagged", () => {
    const { recorder, calls } = setup();
    feed(recorder, fixture("left-countdown"));
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("C6C0");
    expect(summary).toMatchObject({ endKind: "left", playlistId: 4, score: [0, 0], winner: null });
    expect(summary.roster).toHaveLength(8);
    expect(summary.roster.filter((r) => r.isBot).map((r) => r.name)).toEqual(["Slider"]);
    const zeroStates = storage.raw.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE name = 'UpdateState' AND json_extract(data, '$.Game.PlaylistId') = 0");
    expect(zeroStates?.n).toBe(0);
  });

  test("private-series: the retagged teardown stays with its match, the lobby is discarded, the next match stays open", () => {
    const { recorder, calls, fields } = setup();
    feed(recorder, fixture("private-series"));
    const { summary, failures } = only(calls);
    expect(failures).toEqual([]);
    expect(short(summary.guid)).toBe("AB08");
    expect(summary).toMatchObject({ endKind: "completed", arena: "cs_p", score: [3, 7], winner: { teamNum: 1, source: "match_ended" }, joinedInProgress: true });
    expect(fields("teardown_retagged").map((f) => [short(f.guid), short(f.wireGuid)])).toEqual([["AB08", "D900"]]);
    expect(fields("lobby_discarded").map((f) => [short(f.guid), f.via])).toEqual([["D900", "destroyed"]]);
    expect(fields("match_closed").map((f) => short(f.guid))).toEqual(["AB08", "D900"]);
    expect(fields("guid_mismatch")).toEqual([]);
    // The first D900 MatchDestroyed closed AB08; the second closed the lobby.
    expect(countsByName(summary.guid).MatchDestroyed).toBe(1);
    expect(recorder.status()).toMatchObject({ phase: "live" });
    expect(short(recorder.status().guid)).toBe("E5DD");
  });

  test("freeplay: guid '' throughout, so nothing is stored and nothing is recording", () => {
    const { recorder, calls } = setup();
    for (const line of fixture("freeplay")) {
      feed(recorder, [line]);
      expect(recorder.isRecording()).toBe(false);
    }
    expect(calls).toEqual([]);
    expect(storedGuids()).toEqual([]);
  });
});

describe("orphaned matches", () => {
  test("at startup, the match the last run left open is closed with a marker, once", () => {
    const first = setup();
    feed(first.recorder, fixture("private-series"));
    first.recorder.flush();
    const { recorder, calls, fields } = setup({ now: () => 9e12 });
    recorder.recoverAtStartup();
    const { summary } = only(calls);
    expect(short(summary.guid)).toBe("E5DD");
    expect(summary).toMatchObject({ endKind: "orphaned", closedVia: "restart", score: [1, 0], winner: null });
    expect(fields("recovered").map((f) => [short(f.guid), f.phase])).toEqual([["E5DD", "live"]]);
    // The marker isn't the match's end time.
    expect(summary.endedAt).toBeLessThan(9e12);
    expect(storage.raw.get<{ name: string; ts: number }>("SELECT name, ts FROM events ORDER BY id DESC LIMIT 1")).toEqual({ name: "RecorderClosed", ts: 9e12 });

    const again = setup();
    again.recorder.recoverAtStartup();
    expect(again.calls).toEqual([]);
    expect(again.recorder.isRecording()).toBe(false);
  });

  test("at startup with an empty raw.db, or after a clean close, nothing happens", () => {
    const { recorder, calls, logger } = setup();
    recorder.recoverAtStartup();
    feed(recorder, fixture("left-early"));
    calls.length = 0;
    const next = setup();
    next.recorder.recoverAtStartup();
    expect(next.calls).toEqual([]);
    expect(logger.events()).not.toContain("recorder/recover_failed");
  });

  test("a pending match left open at startup is discarded as a lobby", () => {
    const first = setup();
    feed(first.recorder, [frame(1000, "MatchCreated", "LOBBY"), frame(2000, "PlayerJoined", "LOBBY", { PlayerName: "A", PrimaryId: "Epic|a|0" })]);
    const { recorder, calls, fields } = setup();
    recorder.recoverAtStartup();
    expect(calls).toEqual([]);
    expect(fields("lobby_discarded")).toEqual([{ guid: "LOBBY", via: "restart" }]);
  });

  test("after the timeout with no events the match closes, with the held state flushed first", () => {
    const { recorder, calls, fields } = setup();
    // The 2–0 state comes 100 ms after the kept 1–0 one, so the sampler holds it.
    feed(recorder, [...liveMatch("G"), state(3100, "G", [2, 0])]);
    recorder.checkIdle(3100 + ORPHAN_TIMEOUT_MS - 1);
    expect(recorder.isRecording()).toBe(true);
    recorder.checkIdle(3100 + ORPHAN_TIMEOUT_MS);
    expect(recorder.isRecording()).toBe(false);
    const { summary } = only(calls);
    expect(summary).toMatchObject({ endKind: "orphaned", closedVia: "timeout", score: [2, 0], endedAt: 3100 });
    expect(fields("match_closed")).toEqual([{ guid: "G", via: "timeout", phase: "live", stored: 5, storeFailed: 0 }]);
  });

  test("guid '' frames don't keep a match alive", () => {
    const { recorder, calls } = setup();
    const t0 = 3000 + ORPHAN_TIMEOUT_MS;
    feed(recorder, [...liveMatch("G"), frame(t0 - 1, "ClockUpdatedSeconds", "", { TimeSeconds: 300 }), frame(t0, "PlayerLeft", "")]);
    expect(only(calls).summary.closedVia).toBe("timeout");
  });

  test("a MatchCreated with another guid supersedes the open match", () => {
    const { recorder, calls, fields } = setup();
    feed(recorder, [...liveMatch("G1"), frame(4000, "MatchCreated", "G2")]);
    const { summary } = only(calls);
    expect(summary).toMatchObject({ guid: "G1", endKind: "orphaned", closedVia: "superseded", score: [1, 0] });
    expect(recorder.status()).toEqual({ guid: "G2", phase: "pending" });
    expect(countsByName("G2")).toEqual({ MatchCreated: 1 });
    expect(countsByName("G1").RecorderClosed).toBe(1);
    // A superseded lobby is discarded.
    feed(recorder, [frame(5000, "MatchCreated", "G3")]);
    expect(calls).toHaveLength(1);
    expect(fields("lobby_discarded")).toEqual([{ guid: "G2", via: "superseded" }]);
  });

  test("a guid that comes back (Reconnect) reopens live: seq continues and a quick leave still finishes it", () => {
    const { recorder, calls, fields, logger } = setup();
    feed(recorder, [...liveMatch("G"), frame(4000, "MatchDestroyed", "G")]);
    const firstSeq = countsByName("G");
    feed(recorder, [state(10_000, "G", [1, 1]), frame(11_000, "MatchDestroyed", "G")]);
    expect(fields("reopened")).toEqual([{ guid: "G", fromSeq: Object.values(firstSeq).reduce((a, b) => a + b, 0) }]);
    expect(calls.map((c) => [c.summary.endKind, c.summary.score])).toEqual([
      ["left", [1, 0]],
      ["left", [1, 1]],
    ]);
    expect(logger.events()).not.toContain("recorder/store_failed");
  });

  test("a reopened match whose seq lookup failed once still stores after its earlier rows", () => {
    const { recorder: first } = setup();
    feed(first, [...liveMatch("G"), frame(4000, "MatchDestroyed", "G")]);
    let failSeq = true;
    const flaky = new Proxy(storage.raw, {
      get(db, prop) {
        if (prop !== "get") return Reflect.get(db, prop) as unknown;
        return (sql: string, ...params: Param[]) => {
          if (failSeq && sql.includes("MAX(seq)")) {
            failSeq = false;
            throw new Error("SQLITE_BUSY");
          }
          return db.get(sql, ...params);
        };
      },
    });
    const { recorder, calls, fields } = setup({ raw: flaky });
    feed(recorder, [state(10_000, "G", [1, 1]), frame(11_000, "MatchDestroyed", "G")]);
    expect(fields("store_failed").map((f) => f.op)).toEqual(["nextSeq"]);
    expect(fields("match_closed")).toEqual([expect.objectContaining({ stored: 2, storeFailed: 0 })]);
    expect(calls.map((c) => c.summary.score)).toEqual([[1, 1]]);
  });
});

describe("logging and failures", () => {
  test("unknown events and fields are logged once per run", () => {
    const { recorder, fields } = setup();
    feed(recorder, [frame(1, "BallExploded", "G"), frame(2, "BallExploded", "G"), frame(3, "MatchCreated", "G", { Mood: 1 }), frame(4, "MatchCreated", "G", { Mood: 2 })]);
    expect(fields("unknown_event")).toEqual([{ name: "BallExploded" }]);
    expect(fields("unknown_field")).toEqual([{ event: "MatchCreated", field: "Mood" }]);
  });

  test("a bad frame is logged once per reason and dropped", () => {
    const { recorder, fields } = setup();
    feed(recorder, [
      { t: 1, raw: "not json" },
      { t: 2, raw: "{" },
      { t: 3, raw: JSON.stringify({ Event: "MatchCreated", Data: "{" }) },
    ]);
    expect(fields("bad_frame").map((f) => f.reason)).toEqual(["not_json", "bad_data"]);
    expect(recorder.isRecording()).toBe(false);
  });

  test("a failing raw.db drops events with one store_failed per match, and recording goes on", () => {
    const own = openStorage({ dir: mkdtempSync(join(dir, "broken-")), logger: memoryLogger() });
    own.close();
    const { recorder, calls, logger, fields } = setup({ raw: own.raw });
    expect(() => {
      feed(recorder, [...liveMatch("G"), state(9000, "G", [2, 0]), frame(10_000, "MatchDestroyed", "G")]);
    }).not.toThrow();
    expect(calls).toEqual([]);
    expect(fields("store_failed").map((f) => f.op)).toEqual(["names", "nextSeq", "insert"]);
    expect(fields("match_closed")).toEqual([{ guid: "G", via: "destroyed", phase: "live", stored: 0, storeFailed: 5 }]);
    expect(logger.events()).toContain("recorder/summary_failed");
  });

  test("an unexpected throw while handling a frame is logged once per event, and recording goes on", () => {
    const base = memoryLogger();
    let throwOnce = true;
    const logger = {
      ...base,
      info: (category: string, event: string, fields?: Record<string, unknown>) => {
        if (throwOnce && event === "match_live") {
          throwOnce = false;
          throw new Error("bug");
        }
        base.info(category, event, fields);
      },
    };
    const { recorder, calls } = setup({ logger });
    expect(() => {
      feed(recorder, [...liveMatch("G"), frame(4000, "MatchDestroyed", "G")]);
    }).not.toThrow();
    expect(base.lines.filter((l) => l.event === "frame_failed").map((l) => l.fields.event)).toEqual(["MatchInitialized"]);
    expect(calls.map((c) => c.summary.guid)).toEqual(["G"]);
  });

  test("a throwing hook is logged and the next match is still recorded", () => {
    const logger = memoryLogger();
    const seen: string[] = [];
    const recorder = createRecorder({
      raw: storage.raw,
      logger,
      onMatchFinished: (s) => {
        seen.push(s.guid);
        throw new Error("hook bug");
      },
    });
    feed(recorder, [...liveMatch("G1"), frame(4000, "MatchDestroyed", "G1"), ...liveMatch("G2").map((l) => ({ ...l, t: l.t + 5000 })), frame(9000, "MatchDestroyed", "G2")]);
    expect(seen).toEqual(["G1", "G2"]);
    expect(logger.lines.filter((l) => l.event === "hook_failed").map((l) => l.fields.guid)).toEqual(["G1", "G2"]);
  });

  test("a match that closes logs its summary and any failed check", () => {
    const { recorder, fields } = setup();
    // Score 1–0 but nobody credited: player_goals_equal_score fails; the summary still goes out.
    feed(recorder, [frame(1000, "MatchCreated", "G"), frame(2000, "MatchInitialized", "G"), frame(2500, "GoalScored", "G", { Scorer: { Name: "A" }, GoalSpeed: 90 })]);
    feed(recorder, [frame(3000, "UpdateState", "G", { Game: { Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 0 }], PlaylistId: 10, TimeSeconds: 0 }, Players: [] })]);
    feed(recorder, [frame(4000, "MatchEnded", "G", { WinnerTeamNum: 0 }), frame(5000, "MatchDestroyed", "G")]);
    expect(fields("check_failed").map((f) => f.check)).toEqual(["player_goals_equal_score"]);
    expect(fields("summary")).toEqual([expect.objectContaining({ guid: "G", endKind: "completed", score: [1, 0], winner: 0, flags: ["player_goals_equal_score"] })]);
  });
});
