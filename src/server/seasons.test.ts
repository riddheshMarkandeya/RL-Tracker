import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createQueryReader } from "./query/read";
import { createSeasons } from "./seasons";
import { openStorage, type Storage } from "./storage";
import { memoryLogger } from "./testing";

let dir: string;
let storage: Storage;
let logger: ReturnType<typeof memoryLogger>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-seasons-"));
  logger = memoryLogger();
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const seasons = () => createSeasons({ tracker: storage.tracker, reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger });
const SEED = [
  { id: 1, name: "S22", startDate: "2026-03-11" },
  { id: 2, name: "S23", startDate: "2026-06-09" },
  { id: 3, name: "S24", startDate: "2026-09-23" },
];
const events = () => logger.lines.map((l) => [l.level, `${l.cat}/${l.event}`, l.fields]);

describe("seasons store", () => {
  test("an add comes back in start order, with the seed kept", () => {
    expect(seasons().add({ name: "S21", start: "2025-12-10" })).toEqual({
      ok: true,
      seasons: [{ id: 4, name: "S21", startDate: "2025-12-10" }, ...SEED],
    });
    expect(events()).toEqual([["info", "seasons/added", { id: 4, name: "S21", start: "2025-12-10" }]]);
  });

  test("an edit changes the name and the start; a row may keep its own name and start", () => {
    expect(seasons().edit(2, { name: "s23", start: "2026-06-10" })).toEqual({ ok: true, seasons: [SEED[0], { id: 2, name: "s23", startDate: "2026-06-10" }, SEED[2]] });
    expect(seasons().edit(3, { name: "S24", start: "2026-09-23" })).toMatchObject({ ok: true });
    expect(events()).toEqual([
      ["info", "seasons/edited", { id: 2, name: "s23", start: "2026-06-10" }],
      ["info", "seasons/edited", { id: 3, name: "S24", start: "2026-09-23" }],
    ]);
  });

  test("a delete removes the row", () => {
    expect(seasons().remove(2)).toEqual({ ok: true, seasons: [SEED[0], SEED[2]] });
    expect(events()).toEqual([["info", "seasons/deleted", { id: 2, name: "S23", start: "2026-06-09" }]]);
  });

  test("a name another season has, in any case, or its start day is a clash, and nothing is written", () => {
    expect(seasons().add({ name: "s22", start: "2026-12-09" })).toEqual({ ok: false, error: "duplicate_name" });
    expect(seasons().add({ name: "S25", start: "2026-09-23" })).toEqual({ ok: false, error: "duplicate_start" });
    expect(seasons().edit(1, { name: "S23", start: "2026-03-11" })).toEqual({ ok: false, error: "duplicate_name" });
    expect(seasons().edit(1, { name: "S22", start: "2026-06-09" })).toEqual({ ok: false, error: "duplicate_start" });
    expect(storage.tracker.all("SELECT id, name, start_date AS startDate FROM seasons ORDER BY id")).toEqual(SEED);
    expect(events()).toEqual([
      ["warn", "seasons/conflict", { field: "name" }],
      ["warn", "seasons/conflict", { field: "start" }],
      ["warn", "seasons/conflict", { field: "name" }],
      ["warn", "seasons/conflict", { field: "start" }],
    ]);
  });

  test("an unknown id is not found, for edit and delete", () => {
    expect(seasons().edit(99, { name: "S25", start: "2026-12-09" })).toEqual({ ok: false, error: "not_found" });
    expect(seasons().remove(99)).toEqual({ ok: false, error: "not_found" });
    expect(storage.tracker.all("SELECT id FROM seasons")).toHaveLength(3);
  });
});
