import { afterEach, describe, expect, test, vi } from "vitest";
import { initialWatchState, parseTasklist, startGameWatch, step, type GameWatch, type WatchState } from "./game-watch";
import type { ConfigCheck } from "./stats-config";
import { memoryLogger } from "./testing";

describe("parseTasklist", () => {
  test("a CSV row for the game means it's running", () => {
    expect(parseTasklist('"RocketLeague.exe","1234","Console","1","2,345,678 K"\r\n')).toBe(true);
  });

  test("the 'no tasks' message, in any language, means it isn't", () => {
    expect(parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n")).toBe(false);
    expect(parseTasklist("INFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgeführt.\r\n")).toBe(false);
    expect(parseTasklist("")).toBe(false);
  });

  test("only the image-name field counts", () => {
    expect(parseTasklist('"Other.exe","1","RocketLeague.exe","1","1 K"\r\n')).toBe(false);
    expect(parseTasklist('"rocketleague.exe","1234","Console","1","1 K"\r\n')).toBe(true);
  });
});

describe("step", () => {
  const S = 1000;
  /** Runs the inputs in order from the initial state, returning every output. */
  const run = (inputs: { gameRunning: boolean; status?: "waiting" | "connected" | "recording"; at: number }[]) => {
    let state: WatchState = initialWatchState;
    return inputs.map(({ gameRunning, status = "waiting", at }) => {
      const out = step(state, { gameRunning, status, now: at * S });
      state = out.state;
      return { off: out.statsApiOff, toast: out.toast, retryNow: out.retryNow };
    });
  };

  test("no game, nothing to report", () => {
    expect(run([{ gameRunning: false, at: 0 }])).toEqual([{ off: false, toast: false, retryNow: false }]);
  });

  test("every poll that sees the game while waiting asks for a reconnect, so the backoff can't outlast the 60 s", () => {
    const out = run([
      { gameRunning: false, at: 0 },
      { gameRunning: true, at: 20 },
      { gameRunning: true, at: 40 },
      { gameRunning: true, status: "connected", at: 60 },
    ]);
    expect(out.map((o) => o.retryNow)).toEqual([false, true, true, false]);
  });

  test("60 s of the game running while still waiting is 'Stats API off', toasted once per game run", () => {
    const out = run([
      { gameRunning: true, at: 0 },
      { gameRunning: true, at: 59 },
      { gameRunning: true, at: 60 },
      { gameRunning: true, at: 80 },
      { gameRunning: false, at: 100 },
      { gameRunning: true, at: 120 },
      { gameRunning: true, at: 180 },
    ]);
    expect(out.map((o) => o.off)).toEqual([false, false, true, true, false, false, true]);
    expect(out.map((o) => o.toast)).toEqual([false, false, true, false, false, false, true]);
  });

  test("a connection clears it and restarts the clock, so a game restarted between polls isn't flagged at once", () => {
    const out = run([
      { gameRunning: true, at: 0 },
      { gameRunning: true, status: "connected", at: 60 },
      { gameRunning: true, status: "recording", at: 600 },
      { gameRunning: true, at: 620 },
      { gameRunning: true, at: 650 },
      { gameRunning: true, at: 680 },
    ]);
    expect(out.map((o) => o.off)).toEqual([false, false, false, false, false, true]);
    expect(out.map((o) => o.retryNow)).toEqual([true, false, false, true, true, true]);
  });
});

describe("startGameWatch", () => {
  const offCheck: ConfigCheck = {
    installDir: "C:\\Games\\rocketleague",
    foundBy: "epic",
    userConfigDir: "C:\\Users\\me\\OneDrive\\Documents\\My Games\\Rocket League\\TAGame\\Config",
    file: "user",
    path: "C:\\Users\\me\\OneDrive\\Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini",
    effective: { packetSendRate: 0, webPort: 49124 },
    problems: ["send_rate_off"],
  };
  const goodCheck: ConfigCheck = { ...offCheck, effective: { packetSendRate: 30, webPort: 49124 }, problems: [] };
  let watch: GameWatch | undefined;
  afterEach(() => {
    watch?.stop();
  });

  /** A watch over a running game whose Stats API never answers; each now() call is 61 s after the last. */
  const start = (checkConfig: (phase: "startup" | "game_running") => Promise<ConfigCheck | null>) => {
    let t = 0;
    const logger = memoryLogger();
    const toast = vi.fn<(body: string) => Promise<void>>(() => Promise.resolve());
    const detect = vi.fn(() => Promise.resolve(true));
    const check = vi.fn(checkConfig);
    watch = startGameWatch({
      client: { status: () => "waiting", retryNow: () => undefined },
      logger,
      expectedWebPort: 49124,
      pollMs: 10,
      now: () => (t += 61_000),
      detect,
      toast,
      checkConfig: check,
      checkTimeoutMs: 50,
    });
    return { logger, toast, detect, check, watch };
  };

  test("checks at startup, then again when the Stats API turns out off, and the toast names the fix", async () => {
    const { toast, check, watch } = start((phase) => Promise.resolve(phase === "startup" ? goodCheck : offCheck));
    expect(check).toHaveBeenCalledWith("startup");
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    expect(check.mock.calls).toEqual([["startup"], ["game_running"]]);
    expect(toast).toHaveBeenCalledWith("Set PacketSendRate to 30 in Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini, then restart the game.");
    expect(watch.statsApiOff()).toBe(true);
    expect(watch.statsConfig()).toEqual(offCheck);
  });

  test("no install found: the generic toast", async () => {
    const { toast } = start(() => Promise.resolve(null));
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    expect(toast.mock.calls[0]?.[0]).toContain("PacketSendRate above 0");
  });

  test("a check that never returns is cut off, the generic toast still shows, and polling goes on", async () => {
    const { toast, detect, logger, watch } = start((phase) => (phase === "startup" ? Promise.resolve(goodCheck) : new Promise(() => undefined)));
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    expect(toast.mock.calls[0]?.[0]).toContain("PacketSendRate above 0");
    expect(logger.events()).toContain("game/stats_config_timeout");
    expect(watch.statsConfig()).toEqual(goodCheck);
    const polls = detect.mock.calls.length;
    await vi.waitFor(() => {
      expect(detect.mock.calls.length).toBeGreaterThan(polls + 2);
    });
  });
});
