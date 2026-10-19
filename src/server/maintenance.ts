import { backupsDir, runDailyBackup } from "./db/backup";
import { runRetention } from "./db/retention";
import { log, type Logger } from "./log";
import type { Storage } from "./storage";

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Retry delay after a run gave way to a recording match, so a fixed play time can't starve it. */
const RECORDING_RETRY_MS = 15 * 60 * 1000;
/**
 * runDailyBackup only acts when one is due; checking hourly keeps backups close to 24 h apart,
 * and lets a backup that came due mid-match wait for the next check rather than run during it.
 */
const BACKUP_CHECK_MS = 60 * 60 * 1000;

export interface MaintenanceOptions {
  storage: Pick<Storage, "tracker" | "raw" | "dir">;
  isRecording?: () => boolean;
  now?: () => Date;
  logger?: Logger;
  yieldFn?: () => Promise<void>;
}

export interface Maintenance {
  /** Cancels the timers and waits for a retention run in progress to stop. Call before closing storage. */
  stop(): Promise<void>;
}

/**
 * Runs retention 5 min after start and then every 24 h (15 min after a run that gave way to a
 * recording match), and checks hourly whether the daily backup is due; a due backup waits while a
 * match is recording.
 */
export function scheduleMaintenance(opts: MaintenanceOptions): Maintenance {
  const { storage, isRecording = () => false, now = () => new Date(), logger = log, yieldFn } = opts;
  let stopped = false;
  let retentionTimer: ReturnType<typeof setTimeout> | undefined;
  // Only the latest run: runs never overlap, since the next is scheduled when one ends.
  let running: Promise<void> | undefined;

  const scheduleRetention = (delay: number) => {
    retentionTimer = setTimeout(() => {
      running = retentionTick();
    }, delay);
  };
  async function retentionTick(): Promise<void> {
    let next = RUN_INTERVAL_MS;
    try {
      const { status } = await runRetention(storage.raw, { now, isRecording, stopping: () => stopped, logger, yieldFn });
      if (status !== "done") next = RECORDING_RETRY_MS;
    } catch {
      // Broad on purpose and already logged by runRetention: a maintenance error must never kill
      // the recorder, and the next run may well succeed.
    }
    if (!stopped) scheduleRetention(next);
  }

  scheduleRetention(FIRST_RUN_DELAY_MS);
  const backupTimer = setInterval(() => {
    // A long play session only delays a due backup until play stops.
    runDailyBackup(storage.tracker, { dir: backupsDir(storage.dir), now, logger, isRecording });
  }, BACKUP_CHECK_MS);

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(retentionTimer);
      clearInterval(backupTimer);
      await running;
    },
  };
}
