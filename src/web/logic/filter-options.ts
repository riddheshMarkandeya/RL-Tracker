// The playlist dropdown, the same on Recap and Trends: only what was played, no counts. The
// filter lives in the query string as its API value.
import { playlistInfo, type PlaylistGroup } from "../../shared/playlists";
import { GROUPS, type PlaylistFilter } from "../../shared/playlist-filter";
import { filterParam } from "../../shared/schemas/params";

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterGroup {
  /** The optgroup's label; null for the top entry. */
  label: string | null;
  options: FilterOption[];
}

export const filterValue = (f: PlaylistFilter): string => (typeof f === "object" ? String(f.playlist) : f);

/** The filter a query value names; left out is everything, a bad value is everything and `bad`. */
export function parseFilter(value: string | null): { filter: PlaylistFilter; bad: boolean } {
  const parsed = filterParam.safeParse(value ?? undefined);
  return parsed.success ? { filter: parsed.data, bad: false } : { filter: "everything", bad: true };
}

// Each group's playlists are listed singly under its "All" entry. Private is one entry (its ids are
// friends' lobbies and external matches); Other holds the ids no group filter covers.
type Has = (group: PlaylistGroup | null) => boolean;
const inGroup = (f: keyof typeof GROUPS): Has => (g) => g !== null && GROUPS[f].includes(g);
const covered: Has = (g) => g !== null && Object.values(GROUPS).some((groups) => groups.includes(g));
const SECTIONS: readonly { label: string; all: FilterOption | null; has: Has; singly: boolean }[] = [
  { label: "Ranked", all: { value: "ranked", label: "All ranked" }, has: inGroup("ranked"), singly: true },
  { label: "Casual", all: { value: "casual", label: "All casual" }, has: inGroup("casual"), singly: true },
  { label: "Extra modes", all: { value: "extra", label: "All extra modes" }, has: inGroup("extra"), singly: true },
  { label: "Private", all: { value: "private", label: "Private matches" }, has: inGroup("private"), singly: false },
  { label: "Other", all: null, has: (g) => !covered(g), singly: true },
];

const EVERYTHING: FilterOption = { value: "everything", label: "Everything (excl. private)" };

export function filterOptions(present: readonly number[], selected: PlaylistFilter): FilterGroup[] {
  const ids = [...present].sort((a, b) => a - b);
  const groups: FilterGroup[] = [{ label: null, options: [EVERYTHING] }];
  for (const s of SECTIONS) {
    const mine = ids.filter((id) => s.has(playlistInfo(id).group));
    if (!mine.length) continue;
    const singles = s.singly ? mine.map((id) => ({ value: String(id), label: playlistInfo(id).name })) : [];
    groups.push({ label: s.label, options: [...(s.all ? [s.all] : []), ...singles] });
  }
  const value = filterValue(selected);
  if (!groups.some((g) => g.options.some((o) => o.value === value))) {
    const label = typeof selected === "object" ? playlistInfo(selected.playlist).name : (SECTIONS.find((s) => s.all?.value === value)?.all?.label ?? value);
    const other = groups.find((g) => g.label === "Other");
    if (other) other.options.push({ value, label });
    else groups.push({ label: "Other", options: [{ value, label }] });
  }
  return groups;
}
