// Tells "the game is closed" apart from "the game is running with its Stats API off", which the
// WebSocket alone can't: both look like a refused connection.
import type { Logger } from "./log";
import { runCommand, runPowerShell } from "./powershell";
import type { ConnectionStatus, StatsClient } from "./recorder/client";
import { checkStatsConfig, describeProblem, LOCATORS, type ConfigCheck } from "./stats-config";

const POLL_MS = 20_000;
/** Backstop over the config check's own spawn timeouts, so nothing it does can stall the poll. */
const CHECK_TIMEOUT_MS = 15_000;
/** How long the game may run without the Stats API answering before it counts as off. */
const OFF_AFTER_MS = 60_000;
const GAME_IMAGE = "RocketLeague.exe";

/** True when `tasklist /FO CSV /NH` output has a row for the game. The "no tasks" text is localized, so only the image-name field is read. */
export function parseTasklist(stdout: string): boolean {
  return stdout.split(/\r?\n/).some((line) => line.split(",")[0]?.replace(/"/g, "").toLowerCase() === GAME_IMAGE.toLowerCase());
}

export interface WatchState {
  /** When the game was first seen in the current stretch of waiting; null when it isn't running or we're connected. */
  gameSince: number | null;
  toasted: boolean;
}
export const initialWatchState: WatchState = { gameSince: null, toasted: false };

export interface StepOutput {
  state: WatchState;
  statsApiOff: boolean;
  /** Show the toast now. */
  toast: boolean;
  /**
   * Reconnect now rather than after the client's backoff (up to 30 s), so the 60 s measures the
   * game, not the backoff. Asked on every such poll: the game takes about 26 s to open its port.
   */
  retryNow: boolean;
}

/**
 * One poll. Only a stretch of waiting while the game runs counts; a connection or the game closing
 * ends it, so a game restarted between polls starts a fresh 60 s, and so does its toast.
 */
export function step(state: WatchState, input: { gameRunning: boolean; status: ConnectionStatus; now: number }): StepOutput {
  if (!input.gameRunning || input.status !== "waiting") return { state: initialWatchState, statsApiOff: false, toast: false, retryNow: false };
  const gameSince = state.gameSince ?? input.now;
  const statsApiOff = input.now - gameSince >= OFF_AFTER_MS;
  const toast = statsApiOff && !state.toasted;
  return { state: { gameSince, toasted: state.toasted || toast }, statsApiOff, toast, retryNow: true };
}

const DETECT_TIMEOUT_MS = 10_000;

/** Whether the game is running; throws when tasklist can't be run, fails or times out. */
async function detectGame(): Promise<boolean> {
  const { code, stdout, stderr, timedOut } = await runCommand(["tasklist", "/FI", `IMAGENAME eq ${GAME_IMAGE}`, "/FO", "CSV", "/NH"], DETECT_TIMEOUT_MS);
  if (timedOut) throw new Error(`tasklist timed out after ${String(DETECT_TIMEOUT_MS)} ms`);
  if (code !== 0) throw new Error(`tasklist exited ${String(code)}: ${stderr.trim()}`);
  return parseTasklist(stdout);
}

const TOAST_TIMEOUT_MS = 10_000;
const TOAST_TITLE = "RL Tracker isn't getting data";
const TOAST_BODY = "Rocket League is running but its Stats API is off. Set PacketSendRate above 0 in TAGame\\Config\\TAStatsAPI.ini, then restart the game.";
// PowerShell's own AppUserModelID: a toast needs a registered app, and this one always is.
const POWERSHELL_APP_ID = String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Shows a Windows toast through PowerShell. Best-effort: never throws, logs toast/shown or toast/failed. */
export async function showToast(logger: Logger, body = TOAST_BODY, title = TOAST_TITLE): Promise<void> {
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$x = $t.GetElementsByTagName('text')",
    `$x.Item(0).AppendChild($t.CreateTextNode(${psQuote(title)})) > $null`,
    `$x.Item(1).AppendChild($t.CreateTextNode(${psQuote(body)})) > $null`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(POWERSHELL_APP_ID)}).Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
  ].join("\n");
  try {
    const { code, stderr, timedOut } = await runPowerShell(script, TOAST_TIMEOUT_MS);
    if (code === 0) logger.info("toast", "shown", { title, body });
    else logger.warn("toast", "failed", { code, timedOut, stderr: stderr.slice(0, 500) });
  } catch (err) {
    // Broad on purpose: a toast is a nicety, and whatever stops PowerShell from starting must not
    // reach the recorder.
    logger.warn("toast", "failed", { err });
  }
}

export type CheckPhase = "startup" | "game_running";

export interface GameWatchOptions {
  client: Pick<StatsClient, "status" | "retryNow">;
  logger: Logger;
  /** The port the client connects to, which the game's WebPort must match. */
  expectedWebPort: number;
  pollMs?: number;
  now?: () => number;
  detect?: () => Promise<boolean>;
  toast?: (body: string) => Promise<void>;
  checkConfig?: (phase: CheckPhase) => Promise<ConfigCheck | null>;
  checkTimeoutMs?: number;
}

export interface GameWatch {
  /** The game has run a minute or more without the Stats API answering. */
  statsApiOff(): boolean;
  /** The latest Stats API config check; null until one finds the install. */
  statsConfig(): ConfigCheck | null;
  stop(): void;
}

/**
 * Polls for the game while the client is waiting, flags "Stats API off" and shows one toast per game
 * run, naming what's wrong in the game's Stats API settings. Checks those at startup too, so the log
 * and status hold them before the game ever runs.
 */
export function startGameWatch(opts: GameWatchOptions): GameWatch {
  const {
    client,
    logger,
    expectedWebPort,
    pollMs = POLL_MS,
    now = Date.now,
    detect = detectGame,
    toast = (body) => showToast(logger, body),
    checkConfig = () => checkStatsConfig({ expectedWebPort, logger, locators: LOCATORS }),
    checkTimeoutMs = CHECK_TIMEOUT_MS,
  } = opts;
  let state = initialWatchState;
  let off = false;
  let detectFailing = false;
  let busy = false;
  let config: ConfigCheck | null = null;

  /** Runs a check and keeps its result; "timeout" when it outlasts checkTimeoutMs. */
  async function runCheck(phase: CheckPhase): Promise<ConfigCheck | null | "timeout"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        resolve("timeout");
      }, checkTimeoutMs);
    });
    try {
      const result = await Promise.race([checkConfig(phase), timeout]);
      if (result === "timeout") logger.warn("game", "stats_config_timeout", { phase, timeoutMs: checkTimeoutMs });
      else config = result;
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The toast body: the first problem's fix, or the generic hint when the install wasn't found. */
  async function toastBody(): Promise<string> {
    const check = await runCheck("game_running");
    return check === null || check === "timeout" ? TOAST_BODY : describeProblem(check.problems[0], expectedWebPort, check.file);
  }

  async function poll(): Promise<void> {
    const status = client.status();
    let gameRunning = false;
    // Connected means the game is up; tasklist only runs while waiting.
    if (status === "waiting") {
      try {
        gameRunning = await detect();
        detectFailing = false;
      } catch (err) {
        if (!detectFailing) logger.warn("game", "detect_failed", { err });
        detectFailing = true;
      }
    }
    const out = step(state, { gameRunning, status: client.status(), now: now() });
    state = out.state;
    if (out.retryNow) client.retryNow();
    if (out.statsApiOff !== off) {
      off = out.statsApiOff;
      if (off) logger.warn("game", "stats_api_off", { runningForMs: state.gameSince === null ? null : now() - state.gameSince });
      else logger.info("game", "stats_api_ok");
    }
    // The settings are re-read only here: the game may have been reinstalled or edited since startup.
    if (out.toast) await toast(await toastBody());
  }

  void runCheck("startup");
  const timer = setInterval(() => {
    // A slow tasklist or toast must not stack polls.
    if (busy) return;
    busy = true;
    void poll().finally(() => {
      busy = false;
    });
  }, pollMs);

  return {
    statsApiOff: () => off,
    statsConfig: () => config,
    stop: () => {
      clearInterval(timer);
    },
  };
}
