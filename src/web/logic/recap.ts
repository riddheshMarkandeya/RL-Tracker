// What the recap's Overview shows from a session's aggregate and its 30-day baseline. A value
// with nothing behind it is left out rather than shown as a zero.
import type { PlaylistFilter } from "../../shared/playlist-filter";
import type { AggregateWire, MyMatchWire } from "../../shared/schemas/responses";
import { filterValue } from "./filter-options";

/** A share as whole percent. */
export const pct = (share: number) => Math.round(share * 100);

/** Session win % minus the baseline's, and the baseline's, in whole points; null with nothing to compare. */
export function winPctDelta(session: AggregateWire, base: AggregateWire): { points: number; avg: number } | null {
  if (session.winPct === null || base.winPct === null) return null;
  return { points: pct(session.winPct) - pct(base.winPct), avg: pct(base.winPct) };
}

export interface Tile {
  id: "streak" | "ended" | "shooting" | "mvps";
  label: string;
  value: string;
  vs?: { avg: string; dir: "up" | "down" | "same" };
}

export const letter = (r: "win" | "loss" | null) => (r === "win" ? "W" : r === "loss" ? "L" : "–");
export const resultWord = (r: "win" | "loss" | null) => r ?? "no result";

export function tilesFor(a: AggregateWire, base: AggregateWire): Tile[] {
  const tiles: Tile[] = [];
  if (a.bestWinStreak) tiles.push({ id: "streak", label: "Best streak", value: `W${String(a.bestWinStreak)}` });
  if (a.endedOn) tiles.push({ id: "ended", label: "Ended on", value: `${letter(a.endedOn.result)}${String(a.endedOn.length)}` });
  if (a.shootingPct !== null) {
    const tile: Tile = { id: "shooting", label: "Shooting", value: `${String(pct(a.shootingPct))}%` };
    if (base.shootingPct !== null) {
      // Compared as shown, so "40% ▲ avg 40%" can't happen.
      const d = pct(a.shootingPct) - pct(base.shootingPct);
      tile.vs = { avg: `${String(pct(base.shootingPct))}%`, dir: d > 0 ? "up" : d < 0 ? "down" : "same" };
    }
    tiles.push(tile);
  }
  if (a.mvps) tiles.push({ id: "mvps", label: "MVPs", value: `×${String(a.mvps)}` });
  return tiles;
}

/** "3–1", your team first (team 0 first when your team is unknown); null without a score. */
export function scoreFor(m: Pick<MyMatchWire, "scoreTeam0" | "scoreTeam1" | "me">): string | null {
  if (m.scoreTeam0 === null || m.scoreTeam1 === null) return null;
  const [us, them] = m.me?.teamNum === 1 ? [m.scoreTeam1, m.scoreTeam0] : [m.scoreTeam0, m.scoreTeam1];
  return `${String(us)}–${String(them)}`;
}

/** Long sessions get smaller match cards, about 13 to a row. */
export const isDense = (matches: number): boolean => matches > 24;

/** A session's recap (or the latest one's, for a null key), with the filter unless it's the default. */
export function recapPath(key: string | null, filter: PlaylistFilter): string {
  const path = key === null ? "/recap" : `/recap/${encodeURIComponent(key)}`;
  return filter === "everything" ? path : `${path}?filter=${filterValue(filter)}`;
}
