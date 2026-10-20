// Rebuilds match records from raw.db, through the same read the live recorder uses, so a fixed
// rule or a new stat reaches every match still within raw retention. It never deletes a record:
// matches past retention, and anything it skips, keep theirs. Safe to run beside the background
// tracker: each match is its own transaction, and the live match is skipped as still open.
import type { Db } from "../db/sqlite";
import type { Logger } from "../log";
import { closeViaOf, rebuild } from "../recorder/lifecycle";
import { readMatch } from "../recorder/read-match";
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
      const via = closeViaOf(store.lastOf(guid));
      if (via === null) {
        // Only the match with the latest event can still be live; another one lost its close
        // marker (a failed write), and unless a Reconnect resumes it, nothing closes it later.
        skip(guid, "open", guid === newest ? "info" : "warn");
        continue;
      }
      // Retention deletes by time: a match straddling the cutoff lost its start, and must not
      // overwrite the record made when it was whole.
      if (minSeq > 0) {
        skip(guid, "trimmed");
        continue;
      }
      if (rebuild(guid, store.names(guid)).phase === "pending") {
        // A lobby with a record means the lobby rule or an old write changed; the record is kept.
        const hasRecord = tracker.get("SELECT 1 FROM matches WHERE guid = ?", guid) !== undefined;
        skip(guid, hasRecord ? "lobby_has_record" : "lobby", hasRecord ? "warn" : "info");
        continue;
      }
      writer.save(toRecord(readMatch(store, guid, via).summary));
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
