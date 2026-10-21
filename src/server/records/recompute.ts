// Rebuilds match records from raw.db, through the same read the live recorder uses, so a fixed
// rule or a new stat reaches every match in raw.db. A match retention thinned recomputes from its
// kept events, with its dense outputs (car stats, camera) from the snapshot taken when it was
// thinned. It never deletes a record: anything it skips keeps its record. Safe to run beside the
// background tracker: each match is its own transaction, and the live match is skipped as still open.
import type { Db } from "../db/sqlite";
import type { Logger } from "../log";
import { readableAs, readMatch } from "../recorder/read-match";
import { createRawStore } from "../recorder/store";
import { toRecord } from "./record";
import { createRecordWriter } from "./save";

export interface RecomputeOptions {
  raw: Db;
  tracker: Db;
  logger: Logger;
  now?: () => number;
}

export type SkipReason = "open" | "lobby" | "lobby_has_record" | "trimmed";

export interface RecomputeResult {
  written: number;
  skipped: Partial<Record<SkipReason, number>>;
  failed: number;
  ms: number;
}

const C = "records";

export function recomputeAll({ raw, tracker, logger, now }: RecomputeOptions): RecomputeResult {
  const started = performance.now();
  const store = createRawStore(raw);
  const writer = createRecordWriter({ tracker, logger, now });
  const result: RecomputeResult = { written: 0, skipped: {}, failed: 0, ms: 0 };
  const skip = (guid: string, reason: SkipReason, level: "info" | "warn" = "info") => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
    logger[level](C, "recompute_skipped", { guid, reason });
  };

  const matches = store.matches();
  const newest = store.lastEvent()?.guid;
  logger.info(C, "recompute_started", { matches: matches.length });
  for (const { guid, minSeq } of matches) {
    try {
      const r = readableAs(store, guid, minSeq);
      if ("unreadable" in r) {
        if (r.unreadable === "open") {
          // Only the match with the latest event can still be live; another one lost its close
          // marker (a failed write), and unless a Reconnect resumes it, nothing closes it later.
          skip(guid, "open", guid === newest ? "info" : "warn");
        } else if (r.unreadable === "trimmed") {
          // A match that lost its start (the old time-based retention could cut one) must not
          // overwrite the record made when it was whole.
          skip(guid, "trimmed");
        } else {
          // A lobby with a record means the lobby rule or an old write changed; the record is kept.
          const hasRecord = tracker.get("SELECT 1 FROM matches WHERE guid = ?", guid) !== undefined;
          skip(guid, hasRecord ? "lobby_has_record" : "lobby", hasRecord ? "warn" : "info");
        }
        continue;
      }
      writer.save(toRecord(readMatch(store, guid, r.via).summary));
      result.written++;
    } catch (err) {
      // Broad on purpose: one match's bad data or failed write must not stop the rest.
      result.failed++;
      logger.error(C, "recompute_failed", { guid, err });
    }
  }
  result.ms = Math.round(performance.now() - started);
  logger.info(C, "recompute_done", { ...result });
  return result;
}
