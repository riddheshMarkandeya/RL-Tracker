import { homedir } from "node:os";
import { join } from "node:path";
import { DASHBOARD_PORT } from "../shared/constants";

/** Where the tracker keeps its logs and databases. RLTRACKER_DATA_DIR overrides it (tests, dev). */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RLTRACKER_DATA_DIR) return env.RLTRACKER_DATA_DIR;
  // Truthy, not just defined: an empty LOCALAPPDATA (a stripped service environment) would make
  // the path relative to cwd.
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "RLTracker");
  return join(homedir(), "AppData", "Local", "RLTracker");
}

/** The installed exes, side by side in `<dataDir>\bin`. */
export const TRACKER_EXE = "rltracker.exe";
export const SUPERVISOR_EXE = "rltracker-supervisor.exe";

/** The dashboard's port, which also guards a single instance. RLTRACKER_PORT overrides it (tests, dev). */
export function dashboardPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RLTRACKER_PORT;
  if (raw === undefined) return DASHBOARD_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error(`RLTRACKER_PORT must be a port number (1-65535), got "${raw}"`);
  return port;
}
