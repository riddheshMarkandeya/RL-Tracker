// Every API query the pages share, with their cache keys. Lists live under "sessions"; a session's
// detail, the heavy one, is "session"; one match with every player is "match".
import { useQuery } from "@tanstack/react-query";
import type { PlaylistFilter } from "../shared/playlist-filter";
import { currentResponse, latestResponse, matchDetailResponse, sessionDetailResponse, sessionsResponse } from "../shared/schemas/responses";
import { getJson } from "./api";
import { filterValue } from "./logic/filter-options";

/** The current session under "everything", for the header chip and the Start new session button. */
export function useCurrentSession() {
  return useQuery({
    queryKey: ["sessions", "current", "everything"],
    queryFn: () => getJson("/api/sessions/current?filter=everything", currentResponse),
    select: (data) => data.session,
  });
}

/** The newest session under the filter, however old; null when there's none. */
export function useLatestSession(filter: PlaylistFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["sessions", "latest", f],
    queryFn: () => getJson(`/api/sessions/latest?filter=${f}`, latestResponse),
  });
}

/** Sessions whose day is in [from, to], newest first. */
export function useSessionList(filter: PlaylistFilter, from: string, to: string) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["sessions", "list", f, from, to],
    queryFn: () => getJson(`/api/sessions?filter=${f}&from=${from}&to=${to}`, sessionsResponse),
    select: (data) => data.sessions,
  });
}

/** One session under the filter. */
export function useSessionDetail(key: string, filter: PlaylistFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["session", key, f],
    queryFn: () => getJson(`/api/sessions/${encodeURIComponent(key)}?filter=${f}`, sessionDetailResponse),
  });
}

/** One match with every player, for the match page's scoreboard. */
export function useMatchDetail(guid: string) {
  return useQuery({
    queryKey: ["match", guid],
    queryFn: () => getJson(`/api/matches/${encodeURIComponent(guid)}`, matchDetailResponse),
  });
}
