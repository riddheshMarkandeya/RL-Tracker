// Every API query the pages share, with their cache keys. Lists live under "sessions"; a session's
// detail, the heavy one, is "session"; one match with every player is "match"; a session's headline
// lines are "remarks".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { REQUEST_HEADER } from "../shared/constants";
import { filterValue, type PlaylistFilter } from "../shared/playlist-filter";
import { currentResponse, latestResponse, matchDetailResponse, remarksResponse, sessionDetailResponse, sessionsResponse } from "../shared/schemas/responses";
import { getJson, postJson } from "./api";

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
export function useMatchDetail(guid: string, enabled = true) {
  return useQuery({
    queryKey: ["match", guid],
    queryFn: () => getJson(`/api/matches/${encodeURIComponent(guid)}`, matchDetailResponse),
    enabled,
  });
}

const remarksPath = (key: string) => `/api/sessions/${encodeURIComponent(key)}/remarks`;
const remarksKey = (key: string, f: string) => ["remarks", key, f] as const;

/** A session's headline lines under the filter. The server stores them, so a refetch gives the same lines unless the live session moved on. */
export function useRemarks(key: string, filter: PlaylistFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: remarksKey(key, f),
    queryFn: () => getJson(`${remarksPath(key)}?filter=${f}`, remarksResponse),
  });
}

/** ↻: new lines for the session, stored by the server and put straight into the cache. */
export function useRerollRemarks(key: string, filter: PlaylistFilter) {
  const queryClient = useQueryClient();
  const f = filterValue(filter);
  return useMutation({
    mutationFn: () => postJson(`${remarksPath(key)}/reroll?filter=${f}`, { [REQUEST_HEADER]: "1" }, remarksResponse),
    onSuccess: (data) => {
      queryClient.setQueryData(remarksKey(key, f), data);
      // Cancels a GET a match refetch started before the reroll (it would land with the old lines),
      // and refetches in case a match the POST didn't see landed meanwhile: the stored pick wins.
      void queryClient.invalidateQueries({ queryKey: remarksKey(key, f) });
    },
  });
}
