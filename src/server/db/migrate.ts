import type { Logger } from "../log";
import type { Db } from "./sqlite";

export interface MigrateOptions {
  logger: Logger;
  /** Runs once, outside the migration lock, when migrations are pending. Gets the current version. */
  beforeMigrate?: (from: number) => void;
}

export interface MigrateResult {
  /** The version this call started migrating from; equals `to` when it ran nothing. */
  from: number;
  to: number;
}

const userVersion = (db: Db) => db.pragma("user_version") as number;

/**
 * Brings `db` to `migrations.length`, where migrations[i] is the SQL for version i + 1.
 * Each version runs in its own BEGIN IMMEDIATE transaction that re-reads user_version first, so
 * a second instance that waited on the lock skips work the first one already did.
 */
export function migrate(db: Db, name: string, migrations: readonly string[], opts: MigrateOptions): MigrateResult {
  const { logger, beforeMigrate } = opts;
  const known = migrations.length;
  const current = userVersion(db);
  if (current > known) {
    // Old code writing a newer schema could corrupt it; refuse to start.
    logger.error("db", "newer_than_code", { db: name, path: db.path, version: current, known });
    throw new Error(`${name} is at schema version ${String(current)}, newer than this code's ${String(known)}`);
  }
  if (current === known) return { from: current, to: current };

  beforeMigrate?.(current);
  const started = performance.now();
  let from: number | undefined;
  for (let version = current + 1; version <= known; version++) {
    const sql = migrations[version - 1] ?? "";
    try {
      const ran = db.transaction(() => {
        const inLock = userVersion(db);
        if (inLock >= version) return false;
        db.exec(sql);
        db.run(`PRAGMA user_version = ${String(version)}`);
        return true;
      });
      if (ran) from ??= version - 1;
    } catch (err) {
      logger.error("db", "migration_failed", { db: name, path: db.path, version, err });
      throw err;
    }
  }
  const to = userVersion(db);
  if (from === undefined) return { from: to, to };
  logger.info("db", "migrated", { db: name, from, to, ms: Math.round(performance.now() - started) });
  return { from, to };
}
