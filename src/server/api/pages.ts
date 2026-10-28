// What each page shows, composed in one place. Every page starts from the same index: the sessions
// cut over every match, the current one, and per match whether you played and your result. A
// session belongs to the day of its first match, and its rows are always found by its guids: one
// starting at 03:30 counts toward the day before, but its later matches start after that day ends.
import { BASELINE_DAYS } from "../../shared/constants";
import { daysBefore, dayOf, monthOf, periodRange, type PeriodRange, type PeriodSpec, type Season } from "../../shared/periods";
import { inFilter, playlistsPresent, type PlaylistFilter } from "../../shared/playlist-filter";
import type { LatestSession, MatchDetail, MonthFolds, PeriodView, PlayedDays, SessionDetail, SessionList, SessionSummary } from "../../shared/schemas/responses";
import { aggregate, baseline, byPlaylist, type MyMatch } from "../../shared/aggregate";
import { bucketKind, buckets, previousRange, rollingWindows, trendStats } from "../../shared/trends";
import type { MatchResult, QueryReader } from "../query/read";
import { currentSession, cutSessions, type Session } from "../query/sessions";

const yours = (filter: PlaylistFilter) => (m: { playlistId: number | null }) => inFilter(m.playlistId, filter);
const played = (m: MyMatch) => m.me !== null;

export function createPages({ reader, now }: { reader: QueryReader; now: () => number }) {
  function index() {
    const breaks = reader.readBreaks();
    const results = reader.readResults();
    const all = cutSessions(results, breaks);
    const byGuid = new Map(results.map((r) => [r.guid, r]));
    const rowsOf = (s: Session, filter: PlaylistFilter): MatchResult[] =>
      s.guids.flatMap((g) => {
        const r = byGuid.get(g);
        return r?.played && inFilter(r.playlistId, filter) ? [r] : [];
      });
    return { all, current: currentSession(all, breaks, now()), rowsOf, results };
  }
  type Index = ReturnType<typeof index>;

  /** The sessions with a match you played under the filter, oldest first, numbered within their day. */
  function summaries({ all, rowsOf }: Index, filter: PlaylistFilter): SessionSummary[] {
    const listed = all.flatMap((s) => {
      const rows = rowsOf(s, filter);
      return rows.length ? [{ s, rows, day: dayOf(s.startedAt) }] : [];
    });
    const perDay = Map.groupBy(listed, (l) => l.day);
    return listed.map(({ s, rows, day }) => {
      const sameDay = perDay.get(day) ?? [];
      return {
        key: s.key,
        day,
        ordinal: sameDay.findIndex((l) => l.s === s) + 1,
        ofDay: sameDay.length,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        matches: rows.length,
        wins: rows.filter((r) => r.result === "win").length,
        losses: rows.filter((r) => r.result === "loss").length,
        results: rows.map((r) => r.result),
      };
    });
  }

  function sessionList(filter: PlaylistFilter, fromDay: string, toDay: string): SessionList {
    const idx = index();
    const listed = summaries(idx, filter);
    const sessions = listed.filter((s) => fromDay <= s.day && s.day <= toDay);
    // Only a session the filter lists, so the key never names one missing from the list.
    const currentKey = listed.find((s) => s.key === idx.current?.key)?.key ?? null;
    return { sessions: sessions.reverse(), currentKey };
  }

  function monthFolds(filter: PlaylistFilter, beforeDay: string): MonthFolds {
    const before = summaries(index(), filter).filter((s) => s.day < beforeDay);
    const months = [...Map.groupBy(before, (s) => monthOf(s.day)).entries()].map(([month, ss]) => ({
      month,
      sessions: ss.length,
      wins: ss.reduce((n, s) => n + s.wins, 0),
      losses: ss.reduce((n, s) => n + s.losses, 0),
    }));
    return { months: months.reverse() };
  }

  /** Null when there's no current session or nothing in it is under the filter. */
  function currentSummary(filter: PlaylistFilter): SessionSummary | null {
    const idx = index();
    return idx.current === null ? null : (summaries(idx, filter).find((s) => s.key === idx.current?.key) ?? null);
  }

  /** The newest session with a match you played under the filter, however old (null when there's
   *  none), and the playlists of every match you played. */
  function latest(filter: PlaylistFilter): LatestSession {
    const idx = index();
    return {
      session: summaries(idx, filter).at(-1) ?? null,
      playlistsPresent: playlistsPresent(idx.results.filter((r) => r.played).map((r) => r.playlistId)),
    };
  }

  /** Null for a key no session has, such as one a break has since re-cut. */
  function sessionDetail(key: string, filter: PlaylistFilter): SessionDetail | null {
    const idx = index();
    const session = idx.all.find((s) => s.key === key);
    if (!session) return null;
    const listed = summaries(idx, filter);
    const day = dayOf(session.startedAt);
    const month = monthOf(day);
    const rows = reader.readMyMatches({ guids: session.guids }).filter(played);
    const matches = rows.filter(yours(filter));
    // The baseline reads only the window before this session, not all history.
    const before = reader.readMyMatches({ from: daysBefore(session.startedAt, BASELINE_DAYS), to: session.startedAt }).filter(yours(filter));
    return {
      key,
      day,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      current: idx.current?.key === key,
      summary: listed.find((s) => s.key === key) ?? null,
      matches,
      aggregate: aggregate(matches),
      byPlaylist: byPlaylist(matches),
      playlistsPresent: playlistsPresent(rows.map((m) => m.playlistId)),
      baseline: baseline(before, session.startedAt),
      goals: reader.readGoals(matches.map((m) => m.guid)),
      // By time, so a session with nothing under the filter still has neighbours.
      prev: listed.findLast((s) => s.startedAt < session.startedAt)?.key ?? null,
      next: listed.find((s) => s.startedAt > session.startedAt)?.key ?? null,
      // The nearest session in the nearest month with one: the previous month's newest, the next
      // month's first. Once set, neither moves as sessions are added; nextMonth starts null.
      prevMonth: listed.findLast((s) => monthOf(s.day) < month)?.key ?? null,
      nextMonth: listed.find((s) => monthOf(s.day) > month)?.key ?? null,
    };
  }

  const keyOf = ({ all }: Index, guid: string) => all.find((s) => s.guids.includes(guid))?.key ?? null;

  function matchDetail(guid: string): MatchDetail | null {
    const m = reader.readMatch(guid);
    if (!m) return null;
    return { ...m, goals: reader.readGoals([guid]), sessionKey: keyOf(index(), guid) };
  }

  /**
   * Each match counts in the period it started in; a session across an edge counts in both. Null
   * for an unknown season. Buckets and the previous period follow the filter like the aggregate.
   */
  function period(spec: PeriodSpec, filter: PlaylistFilter, window: number): PeriodView | null {
    const at = now();
    const seasons = reader.readSeasons();
    const range = periodRange(spec, { now: at, seasons });
    if (!range) return null;
    const mine = (r: PeriodRange) => reader.readMyMatches({ from: r.from ?? undefined, to: r.to }).filter(played);
    const rows = mine(range);
    const matches = rows.filter(yours(filter));
    const idx = index();
    const inRange = (r: MatchResult) => (range.from === null || r.startedAt >= range.from) && r.startedAt < range.to;
    // In start order, as the reader returns them; the buckets ascend without overlap, so they take
    // the matches in one pass.
    const firstDay = matches[0] ? dayOf(matches[0].startedAt) : null;
    const prevRange = previousRange(spec, range, { now: at, seasons });
    const kind = bucketKind(spec);
    const sessionOf = kind === "day" ? daySessions(idx, filter) : () => null;
    let next = 0;
    return {
      range,
      aggregate: aggregate(matches),
      playlistsPresent: playlistsPresent(rows.map((m) => m.playlistId)),
      sessions: idx.all.filter((s) => idx.rowsOf(s, filter).some(inRange)).length,
      previous: prevRange && { range: prevRange, aggregate: aggregate(mine(prevRange).filter(yours(filter))) },
      firstDay,
      bucket: kind,
      buckets: buckets(spec, range, { now: at, firstDay }).map((b) => {
        const startsBefore = (t: number) => (matches[next]?.startedAt ?? Infinity) < t;
        while (startsBefore(b.from)) next++;
        const start = next;
        while (startsBefore(b.to)) next++;
        const first = matches[start];
        return { ...b, stats: trendStats(aggregate(matches.slice(start, next))), session: next > start && first ? sessionOf(b.day, first.guid) : null };
      }),
      rolling: rolling(idx, range, filter, matches, window),
    };
  }

  /**
   * Where a day's recap opens: the day's first listed session, or, for a day holding only the tail
   * of a session that began before the cutoff, the session of the day's first match.
   */
  function daySessions(idx: Index, filter: PlaylistFilter) {
    const firstOfDay = new Map<string, string>();
    for (const s of summaries(idx, filter)) if (!firstOfDay.has(s.day)) firstOfDay.set(s.day, s.key);
    // The fallback is rare, so its map over every session is built on first use.
    let keyByGuid: Map<string, string> | undefined;
    const byGuid = (g: string) => (keyByGuid ??= new Map(idx.all.flatMap((s) => s.guids.map((guid) => [guid, s.key] as const)))).get(g);
    return (day: string, firstGuid: string) => firstOfDay.get(day) ?? byGuid(firstGuid) ?? null;
  }

  /** Only the last `size` − 1 matches before the period are read, so a window never needs the whole history. */
  function rolling({ results }: Index, range: PeriodRange, filter: PlaylistFilter, matches: MyMatch[], size: number) {
    const from = range.from;
    const wanted = yours(filter);
    const prior = from === null ? [] : results.filter((r) => r.played && r.startedAt < from && wanted(r));
    const reach = prior.slice(Math.max(0, prior.length - (size - 1)));
    const before = reach.length ? reader.readMyMatches({ guids: reach.map((r) => r.guid) }).filter(played) : [];
    return rollingWindows(before, matches, size).map(({ n, end, window }) => ({ n, startedAt: end.startedAt, stats: trendStats(aggregate(window)) }));
  }

  /** Read from the results alone (in start order): a day's count needs no sessions. */
  function playedDays(year: number, filter: PlaylistFilter): PlayedDays {
    const mine = reader.readResults().filter((r) => r.played);
    const prefix = `${String(year)}-`;
    const days = mine.filter(yours(filter)).map((r) => dayOf(r.startedAt)).filter((d) => d.startsWith(prefix));
    return {
      days: [...Map.groupBy(days, (d) => d).entries()].map(([day, ds]) => ({ day, matches: ds.length })),
      firstDay: mine[0] ? dayOf(mine[0].startedAt) : null,
      totalMatches: mine.length,
    };
  }

  return {
    sessionList,
    monthFolds,
    currentSummary,
    latest,
    sessionDetail,
    matchDetail,
    period,
    playedDays,
    seasons: (): Season[] => reader.readSeasons(),
    sessionKeyOf: (guid: string) => keyOf(index(), guid),
  };
}

export type Pages = ReturnType<typeof createPages>;
