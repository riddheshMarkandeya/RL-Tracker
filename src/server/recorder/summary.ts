// Folds one match's deduped events into a MatchSummary through a per-event handler table. Each
// fact has one source: the score and roster from the last state before MatchEnded (player stats
// then catch up in the states after it), the winner from MatchEnded (else the decided rule), the
// MVP from the MVP statfeed (else inferred from the scoreboard).
import { isObject, type Data } from "./envelope";
import type { MatchExtras } from "./extras";
import type { CloseVia } from "./lifecycle";
import { BOT_ID, playerKey, resolveTarget } from "./players";
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
  /** Last real team (0 or 1); null if never on one. */
  teamNum: TeamNum | null;
  /** Bit `1 << TeamNum` for every team the player was on. */
  teamsSeen: number;
  isBot: boolean;
  /** In the end snapshot; false for a player who left. */
  presentAtEnd: boolean;
  /** From the end snapshot, raised by any stat that reached the scoreboard only after MatchEnded. */
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
  /**
   * Goals indexed by TeamNum, from the last scoreboard before MatchEnded with both teams' goals (a
   * whole number of 0 or more each); null when there was none. `facts.rejectedScoreboards` counts the rest.
   */
  score: [number, number] | null;
  /** "decided": no MatchEnded, but the clock had run out (or it was overtime) with one team ahead. */
  winner: { teamNum: TeamNum; source: "match_ended" | "decided" } | null;
  /**
   * "statfeed": the game's award, whose `key` is null when its target couldn't be matched to the
   * roster. "inferred": no award came, so the winning team's top scorer.
   */
  mvp: { name: string; teamNum: TeamNum | null; key: string | null; source: "statfeed" | "inferred" } | null;
  roster: RosterEntry[];
  /** Statfeed counts by roster key, then event name. */
  statfeed: Record<string, Record<string, number>>;
  /** The roster key the camera followed through play: the player whose game this is. Null when spectating or no target. */
  cameraKey: string | null;
  /** What the checks read. */
  facts: {
    sawMatchEnded: boolean;
    /** MatchEnded's WinnerTeamNum as sent, NO_CONTEST included. */
    endedWinnerTeamNum: number | null;
    sawPodium: boolean;
    mvpCount: number;
    liveGoals: number;
    minClock: number | null;
    unresolvedStatfeed: number;
    /** Scoreboards before MatchEnded without both teams' goals, so not used for the score. */
    rejectedScoreboards: number;
    /** States with a camera target during play, resolved or not. */
    cameraTargets: number;
  };
  dedupDropped: Record<string, number>;
  /** The extra stats and goal map from live play; readMatch fills them in after summarise. */
  extras: MatchExtras | null;
  /** Why computing the extras threw, if it did. */
  extrasError: string | null;
  /** Ids of failed checks. */
  flags: string[];
}

/**
 * A real team: there are two. The game also sends 255 for a player not yet on one and -1 for a no
 * contest, and anything else would make a winner no player is on. Every team number the summary
 * stores as a team goes through it.
 */
export type TeamNum = 0 | 1;
export const TEAMS: readonly TeamNum[] = [0, 1];
export const teamOf = (v: unknown): TeamNum | null => (v === 0 || v === 1 ? v : null);
/** MatchEnded's WinnerTeamNum for a match with no winner. */
export const NO_CONTEST = -1;

/** The item with the highest value, or null when none or several share it. */
function uniqueTop<T>(items: readonly T[], value: (item: T) => number): T | null {
  const top = Math.max(...items.map(value));
  const best = items.filter((i) => value(i) === top);
  return best.length === 1 ? (best[0] ?? null) : null;
}
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** The objects in an array field, skipping any other entry. */
const objects = (v: unknown): Data[] => (Array.isArray(v) ? v.filter(isObject) : []);
export const players = (data: Data): Data[] => objects(data.Players);

/** Both teams' goals from a state's `Game`, or null unless both are whole and non-negative. */
function readScore(game: Data): [number, number] | null {
  const goals: (number | undefined)[] = [];
  for (const t of objects(game.Teams)) {
    const team = teamOf(t.TeamNum);
    const score = num(t.Score);
    if (team !== null && score !== null && Number.isInteger(score) && score >= 0) goals[team] = score;
  }
  const [blue, orange] = goals;
  return blue === undefined || orange === undefined ? null : [blue, orange];
}

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
  score: [number, number] | null;
  roster: Map<string, RosterEntry>;
  /** Players of the latest state, for resolving a statfeed's Shortcut at that moment. */
  latestPlayers: Data[];
  mvpCount: number;
  mvp: MatchSummary["mvp"];
  liveGoals: number;
  statfeed: Map<string, Record<string, number>>;
  unresolvedStatfeed: number;
  rejectedScoreboards: number;
  camera: Map<string, number>;
  cameraTargets: number;
}

function readClock(acc: Acc, seconds: unknown, overtime: unknown): void {
  const t = num(seconds);
  if (t !== null) acc.minClock = acc.minClock === null ? t : Math.min(acc.minClock, t);
  if (overtime === true) acc.overtime = true;
  if (acc.sawMatchEnded || t === null || t === acc.clock) return;
  acc.prevClock = acc.clock;
  acc.clock = t;
}

const readStats = (p: Data): PlayerStats => ({
  score: num(p.Score) ?? 0,
  goals: num(p.Goals) ?? 0,
  shots: num(p.Shots) ?? 0,
  assists: num(p.Assists) ?? 0,
  saves: num(p.Saves) ?? 0,
  touches: num(p.Touches) ?? 0,
  demos: num(p.Demos) ?? 0,
});

function updateRoster(acc: Acc, list: Data[]): void {
  for (const r of acc.roster.values()) r.presentAtEnd = false;
  for (const p of list) {
    const key = playerKey(p);
    const team = teamOf(p.TeamNum);
    const prev = acc.roster.get(key);
    acc.roster.set(key, {
      key,
      primaryId: str(p.PrimaryId) ?? "",
      name: str(p.Name) ?? prev?.name ?? "",
      teamNum: team ?? prev?.teamNum ?? null,
      teamsSeen: (prev?.teamsSeen ?? 0) | (team === null ? 0 : 1 << team),
      isBot: p.PrimaryId === BOT_ID,
      presentAtEnd: true,
      stats: readStats(p),
    });
  }
}

/**
 * The game's scoreboard lags its statfeed, so a stat in the last moments reaches only states after
 * MatchEnded. Nothing is played after the end, so a counter can only catch up there, while a
 * teardown state may carry reset counters: each stat keeps its highest value. Only players still
 * in the state are updated; who was there at the end stays as MatchEnded found it.
 */
function catchUpStats(acc: Acc, list: Data[]): void {
  for (const p of list) {
    const entry = acc.roster.get(playerKey(p));
    if (!entry) continue;
    const late = readStats(p);
    for (const k of Object.keys(late) as (keyof PlayerStats)[]) entry.stats[k] = Math.max(entry.stats[k], late[k]);
  }
}

const resolve = (acc: Acc, target: Data) => resolveTarget(acc.latestPlayers, acc.roster.values(), target);

/** Counts the state's camera target, during play only: replays and the podium show other players. */
function countCamera(acc: Acc, game: Data): void {
  if (game.bHasTarget !== true || game.bReplay === true) return;
  acc.cameraTargets++;
  const key = resolve(acc, (game.Target ?? {}) as Data);
  if (key !== null) acc.camera.set(key, (acc.camera.get(key) ?? 0) + 1);
}

type Handler = (acc: Acc, data: Data) => void;

/** One handler per event name; events without one don't affect the summary. */
const HANDLERS: Readonly<Record<string, Handler>> = {
  UpdateState: (acc, data) => {
    const game = (data.Game ?? {}) as Data;
    readClock(acc, game.TimeSeconds, game.bOvertime);
    acc.latestPlayers = players(data);
    // After MatchEnded come the podium and teardown, with players leaving and states possibly
    // retagged with the next match's guid: the snapshot is fixed, but for the lagging player stats.
    if (acc.sawMatchEnded) {
      catchUpStats(acc, acc.latestPlayers);
      return;
    }
    const playlist = num(game.PlaylistId);
    if (playlist) acc.playlistId = playlist;
    acc.arena = str(game.Arena) ?? acc.arena;
    if (Array.isArray(game.Teams)) {
      // A scoreboard missing either team's goals says nothing reliable; the last full one stands.
      const score = readScore(game);
      if (score) acc.score = score;
      else acc.rejectedScoreboards++;
    }
    updateRoster(acc, acc.latestPlayers);
    countCamera(acc, game);
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
    const name = str(data.EventName) ?? "";
    const target = (data.MainTarget ?? {}) as Data;
    const key = resolve(acc, target);
    if (key === null) acc.unresolvedStatfeed++;
    else {
      const counts = acc.statfeed.get(key) ?? {};
      counts[name] = (counts[name] ?? 0) + 1;
      acc.statfeed.set(key, counts);
    }
    if (name !== "MVP") return;
    acc.mvpCount++;
    acc.mvp ??= { name: str(target.Name) ?? "", teamNum: teamOf(target.TeamNum), key, source: "statfeed" };
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

/**
 * Without MatchEnded, a match is decided when one team leads and the clock had run out or it was
 * overtime (the next goal ends it). At 0 s a one-goal lead could in theory still be equalised
 * while the ball is in play; that is accepted.
 */
function winner(acc: Acc): MatchSummary["winner"] {
  if (acc.sawMatchEnded) {
    const team = teamOf(acc.winnerTeamNum);
    return team === null ? null : { teamNum: team, source: "match_ended" };
  }
  const score = acc.score;
  if (!score || !(acc.overtime || acc.clock === 0)) return null;
  const lead = uniqueTop(TEAMS, (t) => score[t]);
  return lead === null ? null : { teamNum: lead, source: "decided" };
}

/** The game's award if one came, else the winning team's unique top scorer among players still there at the end. */
function mvp(acc: Acc, win: MatchSummary["winner"]): MatchSummary["mvp"] {
  if (acc.mvp || !win) return acc.mvp;
  const team = [...acc.roster.values()].filter((r) => r.teamNum === win.teamNum && r.presentAtEnd);
  const best = uniqueTop(team, (r) => r.stats.score);
  return best ? { name: best.name, teamNum: best.teamNum, key: best.key, source: "inferred" } : null;
}

/**
 * The player's own camera stays on their car through play, while a spectator's switches between
 * players, so one player must hold nearly all of it. Unresolved targets (not on the scoreboard
 * yet) say nothing either way, so they don't count.
 */
export const CAMERA_SHARE = 0.95;

/** The player the camera followed through play, or null when it never settled on one. */
function cameraKey(acc: Acc): string | null {
  let best: [string, number] | null = null;
  let resolved = 0;
  for (const entry of acc.camera) {
    resolved += entry[1];
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best && best[1] >= CAMERA_SHARE * resolved ? best[0] : null;
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
    statfeed: new Map(),
    unresolvedStatfeed: 0,
    rejectedScoreboards: 0,
    camera: new Map(),
    cameraTargets: 0,
  };
  for (const ev of events) HANDLERS[ev.name]?.(acc, ev.data);
  const roster = [...acc.roster.values()];
  const win = winner(acc);
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
    winner: win,
    mvp: mvp(acc, win),
    roster,
    statfeed: Object.fromEntries(acc.statfeed),
    cameraKey: cameraKey(acc),
    facts: {
      sawMatchEnded: acc.sawMatchEnded,
      endedWinnerTeamNum: acc.winnerTeamNum,
      sawPodium: acc.sawPodium,
      mvpCount: acc.mvpCount,
      liveGoals: acc.liveGoals,
      minClock: acc.minClock,
      unresolvedStatfeed: acc.unresolvedStatfeed,
      rejectedScoreboards: acc.rejectedScoreboards,
      cameraTargets: acc.cameraTargets,
    },
    dedupDropped: close.dedupDropped,
    extras: null,
    extrasError: null,
    flags: [],
  };
}
