// The process Task Scheduler starts: it runs the tracker exe hidden and restarts it after a crash,
// which Task Scheduler itself doesn't do once a task has launched. It stays idle otherwise.
import { dirname, join } from "node:path";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED } from "./exit-codes";
import { createLogger, type Logger } from "./log";
import { dataDir, TRACKER_EXE } from "./paths";

const RESTART_MIN_MS = 5_000;
const RESTART_MAX_MS = 5 * 60_000;
/** A child that ran this long was healthy, so its crash starts the backoff over. */
const STABLE_UPTIME_MS = 10 * 60_000;

export type Decision = { kind: "stop" } | { kind: "restart"; delayMs: number; cause: "crash" | "start_failed" };

/** What to do after the tracker exited with `code` after `uptimeMs`; `prevDelayMs` is the last restart's delay (null if none). */
export function decide(code: number, uptimeMs: number, prevDelayMs: number | null): Decision {
  if (code === EXIT_OK || code === EXIT_PORT_TAKEN || code === EXIT_CONFIG_INVALID) return { kind: "stop" };
  const delayMs = prevDelayMs === null || uptimeMs >= STABLE_UPTIME_MS ? RESTART_MIN_MS : Math.min(prevDelayMs * 2, RESTART_MAX_MS);
  return { kind: "restart", delayMs, cause: code === EXIT_START_FAILED ? "start_failed" : "crash" };
}

interface Child {
  pid: number;
  exited: Promise<number>;
}
type SpawnFn = (cmd: string[], opts: { cwd: string; windowsHide: boolean; stdio: ["ignore", "ignore", "ignore"] }) => Child;

export interface SupervisorOptions {
  cmd: string[];
  cwd: string;
  logger: Logger;
  spawn?: SpawnFn;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
}

/** Runs `cmd` until it exits with a code that `decide` says to stop on; resolves with that code. */
export async function runSupervisor(opts: SupervisorOptions): Promise<number> {
  const { cmd, cwd, logger, spawn = Bun.spawn, sleep = Bun.sleep, now = Date.now } = opts;
  logger.info("supervisor", "started", { pid: process.pid, cmd });
  let prevDelayMs: number | null = null;
  for (;;) {
    const started = now();
    let code: number;
    try {
      // stdio ignored: the tracker writes its own log file, and nothing reads a hidden console.
      const child = spawn(cmd, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
      code = await child.exited;
      logger.info("supervisor", "child_exited", { pid: child.pid, code, uptimeMs: now() - started });
    } catch (err) {
      // Bun throws synchronously when the exe is missing (ENOENT); retrying with backoff covers a
      // reinstall that is mid-rename, and the log says why if it never comes back.
      logger.error("supervisor", "spawn_failed", { cmd, err });
      code = 1;
    }
    const decision = decide(code, now() - started, prevDelayMs);
    if (decision.kind === "stop") {
      logger.info("supervisor", "stopped", { code });
      return code;
    }
    logger.warn("supervisor", "restarting", { delayMs: decision.delayMs, cause: decision.cause });
    prevDelayMs = decision.delayMs;
    await sleep(decision.delayMs);
  }
}

if (import.meta.main) {
  // The tracker exe sits next to this one, so the task needs no paths beyond the supervisor's own.
  const bin = dirname(process.execPath);
  // Its own file: two processes rotating one log would race.
  const logger = createLogger({ dir: dataDir(), fileName: "supervisor.log" });
  void runSupervisor({ cmd: [join(bin, TRACKER_EXE)], cwd: bin, logger }).then(() => process.exit(EXIT_OK));
}
