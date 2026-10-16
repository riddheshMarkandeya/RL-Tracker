import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths";

export type Level = "info" | "warn" | "error";
/** `ts`, `level`, `cat` and `event` are the logger's own keys; same-named fields are ignored. */
export type LogFn = (cat: string, event: string, fields?: Record<string, unknown>) => void;
export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

export interface LoggerOptions {
  dir: string;
  fileName?: string;
  /** Rotate once the base file would pass this size. */
  maxBytes?: number;
  /** Files kept, base included (at least 2). */
  maxFiles?: number;
  now?: () => Date;
  /** Mirror lines to the console; defaults to stdout being a TTY. */
  echo?: boolean;
}

/** Everything that says why an Error happened: its own fields (code, syscall, ...), cause, errors. */
function errorFields(e: Error): Record<string, unknown> {
  const { errors } = e as { errors?: unknown };
  return { ...Object.fromEntries(Object.entries(e)), name: e.name, message: e.message, stack: e.stack, cause: e.cause, errors };
}

/**
 * JSON.stringify for the values logs carry: Errors keep their details (they stringify to {}
 * otherwise), BigInts become strings, and an object that contains itself becomes "[Circular]".
 * Only true cycles count: a value shared by two siblings is written twice.
 */
function toJsonLine(record: Record<string, unknown>): string {
  // The path from the root: each value as found, and the object JSON.stringify walks for it.
  const path: { value: object; holder: object }[] = [];
  return JSON.stringify(record, function (this: unknown, _key: string, value: unknown) {
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "object" || value === null) return value;
    // The replacer runs with `this` = the holder, so trimming back to it leaves the current path.
    while (path.length > 0 && path.at(-1)?.holder !== this) path.pop();
    if (path.some((p) => p.value === value)) return "[Circular]";
    const holder = value instanceof Error ? errorFields(value) : value;
    path.push({ value, holder });
    return holder;
  });
}

// Writes to a console that is gone (no console under Task Scheduler, a closed pipe) can throw, or
// fail later as an "error" event that crashes the process if nothing listens. There is nowhere
// left to report either, so both are swallowed.
const guardedStreams = new WeakSet<NodeJS.WriteStream>();
function writeConsole(stream: NodeJS.WriteStream, text: string): void {
  if (!guardedStreams.has(stream)) {
    stream.on("error", () => undefined);
    guardedStreams.add(stream);
  }
  try {
    stream.write(text);
  } catch {
    // deliberately ignored, see above
  }
}

/**
 * Structured JSON-lines logger, tagged by category and event, that never throws once created.
 * Writes <dir>/<fileName>, rotating to .1 ... .(maxFiles-1) once a file would pass maxBytes.
 * Failures go to stderr once per streak, as log_write_failed or log_rotate_failed.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const { dir, fileName = "tracker.log", maxBytes = 5 * 1024 * 1024, maxFiles = 5 } = opts;
  if (!Number.isInteger(maxFiles) || maxFiles < 2) throw new RangeError(`maxFiles must be an integer >= 2, got ${String(maxFiles)}`);
  if (!(maxBytes > 0)) throw new RangeError(`maxBytes must be > 0, got ${String(maxBytes)}`);
  const now = opts.now ?? (() => new Date());
  const echo = opts.echo ?? process.stdout.isTTY;
  const path = join(dir, fileName);
  const generation = (i: number) => `${path}.${String(i)}`;
  let size: number | null = null; // bytes in the base file as far as this process knows; null = re-check

  function fileSize(): number {
    try {
      return statSync(path).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0; // not created yet
      throw err;
    }
  }

  /**
   * Shifts generations up into the first free slot (or over the oldest), then renames the base
   * to .1. A failed rename leaves at most a gap at .1, which the next attempt fills without
   * deleting anything.
   */
  function rotate(): void {
    let free = 1;
    while (free < maxFiles - 1 && existsSync(generation(free))) free++;
    rmSync(generation(free), { force: true });
    for (let i = free - 1; i >= 1; i--) renameSync(generation(i), generation(i + 1));
    renameSync(path, generation(1));
  }

  const failing = { write: false, rotate: false }; // report a failure streak once, not per line

  function report(kind: keyof typeof failing, err: unknown): void {
    if (failing[kind]) return;
    failing[kind] = true;
    const record = { ts: new Date().toISOString(), level: "error", cat: "log", event: `log_${kind}_failed`, path };
    let line: string;
    try {
      line = toJsonLine({ ...record, err });
    } catch {
      // err itself can't be serialized (a throwing getter); the event and path still say enough.
      line = toJsonLine({ ...record, err: "[unserializable]" });
    }
    writeConsole(process.stderr, line + "\n");
  }

  function append(line: string): void {
    const bytes = Buffer.byteLength(line);
    if (size === null) {
      mkdirSync(dir, { recursive: true });
      size = fileSize();
    }
    if (size + bytes > maxBytes) {
      // Another process (a second instance, a dev run beside autostart) may have rotated or
      // truncated the file since; trust the counter only after re-reading the real size.
      size = fileSize();
      if (size > 0 && size + bytes > maxBytes) {
        try {
          rotate();
          size = 0;
          failing.rotate = false;
        } catch (err) {
          // Broad on purpose: whatever stopped the rotation (a locked file, a lost race with
          // another process), the line still belongs in the oversized base file.
          // The next over-limit line retries; only the report is once per streak.
          report("rotate", err);
        }
      }
    }
    appendFileSync(path, line);
    size += bytes;
  }

  function write(level: Level, cat: string, event: string, fields: Record<string, unknown> = {}): void {
    let line: string | undefined;
    try {
      const own = { ts: now().toISOString(), level, cat, event };
      line = toJsonLine(Object.assign({ ...own, ...fields }, own)) + "\n";
      append(line);
      failing.write = false;
    } catch (err) {
      // Broad on purpose: logging is best-effort and must never crash the recorder, and every
      // failure here (fs, a throwing toJSON or getter in fields) degrades the same way.
      size = null;
      report("write", err);
    }
    if (echo && line !== undefined) writeConsole(process.stdout, line);
  }

  const at =
    (level: Level): LogFn =>
    (cat, event, fields) => {
      write(level, cat, event, fields);
    };
  return { info: at("info"), warn: at("warn"), error: at("error") };
}

/** The app's logger, writing to the data dir. */
export const log = createLogger({ dir: dataDir() });
