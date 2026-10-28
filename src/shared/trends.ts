// What the Trends page plots: a period cut into buckets, and the period it is compared with.
// Buckets are cut on local days like the periods themselves, so their edges stay at the cutoff
// hour across a DST change.
import type { Aggregate } from "./aggregate";
import { dayOf, dayStart, monthStart, nextMonthStart, periodRange, rollingDays, seasonsByStart, shiftDay, weekStart, type PeriodRange, type PeriodSpec, type Season } from "./periods";

export type BucketKind = "day" | "week" | "month";

/** Half-open `[from, to)` in epoch ms. `day` names the whole bucket (its Monday, or the 1st) even when the period clips it. */
export interface Bucket {
  from: number;
  to: number;
  day: string;
}

/** The few numbers a bucket carries; null where nothing was measured, never a fake 0. */
export interface TrendStats {
  matches: number;
  wins: number | null;
  losses: number | null;
  winPct: number | null;
  shootingPct: number | null;
  perGame: { goals: number | null; assists: number | null; saves: number | null; shots: number | null };
}

export function bucketKind(spec: PeriodSpec): BucketKind {
  switch (spec.kind) {
    case "season":
    case "this_year":
    case "year":
      return "week";
    case "all":
      return "month";
    default:
      return "day";
  }
}

const minDay = (a: string, b: string) => (a < b ? a : b);
const maxDay = (a: string, b: string) => (a > b ? a : b);

/**
 * The buckets a period's axis runs over. A running period runs at least to the end of today, so a
 * closed calendar period shows its rest as empty buckets. All time starts at the month of
 * `firstDay` (the first match under the filter); without one, or for a period that hasn't begun,
 * there are none.
 */
export function buckets(spec: PeriodSpec, range: PeriodRange, { now, firstDay }: { now: number; firstDay: string | null }): Bucket[] {
  const kind = bucketKind(spec);
  const startDay = range.from !== null ? dayOf(range.from) : firstDay !== null ? monthStart(firstDay) : null;
  if (startDay === null) return [];
  const to = range.running ? Math.max(range.to, dayStart(shiftDay(dayOf(now), 1))) : range.to;
  if (to <= dayStart(startDay)) return [];
  const endDay = dayOf(to);
  const out: Bucket[] = [];
  let whole = kind === "day" ? startDay : kind === "week" ? weekStart(startDay) : monthStart(startDay);
  while (whole < endDay) {
    const next = kind === "day" ? shiftDay(whole, 1) : kind === "week" ? shiftDay(whole, 7) : nextMonthStart(whole);
    out.push({ from: dayStart(maxDay(whole, startDay)), to: dayStart(minDay(next, endDay)), day: whole });
    whole = next;
  }
  return out;
}

/** The kinds ‹ › step through. */
export type StepSpec = { kind: "week" | "month"; day: string } | { kind: "season"; id: number };

function step(spec: PeriodSpec, seasons: readonly Season[], by: -1 | 1): StepSpec | null {
  switch (spec.kind) {
    case "week":
      return { kind: "week", day: shiftDay(weekStart(spec.day), 7 * by) };
    case "month":
      return { kind: "month", day: by === 1 ? nextMonthStart(spec.day) : monthStart(shiftDay(monthStart(spec.day), -1)) };
    case "season": {
      const ordered = seasonsByStart(seasons);
      const i = ordered.findIndex((s) => s.id === spec.id);
      const other = i === -1 ? undefined : ordered[i + by];
      return other ? { kind: "season", id: other.id } : null;
    }
    default:
      return null;
  }
}

/** The week, month or season before; null for the other kinds and before the first season. */
export const previousSpec = (spec: PeriodSpec, seasons: readonly Season[]) => step(spec, seasons, -1);
/** The week, month or season after; null for the other kinds and after the last season. */
export const nextSpec = (spec: PeriodSpec, seasons: readonly Season[]) => step(spec, seasons, 1);

/** What a period is compared with: the period before, or for last 7/30 days the n days before them. */
export function previousRange(spec: PeriodSpec, range: PeriodRange, { now, seasons }: { now: number; seasons: readonly Season[] }): PeriodRange | null {
  if ((spec.kind === "last7" || spec.kind === "last30") && range.from !== null) {
    return { from: dayStart(shiftDay(dayOf(range.from), -rollingDays(spec.kind))), to: range.from, running: false };
  }
  const prev = previousSpec(spec, seasons);
  return prev ? periodRange(prev, { now, seasons }) : null;
}

export function trendStats(a: Aggregate): TrendStats {
  return {
    matches: a.matches,
    wins: a.wins,
    losses: a.losses,
    winPct: a.winPct,
    shootingPct: a.shootingPct,
    perGame: { goals: a.perGame.goals, assists: a.perGame.assists, saves: a.perGame.saves, shots: a.perGame.shots },
  };
}

/** How many matches a By match point averages. */
export const ROLLING_WINDOW = 20;

/**
 * The full windows of `size` that end at each of the period's matches, in start order. `before`
 * is the history ahead of the period, oldest first, so the first points already count `size`
 * matches; only its last `size − 1` can reach a window. `n` numbers the period's match a window
 * ends at (`end`), from 1.
 */
export function rollingWindows<T>(before: readonly T[], inPeriod: readonly T[], size: number): { n: number; end: T; window: T[] }[] {
  const reach = before.slice(Math.max(0, before.length - (size - 1)));
  const all = [...reach, ...inPeriod];
  return inPeriod.flatMap((end, i) => {
    const to = reach.length + i + 1;
    return to >= size ? [{ n: i + 1, end, window: all.slice(to - size, to) }] : [];
  });
}
