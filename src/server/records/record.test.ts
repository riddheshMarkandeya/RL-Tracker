import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { feed } from "../recorder/feed";
import { createRecorder } from "../recorder/recorder";
import type { MatchSummary } from "../recorder/summary";
import { openStorage } from "../storage";
import { memoryLogger, readFixture } from "../testing";
import { toRecord, type MatchRow } from "./record";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The summaries the recorder hands its hook for a fixture. */
function summariesOf(name: string): MatchSummary[] {
  const dir = mkdtempSync(join(tmpdir(), "rltracker-record-"));
  dirs.push(dir);
  const storage = openStorage({ dir, logger: memoryLogger() });
  const out: MatchSummary[] = [];
  try {
    feed(createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished: (s) => out.push(s) }), readFixture(name));
  } finally {
    storage.close();
  }
  return out;
}

const matchOf = (name: string): MatchRow => {
  const [s] = summariesOf(name);
  if (!s) throw new Error(`no finished match in ${name}`);
  return toRecord(s).match;
};

const base: Partial<MatchRow> = { closedVia: "destroyed", checkFlags: [], cameraPrimaryId: "Epic|anon1|0" };

describe("toRecord on the fixtures", () => {
  test.each<[string, Partial<MatchRow>]>([
    ["completed", { ...base, playlistId: 13, endKind: "completed", joinedInProgress: false, overtime: false, scoreTeam0: 1, scoreTeam1: 2, winnerTeamNum: 1, winnerSource: "match_ended", mvpKey: "Epic|anon5|0", mvpSource: "statfeed" }],
    ["early-end", { ...base, playlistId: 2, arena: "Stadium_P", endKind: "early_end", scoreTeam0: 2, scoreTeam1: 3, winnerTeamNum: 0, winnerSource: "match_ended", mvpKey: "Epic|anon3|0", mvpSource: "statfeed" }],
    ["overtime-leavers", { ...base, cameraPrimaryId: "Epic|anon2|0", endKind: "completed", overtime: true, scoreTeam0: 5, scoreTeam1: 4, winnerTeamNum: 0, mvpKey: "Epic|anon4|0" }],
    ["joined-in-progress", { ...base, arena: "TrainStation_P", joinedInProgress: true, scoreTeam0: 2, scoreTeam1: 4, winnerTeamNum: 1, mvpKey: "Epic|anon3|0" }],
    ["left-early", { ...base, playlistId: 10, arena: "street_p", endKind: "left", scoreTeam0: 0, scoreTeam1: 4, winnerTeamNum: null, winnerSource: null, mvpKey: null, mvpSource: null }],
    ["left-countdown", { ...base, playlistId: 4, endKind: "left", scoreTeam0: 0, scoreTeam1: 0, winnerTeamNum: null, mvpKey: null }],
    ["private-series", { ...base, arena: "cs_p", endKind: "completed", joinedInProgress: true, scoreTeam0: 3, scoreTeam1: 7, winnerTeamNum: 1, mvpKey: "Epic|anon3|0", mvpSource: "statfeed" }],
  ])("%s", (name, expected) => {
    expect(matchOf(name)).toMatchObject(expected);
  });

  test("every player gets a row, leavers and bots included, with the teams they were on", () => {
    const [s] = summariesOf("overtime-leavers");
    if (!s) throw new Error("no match");
    const { players } = toRecord(s);
    expect(players).toHaveLength(6);
    expect(players.find((p) => p.playerKey === "Epic|anon1|0")).toEqual({
      playerKey: "Epic|anon1|0",
      primaryId: "Epic|anon1|0",
      name: "Player 1",
      isBot: false,
      teamNum: 1,
      teamsSeen: 2,
      presentAtEnd: false,
      score: 774,
      goals: 3,
      shots: 5,
      assists: 0,
      saves: 3,
      touches: 55,
      demos: 1,
    });
    const [countdown] = summariesOf("left-countdown");
    if (!countdown) throw new Error("no match");
    expect(toRecord(countdown).players.find((p) => p.isBot)).toMatchObject({ playerKey: "bot:Slider", primaryId: "Unknown|0|0", teamNum: 1 });
  });

  test("statfeed rows are one per player and event name", () => {
    const [s] = summariesOf("early-end");
    if (!s) throw new Error("no match");
    const rows = toRecord(s).statfeed.filter((r) => r.playerKey === "Epic|anon3|0");
    expect(rows.sort((a, b) => a.eventName.localeCompare(b.eventName))).toEqual([
      { playerKey: "Epic|anon3|0", eventName: "Demolish", count: 3 },
      { playerKey: "Epic|anon3|0", eventName: "EpicSave", count: 1 },
      { playerKey: "Epic|anon3|0", eventName: "Goal", count: 1 },
      { playerKey: "Epic|anon3|0", eventName: "MVP", count: 1 },
      { playerKey: "Epic|anon3|0", eventName: "Save", count: 1 },
      { playerKey: "Epic|anon3|0", eventName: "Shot", count: 1 },
      { playerKey: "Epic|anon3|0", eventName: "Win", count: 1 },
    ]);
  });
});

describe("toRecord: camera id", () => {
  const [completed] = summariesOf("completed");
  const first = completed?.roster[0];
  if (!completed || !first) throw new Error("no match");

  test("a bot, a blank id or no target store no camera id", () => {
    const withCamera = (key: string | null, roster = completed.roster): MatchSummary => ({ ...completed, cameraKey: key, roster });
    expect(toRecord(withCamera(null)).match.cameraPrimaryId).toBeNull();
    const bot = { ...first, key: "bot:Slider", primaryId: "Unknown|0|0", isBot: true };
    expect(toRecord(withCamera("bot:Slider", [bot])).match.cameraPrimaryId).toBeNull();
    const blank = { ...first, key: "", primaryId: "" };
    expect(toRecord(withCamera("", [blank])).match.cameraPrimaryId).toBeNull();
  });

  test("check failures are carried as the flag ids", () => {
    expect(toRecord({ ...completed, flags: ["camera_on_roster"] }).match.checkFlags).toEqual(["camera_on_roster"]);
  });
});
