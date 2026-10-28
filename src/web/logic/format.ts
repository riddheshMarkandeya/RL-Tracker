// Dates, times and lengths as the recap pages print them, in the reader's locale. Days are local
// `YYYY-MM-DD` with the 4am cutoff, as the API sends them.

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

/** A local clock time, in the reader's own 12- or 24-hour style. */
export const clock = (ms: number, locale?: string) => new Date(ms).toLocaleTimeString(locale, { timeStyle: "short" });

export const timeRange = (start: number, end: number, locale?: string): string => `${clock(start, locale)} – ${clock(end, locale)}`;

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
