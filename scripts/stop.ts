// Stops the running tracker (background or dev) through its shutdown endpoint.
// `bun run stop [--wait]`; RLTRACKER_PORT picks which instance (a dev run is on 49101).
import { connect } from "node:net";
import { dashboardPort, SUPERVISOR_EXE } from "../src/server/paths";
import { DASHBOARD_HOST, DASHBOARD_PORT, SHUTDOWN_HEADER } from "../src/shared/constants";

export type StopOutcome = { kind: "status"; status: number } | { kind: "refused" } | { kind: "reset" } | { kind: "error"; message: string };

export function describeStopResult(outcome: StopOutcome): { message: string; exitCode: number } {
  switch (outcome.kind) {
    case "status":
      return outcome.status === 202 ? { message: "RL Tracker is stopping.", exitCode: 0 } : { message: `Stop request failed: HTTP ${String(outcome.status)}.`, exitCode: 1 };
    case "refused":
      return { message: "RL Tracker is not running.", exitCode: 1 };
    case "reset":
      // The tracker answers 202 before tearing down, so a lost answer most likely means it stopped first.
      return { message: "The connection closed before an answer; RL Tracker is probably stopping.", exitCode: 0 };
    case "error":
      return { message: `Stop request failed: ${outcome.message}`, exitCode: 1 };
  }
}

export async function requestStop(port: number): Promise<StopOutcome> {
  try {
    const res = await fetch(`http://${DASHBOARD_HOST}:${String(port)}/api/shutdown`, {
      method: "POST",
      headers: { [SHUTDOWN_HEADER]: "1" },
      signal: AbortSignal.timeout(10_000),
    });
    return { kind: "status", status: res.status };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ECONNREFUSED") return { kind: "refused" };
    if (code === "ECONNRESET") return { kind: "reset" };
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Whether anything accepts connections on the port. */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, DASHBOARD_HOST);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

/** Polls until nothing listens on the port; false if it's still taken after `timeoutMs`. */
export async function waitForPortFree(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (await portInUse(port)) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(250);
  }
  return true;
}

/** Force-ends every process with this exe name; true if any was running. */
export function killImage(exe: string): boolean {
  return Bun.spawnSync(["taskkill", "/IM", exe, "/F"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

const endSupervisor = () => killImage(SUPERVISOR_EXE);

export interface StopResult {
  message: string;
  exitCode: number;
  /** Nothing answered on the port. */
  notRunning: boolean;
}

/** Asks the tracker on `port` to stop and, with `wait`, waits until it has. */
export async function stopTracker(port: number, wait: boolean, deps: { request?: typeof requestStop; endSupervisor?: () => boolean } = {}): Promise<StopResult> {
  const { request = requestStop, endSupervisor: end = endSupervisor } = deps;
  const outcome = await request(port);
  const notRunning = outcome.kind === "refused";
  // A supervisor sleeping between crash restarts would bring the tracker back. Only the installed
  // port has one; a dev run on another port must not end it.
  if (notRunning && port === DASHBOARD_PORT && end()) {
    return { message: "RL Tracker wasn't running; ended its supervisor, which was waiting to restart it.", exitCode: 0, notRunning };
  }
  const result = { ...describeStopResult(outcome), notRunning };
  if (!wait || result.exitCode !== 0) return result;
  return (await waitForPortFree(port))
    ? { message: "RL Tracker stopped.", exitCode: 0, notRunning }
    : { message: `RL Tracker still holds port ${String(port)} after 30 s.`, exitCode: 1, notRunning };
}

if (import.meta.main) {
  const { message, exitCode } = await stopTracker(dashboardPort(), process.argv.includes("--wait"));
  console.log(message);
  process.exit(exitCode);
}
