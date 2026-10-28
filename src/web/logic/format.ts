// Dates, times and lengths as the recap pages print them, in the reader's locale. Days are local
// `YYYY-MM-DD` with the 4am cutoff, as the API sends them. Clock style and speed unit are settings.
import type { Settings } from "../../shared/schemas/settings";

/** The settings that change how a value prints; a whole Settings object passes as one. */
export type Units = Pick<Settings, "clock" | "speed">;

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${String(n)}${suffix}`;
}

/** Rounded to the minute, never under 1. */
export function durationText(ms: number): string {
  const total = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${String(m)} min`;
  return m ? `${String(h)} h ${String(m)} min` : `${String(h)} h`;
}

/** A local clock time in the clock setting's 12 or 24 hours; the locale picks the rest (padding, am/pm). */
export const clock = (ms: number, hours: Units["clock"], locale?: string) =>
  new Date(ms).toLocaleTimeString(locale, { timeStyle: "short", hourCycle: hours === "24h" ? "h23" : "h12" });

export const timeRange = (start: number, end: number, hours: Units["clock"], locale?: string): string => `${clock(start, hours, locale)} – ${clock(end, hours, locale)}`;

const MPH_PER_KMH = 0.621371;

/** A speed the API sends in km/h, in the speed setting's unit; each caller rounds as it prints. */
export const speedIn = (kmh: number, unit: Units["speed"]): number => (unit === "mph" ? kmh * MPH_PER_KMH : kmh);
export const SPEED_LABEL = { kmh: "km/h", mph: "mph" } as const satisfies Record<Units["speed"], string>;

/** A `YYYY-MM-DD` day or `YYYY-MM` month formatted as the date alone, so no zone can shift it. */
function utcDate(day: string, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}

/** "Mon 19 Oct" (in the reader's locale order). */
export const dayLabel = (day: string, locale?: string): string => utcDate(day, locale, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");

/** "19 Oct". */
export const shortDayLabel = (day: string, locale?: string): string => utcDate(day, locale, { day: "numeric", month: "short" });

/** "September 2026" for a `YYYY-MM` month. */
export const monthLabel = (month: string, locale?: string): string => utcDate(month, locale, { month: "long", year: "numeric" });

/** "Sep 2026" for a `YYYY-MM` month. */
export const shortMonthLabel = (month: string, locale?: string): string => utcDate(month, locale, { month: "short", year: "numeric" });

/** "1 win", "2 wins"; `many` for a plural that isn't one plus "s". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`;

/** Whole from 100, else up to 2 decimals with trailing zeros dropped: "413", "1.04", "1.5". */
export const decimal = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
