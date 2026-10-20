import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startReplayServer } from "../../../scripts/replay";
import { openStorage, type Storage } from "../storage";
import { memoryLogger, readFixture as fixture } from "../testing";
import { nextDelay, startStatsClient, statsApiUrl, type ConnectionStatus } from "./client";
import { parseFrame } from "./envelope";
import { feed } from "./feed";
import { createRecorder } from "./recorder";
import type { MatchSummary } from "./summary";

const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await Bun.sleep(5);
  }
};

describe("nextDelay", () => {
  test("starts at 5 s and doubles to a 30 s cap", () => {
    const delays: number[] = [];
    let d: number | null = null;
    for (let i = 0; i < 6; i++) delays.push((d = nextDelay(d)));
    expect(delays).toEqual([5000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });
});

describe("statsApiUrl", () => {
  test("defaults to the game's port and can be pointed elsewhere", () => {
    expect(statsApiUrl({})).toBe("ws://127.0.0.1:49124");
    expect(statsApiUrl({ STATS_API_URL: "ws://127.0.0.1:5000" })).toBe("ws://127.0.0.1:5000");
  });

  test("a URL that isn't a WebSocket one fails at startup, not on every retry", () => {
    expect(() => statsApiUrl({ STATS_API_URL: "http://127.0.0.1:5000" })).toThrow(/STATS_API_URL/);
    expect(() => statsApiUrl({ STATS_API_URL: "nope" })).toThrow(/STATS_API_URL/);
  });
});

describe("startStatsClient against a replayed stream", () => {
  let dir: string;
  let storage: Storage;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rltracker-client-"));
    storage = openStorage({ dir, logger: memoryLogger() });
  });
  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const recorderFor = (calls: MatchSummary[]) =>
    createRecorder({
      raw: storage.raw,
      logger: memoryLogger(),
      onMatchFinished: (s) => calls.push(s),
    });

  test("status goes waiting → connected → recording → connected → waiting, and every non-UpdateState event is stored", async () => {
    const lines = fixture("completed");
    const replay = startReplayServer({ lines, speed: Infinity });
    const calls: MatchSummary[] = [];
    const logger = memoryLogger();
    const statuses: ConnectionStatus[] = [];
    const client = startStatsClient({ url: `ws://127.0.0.1:${String(replay.port)}`, recorder: recorderFor(calls), logger, onStatus: (s) => statuses.push(s) });
    try {
      expect(client.status()).toBe("waiting");
      await replay.done;
      await until(() => calls.length === 1);
      void replay.stop();
      await until(() => client.status() === "waiting");
    } finally {
      client.stop();
    }
    expect(statuses).toEqual(["connected", "recording", "connected", "waiting"]);
    expect(logger.events()).toEqual(expect.arrayContaining(["stats_api/connected", "stats_api/disconnected"]));

    // The same file through the import path gives the same hook call.
    const imported: MatchSummary[] = [];
    const other = openStorage({ dir: mkdtempSync(join(dir, "import-")), logger: memoryLogger() });
    try {
      feed(createRecorder({ raw: other.raw, logger: memoryLogger(), onMatchFinished: (s) => imported.push(s) }), lines);
    } finally {
      other.close();
    }
    const brief = (s: MatchSummary) => ({ guid: s.guid, endKind: s.endKind, score: s.score, winner: s.winner?.teamNum, mvp: s.mvp?.key, flags: s.flags });
    expect(calls.map(brief)).toEqual(imported.map(brief));
    // Fast replay squeezes the gaps, so the sampler keeps fewer states; everything else arrives.
    const stored = storage.raw.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE name != 'UpdateState'")?.n;
    const sent = lines.map((l) => parseFrame(l.raw)).filter((r) => r.ok && r.ev.guid !== "" && r.ev.name !== "UpdateState").length;
    expect(stored).toBe(sent);
  });

  test("with nothing listening, connect_failed is logged once per streak, then still_waiting while retries go on", async () => {
    const closed = startReplayServer({ lines: [] });
    const port = closed.port;
    await closed.stop();
    const logger = memoryLogger();
    const client = startStatsClient({ url: `ws://127.0.0.1:${String(port)}`, recorder: recorderFor([]), logger, minDelayMs: 10, maxDelayMs: 20, stillWaitingMs: 100 });
    try {
      await until(() => logger.events().includes("stats_api/still_waiting"));
    } finally {
      client.stop();
    }
    expect(logger.events().filter((e) => e === "stats_api/connect_failed")).toHaveLength(1);
    expect(logger.lines.find((l) => l.event === "still_waiting")?.fields.attempts).toBeGreaterThan(2);
    expect(client.status()).toBe("waiting");
  });

  test("retryNow connects at once instead of after the backoff", async () => {
    const closed = startReplayServer({ lines: [] });
    const port = closed.port;
    await closed.stop();
    const logger = memoryLogger();
    const client = startStatsClient({ url: `ws://127.0.0.1:${String(port)}`, recorder: recorderFor([]), logger, minDelayMs: 60_000 });
    const replay = startReplayServer({ lines: [], port });
    try {
      await until(() => logger.events().includes("stats_api/connect_failed"));
      client.retryNow();
      await until(() => client.status() === "connected", 2000);
      // Connected: another call has nothing to do.
      client.retryNow();
      expect(logger.events().filter((e) => e === "stats_api/retry_now")).toHaveLength(1);
    } finally {
      client.stop();
      void replay.stop();
    }
  });

  test("retryNow is logged once per failing streak, so a watch asking every poll doesn't flood the log", async () => {
    const closed = startReplayServer({ lines: [] });
    const port = closed.port;
    await closed.stop();
    const logger = memoryLogger();
    const client = startStatsClient({ url: `ws://127.0.0.1:${String(port)}`, recorder: recorderFor([]), logger, minDelayMs: 60_000, stillWaitingMs: 0 });
    const stillWaiting = () => logger.events().filter((e) => e === "stats_api/still_waiting").length;
    try {
      await until(() => logger.events().includes("stats_api/connect_failed"));
      for (let i = 1; i <= 3; i++) {
        client.retryNow();
        await until(() => stillWaiting() === i);
      }
      expect(logger.events().filter((e) => e === "stats_api/retry_now")).toHaveLength(1);
      expect(logger.lines.findLast((l) => l.event === "still_waiting")?.fields.retries).toBe(3);
    } finally {
      client.stop();
    }
  });
});
