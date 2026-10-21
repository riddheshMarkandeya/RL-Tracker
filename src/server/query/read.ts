// Reads match records for pages. "You" are found at read time: a player whose PrimaryId is in
// my_ids and not rejected, so confirming or rejecting an id re-labels every match.
import type { Db, Param } from "../db/sqlite";
import type { Logger } from "../log";
import type { Season } from "../../shared/periods";
import { resultFor } from "../../shared/result";
import type { MyMatch, MyRow } from "./aggregate";
import type { SessionMatch } from "./sessions";

const C = "query";

export interface ReadRange {
  /** Inclusive, on started_at. */
  from?: number;
  /** Exclusive, on started_at. */
  to?: number;
  guids?: readonly string[];
}

const MINE = "SELECT primary_id FROM my_ids WHERE status != 'rejected'";

interface MatchRow {
  guid: string;
  started_at: number;
  ended_at: number;
  playlist_id: number | null;
  arena: string | null;
  end_kind: MyMatch["endKind"];
  closed_via: MyMatch["closedVia"];
  overtime: number;
  winner_team_num: number | null;
  mvp_key: string | null;
  camera_primary_id: string | null;
  // Your row's columns; null when no player of yours is in the match.
  player_key: string | null;
  primary_id: string | null;
  team_num: number | null;
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  demos: number;
  touches: number;
  hardest_shot_kmh: number | null;
  woodwork_hits: number | null;
  aerial_touches: number | null;
  car_ms: number | null;
  boost_avg: number | null;
  supersonic_ms: number | null;
  empty_boost_ms: number | null;
}

function where({ from, to, guids }: ReadRange): { sql: string; params: Param[] } {
  const conds: string[] = [];
  const params: Param[] = [];
  if (from !== undefined) {
    conds.push("m.started_at >= ?");
    params.push(from);
  }
  if (to !== undefined) {
    conds.push("m.started_at < ?");
    params.push(to);
  }
  if (guids) {
    // One JSON parameter rather than a placeholder per guid, so no list hits SQLite's variable limit.
    conds.push("m.guid IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(guids));
  }
  return { sql: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

/** A row with a player of yours. */
type Mine = MatchRow & { player_key: string };
const isNonEmpty = <T>(xs: T[]): xs is [T, ...T[]] => xs.length > 0;

const toMyRow = (r: Mine): MyRow => ({
  playerKey: r.player_key,
  teamNum: r.team_num,
  score: r.score,
  goals: r.goals,
  shots: r.shots,
  assists: r.assists,
  saves: r.saves,
  demos: r.demos,
  touches: r.touches,
  hardestShotKmh: r.hardest_shot_kmh,
  woodworkHits: r.woodwork_hits,
  aerialTouches: r.aerial_touches,
  carMs: r.car_ms,
  boostAvg: r.boost_avg,
  supersonicMs: r.supersonic_ms,
  emptyBoostMs: r.empty_boost_ms,
});

const at = (guid: string, key: string) => `${guid}\n${key}`;

function toMyMatch(
  m: MatchRow,
  me: MyRow | null,
  goals: readonly { speed_kmh: number | null; own_goal: number }[],
  statfeed: readonly { event_name: string; count: number }[],
): MyMatch {
  return {
    guid: m.guid,
    startedAt: m.started_at,
    endedAt: m.ended_at,
    playlistId: m.playlist_id,
    arena: m.arena,
    endKind: m.end_kind,
    closedVia: m.closed_via,
    overtime: m.overtime === 1,
    winnerTeamNum: m.winner_team_num,
    mvpKey: m.mvp_key,
    me,
    result: me === null ? null : resultFor({ winnerTeamNum: m.winner_team_num, endKind: m.end_kind, closedVia: m.closed_via }, me.teamNum),
    goals: goals.map((g) => ({ speedKmh: g.speed_kmh, ownGoal: g.own_goal === 1 })),
    statfeed: Object.fromEntries(statfeed.map((s) => [s.event_name, s.count])),
  };
}

export function createQueryReader({ tracker, logger }: { tracker: Db; logger: Logger }) {
  /** Matches already reported with two of your ids, so a page that re-reads doesn't repeat the warning. */
  const twoYousReported = new Set<string>();

  function timed<T>(fn: string, read: () => T[]): T[] {
    const started = performance.now();
    const rows = read();
    logger.info(C, "read", { fn, rows: rows.length, ms: Math.round(performance.now() - started) });
    return rows;
  }

  /**
   * Two of your ids in one lobby has never been seen. The camera's player is the one you were
   * watching as; without it, the lowest key, so the choice is at least stable.
   */
  function pickMe(mine: readonly [Mine, ...Mine[]]): Mine {
    const [first] = mine;
    if (mine.length === 1) return first;
    const chosen = mine.find((r) => r.primary_id === first.camera_primary_id) ?? first;
    if (!twoYousReported.has(first.guid)) {
      twoYousReported.add(first.guid);
      logger.warn(C, "two_yous", { guid: first.guid, keys: mine.map((r) => r.player_key), chosen: chosen.player_key });
    }
    return chosen;
  }

  function readMyMatches(range: ReadRange = {}): MyMatch[] {
    return timed("readMyMatches", () => {
      const w = where(range);
      const rows = tracker.all<MatchRow>(
        `SELECT m.guid, m.started_at, m.ended_at, m.playlist_id, m.arena, m.end_kind, m.closed_via, m.overtime, m.winner_team_num,
           m.mvp_key, m.camera_primary_id, p.player_key, p.primary_id, p.team_num, p.score, p.goals, p.shots, p.assists, p.saves,
           p.demos, p.touches, p.hardest_shot_kmh, p.woodwork_hits, p.aerial_touches, p.car_ms, p.boost_avg, p.supersonic_ms,
           p.empty_boost_ms
         FROM matches m
         LEFT JOIN match_players p ON p.match_guid = m.guid AND p.primary_id IN (${MINE})
         ${w.sql}
         ORDER BY m.started_at, m.guid, p.player_key`,
        ...w.params,
      );
      // Your goals and statfeed for the same matches, by the same predicate rather than a list of every guid.
      const yours = (key: "scorer_key" | "player_key") =>
        `JOIN match_players p ON p.match_guid = x.match_guid AND p.player_key = x.${key} AND p.primary_id IN (${MINE})
         WHERE x.match_guid IN (SELECT m.guid FROM matches m ${w.sql})`;
      const goals = tracker.all<{ match_guid: string; scorer_key: string; speed_kmh: number | null; own_goal: number }>(
        `SELECT x.match_guid, x.scorer_key, x.speed_kmh, x.own_goal FROM match_goals x ${yours("scorer_key")} ORDER BY x.match_guid, x.idx`,
        ...w.params,
      );
      const statfeed = tracker.all<{ match_guid: string; player_key: string; event_name: string; count: number }>(
        `SELECT x.match_guid, x.player_key, x.event_name, x.count FROM match_player_statfeed x ${yours("player_key")}`,
        ...w.params,
      );

      // Keyed by match and player, so a match with two of your ids gets only the chosen one's.
      const goalsOf = Map.groupBy(goals, (g) => at(g.match_guid, g.scorer_key));
      const feedOf = Map.groupBy(statfeed, (s) => at(s.match_guid, s.player_key));
      return [...Map.groupBy(rows, (r) => r.guid).values()].map((group) => {
        const [m] = group as [MatchRow, ...MatchRow[]];
        const mineRows = group.filter((r): r is Mine => r.player_key !== null);
        const me = isNonEmpty(mineRows) ? toMyRow(pickMe(mineRows)) : null;
        const mine = me === null ? "" : at(m.guid, me.playerKey);
        return toMyMatch(m, me, goalsOf.get(mine) ?? [], feedOf.get(mine) ?? []);
      });
    });
  }

  return {
    readMyMatches,
    /** Every match's times, for cutting sessions. */
    readMatchTimes: (): SessionMatch[] =>
      timed("readMatchTimes", () => tracker.all<SessionMatch>("SELECT guid, started_at AS startedAt, ended_at AS endedAt FROM matches ORDER BY started_at, guid")),
    readBreaks: (): number[] => timed("readBreaks", () => tracker.all<{ at: number }>("SELECT at FROM session_breaks ORDER BY at").map((b) => b.at)),
    readSeasons: (): Season[] => timed("readSeasons", () => tracker.all<Season>("SELECT id, name, start_date AS startDate FROM seasons ORDER BY start_date")),
  };
}

export type QueryReader = ReturnType<typeof createQueryReader>;
