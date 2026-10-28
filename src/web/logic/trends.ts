// The Trends page's state and text: the period, filter, metric and strip year in the query string,
// the quick picks, ‹ › and their bounds, the header's lines, the tiles and the year strip's layout.
// Days are local `YYYY-MM-DD` with the 4am cutoff; the page passes today as `dayOf(Date.now())`.
import { calendarSpan, monthOf, monthStart, nextMonthStart, seasonsByStart, shiftDay, weekStart, type PeriodSpec, type Season } from "../../shared/periods";
import { filterValue, type PlaylistFilter } from "../../shared/playlist-filter";
import { periodParams, playedDaysParams } from "../../shared/schemas/params";
import { nextSpec, previousSpec, type TrendStats } from "../../shared/trends";
import { dayLabel, decimal, monthLabel } from "./format";
import { parseFilter } from "./filter-options";
import { pct, vsAverage } from "./recap";

/** Below this many played matches in total, the page shows the "not enough data yet" note. */
export const ENOUGH_MATCHES = 20;

export type MetricId = "win" | "goals" | "shots" | "shooting" | "assists" | "saves";
export type TrendIcon = "Goal" | "Shot" | "Assist" | "Save";

export const METRICS: readonly { id: MetricId; label: string; icon: TrendIcon | null; rate: boolean }[] = [
  { id: "win", label: "Win %", icon: null, rate: true },
  { id: "goals", label: "Goals / game", icon: "Goal", rate: false },
  { id: "shots", label: "Shots / game", icon: "Shot", rate: false },
  { id: "shooting", label: "Shooting %", icon: null, rate: true },
  { id: "assists", label: "Assists / game", icon: "Assist", rate: false },
  { id: "saves", label: "Saves / game", icon: "Save", rate: false },
];

export interface TrendsState {
  spec: PeriodSpec;
  filter: PlaylistFilter;
  metric: MetricId;
  /** The strip's year; null is the year the period ends in. */
  year: number | null;
}

const DEFAULT_SPEC: PeriodSpec = { kind: "last30" };
const DEFAULT_FILTER: PlaylistFilter = "ranked";
const TREND_KINDS = new Set(["last7", "last30", "week", "month", "season", "this_year", "all"]);

/** A week as its Monday and a month as its 1st, so a quick pick and the URL compare exactly. */
function normal(spec: PeriodSpec): PeriodSpec {
  if (spec.kind === "week") return { kind: "week", day: weekStart(spec.day) };
  if (spec.kind === "month") return { kind: "month", day: monthStart(spec.day) };
  return spec;
}

/** The state the query string names; each bad value falls back to its default and is named in `bad`. */
export function parseTrends(params: URLSearchParams): { state: TrendsState; bad: string[] } {
  const bad: string[] = [];
  const get = (key: string) => params.get(key) ?? undefined;

  let spec = DEFAULT_SPEC;
  const kind = get("kind");
  if (kind !== undefined) {
    const parsed = TREND_KINDS.has(kind) ? periodParams.safeParse({ kind, day: get("day"), season: get("season") }) : null;
    if (parsed?.success) spec = normal(parsed.data.spec);
    else bad.push("kind");
  }

  let filter = DEFAULT_FILTER;
  const rawFilter = params.get("filter");
  if (rawFilter !== null) {
    const parsed = parseFilter(rawFilter);
    if (parsed.bad) bad.push("filter");
    else filter = parsed.filter;
  }

  let metric: MetricId = "win";
  const rawMetric = get("metric");
  if (rawMetric !== undefined) {
    const known = METRICS.find((m) => m.id === rawMetric);
    if (known) metric = known.id;
    else bad.push("metric");
  }

  let year: number | null = null;
  const rawYear = get("year");
  if (rawYear !== undefined) {
    const parsed = playedDaysParams.shape.year.safeParse(rawYear);
    if (parsed.success) year = parsed.data;
    else bad.push("year");
  }
  return { state: { spec, filter, metric, year }, bad };
}

/** A period as the query parameters `/api/period` and the page's URL both take. */
export function periodQuery(spec: PeriodSpec): URLSearchParams {
  const q = new URLSearchParams({ kind: spec.kind });
  if ("day" in spec) q.set("day", spec.day);
  if (spec.kind === "season") q.set("season", String(spec.id));
  return q;
}

export function trendsPath({ spec, filter, metric, year }: TrendsState): string {
  const q = periodQuery(spec);
  if (spec.kind === DEFAULT_SPEC.kind) q.delete("kind");
  if (filterValue(filter) !== filterValue(DEFAULT_FILTER)) q.set("filter", filterValue(filter));
  if (metric !== "win") q.set("metric", metric);
  if (year !== null) q.set("year", String(year));
  const s = q.toString();
  return s ? `/trends?${s}` : "/trends";
}

/** The strip's year: the one asked for, else the year the period ends in, but never past today's. */
export const stripYear = (asked: number | null, lastDay: string, today: string): number =>
  asked ?? Number((lastDay < today ? lastDay : today).slice(0, 4));

export const specEqual = (a: PeriodSpec, b: PeriodSpec): boolean => JSON.stringify(normal(a)) === JSON.stringify(normal(b));

export function quickPicks(today: string): { label: string; spec: PeriodSpec }[] {
  return [
    { label: "Last 7 days", spec: { kind: "last7" } },
    { label: "Last 30 days", spec: { kind: "last30" } },
    { label: "This week", spec: { kind: "week", day: weekStart(today) } },
    { label: "Last week", spec: { kind: "week", day: weekStart(shiftDay(today, -7)) } },
    { label: "This year", spec: { kind: "this_year" } },
    { label: "All time", spec: { kind: "all" } },
  ];
}

/**
 * ‹ (-1) or › (+1): the week, month or season it moves to, or null where it can't. A week or month
 * can't end before your first played day or start after today; seasons follow the table.
 */
export function stepTarget(spec: PeriodSpec, by: -1 | 1, { seasons, firstDay, today }: { seasons: readonly Season[]; firstDay: string | null; today: string }): PeriodSpec | null {
  const target = by === -1 ? previousSpec(spec, seasons) : nextSpec(spec, seasons);
  if (target === null || target.kind === "season") return target;
  const { from, to } = calendarSpan(target.kind, target.day);
  if (by === -1 && (firstDay === null || to <= firstDay)) return null;
  if (by === 1 && from > today) return null;
  return target;
}

interface TextCtx {
  today: string;
  seasons: readonly Season[];
  locale?: string;
}

/** "S24" reads as "Season 24"; any other name is shown as it is. */
const seasonTitle = (name: string) => name.replace(/^S(\d+)$/, "Season $1");

export function periodTitle(spec: PeriodSpec, { today, seasons, locale }: TextCtx): string {
  switch (spec.kind) {
    case "last7":
      return "Last 7 days";
    case "last30":
      return "Last 30 days";
    case "this_year":
      return "This year";
    case "all":
      return "All time";
    case "week": {
      const from = weekStart(spec.day);
      if (from === weekStart(today)) return "This week";
      if (from === weekStart(shiftDay(today, -7))) return "Last week";
      return `Week of ${dayLabel(from, locale)}`;
    }
    case "month":
      return monthLabel(monthOf(spec.day), locale);
    case "day":
    case "year":
      // API-only kinds the page never shows.
      return spec.day;
    case "season": {
      const season = seasons.find((s) => s.id === spec.id);
      return season ? seasonTitle(season.name) : "Season";
    }
  }
}

/** The period's first and last day; the year shows only when it isn't this one, or the two differ. */
export function rangeText({ from, last }: { from: string; last: string }, { today, locale }: TextCtx): string {
  const y = (day: string) => day.slice(0, 4);
  const withYear = (day: string) => `${dayLabel(day, locale)} ${String(Number(y(day)))}`;
  if (y(from) !== y(last)) return `${withYear(from)} – ${withYear(last)}`;
  return `${dayLabel(from, locale)} – ${y(last) === y(today) ? dayLabel(last, locale) : withYear(last)}`;
}

/** What the period is compared with, as the header names it. */
function previousName(spec: PeriodSpec, ctx: TextCtx): string | null {
  switch (spec.kind) {
    case "last7":
      return "the 7 days before";
    case "last30":
      return "the 30 days before";
    case "week":
      return weekStart(spec.day) === weekStart(ctx.today) ? "last week" : "the week before";
    default: {
      const prev = previousSpec(spec, ctx.seasons);
      return prev ? periodTitle(prev, ctx) : null;
    }
  }
}

/** "compared with last week", "the week before had no matches here", or "nothing earlier". */
export function comparedText(spec: PeriodSpec, { hasPrevious, previousMatches }: { hasPrevious: boolean; previousMatches: number }, ctx: TextCtx): string {
  const name = hasPrevious ? previousName(spec, ctx) : null;
  if (name === null) return "nothing earlier";
  return previousMatches > 0 ? `compared with ${name}` : `${name} had no matches here`;
}

/** "still running" belongs to a calendar period that hasn't ended; the rolling ones always run. */
export const showsRunning = (spec: PeriodSpec, running: boolean): boolean => running && ["week", "month", "season", "this_year"].includes(spec.kind);

function rawValue(id: MetricId, s: TrendStats): number | null {
  switch (id) {
    case "win":
      return s.winPct;
    case "shooting":
      return s.shootingPct;
    default:
      return s.perGame[id];
  }
}

const isRate = (id: MetricId) => METRICS.find((m) => m.id === id)?.rate === true;

/** The tile's value: a rate in whole percent, a per-game stat to 2 decimals, "–" when nothing was measured. */
export function metricValue(id: MetricId, s: TrendStats): string {
  const v = rawValue(id, s);
  if (v === null) return "–";
  return isRate(id) ? `${String(pct(v))}%` : decimal(v);
}

export interface Delta {
  dir: "up" | "down" | "same";
  /** "5 pts", "12%", or "≈". */
  text: string;
}

/** The change against the previous period: rates in points (≈ under 1), per game in percent (≈ under 3%). */
export function metricDelta(id: MetricId, cur: TrendStats, prev: TrendStats | null): Delta | null {
  const a = rawValue(id, cur);
  const b = prev === null || prev.matches === 0 ? null : rawValue(id, prev);
  if (a === null || b === null) return null;
  if (isRate(id)) {
    const points = pct(a) - pct(b);
    return points === 0 ? { dir: "same", text: "≈" } : { dir: points > 0 ? "up" : "down", text: `${String(Math.abs(points))} pts` };
  }
  const vs = vsAverage(a, b);
  if (vs === null) return null;
  return vs.dir === "same" ? { dir: "same", text: "≈" } : { dir: vs.dir, text: `${String(Math.abs(vs.pct))}%` };
}

/** A 100×24 sparkline over the buckets; an empty bucket is skipped, never plotted as 0. Null under 2 points. */
export function sparkPath(id: MetricId, buckets: readonly TrendStats[]): string | null {
  const values = buckets.map((b) => (b.matches > 0 ? rawValue(id, b) : null));
  const have = values.filter((v): v is number => v !== null);
  if (have.length < 2) return null;
  const lo = Math.min(...have);
  const span = Math.max(...have) - lo || 1;
  const step = 100 / Math.max(1, values.length - 1);
  return values
    .flatMap((v, i) => (v === null ? [] : [[i * step, 22 - ((v - lo) / span) * 20] as const]))
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join("");
}

export interface StripBox {
  left: number;
  width: number;
  label: string;
  pressed: boolean;
  disabled: boolean;
}

export interface YearStrip {
  /** `id` null is the band before the first season. */
  seasons: (StripBox & { id: number | null })[];
  months: (StripBox & { day: string })[];
  ticks: { day: string; left: number; height: number }[];
  /** The selected period's share of the year, or null when it's outside it. */
  selected: { left: number; width: number } | null;
  /** The end of today, when it falls in the year. */
  today: number | null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The strip's layout, in percent of the year. `selected` is the period's days, `to` exclusive. */
export function yearStrip({
  year,
  today,
  seasons,
  spec,
  selected,
  days,
  locale,
}: {
  year: number;
  today: string;
  seasons: readonly Season[];
  spec: PeriodSpec;
  selected: { from: string; to: string } | null;
  days: readonly { day: string; matches: number }[];
  locale?: string;
}): YearStrip {
  const start = `${String(year)}-01-01`;
  const end = `${String(year + 1)}-01-01`;
  const length = daysBetween(start, end);
  const at = (day: string) => (100 * daysBetween(start, day < start ? start : day > end ? end : day)) / length;
  const box = (from: string, to: string) => ({ left: at(from), width: at(to) - at(from) });

  const ordered = seasonsByStart(seasons);
  const bands: YearStrip["seasons"] = [];
  const first = ordered[0];
  if (!first || first.startDate > start) {
    const to = first ? first.startDate : end;
    bands.push({ ...box(start, to), id: null, label: first ? `Before ${first.name}` : "No seasons", pressed: false, disabled: true });
  }
  ordered.forEach((s, i) => {
    const to = ordered[i + 1]?.startDate ?? end;
    if (to <= start || s.startDate >= end) return;
    bands.push({ ...box(s.startDate, to), id: s.id, label: s.name, pressed: spec.kind === "season" && spec.id === s.id, disabled: false });
  });

  const months = Array.from({ length: 12 }, (_, i) => {
    const day = `${String(year)}-${String(i + 1).padStart(2, "0")}-01`;
    const label = new Date(Date.UTC(year, i, 1)).toLocaleDateString(locale, { month: "short", timeZone: "UTC" });
    return { ...box(day, nextMonthStart(day)), day, label, pressed: spec.kind === "month" && spec.day === day, disabled: day > today };
  });

  const ticks = days
    .filter((d) => d.day >= start && d.day < end)
    .map((d) => ({ day: d.day, left: at(d.day), height: Math.min(22, 4 + d.matches * 2) }));

  const inYear = selected !== null && selected.to > start && selected.from < end;
  const tomorrow = shiftDay(today, 1);
  return {
    seasons: bands,
    months,
    ticks,
    selected: inYear ? box(selected.from, selected.to) : null,
    today: tomorrow > start && tomorrow <= end ? at(tomorrow) : null,
  };
}
