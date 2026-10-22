import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./log";
import { readCapture, type CaptureLine } from "./recorder/feed";
import type { GoalPoint } from "./recorder/play";
import type { TeamNum } from "./recorder/summary";
import type { MatchRecord, PlayerRow } from "./records/record";

export interface LogLine {
  level: "info" | "warn" | "error";
  cat: string;
  event: string;
  fields: Record<string, unknown>;
}

/** A loopback port nothing listens on right now. */
export async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const { port } = probe;
  await probe.stop(true);
  if (port === undefined) throw new Error("probe server has no port");
  return port;
}

/** A Logger that keeps its lines in memory, for tests. */
export function memoryLogger(): Logger & { lines: LogLine[]; events: () => string[] } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine["level"]) =>
    (cat: string, event: string, fields: Record<string, unknown> = {}) => {
      lines.push({ level, cat, event, fields });
    };
  return { lines, events: () => lines.map((l) => `${l.cat}/${l.event}`), info: at("info"), warn: at("warn"), error: at("error") };
}

/** A capture fixture's frame lines, from test/fixtures/<name>.ndjson. */
export const readFixture = (name: string): CaptureLine[] => readCapture(readFileSync(join(import.meta.dirname, "../../test/fixtures", `${name}.ndjson`), "utf8"));

export const ME = "Epic|me|0";
export const ALT = "Steam|alt|0";
export const THEM = "Epic|them|0";

/** A player row with every stat set, for match-record tests. */
export const player = (key: string, teamNum: TeamNum, over: Partial<PlayerRow> = {}): PlayerRow => ({
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

export const goal = (teamNum: TeamNum, scorerKey: string, over: Partial<GoalPoint> = {}): GoalPoint => ({
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

/** A completed 1-1 match, won by team 0 (ME) against THEM, with extras computed. */
export const record = (guid: string, startedAt: number, over: Partial<MatchRecord> = {}, match: Partial<MatchRecord["match"]> = {}): MatchRecord => ({
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
