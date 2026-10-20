import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { backupsDir, backupTracker, runDailyBackup } from "./db/backup";
import { migrate } from "./db/migrate";
import { rawMigrations, trackerMigrations } from "./db/migrations";
import { openDb, type Db, type OpenDbOptions } from "./db/sqlite";
import { log, type Logger } from "./log";
import { dataDir } from "./paths";

export interface Storage {
  /** Settings, seasons, IDs and match records; backed up. */
  tracker: Db;
  /** Raw Stats API events, trimmed by retention; not backed up. */
  raw: Db;
  dir: string;
  close(): void;
}

export interface StorageOptions {
  dir?: string;
  logger?: Logger;
  now?: () => Date;
  busyTimeoutMs?: number;
  /** Overrides the shipped migrations (tests use a fake next version). */
  migrations?: { tracker: readonly string[]; raw: readonly string[] };
}

interface OpenOne {
  name: string;
  migrations: readonly string[];
  openOpts: OpenDbOptions;
  beforeMigrate?: (db: Db, from: number) => void;
}

function openOne(dir: string, logger: Logger, { name, migrations, openOpts, beforeMigrate }: OpenOne): Db {
  const path = join(dir, `${name}.db`);
  const started = performance.now();
  let db: Db;
  try {
    db = openDb(path, openOpts);
  } catch (err) {
    logger.error("db", "open_failed", { db: name, path, err });
    throw err;
  }
  try {
    const hook = beforeMigrate && ((from: number) => {
      beforeMigrate(db, from);
    });
    // migrate logs its own failures.
    const { to } = migrate(db, name, migrations, { logger, beforeMigrate: hook });
    logger.info("db", "opened", { db: name, path, version: to, ms: Math.round(performance.now() - started) });
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Opens and migrates tracker.db and raw.db in the data dir, creating it if needed. */
export function openStorage(opts: StorageOptions = {}): Storage {
  const { dir = dataDir(), logger = log, now = () => new Date(), busyTimeoutMs } = opts;
  const migrations = opts.migrations ?? { tracker: trackerMigrations, raw: rawMigrations };
  const backups = backupsDir(dir);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.error("db", "open_failed", { path: dir, err });
    throw err;
  }
  const tracker = openOne(dir, logger, {
    name: "tracker",
    migrations: migrations.tracker,
    openOpts: { busyTimeoutMs },
    // A fresh DB (version 0) has nothing to protect. A failure throws: migrating without the
    // backup is what it exists to prevent.
    beforeMigrate: (db, from) => {
      if (from > 0) backupTracker(db, { dir: backups, reason: "premigration", now, logger });
    },
  });
  let raw: Db;
  try {
    raw = openOne(dir, logger, { name: "raw", migrations: migrations.raw, openOpts: { busyTimeoutMs, autoVacuum: "incremental", synchronous: "normal" } });
  } catch (err) {
    tracker.close();
    throw err;
  }
  runDailyBackup(tracker, { dir: backups, now, logger });
  return {
    tracker,
    raw,
    dir,
    close: () => {
      try {
        tracker.close();
      } finally {
        raw.close();
      }
    },
  };
}
