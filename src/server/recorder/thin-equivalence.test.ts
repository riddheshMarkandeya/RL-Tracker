import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runRetention } from "../db/retention";
import { toRecord, type MatchRecord } from "../records/record";
import { openStorage, type Storage } from "../storage";
import { memoryLogger, readFixture } from "../testing";
import { feed } from "./feed";
import { readableAs, readMatch } from "./read-match";
import { createRecorder } from "./recorder";
import { createRawStore, type RawStore } from "./store";

const FIXTURES = ["completed", "early-end", "overtime-leavers", "joined-in-progress", "left-early", "left-countdown", "private-series"];

let dir: string;
let storage: Storage;
let store: RawStore;
/** Each record computed from the full events, by guid. */
const full = new Map<string, MatchRecord>();
let thinned: string[];

const recordOf = (guid: string) => {
  const { minSeq } = store.matches().find((m) => m.guid === guid) ?? { minSeq: 0 };
  const r = readableAs(store, guid, minSeq);
  return "via" in r ? toRecord(readMatch(store, guid, r.via).summary) : undefined;
};

// Every fixture recorded, read, thinned and read again: slow under the full parallel suite.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-thin-eq-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  store = createRawStore(storage.raw);
  const recorder = createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished: () => undefined });
  for (const name of FIXTURES) {
    feed(recorder, readFixture(name));
    recorder.flush();
  }
  for (const { guid } of store.matches()) {
    const rec = recordOf(guid);
    if (rec) full.set(guid, rec);
  }
  const result = await runRetention(storage.raw, { now: () => new Date("2027-06-01T00:00:00Z"), isRecording: () => false, logger: memoryLogger(), yieldFn: () => Promise.resolve() });
  expect(result.status).toBe("done");
  thinned = storage.raw.all<{ g: string }>("SELECT match_guid AS g FROM retention_matches WHERE status = 'thinned'").map((r) => r.g);
}, 30_000);
afterAll(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a thinned match recomputes to its full record", () => {
  test("every record is unchanged by thinning", () => {
    expect(full.size).toBe(7);
    expect(thinned.length).toBeGreaterThan(0);
    for (const [guid, rec] of full) expect(recordOf(guid), guid).toEqual(rec);
  });

  test("the snapshot is load-bearing: without it, the thinned events give other car stats", () => {
    const completed = thinned.find((g) => full.get(g)?.match.endKind === "completed" && full.get(g)?.players.some((p) => p.extras.car_ms !== null));
    expect(completed).toBeDefined();
    const guid = completed ?? "";
    const r = readableAs(store, guid, 0);
    if (!("via" in r)) throw new Error("not readable");
    const bare = toRecord(readMatch({ matchEvents: (g) => store.matchEvents(g) }, guid, r.via).summary);
    const carStats = (rec: MatchRecord | undefined) => rec?.players.map((p) => [p.extras.car_ms, p.extras.boost_avg, p.extras.supersonic_ms, p.extras.empty_boost_ms]);
    expect(carStats(bare)).not.toEqual(carStats(full.get(guid)));
  });
});
