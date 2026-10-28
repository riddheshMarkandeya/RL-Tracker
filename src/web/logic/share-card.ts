// The share card: one session as an image to send to friends. Everything it shows, worked out
// from the session, so the component only lays it out.
import type { PlaylistFilter } from "../../shared/playlist-filter";
import { playlistInfo } from "../../shared/playlists";
import type { Result } from "../../shared/result";
import type { AggregateWire, SessionDetail, SessionSummary } from "../../shared/schemas/responses";
import { filterLabel } from "./filter-options";
import { clock, dayLabel, decimal, durationText, SPEED_LABEL, speedIn, type Units } from "./format";
import { pct, stoodOut } from "./recap";

export interface ShareCardInput {
  detail: Pick<SessionDetail, "day" | "startedAt" | "endedAt" | "current" | "aggregate" | "baseline">;
  summary: Pick<SessionSummary, "wins" | "losses" | "results">;
  filter: PlaylistFilter;
  /** Your in-game name in the latest match; null when it couldn't be had. */
  name: string | null;
  mood: string | null;
  units: Units;
}

export interface ShareTile { id: string; label: string; value: string; sub: string | null }

export interface ShareCardView {
  name: string | null;
  when: string;
  live: boolean;
  /** The chosen filter; null on the default, which says nothing a friend would need. */
  label: string | null;
  wins: number;
  losses: number;
  /** Whole percent; null with no decided match. */
  winPct: number | null;
  /** Past four digits the record is set smaller, so it fits beside the win %. */
  smallRecord: boolean;
  results: readonly (Result | null)[];
  mood: string | null;
  tiles: ShareTile[];
  stood: { label: string; text: string } | null;
  /** Fixed tiles shown as "–" because their stat was null, which a played session shouldn't give. */
  nullStats: string[];
}

const NO_VALUE = "–";

// The 8th tile: the first of these that happened. Statfeed counts are absent rather than 0, and
// extras are null when not computed; a 0 is passed over too, so the card shows something that happened.
const EIGHTH: readonly { id: string; label: string; of: (a: AggregateWire) => number | null | undefined }[] = [
  { id: "aerialGoals", label: "Aerial goals", of: (a) => a.statfeed.AerialGoal },
  { id: "woodwork", label: "Crossbar hits", of: (a) => a.woodworkHits },
  { id: "aerialTouches", label: "Aerial touches", of: (a) => a.aerialTouches },
  { id: "epicSaves", label: "Epic saves", of: (a) => a.statfeed.EpicSave },
];

function eighthTile(a: AggregateWire): ShareTile | null {
  for (const { id, label, of } of EIGHTH) {
    const v = of(a);
    if (v != null && v > 0) return { id, label, value: String(v), sub: null };
  }
  return null;
}

function stoodLine(a: AggregateWire, base: AggregateWire, units: Units): ShareCardView["stood"] {
  const top = stoodOut(a, base)?.[0];
  if (top) return { label: top.label, text: `${decimal(top.perGame)} per game, ${String(Math.abs(top.vs.pct))}% ${top.vs.pct > 0 ? "above" : "below"} your 30-day average` };
  if (a.hardestShotKmh !== null) return { label: "Hardest shot", text: `${decimal(speedIn(a.hardestShotKmh, units.speed))} ${SPEED_LABEL[units.speed]}` };
  return null;
}

export function shareCard({ detail, summary, filter, name, mood, units }: ShareCardInput): ShareCardView {
  const a = detail.aggregate;
  const nullStats: string[] = [];
  const fixed = (id: string, label: string, v: number | null, show: (n: number) => string = String, sub: string | null = null): ShareTile => {
    if (v === null) nullStats.push(id);
    return { id, label, value: v === null ? NO_VALUE : show(v), sub: v === null ? null : sub };
  };
  const tiles = [
    fixed("streak", "Best streak", a.bestWinStreak, (n) => `W${String(n)}`),
    fixed("goals", "Goals", a.totals.goals),
    fixed("assists", "Assists", a.totals.assists),
    fixed("saves", "Saves", a.totals.saves),
    fixed("shots", "Shots", a.totals.shots, String, a.shootingPct === null ? null : `${String(pct(a.shootingPct))}% scored`),
    fixed("mvps", "MVPs", a.mvps),
    fixed("demos", "Demos", a.totals.demos),
  ];
  const eighth = eighthTile(a);
  if (eighth) tiles.push(eighth);
  return {
    name,
    when: `${dayLabel(detail.day)} · ${clock(detail.startedAt, units.clock)} · ${durationText(detail.endedAt - detail.startedAt)}${detail.current ? " so far" : ""}`,
    live: detail.current,
    label: filter === "everything" ? null : filterLabel(filter),
    wins: summary.wins,
    losses: summary.losses,
    winPct: a.winPct === null ? null : pct(a.winPct),
    smallRecord: String(summary.wins).length + String(summary.losses).length > 4,
    results: summary.results,
    mood,
    tiles,
    stood: stoodLine(a, detail.baseline, units),
    nullStats,
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/** `rl-session-2026-10-27-2010-ranked-doubles.png`: the local start and the filter. */
export function shareFilename({ startedAt }: { startedAt: number }, filter: PlaylistFilter): string {
  const d = new Date(startedAt);
  const when = `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  const slug =
    typeof filter === "object"
      ? playlistInfo(filter.playlist).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      : filter === "everything"
        ? "all"
        : filter;
  return `rl-session-${when}-${slug}.png`;
}

/** The form line's height when the text leaves it no more room. */
export const LINE_MIN = 48;
/** Room at the line's edges, so the end dots aren't clipped. */
export const PAD = 7;

export interface FormLine {
  points: { x: number; y: number }[];
  dots: { x: number; y: number; r: number; kind: "win" | "loss" | "none" }[];
  /** Where the level of no wins and no losses runs. */
  zeroY: number;
}

/** Running wins minus losses from a start at 0, one dot per match; no result keeps the level. */
export function formLine(results: readonly (Result | null)[], w: number, h: number): FormLine {
  const levels = [0];
  for (const r of results) levels.push((levels.at(-1) ?? 0) + (r === "win" ? 1 : r === "loss" ? -1 : 0));
  // At least −1..1, so a short session doesn't run edge to edge.
  const lo = Math.min(...levels, -1);
  const hi = Math.max(...levels, 1);
  const step = (w - 2 * PAD) / Math.max(1, results.length);
  const X = (i: number) => PAD + i * step;
  const Y = (v: number) => PAD + ((hi - v) * (h - 2 * PAD)) / (hi - lo);
  const r = Math.max(1.6, Math.min(3.6, step * 0.35));
  return {
    points: levels.map((v, i) => ({ x: X(i), y: Y(v) })),
    dots: results.map((res, i) => ({ x: X(i + 1), y: Y(levels[i + 1] ?? 0), r, kind: res ?? "none" })),
    zeroY: Y(0),
  };
}
