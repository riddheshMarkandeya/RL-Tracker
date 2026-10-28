// The Seasons table's rules: each row's end and state, and the errors a draft row shows before it
// is sent (or after the server refuses it with a clash code).
import type { z } from "zod";
import { seasonsByStart, shiftDay, type Season } from "../../shared/periods";
import { SEASON_NAME_MAX, seasonInput } from "../../shared/schemas/tables";
import type { seasonConflict } from "../../shared/schemas/responses";

export interface SeasonRow extends Season {
  /** The day before the next season starts; null for the last one. */
  end: string | null;
  state: "past" | "current" | "upcoming";
}

/** Ordered by start. `today` is `dayOf(now)`, so a season is current from its first day's cutoff hour, as its period is. */
export function seasonRows(seasons: readonly Season[], today: string): SeasonRow[] {
  const ordered = seasonsByStart(seasons);
  return ordered.map((s, i) => {
    const next = ordered[i + 1];
    const state = today < s.startDate ? "upcoming" : next && today >= next.startDate ? "past" : "current";
    return { ...s, end: next ? shiftDay(next.startDate, -1) : null, state };
  });
}

export interface SeasonDraft {
  name: string;
  start: string;
}
export type SeasonErrors = Partial<Record<keyof SeasonDraft, string>>;
export type ConflictCode = z.infer<typeof seasonConflict>["error"];

// A-Z only, as SQLite's NOCASE folds, so the form never refuses a name the server would take.
const fold = (s: string) => s.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
const sameName = (a: string, b: string) => fold(a) === fold(b);
const nameClash = (name: string) => `Another season is called ${name}.`;
const startClash = (name: string) => `${name} already starts on that day.`;

/** What's wrong with a draft, by field; `{}` when it can be sent. `id` is the row being edited, which can't clash with itself. */
export function seasonErrors(rows: readonly Season[], draft: SeasonDraft, id?: number): SeasonErrors {
  const out: SeasonErrors = {};
  const others = rows.filter((r) => r.id !== id);
  const name = draft.name.trim();
  if (name === "") out.name = "Give it a name.";
  else if (name.length > SEASON_NAME_MAX) out.name = `Keep it to ${String(SEASON_NAME_MAX)} characters.`;
  else {
    const clash = others.find((r) => sameName(r.name, name));
    if (clash) out.name = nameClash(clash.name);
  }
  if (!seasonInput.shape.start.safeParse(draft.start).success) out.start = "Pick a start date.";
  else {
    const clash = others.find((r) => r.startDate === draft.start);
    if (clash) out.start = startClash(clash.name);
  }
  return out;
}

/** A 409's code as the same text the form shows, naming the season from the page's list when it has it. */
export function conflictError(code: ConflictCode, rows: readonly Season[], draft: SeasonDraft): SeasonErrors {
  if (code === "duplicate_name") return { name: nameClash(rows.find((r) => sameName(r.name, draft.name))?.name ?? draft.name.trim()) };
  return { start: startClash(rows.find((r) => r.startDate === draft.start)?.name ?? "Another season") };
}
