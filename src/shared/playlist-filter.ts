// The playlist filters pages offer. "Everything" leaves out private matches (friends' lobbies)
// and offline play (bot games), so neither reaches overall stats or the baseline; either can
// still be picked as a single playlist.
import { playlistInfo, type PlaylistGroup } from "./playlists";

type GroupFilter = "ranked" | "casual" | "extra" | "private";
export type PlaylistFilter = "everything" | GroupFilter | { playlist: number };

// LTMs sit with the extra modes; Official Tournament has its own rank, so it isn't in "ranked".
export const GROUPS: Readonly<Record<GroupFilter, readonly PlaylistGroup[]>> = {
  ranked: ["ranked"],
  casual: ["casual"],
  extra: ["extra", "ltm"],
  private: ["private"],
};

/** The filter's query-string value: a group name, or the playlist id. */
export const filterValue = (f: PlaylistFilter): string => (typeof f === "object" ? String(f.playlist) : f);

/** Whether a match's playlist is in the filter; an unmapped id counts only toward "everything". */
export function inFilter(playlistId: number | null, f: PlaylistFilter): boolean {
  if (typeof f === "object") return playlistId === f.playlist;
  const { group } = playlistInfo(playlistId);
  if (f === "everything") return group !== "private" && group !== "offline";
  return group !== null && GROUPS[f].includes(group);
}

/** The distinct playlists among some matches, for a dropdown. */
export function playlistsPresent(ids: readonly (number | null)[]): number[] {
  return [...new Set(ids.filter((id) => id !== null))].sort((a, b) => a - b);
}
