import { createApi, type Api } from "./api";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED } from "./exit-codes";
import { startGameWatch, type GameWatch } from "./game-watch";
import { PortTakenError, startHost, type Host } from "./host";
import { log } from "./log";
import { scheduleMaintenance, type Maintenance } from "./maintenance";
import { dashboardPort, dataDir, staticDir } from "./paths";
import { createQueryReader } from "./query/read";
import { startStatsClient, statsApiUrl, type StatsClient } from "./recorder/client";
import { createRecorder, type Recorder } from "./recorder/recorder";
import { toRecord } from "./records/record";
import { createRecordWriter } from "./records/save";
import { expectedPort } from "./stats-config";
import { openStorage, type Storage } from "./storage";

/** What has been started so far: a stop can arrive mid-startup, and tears down only these. */
interface Parts {
  host?: Host;
  storage?: Storage;
  recorder?: Recorder;
  maintenance?: Maintenance;
  client?: StatsClient;
  gameWatch?: GameWatch;
  api?: Api;
}

function main(): void {
  log.info("app", "started", { pid: process.pid, dataDir: dataDir(), bun: Bun.version });
  const parts: Parts = {};
  let stopping = false;

  /** Tears down what has started, then exits; the only way out once the host is up. */
  const stop = async (reason: string, code = EXIT_OK) => {
    if (stopping) return; // a signal and the endpoint can arrive together
    stopping = true;
    const steps: [string, () => unknown][] = [
      ["api", () => parts.api?.stop()],
      ["client", () => parts.client?.stop()],
      ["game_watch", () => parts.gameWatch?.stop()],
      // The socket's own close comes too late to run before exit; the last scoreboard is written here.
      ["flush", () => parts.recorder?.flush()],
      ["maintenance", () => parts.maintenance?.stop()],
      ["storage", () => parts.storage?.close()],
      ["host", () => parts.host?.stop()],
    ];
    // Each step on its own: a failed flush must not skip closing storage.
    for (const [step, run] of steps) {
      try {
        await run();
      } catch (err) {
        log.error("app", "stop_failed", { reason, step, err });
      }
    }
    // 0 for any stop the user asked for: it must not look like a crash to the supervisor.
    log.info("app", "stopped", { pid: process.pid, reason, code });
    process.exit(code);
  };
  // SIGHUP: closing the console window, on Windows.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      void stop(signal);
    });
  }

  let url, port;
  try {
    url = statsApiUrl();
    port = dashboardPort();
  } catch (err) {
    log.error("app", "config_invalid", { err });
    process.exit(EXIT_CONFIG_INVALID);
  }

  // The port first, so a second instance leaves before touching migrations or backups.
  try {
    parts.host = startHost({ port, logger: log, onShutdown: () => void stop("shutdown") });
  } catch (err) {
    if (err instanceof PortTakenError) {
      log.warn("app", "port_taken", { port });
      process.exit(EXIT_PORT_TAKEN);
    }
    log.error("app", "start_failed", { err });
    process.exit(EXIT_START_FAILED);
  }

  let storage, recorder;
  try {
    storage = parts.storage = openStorage();
    const writer = createRecordWriter({ tracker: storage.tracker, logger: log });
    recorder = parts.recorder = createRecorder({
      raw: storage.raw,
      logger: log,
      // A failed write is logged by the recorder as hook_failed; recompute can rebuild it.
      onMatchFinished: (s) => {
        const record = toRecord(s);
        writer.save(record);
        // Startup recovery finishes matches before the API exists; no page is open then.
        parts.api?.matchEnded(record.match.guid);
      },
    });
    recorder.recoverAtStartup();
  } catch (err) {
    // openStorage logs its specific failure first.
    log.error("app", "start_failed", { err });
    // Through stop, not a bare return: the host is already listening and would keep a process
    // alive that holds the port and records nothing.
    void stop("start_failed", EXIT_START_FAILED);
    return;
  }

  parts.maintenance = scheduleMaintenance({ storage, isRecording: recorder.isRecording });
  const client = (parts.client = startStatsClient({ url, recorder, logger: log }));
  const gameWatch = (parts.gameWatch = startGameWatch({ client, logger: log, expectedWebPort: expectedPort(url) }));
  const api = (parts.api = createApi({
    tracker: storage.tracker,
    reader: createQueryReader({ tracker: storage.tracker, logger: log }),
    status: () => ({ connection: client.status(), statsApiOff: gameWatch.statsApiOff(), configProblems: gameWatch.statsConfig()?.problems ?? [] }),
    staticDir: staticDir(),
    logger: log,
  }));
  parts.host.mount(api.handle);
}

main();
