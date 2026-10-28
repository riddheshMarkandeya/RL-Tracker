import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createIds } from "./ids";
import { createQueryReader } from "./query/read";
import { createRecordWriter } from "./records/save";
import { openStorage, type Storage } from "./storage";
import { ALT, ME, memoryLogger, record } from "./testing";

let dir: string;
let storage: Storage;
let logger: ReturnType<typeof memoryLogger>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-ids-"));
  logger = memoryLogger();
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const ids = () => createIds({ tracker: storage.tracker, logger });
const addId = (id: string, name: string | null, status: string, at: number) =>
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, ?, ?, ?)", id, name, status, at);

describe("ids store", () => {
  test("the list is in the order the ids were added, with each one's platform", () => {
    addId("PS4|ps|0", "ps", "rejected", 3);
    addId(ALT, "alt", "pending", 2);
    addId(ME, "me", "confirmed", 1);
    expect(ids().list()).toEqual([
      { primaryId: ME, name: "me", platform: "Epic", status: "confirmed" },
      { primaryId: ALT, name: "alt", platform: "Steam", status: "pending" },
      { primaryId: "PS4|ps|0", name: "ps", platform: "PlayStation", status: "rejected" },
    ]);
    expect(logger.lines).toEqual([]);
  });

  test("an unknown prefix shows as itself and is logged once, however often the list is read", () => {
    addId("Tesla|a|0", null, "pending", 1);
    addId("Tesla|b|0", null, "pending", 2);
    const store = ids();
    expect(store.list().map((r) => r.platform)).toEqual(["Tesla", "Tesla"]);
    store.list();
    expect(logger.lines.filter((l) => l.event === "unknown_platform").map((l) => [l.level, l.fields])).toEqual([["warn", { prefix: "Tesla" }]]);
  });

  test("a status is set both ways and logged; the answer comes back as the whole list", () => {
    addId(ME, "me", "pending", 1);
    expect(ids().setStatus(ME, "confirmed")).toEqual([{ primaryId: ME, name: "me", platform: "Epic", status: "confirmed" }]);
    expect(ids().setStatus(ME, "rejected")?.[0]?.status).toBe("rejected");
    expect(ids().setStatus(ME, "confirmed")?.[0]?.status).toBe("confirmed");
    expect(logger.lines.filter((l) => l.event === "status").map((l) => l.fields)).toEqual([
      { id: ME, from: "pending", to: "confirmed" },
      { id: ME, from: "confirmed", to: "rejected" },
      { id: ME, from: "rejected", to: "confirmed" },
    ]);
  });

  test("an unknown id is null, and nothing is written", () => {
    expect(ids().setStatus("Epic|nobody|0", "confirmed")).toBeNull();
    expect(ids().list()).toEqual([]);
  });

  test("a rejected id stops counting as you", () => {
    addId(ME, "me", "confirmed", 1);
    createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 }).save(record("A", 1000));
    const reader = createQueryReader({ tracker: storage.tracker, logger: memoryLogger() });
    expect(reader.readResults()[0]).toMatchObject({ played: true, result: "win" });
    ids().setStatus(ME, "rejected");
    expect(reader.readResults()[0]).toMatchObject({ played: false, result: null });
  });
});
