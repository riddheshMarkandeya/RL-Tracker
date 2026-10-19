// Standalone Stats API capture: records the game's WebSocket stream to NDJSON while you play,
// so real sessions exist on disk before the recorder does. Run with `bun run scripts/capture.ts`;
// Ctrl+C to stop.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUpdateStateSampler, UPDATE_STATE_INTERVAL_MS, type Line, type Sampler } from "../src/server/recorder/sampler";

const STATS_URL = "ws://127.0.0.1:49124";
const RECONNECT_MS = 5_000;
const STILL_WAITING_MS = 5 * 60_000;
const STATUS_MS = 10 * 60_000;

/** Outer envelope's `Event` name, or null when the frame isn't a JSON object with a string Event. */
export function eventNameOf(frame: string): string | null {
  try {
    const envelope: unknown = JSON.parse(frame);
    if (typeof envelope !== "object" || envelope === null) return null;
    const event = (envelope as { Event?: unknown }).Event;
    return typeof event === "string" ? event : null;
  } catch {
    return null; // not JSON: the caller writes the frame anyway and logs bad_frame
  }
}

/** MatchGuid from the envelope's nested Data JSON string, or null. */
export function matchGuidOf(raw: string): string | null {
  try {
    const envelope = JSON.parse(raw) as { Data?: unknown };
    if (typeof envelope.Data !== "string") return null;
    const data: unknown = JSON.parse(envelope.Data);
    const guid = (data as { MatchGuid?: unknown }).MatchGuid;
    return typeof guid === "string" ? guid : null;
  } catch {
    return null; // only used for the log line
  }
}

type Fields = Record<string, string | number | null | undefined>;

function main(): void {
  const dir = process.env.CAPTURE_DIR ?? fileURLToPath(new URL("../captures", import.meta.url));
  const logPath = join(dir, "capture.log");

  function log(event: string, fields: Fields = {}): void {
    const kv = Object.entries(fields).map(([k, v]) => ` ${k}=${String(v)}`).join("");
    const line = `${new Date().toISOString()} [capture] ${event}${kv}`;
    console.log(line);
    try {
      appendFileSync(logPath, `${line}\n`);
    } catch {
      // best-effort: the console still has the line, and a real write failure on the capture
      // file itself is reported as write_error
    }
  }

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    log("write_error", { path: dir, error: String(err) });
    process.exit(1);
  }

  // State of the current connection; null while waiting for the game.
  let session: {
    sampler: Sampler<Line>;
    path: string | null;
    kept: number;
    statesSeen: number;
    statesWritten: number;
    bytes: number;
    badFrameLogged: boolean;
    // totals at the previous match_end, so match_end reports per-match counts
    matchStart: { kept: number; dropped: number };
    statusTimer: ReturnType<typeof setInterval>;
  } | null = null;
  let failStreakSince: number | null = null;
  let lastWaitingLog = 0;

  const decoder = new TextDecoder();
  const dropped = () => (session ? session.statesSeen - session.statesWritten : 0);

  function write(line: Line): void {
    if (!session) return;
    if (!session.path) {
      session.path = join(dir, `capture-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`);
      log("file_opened", { path: session.path });
    }
    const text = `${JSON.stringify({ t: line.t, raw: line.raw })}\n`;
    try {
      appendFileSync(session.path, text);
    } catch (err) {
      log("write_error", { path: session.path, error: String(err) });
      process.exit(1);
    }
    session.kept++;
    session.bytes += Buffer.byteLength(text);
    if (line.event === "UpdateState") session.statesWritten++;
  }

  function badFrame(reason: string): void {
    if (!session || session.badFrameLogged) return;
    session.badFrameLogged = true;
    log("bad_frame", { reason, note: "written anyway; logged once per connection" });
  }

  function onFrame(data: unknown): void {
    if (!session) return;
    let raw: string;
    if (typeof data === "string") {
      raw = data;
    } else {
      raw = decoder.decode(data as ArrayBuffer);
      badFrame("binary");
    }
    const event = eventNameOf(raw);
    if (event === null) badFrame("unparseable");
    if (event === "UpdateState") session.statesSeen++;
    for (const line of session.sampler.offer({ t: Date.now(), raw, event })) write(line);
    if (event === "MatchDestroyed") {
      const now = { kept: session.kept, dropped: dropped() };
      log("match_end", {
        guid: matchGuidOf(raw),
        kept: now.kept - session.matchStart.kept,
        updatestate_dropped: now.dropped - session.matchStart.dropped,
      });
      session.matchStart = now;
    }
  }

  function endSession(): { kept: number; dropped: number } | null {
    if (!session) return null;
    const held = session.sampler.flush();
    if (held) write(held);
    clearInterval(session.statusTimer);
    const totals = { kept: session.kept, dropped: dropped() };
    session = null;
    return totals;
  }

  function connect(): void {
    const ws = new WebSocket(STATS_URL);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      failStreakSince = null;
      session = {
        sampler: createUpdateStateSampler<Line>(UPDATE_STATE_INTERVAL_MS),
        path: null,
        kept: 0,
        statesSeen: 0,
        statesWritten: 0,
        bytes: 0,
        badFrameLogged: false,
        matchStart: { kept: 0, dropped: 0 },
        statusTimer: setInterval(() => {
          if (session) {
            log("status", { kept: session.kept, dropped: dropped(), mb: (session.bytes / 1e6).toFixed(1) });
          }
        }, STATUS_MS),
      };
      log("connected", { url: STATS_URL });
    };
    ws.onmessage = (ev) => {
      onFrame(ev.data);
    };
    // A failed connect fires both error and close; reconnect is scheduled only from close.
    ws.onclose = (ev) => {
      const totals = endSession();
      if (totals) {
        log("disconnected", { code: ev.code, ...totals });
      } else {
        const now = Date.now();
        if (failStreakSince === null) {
          failStreakSince = lastWaitingLog = now;
          log("connect_failed", { url: STATS_URL, retry_s: RECONNECT_MS / 1000, note: "is the game running?" });
        } else if (now - lastWaitingLog >= STILL_WAITING_MS) {
          lastWaitingLog = now;
          log("still_waiting", { minutes: Math.round((now - failStreakSince) / 60_000) });
        }
      }
      setTimeout(connect, RECONNECT_MS);
    };
  }

  function shutdown(signal: string): void {
    const totals = endSession();
    log("shutdown", { signal, ...(totals ?? { kept: 0, dropped: 0 }) });
    process.exit(0);
  }
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGHUP", () => {
    shutdown("SIGHUP");
  }); // console window closed, on Windows
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  log("started", { dir });
  connect();
}

if (import.meta.main) main();
