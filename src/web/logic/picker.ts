// The session picker's lists. Days are local `YYYY-MM-DD` with the 4am cutoff, as the
// API sends them.
import { nextMonthStart, shiftDay } from "../../shared/periods";
import type { SessionSummary } from "../../shared/schemas/responses";

type Result = SessionSummary["results"][number];

/** Consecutive sessions of the same day, in the list's order. */
export function groupByDay(sessions: readonly SessionSummary[]): { day: string; sessions: SessionSummary[] }[] {
  const groups: { day: string; sessions: SessionSummary[] }[] = [];
  for (const s of sessions) {
    const last = groups.at(-1);
    if (last?.day === s.day) last.sessions.push(s);
    else groups.push({ day: s.day, sessions: [s] });
  }
  return groups;
}

/** The mini W/L strip: at most `max` squares, the rest counted. */
export function strip(results: readonly Result[], max: number): { squares: Result[]; more: number } {
  return { squares: results.slice(0, max), more: Math.max(0, results.length - max) };
}

/** A `YYYY-MM` month's first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  return { from, to: shiftDay(nextMonthStart(from), -1) };
}
