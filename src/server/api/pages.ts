// What each page shows, composed in one place. Every page starts from the same index: the sessions
// cut over every match, the current one, and per match whether you played and your result. A
// session belongs to the day of its first match, and its rows are always found by its guids: one
// starting at 03:30 counts toward the day before, but its later matches start after that day ends.
import { BASELINE_DAYS } from "../../shared/constants";
import { daysBefore, dayOf, monthOf, periodRange, type PeriodSpec, type Season } from "../../shared/periods";
import { inFilter, playlistsPresent, type PlaylistFilter } from "../../shared/playlist-filter";
import type { LatestSession, MatchDetail, MonthFolds, PeriodView, SessionDetail, SessionList, SessionSummary } from "../../shared/schemas/responses";
import { aggregate, baseline, byPlaylist, type MyMatch } from "../../shared/aggregate";
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

  /** Each match counts in the period it started in; a session across an edge counts in both. Null for an unknown season. */
  function period(spec: PeriodSpec, filter: PlaylistFilter): PeriodView | null {
    const range = periodRange(spec, { now: now(), seasons: reader.readSeasons() });
    if (!range) return null;
    const rows = reader.readMyMatches({ from: range.from ?? undefined, to: range.to }).filter(played);
    const matches = rows.filter(yours(filter));
    const idx = index();
    const inRange = (r: MatchResult) => (range.from === null || r.startedAt >= range.from) && r.startedAt < range.to;
    return {
      range,
      aggregate: aggregate(matches),
      playlistsPresent: playlistsPresent(rows.map((m) => m.playlistId)),
      sessions: idx.all.filter((s) => idx.rowsOf(s, filter).some(inRange)).length,
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
    seasons: (): Season[] => reader.readSeasons(),
    sessionKeyOf: (guid: string) => keyOf(index(), guid),
  };
}

export type Pages = ReturnType<typeof createPages>;
