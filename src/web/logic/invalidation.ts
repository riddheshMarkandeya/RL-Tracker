// What a new match or a session break can change in the cache. Stale by default, so a query key
// added later is refreshed without anyone remembering to list it here. Settings are spared: a
// match never changes them. The other exception is an older session's detail: sessions are only
// appended, a break is always at now, a baseline reads only the window before its session, and
// `prev` and `prevMonth` never change. So of the details, only these can move:
// - the newest session's (its `next` is still null);
// - the one the match landed in;
// - after a match, those on the days it may have started a session on (a new one there changes
//   their "Nth of M that day"): today, and yesterday, as a match ending now may have begun before
//   the day's cutoff;
// - after a match, those of an earlier month with no next month yet (a new session may be its first).

import { monthOf, shiftDay } from "../../shared/periods";

export interface CachedQuery {
  queryKey: readonly unknown[];
  state: { data: unknown };
}

const field = (data: unknown, name: string): unknown => (typeof data === "object" && data !== null && name in data ? (data as Record<string, unknown>)[name] : null);

/** The predicate for `invalidateQueries` after a match in `sessionKey` (null: unknown, or a break) ending `today` (null for a break). */
export function staleAfter(sessionKey: string | null, today: string | null): (query: CachedQuery) => boolean {
  const after = today === null ? null : { yesterday: shiftDay(today, -1), month: monthOf(today) };
  return ({ queryKey: [kind, key], state: { data } }) => {
    if (kind === "settings") return false;
    if (kind !== "session" || data === undefined) return true;
    const day = field(data, "day");
    if (key === sessionKey || field(data, "next") === null || typeof day !== "string") return true;
    if (after === null) return false;
    return day >= after.yesterday || (field(data, "nextMonth") === null && monthOf(day) < after.month);
  };
}

/**
 * The predicate for `invalidateQueries` after a You or Seasons save. Either can move every stat or
 * period, so it's coarse (the app is local). Settings and the two tables are spared: neither table
 * depends on the other, and the save put its own answer in the cache.
 */
export const staleAfterTables = ({ queryKey: [kind] }: CachedQuery): boolean => kind !== "settings" && kind !== "ids" && kind !== "seasons";
