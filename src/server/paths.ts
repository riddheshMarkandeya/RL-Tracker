import { homedir } from "node:os";
import { join } from "node:path";

/** Where the tracker keeps its logs and databases. RLTRACKER_DATA_DIR overrides it (tests, dev). */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RLTRACKER_DATA_DIR) return env.RLTRACKER_DATA_DIR;
  // Truthy, not just defined: an empty LOCALAPPDATA (a stripped service environment) would make
  // the path relative to cwd.
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "RLTracker");
  return join(homedir(), "AppData", "Local", "RLTracker");
}
