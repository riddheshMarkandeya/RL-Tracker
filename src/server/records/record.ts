// A finished match's summary mapped to the rows tracker.db stores. Nothing here depends on which
// player is "you": every player gets a full row, and pages pick "you" by joining with my_ids.
import { PLAYER_EXTRAS, type ExtraValues } from "../recorder/extras";
import type { GoalPoint } from "../recorder/play";
import type { MatchSummary, TeamNum } from "../recorder/summary";

export interface MatchRow {
  guid: string;
  startedAt: number;
  endedAt: number;
  /** Raw id: the playlist map is applied when a page reads it, so a corrected map reaches old matches. */
  playlistId: number | null;
  arena: string | null;
  endKind: MatchSummary["endKind"];
  closedVia: MatchSummary["closedVia"];
  joinedInProgress: boolean;
  overtime: boolean;
  scoreTeam0: number | null;
  scoreTeam1: number | null;
  winnerTeamNum: TeamNum | null;
  winnerSource: NonNullable<MatchSummary["winner"]>["source"] | null;
  mvpKey: string | null;
  mvpSource: NonNullable<MatchSummary["mvp"]>["source"] | null;
  /** The camera's PrimaryId: the guess at whose game this is. Null for a bot or no target. */
  cameraPrimaryId: string | null;
  checkFlags: string[];
}

export interface PlayerRow {
  playerKey: string;
  primaryId: string;
  name: string;
  isBot: boolean;
  teamNum: TeamNum | null;
  teamsSeen: number;
  presentAtEnd: boolean;
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
  /** By registry column; all null when the summary has no extras. */
  extras: ExtraValues;
}

export interface StatfeedRow {
  playerKey: string;
  eventName: string;
  count: number;
}

export interface MatchRecord {
  match: MatchRow;
  players: PlayerRow[];
  statfeed: StatfeedRow[];
  /** In match order. */
  goals: GoalPoint[];
}

const NO_EXTRAS: ExtraValues = Object.fromEntries(PLAYER_EXTRAS.map((e) => [e.column, null]));

function cameraPrimaryId(s: MatchSummary): string | null {
  const entry = s.roster.find((r) => r.key === s.cameraKey);
  return entry && !entry.isBot && entry.primaryId !== "" ? entry.primaryId : null;
}

export function toRecord(s: MatchSummary): MatchRecord {
  return {
    match: {
      guid: s.guid,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      playlistId: s.playlistId,
      arena: s.arena,
      endKind: s.endKind,
      closedVia: s.closedVia,
      joinedInProgress: s.joinedInProgress,
      overtime: s.overtime,
      scoreTeam0: s.score?.[0] ?? null,
      scoreTeam1: s.score?.[1] ?? null,
      winnerTeamNum: s.winner?.teamNum ?? null,
      winnerSource: s.winner?.source ?? null,
      mvpKey: s.mvp?.key ?? null,
      mvpSource: s.mvp?.source ?? null,
      cameraPrimaryId: cameraPrimaryId(s),
      checkFlags: [...s.flags],
    },
    players: s.roster.map((r) => ({
      playerKey: r.key,
      primaryId: r.primaryId,
      name: r.name,
      isBot: r.isBot,
      teamNum: r.teamNum,
      teamsSeen: r.teamsSeen,
      presentAtEnd: r.presentAtEnd,
      ...r.stats,
      extras: { ...NO_EXTRAS, ...s.extras?.players[r.key] },
    })),
    statfeed: Object.entries(s.statfeed).flatMap(([playerKey, counts]) => Object.entries(counts).map(([eventName, count]) => ({ playerKey, eventName, count }))),
    goals: s.extras?.goals ?? [],
  };
}
