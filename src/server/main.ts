import { log } from "./log";
import { dataDir } from "./paths";
import { openStorage } from "./storage";

log.info("app", "started", { pid: process.pid, dataDir: dataDir(), bun: Bun.version });
try {
  const storage = openStorage();
  storage.close();
  log.info("app", "stopped", { pid: process.pid });
} catch (err) {
  // openStorage has logged the specific failure; this records that startup gave up.
  log.error("app", "start_failed", { err });
  process.exitCode = 1;
}
