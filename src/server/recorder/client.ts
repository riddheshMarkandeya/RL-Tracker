// The connection to the game's Stats API: one WebSocket, reconnecting with backoff while the game
// is closed, feeding each frame to the recorder and driving its idle check.
import { STATS_API_PORT } from "../../shared/constants";
import type { Logger } from "../log";
import type { Recorder } from "./recorder";

export const RECONNECT_MIN_MS = 5_000;
export const RECONNECT_MAX_MS = 30_000;
const STILL_WAITING_MS = 5 * 60_000;
/** Well under the orphan timeout, so a silent match closes within a minute of it. */
const IDLE_CHECK_MS = 30_000;

/** "Stats API off" (the game running without it) needs process detection, so it isn't told apart from "waiting" here. */
export type ConnectionStatus = "waiting" | "connected" | "recording";

/** The wait before the next connect attempt, given the last one (null after a successful open). */
export function nextDelay(prev: number | null, min = RECONNECT_MIN_MS, max = RECONNECT_MAX_MS): number {
  return prev === null ? min : Math.min(prev * 2, max);
}

/** The Stats API URL; STATS_API_URL overrides it, e.g. to point at scripts/replay.ts. */
export function statsApiUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.STATS_API_URL ?? `ws://127.0.0.1:${String(STATS_API_PORT)}`;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`STATS_API_URL is not a URL: ${url}`);
  }
  if (protocol !== "ws:" && protocol !== "wss:") throw new Error(`STATS_API_URL must be a ws:// URL, got ${url}`);
  return url;
}

export interface StatsClientOptions {
  url: string;
  recorder: Pick<Recorder, "handleFrame" | "flush" | "checkIdle" | "isRecording">;
  logger: Logger;
  now?: () => number;
  onStatus?: (status: ConnectionStatus) => void;
  minDelayMs?: number;
  maxDelayMs?: number;
  stillWaitingMs?: number;
}

export function startStatsClient(opts: StatsClientOptions) {
  const { url, recorder, logger, now = Date.now, onStatus, minDelayMs, maxDelayMs, stillWaitingMs = STILL_WAITING_MS } = opts;
  const decoder = new TextDecoder();
  let socket: WebSocket | null = null;
  let open = false;
  let stopped = false;
  let delay: number | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let status: ConnectionStatus = "waiting";
  let frames = 0;
  /** The current streak of failed attempts: when it began, how many, when it was last logged, how many retryNow calls. */
  let failing: { since: number; attempts: number; logged: number; retries: number } | null = null;

  function updateStatus(): void {
    const next: ConnectionStatus = !open ? "waiting" : recorder.isRecording() ? "recording" : "connected";
    if (next === status) return;
    logger.info("recorder", "status", { from: status, to: next });
    status = next;
    onStatus?.(next);
  }

  function failedAttempt(): void {
    const t = now();
    if (!failing) {
      failing = { since: t, attempts: 1, logged: t, retries: 0 };
      logger.warn("stats_api", "connect_failed", { url, retryMs: nextDelay(delay, minDelayMs, maxDelayMs), note: "is the game running with the Stats API on?" });
      return;
    }
    failing.attempts++;
    if (t - failing.logged < stillWaitingMs) return;
    failing.logged = t;
    logger.info("stats_api", "still_waiting", { minutes: Math.round((t - failing.since) / 60_000), attempts: failing.attempts, retries: failing.retries });
  }

  function connect(): void {
    const ws = new WebSocket(url);
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      open = true;
      delay = null;
      failing = null;
      frames = 0;
      logger.info("stats_api", "connected", { url });
      updateStatus();
    };
    ws.onmessage = (ev: MessageEvent) => {
      frames++;
      const raw = typeof ev.data === "string" ? ev.data : decoder.decode(ev.data as ArrayBuffer);
      recorder.handleFrame(raw, now());
      updateStatus();
    };
    // A failed connect fires both error and close; everything is handled on close.
    ws.onclose = (ev: CloseEvent) => {
      socket = null;
      if (open) {
        open = false;
        // The match stays open: the game may come back (Reconnect), else the idle check closes it.
        recorder.flush();
        logger.info("stats_api", "disconnected", { code: ev.code, frames });
      } else if (!stopped) {
        failedAttempt();
      }
      updateStatus();
      if (stopped) return;
      delay = nextDelay(delay, minDelayMs, maxDelayMs);
      retry = setTimeout(connect, delay);
    };
  }

  const idleTimer = setInterval(() => {
    recorder.checkIdle(now());
    updateStatus();
  }, IDLE_CHECK_MS);

  connect();
  return {
    status: () => status,
    /** Connects now and restarts the backoff, e.g. when the game has just started; a no-op while connected or mid-attempt. */
    retryNow(): void {
      if (stopped || socket) return;
      clearTimeout(retry);
      delay = null;
      // The game watch asks on every poll while the game runs; still_waiting counts the rest.
      if (!failing?.retries) logger.info("stats_api", "retry_now");
      if (failing) failing.retries++;
      connect();
    },
    stop(): void {
      stopped = true;
      clearTimeout(retry);
      clearInterval(idleTimer);
      socket?.close();
    },
  };
}

export type StatsClient = ReturnType<typeof startStatsClient>;
