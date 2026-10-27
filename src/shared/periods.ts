// Local days and the periods built from them. Local means the process's time zone: the server and
// the browser run on the same PC. Days are counted on calendar fields, never as 24 h of ms, so
// every edge stays at the cutoff hour across a DST change.
import { DAY_CUTOFF_HOUR, ROLLING_LONG_DAYS, ROLLING_SHORT_DAYS, WEEK_START_DAY } from "./constants";

export interface Season {
  id: number;
  name: string;
  /** Local `YYYY-MM-DD`. */
  startDate: string;
}

export type PeriodSpec =
  | { kind: "day" | "week" | "month" | "year"; day: string }
  | { kind: "season"; id: number }
  | { kind: "last7" | "last30" | "this_year" | "all" };

/** Half-open `[from, to)` in epoch ms; `from` null is all time. */
export interface PeriodRange {
  from: number | null;
  to: number;
  running: boolean;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const format = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function parts(day: string): [number, number, number] {
  const [y = NaN, m = NaN, d = NaN] = day.split("-").map(Number);
  return [y, m, d];
}

/** Calendar arithmetic on the date alone (UTC has no DST to step over). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = parts(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The `YYYY-MM` month a `YYYY-MM-DD` day is in: what the session list and its month steps mean by a month. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** The first day of the month after a day's. */
export function nextMonthStart(day: string): string {
  const [y, m] = parts(day);
  return m === 12 ? format(y + 1, 1, 1) : format(y, m + 1, 1);
}

/** The local day an instant counts toward: before the cutoff hour it is still the day before. */
export function dayOf(ms: number): string {
  const t = new Date(ms);
  const day = format(t.getFullYear(), t.getMonth() + 1, t.getDate());
  return t.getHours() < DAY_CUTOFF_HOUR ? shiftDay(day, -1) : day;
}

/** The same local clock time `days` calendar days earlier, so a span across a DST change keeps its hour. */
export function daysBefore(ms: number, days: number): number {
  const t = new Date(ms);
  t.setDate(t.getDate() - days);
  return t.getTime();
}

/** When a local day begins: its cutoff hour. */
export function dayStart(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d, DAY_CUTOFF_HOUR).getTime();
}

const weekday = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const closed = (fromDay: string, toDay: string, now: number): PeriodRange => {
  const from = dayStart(fromDay);
  const to = dayStart(toDay);
  return { from, to, running: from <= now && now < to };
};

/** Up to now; one that hasn't begun yet (a season entered ahead) is empty at its start. */
const open = (from: number | null, now: number): PeriodRange =>
  from !== null && from > now ? { from, to: from, running: false } : { from, to: now, running: true };

/** The range a period covers, or null for a season that doesn't exist. */
export function periodRange(spec: PeriodSpec, { now, seasons }: { now: number; seasons: readonly Season[] }): PeriodRange | null {
  switch (spec.kind) {
    case "day":
      return closed(spec.day, shiftDay(spec.day, 1), now);
    case "week": {
      const start = shiftDay(spec.day, -((weekday(spec.day) - WEEK_START_DAY + 7) % 7));
      return closed(start, shiftDay(start, 7), now);
    }
    case "month": {
      return closed(`${monthOf(spec.day)}-01`, nextMonthStart(spec.day), now);
    }
    case "year": {
      const [y] = parts(spec.day);
      return closed(format(y, 1, 1), format(y + 1, 1, 1), now);
    }
    case "season": {
      const ordered = [...seasons].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const i = ordered.findIndex((s) => s.id === spec.id);
      const season = ordered[i];
      if (!season) return null;
      const next = ordered[i + 1];
      return next ? closed(season.startDate, next.startDate, now) : open(dayStart(season.startDate), now);
    }
    case "last7":
    case "last30": {
      const days = spec.kind === "last7" ? ROLLING_SHORT_DAYS : ROLLING_LONG_DAYS;
      return open(dayStart(shiftDay(dayOf(now), -(days - 1))), now);
    }
    case "this_year":
      return open(dayStart(`${dayOf(now).slice(0, 4)}-01-01`), now);
    case "all":
      return open(null, now);
  }
}
