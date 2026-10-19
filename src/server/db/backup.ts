import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../log";
import type { Db } from "./sqlite";

export type BackupReason = "premigration" | "daily";

const KEEP_BACKUPS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A check firing slightly early (timer jitter, clock step) must not push the backup back an hour. */
const DUE_SLACK_MS = 5 * 60 * 1000;
/** tracker-<UTC yyyyMMdd-HHmmss-SSS>-<reason>.db; the fixed-width stamp makes names sort by time. */
const BACKUP_FILE = /^tracker-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})-[a-z]+\.db$/;

/** Where tracker.db's backups live, inside the data dir. */
export const backupsDir = (dataDir: string) => join(dataDir, "backups");

export function backupName(at: Date, reason: BackupReason): string {
  const [date = "", time = ""] = at.toISOString().split("T"); // 2026-10-16, 09:05:03.007Z
  return `tracker-${date.replaceAll("-", "")}-${time.slice(0, 8).replaceAll(":", "")}-${time.slice(9, 12)}-${reason}.db`;
}

/** File names in `dir`; [] if the dir doesn't exist yet. */
function readNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Backup file names, oldest first. */
const backupsIn = (names: string[]) => names.filter((f) => BACKUP_FILE.test(f)).sort();

function stampOf(name: string): number {
  const m = BACKUP_FILE.exec(name);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, ms] = m.map(Number) as [number, number, number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

export interface BackupOptions {
  dir: string;
  reason: BackupReason;
  now: () => Date;
  logger: Logger;
}

/** Copies tracker.db into `dir` with VACUUM INTO, then prunes. Logs and rethrows a failure. */
export function backupTracker(db: Db, { dir, reason, now, logger }: BackupOptions): string {
  const path = join(dir, backupName(now(), reason));
  // Written under a name the daily check and the keep-7 count don't see, then renamed: a copy cut
  // short (full disk, killed process) must never pass for the newest good backup.
  const partial = `${path}.partial`;
  const started = performance.now();
  try {
    mkdirSync(dir, { recursive: true });
    db.run("VACUUM INTO ?", partial);
    const { size } = statSync(partial);
    renameSync(partial, path);
    logger.info("backup", "created", { reason, path, bytes: size, ms: Math.round(performance.now() - started) });
  } catch (err) {
    logger.error("backup", "failed", { reason, path, err });
    try {
      rmSync(partial, { force: true });
    } catch {
      // Best effort: the next prune removes a leftover, and the copy's own error matters more.
    }
    throw err;
  }
  pruneBackups(dir, { logger });
  return path;
}

/**
 * Deletes all but the newest backups, and any `.partial` left by a copy that was killed. Never
 * throws: a failed delete only leaves an extra file.
 */
export function pruneBackups(dir: string, { logger, keep = KEEP_BACKUPS }: { logger: Logger; keep?: number }): void {
  let all: string[];
  try {
    all = readNames(dir);
  } catch (err) {
    logger.warn("backup", "prune_failed", { path: dir, err });
    return;
  }
  const names = backupsIn(all);
  const partials = all.filter((f) => f.endsWith(".partial") && BACKUP_FILE.test(f.slice(0, -".partial".length)));
  const removed: string[] = [];
  for (const name of [...partials, ...names.slice(0, Math.max(0, names.length - keep))]) {
    const path = join(dir, name);
    try {
      rmSync(path);
      removed.push(name);
    } catch (err) {
      logger.warn("backup", "prune_failed", { path, err });
    }
  }
  if (removed.length > 0) logger.info("backup", "pruned", { removed });
}

/**
 * Due when there is no backup, the newest is 24 h old or more, or the newest is dated in the
 * future (the clock moved back; waiting for it would skip backups for that long).
 */
export function dailyBackupDue(dir: string, now: Date): boolean {
  const newest = backupsIn(readNames(dir)).at(-1);
  if (newest === undefined) return true;
  const age = now.getTime() - stampOf(newest);
  return age >= DAY_MS - DUE_SLACK_MS || age < 0;
}

export interface DailyBackupOptions extends Omit<BackupOptions, "reason"> {
  /** While true, a due backup waits: VACUUM INTO blocks the event loop for the copy. */
  isRecording?: () => boolean;
}

/** Makes a daily backup if one is due. Never throws: a missed backup mustn't stop the app. */
export function runDailyBackup(db: Db, { dir, now, logger, isRecording = () => false }: DailyBackupOptions): void {
  // One instant for the check and the file's stamp: a later stamp could make tomorrow's hourly
  // check find it just under 24 h old and push the backup back an hour.
  const at = now();
  let due: boolean;
  let recording: boolean;
  try {
    due = dailyBackupDue(dir, at);
    recording = due && isRecording();
  } catch (err) {
    logger.error("backup", "failed", { reason: "daily", path: dir, err });
    return;
  }
  if (!due) return;
  if (recording) {
    logger.info("backup", "skipped_recording");
    return;
  }
  try {
    backupTracker(db, { dir, reason: "daily", now: () => at, logger });
  } catch {
    // already logged by backupTracker
  }
}
