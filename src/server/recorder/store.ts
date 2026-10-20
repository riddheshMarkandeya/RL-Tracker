// Raw event rows in raw.db, filed under the match the lifecycle assigned them to.
import type { Db } from "../db/sqlite";
import type { Data } from "./envelope";
import { playerKey } from "./players";

export interface StoredEvent {
  seq: number;
  ts: number;
  name: string;
  data: Data;
}

export interface RawStore {
  /** The next seq for `guid`: 0, or one past its last row (a reopened match continues). */
  nextSeq(guid: string): number;
  insert(row: StoredEvent & { guid: string }): void;
  /** The most recent row overall; only the last match can still be open. */
  lastEvent(): { guid: string; name: string } | undefined;
  /** Every match, first seen first, with its lowest seq (above 0 once retention cut its start). */
  matches(): { guid: string; minSeq: number }[];
  /** A match's last row, with its data unparsed. */
  lastOf(guid: string): { name: string; data: string } | undefined;
  names(guid: string): string[];
  matchEvents(guid: string): StoredEvent[];
}

export function createRawStore(db: Db): RawStore {
  return {
    nextSeq: (guid) => db.get<{ next: number }>("SELECT COALESCE(MAX(seq) + 1, 0) AS next FROM events WHERE match_guid = ?", guid)?.next ?? 0,
    insert: ({ guid, seq, ts, name, data }) => {
      db.run("INSERT INTO events (match_guid, seq, ts, name, data) VALUES (?, ?, ?, ?, ?)", guid, seq, ts, name, JSON.stringify(data));
    },
    lastEvent: () => db.get<{ guid: string; name: string }>("SELECT match_guid AS guid, name FROM events ORDER BY id DESC LIMIT 1"),
    matches: () => db.all<{ guid: string; minSeq: number }>("SELECT match_guid AS guid, MIN(seq) AS minSeq FROM events GROUP BY match_guid ORDER BY MIN(id)"),
    lastOf: (guid) => db.get<{ name: string; data: string }>("SELECT name, data FROM events WHERE match_guid = ? ORDER BY seq DESC LIMIT 1", guid),
    names: (guid) => db.all<{ name: string }>("SELECT name FROM events WHERE match_guid = ? ORDER BY seq", guid).map((r) => r.name),
    matchEvents: (guid) =>
      db
        .all<{ seq: number; ts: number; name: string; data: string }>("SELECT seq, ts, name, data FROM events WHERE match_guid = ? ORDER BY seq", guid)
        .map((r) => ({ ...r, data: JSON.parse(r.data) as Data })),
  };
}

/** Per-match state for trimForStorage. */
export interface TrimState {
  loadoutSeen: Set<string>;
  sawPlaylist: boolean;
}

export const newTrimState = (): TrimState => ({ loadoutSeen: new Set(), sawPlaylist: false });

/**
 * `Loadout` is constant per match and makes up most of an UpdateState's size, so each player's is
 * kept only the first time `seen` meets them. Entries that aren't objects are passed through.
 */
export function stripRepeatLoadouts(players: readonly unknown[], seen: Set<string>): unknown[] {
  return players.map((p) => {
    if (typeof p !== "object" || p === null || !("Loadout" in p)) return p;
    const key = playerKey(p as { PrimaryId?: unknown; Name?: unknown });
    if (!seen.has(key)) {
      seen.add(key);
      return p;
    }
    const rest: Record<string, unknown> = { ...p };
    delete rest.Loadout;
    return rest;
  });
}

/**
 * What of an event gets stored, or null to skip it: repeated loadouts are stripped, and the states
 * still showing the menu's PlaylistId 0 before the match's real one carry nothing.
 */
export function trimForStorage(name: string, data: Data, st: TrimState): Data | null {
  if (name !== "UpdateState") return data;
  const playlist = (data.Game as { PlaylistId?: unknown } | undefined)?.PlaylistId;
  if (playlist === 0 && !st.sawPlaylist) return null;
  if (typeof playlist === "number" && playlist !== 0) st.sawPlaylist = true;
  if (!Array.isArray(data.Players)) return data;
  return { ...data, Players: stripRepeatLoadouts(data.Players, st.loadoutSeen) };
}
