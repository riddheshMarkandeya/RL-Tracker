import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED } from "./exit-codes";
import { decide, runSupervisor } from "./supervisor";
import { memoryLogger } from "./testing";

const MIN = 60_000;

describe("decide", () => {
  test("a clean stop, a taken port and a bad config end the supervisor too", () => {
    expect(decide(EXIT_OK, 1000, null)).toEqual({ kind: "stop" });
    expect(decide(EXIT_PORT_TAKEN, 1000, 20_000)).toEqual({ kind: "stop" });
    expect(decide(EXIT_CONFIG_INVALID, 1000, null)).toEqual({ kind: "stop" });
  });

  test("a crash restarts after 5 s, labelled by its exit code", () => {
    expect(decide(1, 1000, null)).toEqual({ kind: "restart", delayMs: 5000, cause: "crash" });
    expect(decide(EXIT_START_FAILED, 1000, null)).toEqual({ kind: "restart", delayMs: 5000, cause: "start_failed" });
    // Any other code (a kill, a native crash) is a crash too.
    expect(decide(0xc0000005, 1000, null)).toMatchObject({ kind: "restart", cause: "crash" });
  });

  test("quick repeated crashes double the delay up to 5 min", () => {
    const delays: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 9; i++) {
      const d = decide(1, 1000, prev);
      if (d.kind !== "restart") throw new Error("expected a restart");
      delays.push((prev = d.delayMs));
    }
    expect(delays).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  });

  test("10 min of uptime resets the delay", () => {
    expect(decide(1, 10 * MIN, 300_000)).toMatchObject({ delayMs: 5000 });
    expect(decide(1, 10 * MIN - 1, 300_000)).toMatchObject({ delayMs: 300_000 });
  });
});

describe("runSupervisor with a real child", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rltracker-sup-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A sleep that records delays and fails the test rather than loop forever. */
  const recordSleeps = (sleeps: number[]) => (ms: number) => {
    sleeps.push(ms);
    return sleeps.length > 10 ? Promise.reject(new Error("supervisor kept restarting")) : Promise.resolve();
  };

  const supervise = async (codes: string) => {
    const logger = memoryLogger();
    const counter = join(dir, "runs");
    const sleeps: number[] = [];
    const code = await runSupervisor({
      cmd: [process.execPath, join(import.meta.dirname, "../../test/exit-child.ts"), counter, codes],
      cwd: dir,
      logger,
      sleep: recordSleeps(sleeps),
    });
    return { code, logger, sleeps, runs: Number(readFileSync(counter, "utf8")) };
  };

  test("restarts after crashes with a growing delay, and stops on a clean exit", async () => {
    const { code, logger, sleeps, runs } = await supervise("1,2,0");
    expect(code).toBe(0);
    expect(runs).toBe(3);
    expect(sleeps).toEqual([5000, 10_000]);
    expect(logger.events()).toEqual([
      "supervisor/started",
      "supervisor/child_exited",
      "supervisor/restarting",
      "supervisor/child_exited",
      "supervisor/restarting",
      "supervisor/child_exited",
      "supervisor/stopped",
    ]);
    expect(logger.lines.filter((l) => l.event === "restarting").map((l) => l.fields.cause)).toEqual(["crash", "start_failed"]);
  });

  test("a child that found the port taken isn't restarted", async () => {
    const { code, sleeps, runs } = await supervise("3");
    expect(code).toBe(3);
    expect(runs).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("a missing exe is logged and retried like a crash", async () => {
    const logger = memoryLogger();
    let spawns = 0;
    const code = await runSupervisor({
      cmd: [join(dir, "missing.exe")],
      cwd: dir,
      logger,
      sleep: recordSleeps([]),
      // Two real spawns of the missing exe, then a clean child to end the loop.
      spawn: (cmd, opts) => (spawns++ < 2 ? Bun.spawn(cmd, opts) : { pid: 0, exited: Promise.resolve(0) }),
    });
    expect(code).toBe(0);
    expect(logger.events().filter((e) => e === "supervisor/spawn_failed")).toHaveLength(2);
  });
});
