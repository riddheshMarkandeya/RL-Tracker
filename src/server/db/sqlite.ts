// The only file that imports bun:sqlite, so the driver can be swapped behind `Db`.
import { Database } from "bun:sqlite";

export type Param = string | number | bigint | boolean | null | Uint8Array;

/** Rejects a callback that returns a promise: its awaits would run after the commit. */
type Sync<T> = T extends PromiseLike<unknown> ? never : T;

export interface Db {
  readonly path: string;
  /** One statement, with bound parameters. */
  run(sql: string, ...params: Param[]): { changes: number };
  // The row type is the caller's assertion about its own SQL; the driver can't check it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[];
  /** Several statements, no parameters (migrations). */
  exec(sql: string): void;
  /** `BEGIN IMMEDIATE`; commits fn's result, rolls back if it throws. */
  transaction<T>(fn: () => Sync<T>): T;
  /** Reads a pragma's first value, e.g. pragma("user_version"). `name` is spliced into SQL: literals only. */
  pragma(name: string): unknown;
  close(): void;
}

const isThenable = (v: unknown) => typeof (v as { then?: unknown } | null)?.then === "function";

export interface OpenDbOptions {
  busyTimeoutMs?: number;
  /** Only takes effect on a new, empty file. */
  autoVacuum?: "incremental";
}

export function openDb(path: string, opts: OpenDbOptions = {}): Db {
  const { busyTimeoutMs = 5000, autoVacuum } = opts;
  const db = new Database(path, { create: true, strict: true });
  try {
    db.run(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`);
    // Before WAL: switching to WAL writes page 1, and that fixes the vacuum mode for good.
    if (autoVacuum) db.run("PRAGMA auto_vacuum = INCREMENTAL");
    // SQLite answers with the mode it kept; staying in rollback mode would let readers and the
    // writer block each other with nothing logged.
    const { journal_mode: mode } = db.query("PRAGMA journal_mode = WAL").get() as { journal_mode: string };
    if (mode !== "wal") throw new Error(`journal_mode is ${mode}, expected wal: ${path}`);
    db.run("PRAGMA foreign_keys = ON");
  } catch (err) {
    db.close();
    throw err;
  }

  return {
    path,
    run: (sql, ...params) => ({ changes: db.run(sql, params).changes }),
    get: <T>(sql: string, ...params: Param[]) => (db.query(sql).get(...params) as T | null) ?? undefined,
    all: <T>(sql: string, ...params: Param[]) => db.query(sql).all(...params) as T[],
    exec: (sql) => {
      db.run(sql);
    },
    transaction: <T>(fn: () => Sync<T>): T =>
      db
        .transaction(() => {
          const result = fn();
          if (isThenable(result)) {
            // The caller never sees this promise, so silence its rejection; the TypeError is the
            // failure. Only for a real Promise: calling another thenable's then() could run its work.
            if (result instanceof Promise) result.catch(() => undefined);
            throw new TypeError("transaction callback must be synchronous");
          }
          return result;
        })
        .immediate(),
    pragma: (name) => {
      const row = db.query(`PRAGMA ${name}`).get() as Record<string, unknown> | null;
      return row ? Object.values(row)[0] : undefined;
    },
    close: () => {
      db.close();
    },
  };
}
