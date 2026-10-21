// Aggregates over your matches. An empty set gives nulls rather than zeros, so a page never shows
// a stat nothing was measured for.
import { BASELINE_DAYS } from "../../shared/constants";
import { daysBefore } from "../../shared/periods";
import type { Result, ResultInput } from "../../shared/result";

/** Your player row in a match. The extras are null until computed; the car stats also for a match without car state. */
export interface MyRow {
  playerKey: string;
  teamNum: number | null;
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  demos: number;
  touches: number;
  hardestShotKmh: number | null;
  woodworkHits: number | null;
  aerialTouches: number | null;
  carMs: number | null;
  boostAvg: number | null;
  supersonicMs: number | null;
  emptyBoostMs: number | null;
}

/** A match as pages read it: you are `me`, null when spectated. */
export interface MyMatch {
  guid: string;
  startedAt: number;
  endedAt: number;
  playlistId: number | null;
  arena: string | null;
  endKind: ResultInput["endKind"];
  closedVia: ResultInput["closedVia"];
  overtime: boolean;
  scoreTeam0: number | null;
  scoreTeam1: number | null;
  winnerTeamNum: number | null;
  mvpKey: string | null;
  /** A check failed on this match. */
  flagged: boolean;
  me: MyRow | null;
  result: Result | null;
  /** Your goals. */
  goals: { speedKmh: number | null; ownGoal: boolean }[];
  /** Your statfeed counts by event name. */
  statfeed: Record<string, number>;
}

const COUNTED = ["goals", "assists", "saves", "shots", "demos", "score"] as const;
type Counted = (typeof COUNTED)[number];

export interface Aggregate {
  matches: number;
  wins: number | null;
  losses: number | null;
  noResult: number | null;
  /** Wins over decided matches. */
  winPct: number | null;
  leftEarly: number | null;
  mvps: number | null;
  totals: Record<Counted, number | null>;
  perGame: Record<Counted, number | null>;
  shootingPct: number | null;
  bestWinStreak: number | null;
  bestLossStreak: number | null;
  /** The streak at the latest decided match. */
  endedOn: { result: Result; length: number } | null;
  /** The matches with extras computed; the extras below are over these only. */
  extrasMatches: number;
  hardestShotKmh: number | null;
  /** Own goals don't count. */
  fastestGoalKmh: number | null;
  woodworkHits: number | null;
  aerialTouches: number | null;
  /** Weighted by car time. */
  boostAvg: number | null;
  supersonicShare: number | null;
  emptyBoostShare: number | null;
  statfeed: Record<string, number>;
}

type Played = MyMatch & { me: MyRow };

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
// A loop, not Math.max(...xs): a long history passes more values than a call takes as arguments.
const maxOrNull = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => Math.max(a, b)) : null);
const nullCounts = () => Object.fromEntries(COUNTED.map((k) => [k, null])) as Record<Counted, null>;

function streaks(played: readonly Played[]) {
  let bestWin = 0;
  let bestLoss = 0;
  let run: Aggregate["endedOn"] = null;
  for (const { result } of [...played].sort((a, b) => a.startedAt - b.startedAt)) {
    if (result === null) continue;
    const length: number = run !== null && run.result === result ? run.length + 1 : 1;
    run = { result, length };
    if (result === "win") bestWin = Math.max(bestWin, run.length);
    else bestLoss = Math.max(bestLoss, run.length);
  }
  return { bestWinStreak: bestWin, bestLossStreak: bestLoss, endedOn: run };
}

const NO_EXTRAS = { extrasMatches: 0, hardestShotKmh: null, fastestGoalKmh: null, woodworkHits: null, aerialTouches: null, boostAvg: null, supersonicShare: null, emptyBoostShare: null };

function extras(played: readonly Played[]): Pick<Aggregate, keyof typeof NO_EXTRAS> {
  // woodwork_hits is null exactly when a match's extras weren't computed.
  const computed = played.filter((m): m is Played & { me: MyRow & { woodworkHits: number } } => m.me.woodworkHits !== null);
  if (!computed.length) return NO_EXTRAS;
  const rows = computed.map((m) => m.me);
  const withCar = rows.filter((r): r is (typeof rows)[number] & { carMs: number } => r.carMs !== null);
  const carMs = sum(withCar.map((r) => r.carMs));
  // With car_ms set, boost_avg is null only at car_ms 0, which weighs nothing, and the ms columns are never null.
  return {
    extrasMatches: computed.length,
    hardestShotKmh: maxOrNull(rows.flatMap((r) => (r.hardestShotKmh === null ? [] : [r.hardestShotKmh]))),
    fastestGoalKmh: maxOrNull(computed.flatMap((m) => m.goals.flatMap((g) => (g.ownGoal || g.speedKmh === null ? [] : [g.speedKmh])))),
    woodworkHits: sum(rows.map((r) => r.woodworkHits)),
    aerialTouches: sum(rows.map((r) => r.aerialTouches ?? 0)),
    boostAvg: ratio(sum(withCar.map((r) => (r.boostAvg ?? 0) * r.carMs)), carMs),
    supersonicShare: ratio(sum(withCar.map((r) => r.supersonicMs ?? 0)), carMs),
    emptyBoostShare: ratio(sum(withCar.map((r) => r.emptyBoostMs ?? 0)), carMs),
  };
}

/** Over the matches you played; spectated ones are skipped. */
export function aggregate(rows: readonly MyMatch[]): Aggregate {
  const played = rows.filter((m): m is Played => m.me !== null);
  const n = played.length;
  if (n === 0) {
    return {
      matches: 0,
      wins: null,
      losses: null,
      noResult: null,
      winPct: null,
      leftEarly: null,
      mvps: null,
      totals: nullCounts(),
      perGame: nullCounts(),
      shootingPct: null,
      bestWinStreak: null,
      bestLossStreak: null,
      endedOn: null,
      ...NO_EXTRAS,
      statfeed: {},
    };
  }
  const wins = played.filter((m) => m.result === "win").length;
  const losses = played.filter((m) => m.result === "loss").length;
  const totals = Object.fromEntries(COUNTED.map((k) => [k, sum(played.map((m) => m.me[k]))])) as Record<Counted, number>;
  const statfeed: Record<string, number> = {};
  for (const m of played) for (const [event, count] of Object.entries(m.statfeed)) statfeed[event] = (statfeed[event] ?? 0) + count;
  return {
    matches: n,
    wins,
    losses,
    noResult: n - wins - losses,
    winPct: ratio(wins, wins + losses),
    leftEarly: played.filter((m) => m.endKind === "left").length,
    mvps: played.filter((m) => m.mvpKey === m.me.playerKey).length,
    totals,
    perGame: Object.fromEntries(COUNTED.map((k) => [k, totals[k] / n])) as Record<Counted, number>,
    shootingPct: ratio(totals.goals, totals.shots),
    ...streaks(played),
    ...extras(played),
    statfeed,
  };
}

/** One aggregate per playlist you played, by id, the unknown playlist last. */
export function byPlaylist(rows: readonly MyMatch[]): { playlistId: number | null; aggregate: Aggregate }[] {
  return [...Map.groupBy(rows.filter((m) => m.me !== null), (m) => m.playlistId).entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([playlistId, ms]) => ({ playlistId, aggregate: aggregate(ms) }));
}

/**
 * A session's baseline: the matches from the same local clock time BASELINE_DAYS calendar days
 * earlier up to the session's start. The caller filters the rows first, so it follows the filters.
 */
export function baseline(rows: readonly MyMatch[], sessionStart: number): Aggregate {
  const from = daysBefore(sessionStart, BASELINE_DAYS);
  return aggregate(rows.filter((m) => m.startedAt >= from && m.startedAt < sessionStart));
}
