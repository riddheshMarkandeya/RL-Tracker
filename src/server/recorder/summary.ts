// Folds one match's deduped events into a MatchSummary through a per-event handler table. Each
// fact has one source: the winner only from MatchEnded, the MVP only from the MVP statfeed, the
// score and the end-of-match scoreboard from the last state before MatchEnded.
import type { Data } from "./envelope";
import type { CloseVia } from "./lifecycle";
import { BOT_ID, playerKey } from "./players";
import type { StoredEvent } from "./store";

export type EndKind = "completed" | "early_end" | "left" | "orphaned";

export interface PlayerStats {
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  touches: number;
  demos: number;
}

export interface RosterEntry {
  /** PrimaryId, or `bot:<Name>` since every bot shares one id. */
  key: string;
  primaryId: string;
  name: string;
  /** Last team other than 255 (not on a team yet); null if never on one. */
  teamNum: number | null;
  isBot: boolean;
  /** In the end snapshot; false for a player who left. */
  presentAtEnd: boolean;
  stats: PlayerStats;
}

export interface MatchSummary {
  guid: string;
  playlistId: number | null;
  arena: string | null;
  startedAt: number;
  endedAt: number;
  endKind: EndKind;
  closedVia: CloseVia;
  joinedInProgress: boolean;
  overtime: boolean;
  /** Goals indexed by TeamNum, from the end snapshot; null when no state was stored. */
  score: number[] | null;
  winnerTeamNum: number | null;
  /** `key` is the roster key, or null when the statfeed's target couldn't be matched. */
  mvp: { name: string; teamNum: number | null; key: string | null } | null;
  roster: RosterEntry[];
  /** What the checks read. */
  facts: { sawMatchEnded: boolean; sawPodium: boolean; mvpCount: number; liveGoals: number; minClock: number | null };
  dedupDropped: Record<string, number>;
  /** Ids of failed checks. */
  flags: string[];
}

const NO_TEAM = 255;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const players = (data: Data) => (Array.isArray(data.Players) ? (data.Players as Data[]) : []);

interface Acc {
  playlistId: number | null;
  arena: string | null;
  sawInitialized: boolean;
  sawMatchEnded: boolean;
  sawPodium: boolean;
  overtime: boolean;
  /** The last clock reading before MatchEnded, and the different one before it. */
  clock: number | null;
  prevClock: number | null;
  minClock: number | null;
  winnerTeamNum: number | null;
  score: number[] | null;
  roster: Map<string, RosterEntry>;
  /** Players of the latest state, for resolving a statfeed's Shortcut at that moment. */
  latestPlayers: Data[];
  mvpCount: number;
  mvp: MatchSummary["mvp"];
  liveGoals: number;
}

function readClock(acc: Acc, seconds: unknown, overtime: unknown): void {
  const t = num(seconds);
  if (t !== null) acc.minClock = acc.minClock === null ? t : Math.min(acc.minClock, t);
  if (overtime === true) acc.overtime = true;
  if (acc.sawMatchEnded || t === null || t === acc.clock) return;
  acc.prevClock = acc.clock;
  acc.clock = t;
}

function updateRoster(acc: Acc, list: Data[]): void {
  for (const r of acc.roster.values()) r.presentAtEnd = false;
  for (const p of list) {
    const key = playerKey(p);
    const team = num(p.TeamNum);
    const prev = acc.roster.get(key);
    acc.roster.set(key, {
      key,
      primaryId: str(p.PrimaryId) ?? "",
      name: str(p.Name) ?? prev?.name ?? "",
      teamNum: team !== null && team !== NO_TEAM ? team : (prev?.teamNum ?? null),
      isBot: p.PrimaryId === BOT_ID,
      presentAtEnd: true,
      stats: {
        score: num(p.Score) ?? 0,
        goals: num(p.Goals) ?? 0,
        shots: num(p.Shots) ?? 0,
        assists: num(p.Assists) ?? 0,
        saves: num(p.Saves) ?? 0,
        touches: num(p.Touches) ?? 0,
        demos: num(p.Demos) ?? 0,
      },
    });
  }
}

/** The statfeed target's roster key: its Shortcut in the latest state if name and team agree, else a unique name+team match. */
function resolveTarget(acc: Acc, target: Data): string | null {
  const name = str(target.Name);
  const team = num(target.TeamNum);
  const byShortcut = acc.latestPlayers.find((p) => p.Shortcut === target.Shortcut);
  if (byShortcut?.Name === name && num(byShortcut.TeamNum) === team) return playerKey(byShortcut);
  const matches = [...acc.roster.values()].filter((r) => r.name === name && r.teamNum === team);
  return matches.length === 1 ? (matches[0]?.key ?? null) : null;
}

type Handler = (acc: Acc, data: Data) => void;

/** One handler per event name; events without one don't affect the summary. WP4 adds stats here. */
const HANDLERS: Readonly<Record<string, Handler>> = {
  UpdateState: (acc, data) => {
    const game = (data.Game ?? {}) as Data;
    readClock(acc, game.TimeSeconds, game.bOvertime);
    acc.latestPlayers = players(data);
    // After MatchEnded come the podium and teardown, with players leaving and states possibly
    // retagged from the next match: the snapshot is fixed.
    if (acc.sawMatchEnded) return;
    const playlist = num(game.PlaylistId);
    if (playlist) acc.playlistId = playlist;
    acc.arena = str(game.Arena) ?? acc.arena;
    if (Array.isArray(game.Teams)) {
      const score: number[] = [];
      for (const t of game.Teams as Data[]) {
        const team = num(t.TeamNum);
        if (team !== null) score[team] = num(t.Score) ?? 0;
      }
      acc.score = score;
    }
    updateRoster(acc, acc.latestPlayers);
  },
  ClockUpdatedSeconds: (acc, data) => {
    readClock(acc, data.TimeSeconds, data.bOvertime);
  },
  MatchInitialized: (acc) => {
    acc.sawInitialized = true;
  },
  MatchEnded: (acc, data) => {
    acc.sawMatchEnded = true;
    acc.winnerTeamNum = num(data.WinnerTeamNum);
  },
  PodiumStart: (acc) => {
    acc.sawPodium = true;
  },
  GoalScored: (acc) => {
    acc.liveGoals++;
  },
  StatfeedEvent: (acc, data) => {
    if (data.EventName !== "MVP") return;
    acc.mvpCount++;
    if (acc.mvp) return;
    const target = (data.MainTarget ?? {}) as Data;
    acc.mvp = { name: str(target.Name) ?? "", teamNum: num(target.TeamNum), key: resolveTarget(acc, target) };
  },
};

/**
 * Every match resets the clock to 0 just before MatchEnded, so time left shows in the reading
 * before that: a full match counts down through 1, a forfeit jumps from where it stopped. In
 * overtime the clock counts up instead, and any end there is a full one.
 */
function endedEarly(acc: Acc): boolean {
  if (acc.overtime || acc.clock === null) return false;
  return acc.clock > 0 || (acc.prevClock ?? 0) > 1;
}

function endKind(acc: Acc, via: CloseVia): EndKind {
  if (acc.sawMatchEnded) return endedEarly(acc) ? "early_end" : "completed";
  return via === "destroyed" ? "left" : "orphaned";
}

/** `events` are one match's events, deduped, in seq order. */
export function summarise(guid: string, events: readonly StoredEvent[], close: { via: CloseVia; dedupDropped: Record<string, number> }): MatchSummary {
  const acc: Acc = {
    playlistId: null,
    arena: null,
    sawInitialized: false,
    sawMatchEnded: false,
    sawPodium: false,
    overtime: false,
    clock: null,
    prevClock: null,
    minClock: null,
    winnerTeamNum: null,
    score: null,
    roster: new Map(),
    latestPlayers: [],
    mvpCount: 0,
    mvp: null,
    liveGoals: 0,
  };
  for (const ev of events) HANDLERS[ev.name]?.(acc, ev.data);
  const roster = [...acc.roster.values()];
  return {
    guid,
    playlistId: acc.playlistId,
    arena: acc.arena,
    startedAt: events[0]?.ts ?? 0,
    endedAt: events.at(-1)?.ts ?? 0,
    endKind: endKind(acc, close.via),
    closedVia: close.via,
    // Re-derived from the stored events rather than taken from the lifecycle, so recompute needs only raw.db.
    joinedInProgress: !acc.sawInitialized,
    overtime: acc.overtime,
    score: acc.score,
    winnerTeamNum: acc.winnerTeamNum,
    mvp: acc.mvp,
    roster,
    facts: { sawMatchEnded: acc.sawMatchEnded, sawPodium: acc.sawPodium, mvpCount: acc.mvpCount, liveGoals: acc.liveGoals, minClock: acc.minClock },
    dedupDropped: close.dedupDropped,
    flags: [],
  };
}
