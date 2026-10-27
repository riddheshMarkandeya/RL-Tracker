// The e2e stack, run under Bun by the Playwright fixture (seeding needs bun:sqlite): a temp data dir
// seeded per the mode in argv (`rich`, the default, or `empty`), the repo's web build copied to the
// installed path, a gated replay of the completed fixture, and the real tracker. Protocol: prints
// `ready {"url","dataDir"}` on stdout; the stdin line `go` releases the replay; stdin EOF tears
// everything down.
// RLT_E2E_KEEP=1 keeps the temp dir (and its tracker.log).
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { startReplayServer } from "../../scripts/replay";
import { describeStopResult, requestStop } from "../../scripts/stop";
import { createLogger } from "../../src/server/log";
import { createRecordWriter } from "../../src/server/records/save";
import { openStorage } from "../../src/server/storage";
import { freePort, goal, ME, player, readFixture, record, THEM } from "../../src/server/testing";
import { dayStart, dayOf } from "../../src/shared/periods";
import type { Seed } from "./fixtures";
import { DASHBOARD_HOST } from "../../src/shared/constants";

const REPO = join(import.meta.dirname, "..", "..");
const MIN = 60_000;
/** The completed fixture lasts ~392 s; at 64x the header shows "recording match" for several seconds. */
const REPLAY_SPEED = 64;
const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;

const say = (msg: string, fields: Record<string, unknown> = {}) => {
  console.log(`[e2e] ${msg}${Object.keys(fields).length ? " " + JSON.stringify(fields) : ""}`);
};

function logTail(dir: string, lines = 30): string {
  try {
    return readFileSync(join(dir, "tracker.log"), "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch (err) {
    return `(no tracker.log: ${(err as Error).message})`;
  }
}

const HOUR = 60 * MIN;

/** A match of ME's, won or lost, `start` ms after the local day's 4am start. */
const match = (guid: string, day: string, start: number, won: boolean, over: { playlistId?: number; checkFlags?: string[]; scoreTeam0?: number } = {}, rows: Parameters<typeof record>[2] = {}) => {
  const at = dayStart(day) + start;
  return record(guid, at, rows, { endedAt: at + 5 * MIN, scoreTeam0: won ? 2 : 1, scoreTeam1: won ? 1 : 2, winnerTeamNum: won ? 0 : 1, mvpKey: won ? ME : null, ...over });
};

/**
 * Your 4 goals and a hat trick: 3 more than the usual 1, so goals per game are 12% over the
 * baseline's and stand out. The goal you concede is aerial and deflected (your team touched it last).
 */
const HAT_TRICK: Parameters<typeof record>[2] = {
  players: [player(ME, 0, { goals: 4 }), player(THEM, 1)],
  statfeed: [
    { playerKey: ME, eventName: "Goal", count: 4 },
    { playerKey: ME, eventName: "HatTrick", count: 1 },
    { playerKey: THEM, eventName: "Goal", count: 1 },
  ],
  goals: [
    goal(0, ME, { speedKmh: 120 }),
    goal(0, ME, { pos: { x: 300, y: 4100, z: 93 }, distance: 1000 }),
    goal(0, ME, { pos: { x: -300, y: 4100, z: 93 }, distance: 1000 }),
    goal(0, ME, { pos: { x: -800, y: -880, z: 93 }, distance: 6000 }),
    goal(1, THEM, { pos: { x: 600, y: -2920, z: 700 }, distance: 2200, aerial: true, deflected: true }),
  ],
};

/**
 * `rich`: the current session is exactly one won match, ended 5 minutes ago (the header chip reads
 * "This session: 1–0"). Last month, so none is current: a 26-match session, a private-only one,
 * and two sessions on one day (one with a flagged match). The month before: one session, the
 * 26-match session's only baseline match. In the 26-match session, match 2 is HAT_TRICK and match 3
 * is on Ranked Doubles.
 * `empty`: no matches at all.
 */
function seed(dir: string, mode: Seed): void {
  const logger = createLogger({ dir });
  const storage = openStorage({ dir, logger });
  try {
    storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', ?)", ME, Date.now());
    if (mode === "empty") return;
    const now = Date.now();
    // Days of months before the current session's, so which month holds each session doesn't
    // depend on the run's date.
    const [y = 0, m = 1] = dayOf(now - 10 * MIN).split("-").map(Number);
    const day = (monthsBack: number, d: number) => {
      const i = y * 12 + (m - 1) - monthsBack;
      return `${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    };
    const writer = createRecordWriter({ tracker: storage.tracker, logger });
    writer.save(match("e2e-old", day(2, 15), 14 * HOUR, true));
    for (let i = 0; i < 26; i++) {
      writer.save(match(`e2e-long-${String(i).padStart(2, "0")}`, day(1, 5), 10 * HOUR + i * 6 * MIN, i % 3 !== 0, i === 2 ? { playlistId: 11 } : i === 1 ? { scoreTeam0: 4 } : {}, i === 1 ? HAT_TRICK : {}));
    }
    writer.save(match("e2e-private", day(1, 8), 14 * HOUR, true, { playlistId: 6 }));
    writer.save(match("e2e-first-a", day(1, 12), 8 * HOUR, true, { playlistId: 11 }));
    writer.save(match("e2e-first-b", day(1, 12), 8 * HOUR + 10 * MIN, false, { playlistId: 11, checkFlags: ["mvp_count"] }));
    writer.save(match("e2e-second", day(1, 12), 12 * HOUR, false, { playlistId: 2 }));
    writer.save(record("e2e-seed-won", now - 10 * MIN, {}, { endedAt: now - 5 * MIN }));
  } finally {
    storage.close();
  }
}

/** Removes the temp data dir unless RLT_E2E_KEEP=1. Never throws: it runs on the failure paths too. */
function removeDir(dir: string): void {
  if (process.env.RLT_E2E_KEEP === "1") {
    say("kept the data dir", { dataDir: dir });
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  } catch (err) {
    say("could not remove the data dir", { dataDir: dir, err: (err as Error).message });
  }
}

async function main(): Promise<void> {
  const dist = join(REPO, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error(`${dist}\\index.html is missing; run vite build first (bun run e2e does)`);

  const dir = mkdtempSync(join(tmpdir(), "rlt-e2e-"));
  try {
    // The installed path, so the tracker's default staticDir is what's served.
    cpSync(dist, join(dir, "bin", "web"), { recursive: true });
    seed(dir, process.argv[2] === "empty" ? "empty" : "rich");
  } catch (err) {
    removeDir(dir);
    throw err;
  }

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const replay = startReplayServer({ lines: readFixture("completed"), speed: REPLAY_SPEED, gate });
  const port = await freePort();
  const url = `http://${DASHBOARD_HOST}:${String(port)}`;
  say("starting", { dataDir: dir, trackerPort: port, replayPort: replay.port });

  const env: Record<string, string | undefined> = { ...process.env, RLTRACKER_DATA_DIR: dir, RLTRACKER_PORT: String(port), STATS_API_URL: `ws://127.0.0.1:${String(replay.port)}` };
  delete env.RLTRACKER_STATIC_DIR;
  const started = Date.now();
  const tracker = Bun.spawn([process.execPath, "run", join(REPO, "src", "server", "main.ts")], { cwd: REPO, env, stdout: "ignore", stderr: "inherit" });

  let tearingDown = false;
  // The log tail is printed before the dir goes; RLT_E2E_KEEP=1 keeps the whole log.
  const fail = (msg: string, fields: Record<string, unknown>) => {
    say(msg, fields);
    console.log(logTail(dir));
    removeDir(dir);
    process.exit(1);
  };
  void tracker.exited.then((code) => {
    if (!tearingDown) fail("tracker exited early", { code });
  });

  for (;;) {
    try {
      if ((await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2000) })).status === 200) break;
    } catch {
      // Not listening yet, or not answering within 2 s.
    }
    if (Date.now() - started > READY_TIMEOUT_MS) {
      tearingDown = true;
      tracker.kill();
      await tracker.exited;
      fail("tracker never became ready", { ms: READY_TIMEOUT_MS });
    }
    await Bun.sleep(100);
  }
  say("tracker ready", { ms: Date.now() - started });
  console.log(`ready ${JSON.stringify({ url, dataDir: dir })}`);

  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (line.trim() !== "go") return;
    say("replay released", { speed: REPLAY_SPEED });
    release();
  });
  await new Promise<void>((resolve) => input.once("close", resolve));

  tearingDown = true;
  const stop = await requestStop(port);
  if (describeStopResult(stop).exitCode !== 0) say("shutdown request failed", { stop });
  const code = await Promise.race([tracker.exited, Bun.sleep(STOP_TIMEOUT_MS).then(() => null)]);
  if (code === null) {
    say("tracker did not stop; killing it", { ms: STOP_TIMEOUT_MS });
    tracker.kill();
    await tracker.exited;
  } else {
    say("tracker stopped", { code });
  }
  await replay.stop();
  removeDir(dir);
}

await main();
