// What the recap's Overview shows from a session's aggregate and its 30-day baseline. A value
// with nothing behind it is left out rather than shown as a zero.
import type { PlaylistFilter } from "../../shared/playlist-filter";
import { playlistInfo } from "../../shared/playlists";
import type { FlagReason } from "../../shared/flags";
import type { AggregateWire, MatchDetail, MyMatchWire, SessionDetail } from "../../shared/schemas/responses";
import { filterValue } from "../../shared/playlist-filter";
import { clock, decimal } from "./format";

/** A share as whole percent. */
export const pct = (share: number) => Math.round(share * 100);

/** Session win % minus the baseline's, and the baseline's, in whole points; null with nothing to compare. */
export function winPctDelta(session: AggregateWire, base: AggregateWire): { points: number; avg: number } | null {
  if (session.winPct === null || base.winPct === null) return null;
  return { points: pct(session.winPct) - pct(base.winPct), avg: pct(base.winPct) };
}

export interface Tile {
  id: "streak" | "ended" | "shooting" | "mvps";
  label: string;
  value: string;
  vs?: { avg: string; dir: "up" | "down" | "same" };
}

export const letter = (r: "win" | "loss" | null) => (r === "win" ? "W" : r === "loss" ? "L" : "–");
export const resultWord = (r: "win" | "loss" | null) => r ?? "no result";

export function tilesFor(a: AggregateWire, base: AggregateWire): Tile[] {
  const tiles: Tile[] = [];
  if (a.bestWinStreak) tiles.push({ id: "streak", label: "Best streak", value: `W${String(a.bestWinStreak)}` });
  if (a.endedOn) tiles.push({ id: "ended", label: "Ended on", value: `${letter(a.endedOn.result)}${String(a.endedOn.length)}` });
  if (a.shootingPct !== null) {
    const tile: Tile = { id: "shooting", label: "Shooting", value: `${String(pct(a.shootingPct))}%` };
    if (base.shootingPct !== null) {
      // Compared as shown, so "40% ▲ avg 40%" can't happen.
      const d = pct(a.shootingPct) - pct(base.shootingPct);
      tile.vs = { avg: `${String(pct(base.shootingPct))}%`, dir: d > 0 ? "up" : d < 0 ? "down" : "same" };
    }
    tiles.push(tile);
  }
  if (a.mvps) tiles.push({ id: "mvps", label: "MVPs", value: `×${String(a.mvps)}` });
  return tiles;
}

export type StatId = "score" | "goals" | "assists" | "saves" | "shots" | "demos";
export type IconName = "Goal" | "Assist" | "Save" | "Shot" | "Demolition";

export const PER_GAME: readonly { id: StatId; label: string; icon: IconName | null }[] = [
  { id: "score", label: "Score", icon: null },
  { id: "goals", label: "Goals", icon: "Goal" },
  { id: "assists", label: "Assists", icon: "Assist" },
  { id: "saves", label: "Saves", icon: "Save" },
  { id: "shots", label: "Shots", icon: "Shot" },
  { id: "demos", label: "Demos", icon: "Demolition" },
];

export interface Vs { pct: number; dir: "up" | "down" | "same" }

/** Whole-percent change against an average; null without one or at zero, where no ratio is fair. */
export function vsAverage(value: number, avg: number | null): Vs | null {
  if (avg === null || avg === 0) return null;
  const p = Math.round((100 * (value - avg)) / avg);
  return { pct: p, dir: Math.abs(p) < 3 ? "same" : p > 0 ? "up" : "down" };
}

export interface PerGameCard { id: StatId; label: string; icon: IconName | null; perGame: number; total: number; avg: number | null; vs: Vs | null }

export function perGameCards(a: AggregateWire, base: AggregateWire): PerGameCard[] {
  return PER_GAME.flatMap(({ id, label, icon }) => {
    const perGame = a.perGame[id];
    const total = a.totals[id];
    if (perGame === null || total === null) return [];
    const avg = base.matches === 0 ? null : base.perGame[id];
    return [{ id, label, icon, perGame, total, avg, vs: avg === null ? null : vsAverage(perGame, avg) }];
  });
}

/** How far a per-game stat must move from the 30-day average, either way, to stand out. */
export const STOOD_OUT_MIN_PCT = 10;

export interface StoodOut { id: StatId; label: string; icon: IconName | null; perGame: number; avg: number; vs: Vs }

/** Up to three stats furthest from the average, biggest first; null with no baseline, [] when none moved enough. */
export function stoodOut(a: AggregateWire, base: AggregateWire): StoodOut[] | null {
  if (base.matches === 0) return null;
  return perGameCards(a, base)
    .flatMap(({ id, label, icon, perGame, avg, vs }) => {
      // Compared on the rounded percent, as shown, so "▲ 10%" never reads as close to average.
      return vs === null || avg === null || Math.abs(vs.pct) < STOOD_OUT_MIN_PCT ? [] : [{ id, label, icon, perGame, avg, vs }];
    })
    .sort((x, y) => Math.abs(y.vs.pct) - Math.abs(x.vs.pct))
    .slice(0, 3);
}

export interface PlaylistRow { playlistId: number | null; name: string; wins: number | null; losses: number | null; winPct: number | null; goalsPerGame: number | null }

/** A row per playlist; null with fewer than two, where it would repeat the session. */
export function playlistRows(byPlaylist: SessionDetail["byPlaylist"]): PlaylistRow[] | null {
  if (byPlaylist.length < 2) return null;
  return byPlaylist.map(({ playlistId, aggregate: a }) => ({
    playlistId,
    name: playlistInfo(playlistId).name,
    wins: a.wins,
    losses: a.losses,
    winPct: a.winPct === null ? null : pct(a.winPct),
    goalsPerGame: a.perGame.goals,
  }));
}

export interface ExtraCard {
  id: "hardest" | "fastest" | "woodwork" | "boost" | "supersonic" | "empty" | "aerial";
  label: string;
  value: string;
  unit: "km/h" | "%" | null;
  sub: string | null;
}

/** The extras tiles; [] when no match has its extras computed. */
export function extrasCards(a: AggregateWire, matches: readonly MyMatchWire[]): ExtraCard[] {
  if (a.extrasMatches === 0) return [];
  // The match a record came from, among those the aggregate counted; the first on a tie.
  const counted = (m: MyMatchWire) => m.me !== null && m.me.woodworkHits !== null;
  const matchOf = (has: (m: MyMatchWire) => boolean): string | null => {
    if (matches.length < 2) return null;
    const i = matches.findIndex((m) => counted(m) && has(m));
    return i < 0 ? null : `match ${String(i + 1)}`;
  };
  const cards: (ExtraCard | null)[] = [
    a.hardestShotKmh === null ? null : { id: "hardest", label: "Hardest shot", value: decimal(a.hardestShotKmh), unit: "km/h", sub: matchOf((m) => m.me?.hardestShotKmh === a.hardestShotKmh) },
    a.fastestGoalKmh === null
      ? null
      : { id: "fastest", label: "Fastest goal", value: decimal(a.fastestGoalKmh), unit: "km/h", sub: matchOf((m) => m.goals.some((g) => !g.ownGoal && g.speedKmh === a.fastestGoalKmh)) },
    a.woodworkHits === null ? null : { id: "woodwork", label: "Crossbar hits", value: String(a.woodworkHits), unit: null, sub: null },
    a.boostAvg === null ? null : { id: "boost", label: "Avg boost", value: String(Math.round(a.boostAvg)), unit: null, sub: "your car" },
    a.supersonicShare === null ? null : { id: "supersonic", label: "Supersonic", value: String(pct(a.supersonicShare)), unit: "%", sub: "of time played" },
    a.emptyBoostShare === null ? null : { id: "empty", label: "Empty tank", value: String(pct(a.emptyBoostShare)), unit: "%", sub: "time on 0 boost" },
    a.aerialTouches === null ? null : { id: "aerial", label: "Aerial touches", value: String(a.aerialTouches), unit: null, sub: "yours, in the air" },
  ];
  return cards.filter((c) => c !== null);
}

/** Statfeed events worth a tile, in display order. LongGoal is the game's award, which follows no simple distance rule. */
export const HIGHLIGHTS: readonly (readonly [event: string, label: string])[] = [
  ["HatTrick", "Hat tricks"],
  ["OvertimeGoal", "Overtime goals"],
  ["Savior", "Savior"],
  ["EpicSave", "Epic saves"],
  ["AerialGoal", "Aerial goals"],
  ["LongGoal", "Long goal awards"],
  ["BicycleHit", "Bicycle hits"],
  ["Playmaker", "Playmaker"],
  ["PoolShot", "Pool shots"],
  ["BackwardsGoal", "Backwards goals"],
  ["FlipReset", "Flip resets"],
  ["LowFive", "Low fives"],
];

export function highlights(statfeed: Record<string, number>): { event: string; label: string; count: number }[] {
  return HIGHLIGHTS.flatMap(([event, label]) => {
    const count = statfeed[event] ?? 0;
    return count > 0 ? [{ event, label, count }] : [];
  });
}

/** "3–1", your team first (team 0 first when your team is unknown); null without a score. */
export function scoreFor(m: Pick<MyMatchWire, "scoreTeam0" | "scoreTeam1" | "me">): string | null {
  if (m.scoreTeam0 === null || m.scoreTeam1 === null) return null;
  const [us, them] = m.me?.teamNum === 1 ? [m.scoreTeam1, m.scoreTeam0] : [m.scoreTeam0, m.scoreTeam1];
  return `${String(us)}–${String(them)}`;
}

/** Long sessions get smaller match cards, about 13 to a row. */
export const isDense = (matches: number): boolean => matches > 24;

/** Which of a session's pages: the Overview, Matches & numbers, or one match. */
export type RecapView = "overview" | "matches" | { match: string };

/** A session's recap (or the latest one's, for a null key), with the filter unless it's the default. */
export function recapPath(key: string | null, filter: PlaylistFilter, view: RecapView = "overview"): string {
  const session = key === null ? "/recap" : `/recap/${encodeURIComponent(key)}`;
  const path = key === null || view === "overview" ? session : view === "matches" ? `${session}/matches` : `${session}/match/${encodeURIComponent(view.match)}`;
  return filter === "everything" ? path : `${path}?filter=${filterValue(filter)}`;
}

const counted = (r: "win" | "loss") => `counted as a ${r}`;
const DECIDED = ", which the score had already decided";

/** The match page's flag note, a line per reason, worded by how the match was actually counted. */
export function flagLines(flags: readonly FlagReason[], result: "win" | "loss" | null): string[] {
  const decided = flags.includes("winner_decided") ? DECIDED : "";
  // A decided winner is filled in when you left or the ending was lost, so those lines say it; with
  // no result they can't, and the decided winner gets its own line.
  const endLine = result !== null && (flags.includes("left") || flags.includes("lost_ending"));
  return flags.flatMap((f): string[] => {
    switch (f) {
      case "left":
        return [result === null ? "You left before the end." : `You left before the end — ${counted(result)}${decided}.`];
      case "lost_ending":
        return [result === null ? "The tracker lost this match's ending, so there's no result." : `The tracker lost this match's ending — ${counted(result)}${decided}.`];
      case "joined":
        return ["You joined in progress — counted as a full game."];
      case "winner_decided":
        return endLine ? [] : ["The game didn't report a winner — it was taken from the score, which had already decided it."];
      case "mvp_inferred":
        return ["MVP inferred: no MVP award fired, so it went to the top score on the winning team."];
      case "check_failed":
        return ["A data check failed on this match, so some numbers may be off."];
    }
  });
}

const SHORT: Record<FlagReason, string> = {
  left: "you left early",
  lost_ending: "ending not recorded",
  joined: "joined in progress",
  winner_decided: "winner taken from the score",
  mvp_inferred: "MVP inferred",
  check_failed: "a data check failed",
};

/** "flagged: …" for an aria-label or title; null when the match isn't flagged. */
export const flagShort = (flags: readonly FlagReason[]): string | null => (flags.length ? `flagged: ${flags.map((f) => SHORT[f]).join(", ")}` : null);

/** Whether this match's MVP is you. */
export const isMyMvp = (m: MyMatchWire): boolean => m.me !== null && m.mvpKey === m.me.playerKey;

/** How a match link is announced: "Match 2, 21:04, win, 3–1, Ranked Doubles, MVP, flagged: …". */
export function matchLabel(m: MyMatchWire, n: number): string {
  return [`Match ${String(n)}`, clock(m.startedAt), resultWord(m.result), scoreFor(m), playlistInfo(m.playlistId).name, isMyMvp(m) && "MVP", flagShort(m.flags)]
    .filter(Boolean)
    .join(", ");
}

type MatchPlayer = MatchDetail["players"][number];
export interface ScoreTeam {
  side: "yours" | "opponents" | "blue" | "orange" | "unknown";
  teamNum: number | null;
  players: MatchPlayer[];
}

/** The scoreboard's teams: yours first (blue first when yours is unknown), each by score; empty ones left out. */
export function scoreboardTeams(players: readonly MatchPlayer[], myTeam: number | null): ScoreTeam[] {
  const order: [ScoreTeam["side"], number | null][] =
    myTeam === null ? [["blue", 0], ["orange", 1]] : [["yours", myTeam], ["opponents", 1 - myTeam]];
  const teams: ScoreTeam[] = [...order, ["unknown", null] as const].map(([side, teamNum]) => ({
    side,
    teamNum,
    players: players.filter((p) => p.teamNum === teamNum).sort((a, b) => b.score - a.score),
  }));
  return teams.filter((t) => t.players.length > 0);
}
