import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rawMigrations } from "../db/migrations";
import { openDb } from "../db/sqlite";
import { openStorage, type Storage } from "../storage";
import { memoryLogger } from "../testing";
import { createRawStore, newTrimState, trimForStorage, type RawStore } from "./store";

let dir: string;
let storage: Storage;
let store: RawStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-store-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  store = createRawStore(storage.raw);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("createRawStore", () => {
  test("seq starts at 0 and continues after stored rows, per guid", () => {
    expect(store.nextSeq("A")).toBe(0);
    store.insert({ guid: "A", seq: 0, ts: 10, name: "MatchCreated", data: {} });
    store.insert({ guid: "A", seq: 1, ts: 11, name: "RoundStarted", data: {} });
    expect(store.nextSeq("A")).toBe(2);
    expect(store.nextSeq("B")).toBe(0);
  });

  test("lastEvent is the most recently inserted row, across guids", () => {
    expect(store.lastEvent()).toBeUndefined();
    store.insert({ guid: "A", seq: 0, ts: 10, name: "MatchDestroyed", data: {} });
    store.insert({ guid: "B", seq: 0, ts: 11, name: "UpdateState", data: {} });
    expect(store.lastEvent()).toEqual({ guid: "B", name: "UpdateState" });
  });

  test("thinnedOutputs returns a thinned match's snapshot, and nothing for an exempt or unknown match", () => {
    const outputs = { cameraKey: "Epic|A|0", players: { "Epic|A|0": { car_ms: 10 } } };
    storage.raw.run(
      "INSERT INTO retention_matches (match_guid, status, decided_at, rule_versions, outputs) VALUES ('T', 'thinned', 1, ?, ?)",
      JSON.stringify({ car_sampling: 1 }),
      JSON.stringify(outputs),
    );
    storage.raw.run("INSERT INTO retention_matches (match_guid, status, decided_at, rule_versions, flags) VALUES ('E', 'exempt', 1, '{}', '[\"x\"]')");
    expect(store.thinnedOutputs("T")).toEqual({ outputs, ruleVersions: { car_sampling: 1 } });
    expect(store.thinnedOutputs("E")).toBeUndefined();
    expect(store.thinnedOutputs("nope")).toBeUndefined();
  });

  test("thinnedOutputs is undefined on a read-only raw.db from before the retention table", () => {
    const path = join(dir, "old-raw.db");
    const old = openDb(path);
    old.exec(rawMigrations[0] ?? "");
    old.close();
    const ro = openDb(path, { readonly: true });
    expect(createRawStore(ro).thinnedOutputs("T")).toBeUndefined();
    ro.close();
  });

  test("matchEvents returns one guid's events in seq order with parsed data; names lists just the names", () => {
    store.insert({ guid: "A", seq: 1, ts: 11, name: "MatchEnded", data: { WinnerTeamNum: 1 } });
    store.insert({ guid: "A", seq: 0, ts: 10, name: "MatchCreated", data: { MatchGuid: "A" } });
    store.insert({ guid: "B", seq: 0, ts: 12, name: "MatchCreated", data: {} });
    expect(store.matchEvents("A")).toEqual([
      { seq: 0, ts: 10, name: "MatchCreated", data: { MatchGuid: "A" } },
      { seq: 1, ts: 11, name: "MatchEnded", data: { WinnerTeamNum: 1 } },
    ]);
    expect(store.names("A")).toEqual(["MatchCreated", "MatchEnded"]);
    expect(store.names("Z")).toEqual([]);
  });
});

describe("trimForStorage", () => {
  const state = (playlist: number, players: Record<string, unknown>[]) => ({ Game: { PlaylistId: playlist }, Players: players });

  test("keeps each player's Loadout only the first time it's stored in the match", () => {
    const seen = newTrimState();
    const first = trimForStorage("UpdateState", state(2, [{ PrimaryId: "p1", Loadout: ["x"] }]), seen);
    const second = trimForStorage("UpdateState", state(2, [{ PrimaryId: "p1", Loadout: ["x"] }, { PrimaryId: "p2", Loadout: ["y"] }]), seen);
    expect(first).toEqual(state(2, [{ PrimaryId: "p1", Loadout: ["x"] }]));
    expect(second).toEqual(state(2, [{ PrimaryId: "p1" }, { PrimaryId: "p2", Loadout: ["y"] }]));
  });

  test("bots share one id, so their loadouts are keyed by name too", () => {
    const seen = newTrimState();
    trimForStorage("UpdateState", state(2, [{ PrimaryId: "Unknown|0|0", Name: "Sticks", Loadout: ["a"] }]), seen);
    expect(trimForStorage("UpdateState", state(2, [{ PrimaryId: "Unknown|0|0", Name: "Hound", Loadout: ["b"] }]), seen)).toEqual(
      state(2, [{ PrimaryId: "Unknown|0|0", Name: "Hound", Loadout: ["b"] }]),
    );
  });

  test("skips UpdateState while PlaylistId is 0 (the menu value before the real one)", () => {
    expect(trimForStorage("UpdateState", state(0, []), newTrimState())).toBeNull();
  });

  test("once a real PlaylistId was stored, a later 0 is kept: only the leading menu states carry nothing", () => {
    const seen = newTrimState();
    trimForStorage("UpdateState", state(2, []), seen);
    expect(trimForStorage("UpdateState", state(0, []), seen)).toEqual(state(0, []));
  });

  test("Players entries that aren't objects are passed through, not thrown on", () => {
    const data = { Game: { PlaylistId: 2 }, Players: [null, 5, { PrimaryId: "p1", Loadout: ["x"] }] };
    expect(trimForStorage("UpdateState", data, newTrimState())).toEqual(data);
  });

  test("leaves other events untouched", () => {
    const data = { Players: [{ Name: "x" }], Ball: {} };
    expect(trimForStorage("BallHit", data, newTrimState())).toBe(data);
  });

  test("does not mutate the input", () => {
    const data = state(2, [{ PrimaryId: "p1", Loadout: ["x"] }]);
    const seen = { ...newTrimState(), loadoutSeen: new Set(["p1"]) };
    trimForStorage("UpdateState", data, seen);
    expect(data.Players[0]).toEqual({ PrimaryId: "p1", Loadout: ["x"] });
  });
});
