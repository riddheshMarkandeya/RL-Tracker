// Writes match records to tracker.db, one transaction per match, and adds the camera's player as
// a pending guess at "you". Write errors are not caught here: live, the recorder's hook handler
// logs them and the raw events stay for recompute; recompute catches them per match.
import type { Db } from "../db/sqlite";
import type { Logger } from "../log";
import { playlistInfo } from "../../shared/playlists";
import { PLAYER_EXTRAS } from "../recorder/extras";
import type { MatchRecord } from "./record";

export interface RecordWriterOptions {
  tracker: Db;
  logger: Logger;
  now?: () => number;
}

const C = "records";

const UPSERT_MATCH = `
  INSERT INTO matches (guid, started_at, ended_at, playlist_id, arena, end_kind, closed_via, joined_in_progress, overtime,
    score_team0, score_team1, winner_team_num, winner_source, mvp_key, mvp_source, camera_primary_id, check_flags)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (guid) DO UPDATE SET
    started_at = excluded.started_at, ended_at = excluded.ended_at, playlist_id = excluded.playlist_id, arena = excluded.arena,
    end_kind = excluded.end_kind, closed_via = excluded.closed_via, joined_in_progress = excluded.joined_in_progress,
    overtime = excluded.overtime, score_team0 = excluded.score_team0, score_team1 = excluded.score_team1,
    winner_team_num = excluded.winner_team_num, winner_source = excluded.winner_source, mvp_key = excluded.mvp_key,
    mvp_source = excluded.mvp_source, camera_primary_id = excluded.camera_primary_id, check_flags = excluded.check_flags`;

// The extras' columns come from the registry, so a new stat needs only its entry and a migration.
const BASE_PLAYER_COLUMNS = ["match_guid", "player_key", "primary_id", "name", "is_bot", "team_num", "teams_seen", "present_at_end", "score", "goals", "shots", "assists", "saves", "touches", "demos"];
const PLAYER_COLUMNS = [...BASE_PLAYER_COLUMNS, ...PLAYER_EXTRAS.map((e) => e.column)];
const INSERT_PLAYER = `INSERT INTO match_players (${PLAYER_COLUMNS.join(", ")}) VALUES (${PLAYER_COLUMNS.map(() => "?").join(", ")})`;

const INSERT_GOAL = `
  INSERT INTO match_goals (match_guid, idx, team_num, scorer_key, assister_key, toucher_key, x, y, z, distance, speed_kmh, deflected, aerial, own_goal)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The camera's id, unless it is already in my_ids (whatever its status: a rejected one is never
 * asked about again) or a confirmed id played this match (then the camera was on someone else).
 */
const ADD_GUESS = `
  INSERT OR IGNORE INTO my_ids (primary_id, name, status, added_at)
  SELECT ?, ?, 'pending', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM my_ids JOIN match_players ON match_players.primary_id = my_ids.primary_id
    WHERE my_ids.status = 'confirmed' AND match_players.match_guid = ?)`;

const cameraName = ({ match, players }: MatchRecord) => players.find((p) => p.primaryId === match.cameraPrimaryId)?.name ?? null;

export function createRecordWriter({ tracker, logger, now = Date.now }: RecordWriterOptions) {
  /** Unmapped playlist ids already reported this run. */
  const unknownPlaylists = new Set<number | null>();

  function reportUnknownPlaylist({ match, players }: MatchRecord): void {
    if (playlistInfo(match.playlistId).group !== null || unknownPlaylists.has(match.playlistId)) return;
    unknownPlaylists.add(match.playlistId);
    const teamSizes: number[] = [];
    for (const p of players) if (p.teamNum !== null) teamSizes[p.teamNum] = (teamSizes[p.teamNum] ?? 0) + 1;
    logger.warn(C, "unknown_playlist", { guid: match.guid, playlistId: match.playlistId, arena: match.arena, teamSizes });
  }

  /** Writes one match, replacing any earlier record of its guid. Returns whether a guess was added. */
  function write(record: MatchRecord): boolean {
    const { match: m, players, statfeed, goals } = record;
    tracker.run(
      UPSERT_MATCH,
      m.guid,
      m.startedAt,
      m.endedAt,
      m.playlistId,
      m.arena,
      m.endKind,
      m.closedVia,
      m.joinedInProgress,
      m.overtime,
      m.scoreTeam0,
      m.scoreTeam1,
      m.winnerTeamNum,
      m.winnerSource,
      m.mvpKey,
      m.mvpSource,
      m.cameraPrimaryId,
      JSON.stringify(m.checkFlags),
    );
    tracker.run("DELETE FROM match_players WHERE match_guid = ?", m.guid);
    tracker.run("DELETE FROM match_player_statfeed WHERE match_guid = ?", m.guid);
    tracker.run("DELETE FROM match_goals WHERE match_guid = ?", m.guid);
    for (const p of players) {
      const extras = PLAYER_EXTRAS.map((e) => p.extras[e.column] ?? null);
      tracker.run(INSERT_PLAYER, m.guid, p.playerKey, p.primaryId, p.name, p.isBot, p.teamNum, p.teamsSeen, p.presentAtEnd, p.score, p.goals, p.shots, p.assists, p.saves, p.touches, p.demos, ...extras);
    }
    goals.forEach((g, idx) => {
      const { pos } = g;
      tracker.run(INSERT_GOAL, m.guid, idx, g.teamNum, g.scorerKey, g.assisterKey, g.toucherKey, pos?.x ?? null, pos?.y ?? null, pos?.z ?? null, g.distance, g.speedKmh, g.deflected, g.aerial, g.ownGoal);
    });
    for (const s of statfeed) {
      tracker.run("INSERT INTO match_player_statfeed (match_guid, player_key, event_name, count) VALUES (?, ?, ?, ?)", m.guid, s.playerKey, s.eventName, s.count);
    }
    if (m.cameraPrimaryId === null) return false;
    return tracker.run(ADD_GUESS, m.cameraPrimaryId, cameraName(record), now(), m.guid).changes > 0;
  }

  return {
    save(record: MatchRecord): void {
      const started = performance.now();
      const guessed = tracker.transaction(() => write(record));
      const { match: m } = record;
      logger.info(C, "written", {
        guid: m.guid,
        players: record.players.length,
        goals: record.goals.length,
        ownGoals: record.goals.filter((g) => g.ownGoal).length,
        winnerSource: m.winnerSource,
        mvpSource: m.mvpSource,
        checkFlags: m.checkFlags,
        ms: Math.round(performance.now() - started),
      });
      if (guessed) logger.info(C, "pending_guess", { guid: m.guid, primaryId: m.cameraPrimaryId, name: cameraName(record) });
      reportUnknownPlaylist(record);
    },
  };
}

export type RecordWriter = ReturnType<typeof createRecordWriter>;
