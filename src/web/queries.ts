// Every API query the pages share, with their cache keys. Lists live under "sessions"; a session's
// detail, the heavy one, is "session"; one match with every player is "match"; a session's headline
// lines are "remarks"; the Trends page reads "period", "played-days" and "seasons".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { REQUEST_HEADER } from "../shared/constants";
import { filterValue, type PlaylistFilter } from "../shared/playlist-filter";
import type { PeriodSpec } from "../shared/periods";
import {
  currentResponse,
  latestResponse,
  matchDetailResponse,
  periodResponse,
  playedDaysResponse,
  remarksResponse,
  seasonsResponse,
  sessionDetailResponse,
  sessionsResponse,
} from "../shared/schemas/responses";
import { getJson, postJson } from "./api";
import { periodQuery } from "./logic/trends";

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

/**
 * A period under the filter, with the period it's compared with and its buckets. Keyed by today too:
 * cached queries never go stale, and a rolling or running period moves on at the day's cutoff.
 */
export function usePeriod(spec: PeriodSpec, filter: PlaylistFilter, today: string) {
  const f = filterValue(filter);
  const q = periodQuery(spec).toString();
  return useQuery({
    queryKey: ["period", q, f, today],
    queryFn: () => getJson(`/api/period?${q}&filter=${f}`, periodResponse),
  });
}

/** The days you played in a year under the filter, and your first day and total whatever the filter. */
export function usePlayedDays(year: number, filter: PlaylistFilter) {
  const f = filterValue(filter);
  return useQuery({
    queryKey: ["played-days", year, f],
    queryFn: () => getJson(`/api/played-days?year=${String(year)}&filter=${f}`, playedDaysResponse),
    // Paging the strip's year changes only its ticks (the page's gate and the stepper's bounds stay),
    // so it keeps the page up rather than loading it again. A new filter's ticks wait for their load.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === f ? prev : undefined),
  });
}

export function useSeasons() {
  return useQuery({
    queryKey: ["seasons"],
    queryFn: () => getJson("/api/seasons", seasonsResponse),
    select: (data) => data.seasons,
  });
}
