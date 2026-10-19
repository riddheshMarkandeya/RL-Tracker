import { RETENTION_DAYS } from "../../shared/constants";
import type { Logger } from "../log";
import type { Db } from "./sqlite";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 5000;
/** Pages returned per incremental_vacuum step: 16 MB at the default 4 KB page size. */
const VACUUM_PAGES = 4096;

const setImmediateYield = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

export interface RetentionOptions {
  now: () => Date;
  /** True while a match is being recorded; retention gives way to it. */
  isRecording: () => boolean;
  /** True once the app is shutting down; the run stops at the next batch boundary. */
  stopping?: () => boolean;
  logger: Logger;
  /** Lets other work run between delete batches. */
  yieldFn?: () => Promise<void>;
  batchSize?: number;
  vacuumPages?: number;
}

export interface RetentionResult {
  /** skipped: recording when it began; stopped: recording started, or shutdown began, part-way. */
  status: "done" | "skipped" | "stopped";
  events: number;
  batches: number;
}

/**
 * Deletes raw events older than RETENTION_DAYS in batches, then returns the freed pages to the
 * filesystem. Cutting by event time can split the oldest match at the edge; only a backfill of a
 * 90-day-old match would see that, and backfill only targets matches inside the window.
 * Logs and rethrows a failure.
 */
export async function runRetention(raw: Db, opts: RetentionOptions): Promise<RetentionResult> {
  const { now, isRecording, stopping = () => false, logger, yieldFn = setImmediateYield } = opts;
  const { batchSize = BATCH_SIZE, vacuumPages = VACUUM_PAGES } = opts;
  const started = performance.now();
  let events = 0;
  let batches = 0;
  /** Lets other work run, then says why the run must stop, if it must. */
  const pause = async (): Promise<"recording" | "shutdown" | undefined> => {
    await yieldFn();
    if (stopping()) return "shutdown";
    return isRecording() ? "recording" : undefined;
  };
  const stop = (reason: "recording" | "shutdown"): RetentionResult => {
    // Deleted rows' pages stay on the freelist; the next run's vacuum returns them.
    logger.info("retention", "stopped", { reason, events, batches });
    return { status: "stopped", events, batches };
  };
  const freePages = () => raw.pragma("freelist_count") as number;
  try {
    if (isRecording()) {
      logger.info("retention", "skipped_recording");
      return { status: "skipped", events, batches };
    }
    const cutoff = now().getTime() - RETENTION_DAYS * DAY_MS;
    for (;;) {
      const { changes } = raw.run("DELETE FROM events WHERE id IN (SELECT id FROM events WHERE ts < ? LIMIT ?)", cutoff, batchSize);
      events += changes;
      batches++;
      if (changes < batchSize) break;
      const reason = await pause();
      if (reason) return stop(reason);
    }
    // In steps, so a large backlog can't block the event loop in one go. Counting the freelist,
    // re-read after each pause, keeps the recorder's inserts between steps out of the figure.
    let vacuumed = 0;
    for (;;) {
      const free = freePages();
      if (free === 0) break;
      raw.run(`PRAGMA incremental_vacuum(${String(vacuumPages)})`);
      const left = freePages();
      vacuumed += free - left;
      if (left === free) {
        // Without incremental auto_vacuum the pragma frees nothing, and the file never shrinks.
        logger.warn("retention", "vacuum_noop", { freePages: left, autoVacuum: raw.pragma("auto_vacuum") });
        break;
      }
      if (left === 0) break;
      const reason = await pause();
      if (reason) return stop(reason);
    }
    const mb = Math.round(((vacuumed * (raw.pragma("page_size") as number)) / 1024 / 1024) * 100) / 100;
    logger.info("retention", "done", { events, mb, batches, ms: Math.round(performance.now() - started) });
    return { status: "done", events, batches };
  } catch (err) {
    logger.error("retention", "failed", { events, batches, err });
    throw err;
  }
}
