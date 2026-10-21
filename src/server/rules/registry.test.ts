import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { migrate } from "../db/migrate";
import { trackerMigrations } from "../db/migrations";
import { openDb, type Db } from "../db/sqlite";
import { CHECK_IDS } from "../recorder/checks";
import { PLAYER_EXTRAS } from "../recorder/extras";
import { memoryLogger } from "../testing";
import { pinsOf, renderDefinitions, unbumpedConstants, type Pins } from "./definitions";
import { DENSE_PLAYER_COLUMNS, DENSE_RULE_IDS, MIXED_WITH_DENSE, RECORDED_RULE_VERSIONS, RULES } from "./registry";

const ROOT = join(import.meta.dirname, "..", "..", "..");

let dir: string;
let tracker: Db;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-registry-"));
  tracker = openDb(join(dir, "tracker.db"));
  migrate(tracker, "tracker", trackerMigrations, { logger: memoryLogger() });
});
afterAll(() => {
  tracker.close();
  rmSync(dir, { recursive: true, force: true });
});

const columnsOf = (table: string) => tracker.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name);

describe("the rule registry", () => {
  test("has rules, with unique snake_case ids and versions from 1", () => {
    expect(RULES.length).toBeGreaterThan(0);
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      expect(Number.isInteger(r.version) && r.version >= 1, r.id).toBe(true);
      expect(r.rule.trim(), r.id).not.toBe("");
      expect(r.evidence.trim(), r.id).not.toBe("");
    }
  });

  test("names only real checks, and every check guards a rule", () => {
    const named = new Set(RULES.flatMap((r) => r.checks));
    expect([...named].filter((id) => !CHECK_IDS.includes(id))).toEqual([]);
    expect(CHECK_IDS.filter((id) => !named.has(id))).toEqual([]);
  });

  test("gives every extra stat a rule that writes it", () => {
    const written = new Set(RULES.flatMap((r) => r.outputs ?? []));
    expect(PLAYER_EXTRAS.map((e) => `match_players.${e.column}`).filter((c) => !written.has(c))).toEqual([]);
  });

  test("lists outputs only on recorded rules, and each is a real column", () => {
    for (const r of RULES) {
      if (r.applied !== "recorded") expect(r.outputs ?? [], r.id).toEqual([]);
      for (const out of r.outputs ?? []) {
        const [table = "", column = ""] = out.split(".");
        expect(columnsOf(table), `${r.id}: ${out}`).toContain(column);
      }
    }
  });

  test("a recorded rule without outputs is one that only decides which records exist, or a flag", () => {
    // A new recorded rule lists its columns, so rules-diff can say which rule a moved column needs reviewed under.
    const none = RULES.filter((r) => r.applied === "recorded" && !r.outputs?.length).map((r) => r.id);
    expect(none.sort()).toEqual(["last_touch_comparison", "lobby_no_record", "only_latest_match_open", "pending_guess"]);
  });

  test("refs point at files that exist", () => {
    for (const r of RULES) {
      expect(r.refs.length, r.id).toBeGreaterThan(0);
      for (const ref of r.refs) expect(existsSync(join(ROOT, ref)), `${r.id}: ${ref}`).toBe(true);
    }
  });

  test("the recorded versions are exactly the recorded rules", () => {
    expect(RECORDED_RULE_VERSIONS).toEqual(Object.fromEntries(RULES.filter((r) => r.applied === "recorded").map((r) => [r.id, r.version])));
  });

  describe("dense rules", () => {
    // What a thinned match's snapshot holds: its car stats per player, and the camera's key.
    const snapshot = ["match_players.car_ms", "match_players.boost_avg", "match_players.supersonic_ms", "match_players.empty_boost_ms", "matches.camera_primary_id"];

    test("are the car and camera rules, recorded, and write only what the snapshot holds", () => {
      expect([...DENSE_RULE_IDS].sort()).toEqual(["camera_identity", "car_sampling", "car_stats"]);
      expect([...DENSE_PLAYER_COLUMNS].sort()).toEqual(["boost_avg", "car_ms", "empty_boost_ms", "supersonic_ms"]);
      for (const r of RULES.filter((x) => x.dense)) {
        expect(r.applied, r.id).toBe("recorded");
        expect((r.outputs ?? []).filter((o) => !snapshot.includes(o)), r.id).toEqual([]);
        expect(r.checks, r.id).toContain("thinned_snapshot_on_roster");
      }
    });

    test("every other rule feeding the snapshot is listed as mixed, and only those and player_key are", () => {
      const feeding = RULES.filter((r) => !r.dense && (r.outputs ?? []).some((o) => snapshot.includes(o))).map((r) => r.id);
      expect([...MIXED_WITH_DENSE].sort()).toEqual([...feeding, "player_key"].sort());
    });
  });

  test("docs/definitions.md is generated from it", () => {
    const file = readFileSync(join(ROOT, "docs", "definitions.md"), "utf8").replace(/\r\n/g, "\n");
    expect(file, "docs/definitions.md is out of date: run `bun run definitions`").toBe(renderDefinitions(RULES));
  });

  test("no rule's constants changed without a version bump, and the pins are current", () => {
    const pins = JSON.parse(readFileSync(join(import.meta.dirname, "constant-pins.json"), "utf8")) as Pins;
    expect(unbumpedConstants(RULES, pins), "constants changed or unlisted without a version bump: bump these rules").toEqual([]);
    expect(pins, "constant-pins.json is out of date: run `bun run definitions`").toEqual(pinsOf(RULES));
  });
});
