import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SHUTDOWN_HEADER } from "../shared/constants";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED } from "./exit-codes";
import { freePort } from "./testing";

const MAIN = join(import.meta.dirname, "main.ts");

const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
};

describe("main as a process", () => {
  let dir: string;
  let port: number;
  const children: ReturnType<typeof Bun.spawn>[] = [];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rltracker-main-"));
    port = await freePort();
  });
  afterEach(async () => {
    for (const c of children.splice(0)) {
      c.kill();
      await c.exited;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const spawnMain = (dataDir: string, env: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, MAIN], {
      // Port 9 (discard) has nothing listening, so the client just keeps waiting.
      env: { ...process.env, RLTRACKER_DATA_DIR: dataDir, RLTRACKER_PORT: String(port), STATS_API_URL: "ws://127.0.0.1:9", ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    children.push(child);
    return child;
  };
  const events = (dataDir: string) => {
    const file = join(dataDir, "tracker.log");
    if (!existsSync(file)) return [];
    // The child may be mid-append: only text before the last "\n" is whole lines.
    return readFileSync(file, "utf8")
      .split("\n")
      .slice(0, -1)
      .map((l) => JSON.parse(l) as { cat: string; event: string; reason?: string; pid?: number });
  };
  const has = (dataDir: string, event: string) => events(dataDir).some((e) => `${e.cat}/${e.event}` === event);

  test("a second instance exits 3 without opening storage, and the shutdown endpoint stops the first with 0", async () => {
    const first = spawnMain(dir);
    // The client's first failed connect comes after storage and the recorder are up.
    await until(() => has(dir, "stats_api/connect_failed"));

    const otherDir = join(dir, "second");
    const second = spawnMain(otherDir);
    expect(await second.exited).toBe(EXIT_PORT_TAKEN);
    expect(has(otherDir, "app/port_taken")).toBe(true);
    // It left before storage: no databases in its own data dir.
    expect(existsSync(join(otherDir, "tracker.db"))).toBe(false);

    const res = await fetch(`http://127.0.0.1:${String(port)}/api/shutdown`, { method: "POST", headers: { [SHUTDOWN_HEADER]: "1" } });
    expect(res.status).toBe(202);
    expect(await first.exited).toBe(EXIT_OK);
    expect(events(dir).at(-1)).toMatchObject({ cat: "app", event: "stopped", reason: "shutdown" });
  });

  test("storage that can't open exits 2 and leaves nothing listening", async () => {
    // A directory where tracker.db belongs: the log still works, the database can't open.
    mkdirSync(join(dir, "tracker.db"), { recursive: true });
    const child = spawnMain(dir);
    expect(await child.exited).toBe(EXIT_START_FAILED);
    expect(has(dir, "app/start_failed")).toBe(true);
    await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
  });

  test("an invalid port setting exits 4, which the supervisor doesn't retry", async () => {
    const child = spawnMain(dir, { RLTRACKER_PORT: "not-a-port" });
    expect(await child.exited).toBe(EXIT_CONFIG_INVALID);
    expect(has(dir, "app/config_invalid")).toBe(true);
  });
});
