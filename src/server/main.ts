import { log } from "./log";
import { dataDir } from "./paths";

log.info("app", "started", { pid: process.pid, dataDir: dataDir(), bun: Bun.version });
