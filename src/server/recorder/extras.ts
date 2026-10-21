// The per-player extra stats as a registry: each entry is one match_players column and how it is
// computed from the play view. The writer builds its column list from here, and a migration test
// fails for an entry whose column doesn't exist.
import { buildPlay, CAR_SAMPLE_CAP_MS, type CarSample, type GoalPoint, type Play, type Pos } from "./play";
import { GOAL_LINE_Y } from "../../shared/constants";
import type { StoredEvent } from "./store";
import type { MatchSummary, RosterEntry } from "./summary";

export interface PlayerExtra {
  column: string;
  compute(play: Play, key: string): number | null;
  /** Its sane range, checked per player; null when it can't leave it by construction. */
  inRange: ((n: number, r: RosterEntry, facts: Play["facts"]) => boolean) | null;
}

export const HARDEST_SHOT_MAX_KMH = 250;

/** Every AerialGoal statfeed's scoring touch was at 558 or higher; nearly every other goal's at 430 or lower. */
export const AERIAL_MIN_Z = 550;
/** A touch this close to a wall is a wall ride or a wall touch, not an aerial. */
export const WALL_MARGIN = 300;
export const SIDE_WALL_X = 4096;
/** The corners are cut at 45°, so they bound |x| + |y|; this limit keeps the same margin off them. */
export const CORNER_MAX_XY_SUM = 7640;

const isAerial = ({ x, y, z }: Pos) =>
  z >= AERIAL_MIN_Z && Math.abs(x) <= SIDE_WALL_X - WALL_MARGIN && Math.abs(y) <= GOAL_LINE_Y - WALL_MARGIN && Math.abs(x) + Math.abs(y) <= CORNER_MAX_XY_SUM;

/** The player's car samples, or null when they had none (opponents' car state isn't sent). */
function carStat(play: Play, key: string, of: (samples: CarSample[], ms: number) => number | null): number | null {
  const mine = play.samples.filter((s) => s.key === key);
  if (mine.length === 0) return null;
  return of(mine, mine.reduce((sum, s) => sum + s.weightMs, 0));
}
const msWhere = (samples: CarSample[], is: (s: CarSample) => boolean) => samples.filter(is).reduce((sum, s) => sum + s.weightMs, 0);

/**
 * Time stats are stored as ms with `car_ms` beside them, so a share across matches is a ratio of
 * sums rather than an average of per-match shares. The counts, and the supersonic and empty
 * shares of car_ms, have no range to check.
 */
export const PLAYER_EXTRAS: readonly PlayerExtra[] = [
  { column: "hardest_shot_kmh", compute: (play, key) => play.hardestShot[key] ?? null, inRange: (n) => n >= 0 && n <= HARDEST_SHOT_MAX_KMH },
  { column: "woodwork_hits", compute: (play, key) => play.woodwork[key] ?? 0, inRange: null },
  {
    column: "aerial_touches",
    compute: (play, key) => (play.touches[key] ?? []).filter(isAerial).length,
    // Counted from BallHits, while the touches come from the game's scoreboard.
    inRange: (n, r) => n <= r.stats.touches,
  },
  {
    column: "car_ms",
    compute: (play, key) => carStat(play, key, (_, ms) => ms),
    // Samples sit inside play; a clock stepping back mid-match breaks that, and the match is flagged.
    inRange: (n, _, facts) => n <= facts.playMs + CAR_SAMPLE_CAP_MS,
  },
  {
    column: "boost_avg",
    // With every sample weighing 0 (a single state in play) there's no time to average over.
    compute: (play, key) => carStat(play, key, (s, ms) => (ms ? s.reduce((sum, c) => sum + c.boost * c.weightMs, 0) / ms : null)),
    inRange: (n) => n >= 0 && n <= 100,
  },
  { column: "supersonic_ms", compute: (play, key) => carStat(play, key, (s) => msWhere(s, (c) => c.supersonic)), inRange: null },
  { column: "empty_boost_ms", compute: (play, key) => carStat(play, key, (s) => msWhere(s, (c) => c.boost === 0)), inRange: null },
];

export type ExtraValues = Record<string, number | null>;

export function playerExtras(play: Play, key: string): ExtraValues {
  return Object.fromEntries(PLAYER_EXTRAS.map((e) => [e.column, e.compute(play, key)]));
}

export interface MatchExtras {
  /** By roster key. */
  players: Record<string, ExtraValues>;
  goals: GoalPoint[];
  facts: Play["facts"];
}

/** `events` are one match's events, deduped, in seq order. */
export function computeExtras(events: readonly StoredEvent[], summary: Pick<MatchSummary, "roster" | "joinedInProgress">): MatchExtras {
  const play = buildPlay(events, summary);
  return {
    players: Object.fromEntries(summary.roster.map((r) => [r.key, playerExtras(play, r.key)])),
    goals: play.goals,
    facts: play.facts,
  };
}
