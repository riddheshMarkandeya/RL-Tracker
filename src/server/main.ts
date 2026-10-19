import { log } from "./log";
import { dataDir } from "./paths";
import { startStatsClient, statsApiUrl } from "./recorder/client";
import { createRecorder } from "./recorder/recorder";
import { openStorage } from "./storage";

function main(): void {
  log.info("app", "started", { pid: process.pid, dataDir: dataDir(), bun: Bun.version });
  let storage;
  let url;
  try {
    url = statsApiUrl();
    storage = openStorage();
  } catch (err) {
    // openStorage logs its specific failure first; a bad STATS_API_URL is only in err.
    log.error("app", "start_failed", { err });
    process.exitCode = 1;
    return;
  }
  const recorder = createRecorder({
    raw: storage.raw,
    logger: log,
    // WP4 turns finished matches into records; the recorder already logs each summary.
    onMatchFinished: () => undefined,
  });
  recorder.recoverAtStartup();
  const client = startStatsClient({ url, recorder, logger: log });

  const stop = (signal: string) => {
    client.stop();
    // The socket's own close comes too late to run before exit; the last scoreboard is written here.
    recorder.flush();
    storage.close();
    log.info("app", "stopped", { pid: process.pid, signal });
    process.exit(0);
  };
  // SIGHUP: closing the console window, on Windows.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      stop(signal);
    });
  }
}

main();
