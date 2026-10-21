import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../db/migrate";
import { trackerMigrations } from "../db/migrations";
import { openDb, type Db, type Param } from "../db/sqlite";
import { feed } from "../recorder/feed";
import { createRecorder } from "../recorder/recorder";
import type { Rule } from "../rules/registry";
import { openStorage } from "../storage";
import { memoryLogger, readFixture } from "../testing";
import { toRecord } from "./record";
import { createRecordWriter } from "./save";
import { diffRecords, formatReport, hasChanges, runRulesDiff, TABLES } from "./rules-diff";

let dir: string;
const open: Db[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-rules-diff-"));
});
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  rmSync(dir, { recursive: true, force: true });
});

function tracker(name: string, migrations = trackerMigrations): Db {
  const d = openDb(join(dir, `${name}.db`));
  open.push(d);
  migrate(d, name, migrations, { logger: memoryLogger() });
  return d;
}

const VERSIONS = { aerial_touch: 1, touch_merge: 1, winner: 1 };

function insert(d: Db, table: string, row: Record<string, Param>): void {
  const cols = Object.keys(row);
  d.run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...Object.values(row));
}

/** One match with two players and a goal; `versions` null leaves rule_versions out (an older schema). */
function seed(d: Db, guid: string, over: { flags?: string[]; versions?: Record<string, number> | null; aerial?: [number, number]; winner?: number } = {}): void {
  const { flags = [], versions = VERSIONS, aerial = [2, 0], winner = 0 } = over;
  insert(d, "matches", {
    guid,
    started_at: 1,
    ended_at: 2,
    end_kind: "completed",
    closed_via: "destroyed",
    joined_in_progress: 0,
    overtime: 0,
    winner_team_num: winner,
    check_flags: JSON.stringify(flags),
    ...(versions === null ? {} : { rule_versions: JSON.stringify(versions) }),
  });
  aerial.forEach((n, i) => {
    insert(d, "match_players", {
      match_guid: guid,
      player_key: `p${String(i)}`,
      primary_id: `p${String(i)}`,
      name: `p${String(i)}`,
      is_bot: 0,
      team_num: i,
      teams_seen: 1 << i,
      present_at_end: 1,
      score: 100,
      goals: 0,
      shots: 0,
      assists: 0,
      saves: 0,
      touches: 10,
      demos: 0,
      aerial_touches: n,
    });
  });
  insert(d, "match_goals", { match_guid: guid, idx: 0, team_num: 0, scorer_key: "p0", deflected: 0, aerial: 0, own_goal: 0 });
}

const rule = (id: string, outputs: string[]): Rule => ({ id, area: "extras", rule: "r", checks: [], evidence: "e", version: 1, applied: "recorded", outputs, refs: [] });
const RULES = [rule("aerial_touch", ["match_players.aerial_touches"]), rule("touch_merge", ["match_players.aerial_touches"]), rule("winner", ["matches.winner_team_num"])];

describe("diffRecords", () => {
  test("identical records: no change", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    seed(next, "A");
    const diff = diffRecords(base, next, RULES);
    expect(hasChanges(diff)).toBe(false);
    expect(diff).toMatchObject({ moved: [], onlyBase: {}, onlyNext: {}, flags: {}, ruleVersions: {}, kept: [], unbumped: [] });
  });

  test("a moved stat: its column, rows moved and the change", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A", { aerial: [2, 0] });
    seed(base, "B", { aerial: [4, 1] });
    seed(next, "A", { aerial: [3, 0], versions: { ...VERSIONS, aerial_touch: 2 } });
    seed(next, "B", { aerial: [1, 1], versions: { ...VERSIONS, aerial_touch: 2 } });
    const diff = diffRecords(base, next, RULES);
    expect(hasChanges(diff)).toBe(true);
    expect(diff.moved).toEqual([{ column: "match_players.aerial_touches", moved: 2, maxAbsDelta: 3, meanDelta: -1, rowsUnbumped: 0, owners: ["aerial_touch", "touch_merge"] }]);
    expect(diff.ruleVersions).toEqual({ aerial_touch: 2 });
    expect(diff.unbumped).toEqual([]);
  });

  test("a flag gained and one lost, per match", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A", { flags: ["mvp_count"] });
    seed(next, "A", { flags: ["touches_resolved"] });
    expect(diffRecords(base, next, RULES).flags).toEqual({ touches_resolved: { gained: ["A"], lost: [] }, mvp_count: { gained: [], lost: ["A"] } });
  });

  test("rows only in one side are counted per table, outside kept matches", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    seed(next, "A");
    insert(next, "match_goals", { match_guid: "A", idx: 1, team_num: 1, scorer_key: "p1", deflected: 0, aerial: 0, own_goal: 0 });
    seed(next, "N");
    expect(diffRecords(base, next, RULES)).toMatchObject({ onlyBase: {}, onlyNext: { match_goals: 2, matches: 1, match_players: 2 } });
  });

  test("a base match recompute didn't write is kept, not missing", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    seed(base, "OLD");
    seed(next, "A");
    const diff = diffRecords(base, next, RULES);
    expect(diff.kept).toEqual(["OLD"]);
    expect(diff.onlyBase).toEqual({});
    expect(hasChanges(diff)).toBe(false);
  });

  describe("bump guard", () => {
    test("warns when a match changed and no rule was bumped, and lists the column to review", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A", { aerial: [2, 0] });
      seed(next, "A", { aerial: [3, 0] });
      const diff = diffRecords(base, next, RULES);
      expect(diff.moved[0]).toMatchObject({ column: "match_players.aerial_touches", rowsUnbumped: 1 });
      expect(diff.unbumped).toEqual(["A"]);
      expect(diff.toReview).toEqual(["match_players.aerial_touches moved in 1 row(s) with none of its listed rules bumped (aerial_touch, touch_merge)"]);
    });

    test("a bump of another rule: no warning, only the column to review", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A", { aerial: [2, 0] });
      seed(next, "A", { aerial: [3, 0], versions: { ...VERSIONS, winner: 2 } });
      const diff = diffRecords(base, next, RULES);
      expect(diff.unbumped).toEqual([]);
      expect(diff.toReview).toHaveLength(1);
    });

    test("is silent when one of several listed rules was bumped", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A", { aerial: [2, 0] });
      seed(next, "A", { aerial: [3, 0], versions: { ...VERSIONS, touch_merge: 2 } });
      expect(diffRecords(base, next, RULES)).toMatchObject({ unbumped: [], toReview: [] });
    });

    test("a flag gained with no bump warns too", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A");
      seed(next, "A", { flags: ["mvp_count"] });
      expect(diffRecords(base, next, RULES).unbumped).toEqual(["A"]);
    });

    test("is silent on a base match with no versions (recorded before they were stored)", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A", { aerial: [2, 0] });
      base.run("UPDATE matches SET rule_versions = NULL");
      seed(next, "A", { aerial: [3, 0] });
      const diff = diffRecords(base, next, RULES);
      expect(diff).toMatchObject({ unbumped: [], toReview: [] });
      expect(diff.unversioned).toBe(1);
      expect(diff.ruleVersions).toEqual({});
    });

    test("a moved column no rule writes is reported apart, with no owners, and its match warns", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A");
      seed(next, "A");
      next.run("UPDATE match_players SET demos = 1 WHERE player_key = 'p0'");
      const diff = diffRecords(base, next, RULES);
      expect(diff.moved).toEqual([{ column: "match_players.demos", moved: 1, maxAbsDelta: 1, meanDelta: 1, rowsUnbumped: 1, owners: [] }]);
      expect(diff.toReview).toEqual(["match_players.demos moved in 1 row(s) and no rule lists it"]);
      expect(diff.unbumped).toEqual(["A"]);
    });

    test("a bump of another rule hides no unlisted column: it still gets a review line", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A");
      seed(next, "A", { versions: { ...VERSIONS, winner: 2 } });
      next.run("UPDATE match_players SET demos = 1 WHERE player_key = 'p0'");
      const diff = diffRecords(base, next, RULES);
      expect(diff.unbumped).toEqual([]);
      expect(diff.toReview).toEqual(["match_players.demos moved in 1 row(s) and no rule lists it"]);
    });

    test("match lists are in guid order", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      for (const g of ["B", "A"]) {
        seed(base, g, { flags: ["goal_order"] });
        seed(next, g, { flags: ["mvp_count"] });
      }
      for (const g of ["D", "C"]) seed(base, g);
      const diff = diffRecords(base, next, RULES);
      expect(diff.flags).toEqual({ mvp_count: { gained: ["A", "B"], lost: [] }, goal_order: { gained: [], lost: ["A", "B"] } });
      expect(diff.kept).toEqual(["C", "D"]);
    });

    test("a flag lost with no bump warns", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A", { flags: ["mvp_count"] });
      seed(next, "A");
      expect(diffRecords(base, next, RULES).unbumped).toEqual(["A"]);
    });

    test("a rule added or removed is a version change: no warning", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      seed(base, "A", { aerial: [2, 0], versions: { ...VERSIONS, old_rule: 1 } });
      seed(next, "A", { aerial: [3, 0], versions: { ...VERSIONS, new_rule: 1 } });
      const diff = diffRecords(base, next, RULES);
      expect(diff.ruleVersions).toEqual({ old_rule: 1, new_rule: 1 });
      expect(diff.unbumped).toEqual([]);
    });

    test("the report shows five unbumped matches and points at the log for the rest", () => {
      const [base, next] = [tracker("base"), tracker("next")];
      const guids = ["A", "B", "C", "D", "E", "F"];
      for (const g of [...guids].reverse()) {
        seed(base, g, { aerial: [2, 0] });
        seed(next, g, { aerial: [3, 0] });
      }
      const diff = diffRecords(base, next, RULES);
      expect(diff.unbumped).toEqual(guids);
      const text = formatReport({ diff, recompute: { written: 6, skipped: {}, failed: 0, ms: 0 }, kept: { skipped: 0, noRaw: 0 }, scratchDir: null });
      expect(text).toContain("WARNING: 6 match(es) changed with no rule version bumped (all in rules/diff_done): A B C D E …");
    });
  });

  test("compares every per-match table of the tracker schema", () => {
    const d = tracker("schema");
    const tables = d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    const perMatch = tables.filter((t) => t === "matches" || d.all<{ name: string }>(`SELECT name FROM pragma_table_info('${t}')`).some((c) => c.name === "match_guid"));
    expect(perMatch.sort()).toEqual(TABLES.map((t) => t.name).sort());
  });

  test("a goal added in a match is a row change there: its later goals aren't compared column by column", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    seed(base, "B");
    seed(next, "A");
    seed(next, "B");
    // In A a new goal 0 shifts the old one to idx 1; in B goal 0 moves on its own.
    next.run("UPDATE match_goals SET idx = 1, team_num = 1 WHERE match_guid = 'A'");
    insert(next, "match_goals", { match_guid: "A", idx: 0, team_num: 0, scorer_key: "p0", deflected: 1, aerial: 0, own_goal: 0 });
    next.run("UPDATE match_goals SET aerial = 1 WHERE match_guid = 'B'");
    const diff = diffRecords(base, next, RULES);
    expect(diff).toMatchObject({ onlyNext: { match_goals: 1 }, reshaped: { match_goals: 1 } });
    expect(diff.moved).toEqual([expect.objectContaining({ column: "match_goals.aerial", moved: 1 })]);
    expect(formatReport({ diff, recompute: { written: 2, skipped: {}, failed: 0, ms: 0 }, kept: { skipped: 0, noRaw: 0 }, scratchDir: null })).toContain(
      "rows added or dropped, values not compared: match_goals in 1 match(es)",
    );
  });

  test("a goal dropped is a row change too", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    insert(base, "match_goals", { match_guid: "A", idx: 1, team_num: 1, scorer_key: "p1", deflected: 0, aerial: 1, own_goal: 0 });
    seed(next, "A");
    next.run("UPDATE match_goals SET team_num = 1, scorer_key = 'p1', aerial = 1 WHERE match_guid = 'A'");
    const diff = diffRecords(base, next, RULES);
    expect(diff).toMatchObject({ onlyBase: { match_goals: 1 }, reshaped: { match_goals: 1 }, moved: [], toReview: [] });
    expect(diff.unbumped).toEqual(["A"]);
  });

  test("a player row added keeps the others compared, and a new match is no row change", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    seed(next, "A", { aerial: [5, 0] });
    insert(next, "match_players", { match_guid: "A", player_key: "p9", primary_id: "p9", name: "p9", is_bot: 0, team_num: 0, teams_seen: 1, present_at_end: 1, score: 0, goals: 0, shots: 0, assists: 0, saves: 0, touches: 0, demos: 0, aerial_touches: 0 });
    seed(next, "N");
    const diff = diffRecords(base, next, RULES);
    expect(diff.reshaped).toEqual({});
    expect(diff.onlyNext).toEqual({ matches: 1, match_players: 3, match_goals: 1 });
    expect(diff.moved).toEqual([expect.objectContaining({ column: "match_players.aerial_touches", moved: 1 })]);
  });

  test("a base schema without a table counts every recomputed row of it as new", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    seed(base, "A");
    seed(next, "A");
    base.run("DROP TABLE match_goals");
    expect(diffRecords(base, next, RULES).onlyNext).toEqual({ match_goals: 1 });
  });

  test("a row whose match has no matches row on either side gets no bump check", () => {
    const [base, next] = [tracker("base"), tracker("next")];
    for (const d of [base, next]) {
      seed(d, "A");
      d.run("DELETE FROM matches");
    }
    next.run("UPDATE match_players SET aerial_touches = 9 WHERE player_key = 'p0'");
    expect(diffRecords(base, next, RULES).unbumped).toEqual([]);
  });

  test("a base schema without a column (rule_versions) is compared over the shared ones", () => {
    const base = tracker("base", trackerMigrations.slice(0, 3));
    const next = tracker("next");
    seed(base, "A", { versions: null, winner: 0 });
    seed(next, "A", { winner: 1 });
    const diff = diffRecords(base, next, RULES);
    expect(diff.moved.map((m) => m.column)).toEqual(["matches.winner_team_num"]);
    expect(diff.unversioned).toBe(1);
    expect(diff.unbumped).toEqual([]);
  });
});

describe("runRulesDiff", () => {
  /** Records fixtures into the data dir `dir` the way the live tracker does. */
  function recordInto(names: readonly string[]): void {
    const storage = openStorage({ dir, logger: memoryLogger() });
    try {
      const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger() });
      const recorder = createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished: (s) => {
        writer.save(toRecord(s));
      } });
      for (const name of names) {
        feed(recorder, readFixture(name));
        recorder.flush();
      }
    } finally {
      storage.close();
    }
  }
  const scratchDirs = () => readdirSync(tmpdir()).filter((d) => d.startsWith("rltracker-rules-diff-") && !dir.endsWith(d));

  test("the stored records against the same rules: no change, and only its own lines logged", { timeout: 30_000 }, () => {
    recordInto(["completed", "private-series"]);
    const before = scratchDirs();
    const logger = memoryLogger();
    const report = runRulesDiff({ dir, logger });
    expect(hasChanges(report.diff)).toBe(false);
    expect(report.diff.unbumped).toEqual([]);
    expect(report.recompute).toMatchObject({ written: 2, failed: 0 });
    expect(report.scratchDir).toBeNull();
    expect(formatReport(report)).toContain("no change");
    expect(logger.events()).toEqual(["rules/diff_started", "rules/diff_done"]);
    expect(existsSync(join(dir, "tracker.log"))).toBe(false);
    expect(scratchDirs()).toEqual(before);
  });

  test("a stored value that differs from the recompute is reported, with the bump warning", { timeout: 30_000 }, () => {
    recordInto(["completed"]);
    const storage = openStorage({ dir, logger: memoryLogger() });
    storage.tracker.run("UPDATE match_players SET aerial_touches = aerial_touches + 5 WHERE player_key = (SELECT MIN(player_key) FROM match_players)");
    storage.close();
    const report = runRulesDiff({ dir, logger: memoryLogger() });
    expect(report.diff.moved).toEqual([expect.objectContaining({ column: "match_players.aerial_touches", moved: 1, maxAbsDelta: 5, meanDelta: -5, rowsUnbumped: 1 })]);
    expect(report.diff.unbumped).toHaveLength(1);
    expect(formatReport(report)).toMatch(/review: match_players.aerial_touches moved in 1 row/);
    expect(formatReport(report)).toMatch(/WARNING: 1 match\(es\) changed with no rule version bumped/);
  });

  test("a match that fails to recompute keeps the scratch dir, with its log, for the report", { timeout: 30_000 }, () => {
    recordInto(["completed"]);
    const storage = openStorage({ dir, logger: memoryLogger() });
    storage.raw.run("UPDATE events SET data = '{' WHERE id = (SELECT id FROM events WHERE name = 'UpdateState' LIMIT 1)");
    storage.close();
    const report = runRulesDiff({ dir, logger: memoryLogger() });
    try {
      expect(report.recompute.failed).toBe(1);
      expect(report.scratchDir).not.toBeNull();
      expect(readFileSync(join(report.scratchDir ?? "", "tracker.log"), "utf8")).toContain("recompute_failed");
      expect(formatReport(report)).toContain(report.scratchDir ?? "");
    } finally {
      if (report.scratchDir) rmSync(report.scratchDir, { recursive: true, force: true });
    }
  });

  test("an error after the scratch dir was made removes it", { timeout: 30_000 }, () => {
    recordInto(["completed"]);
    const storage = openStorage({ dir, logger: memoryLogger() });
    storage.tracker.run("UPDATE matches SET check_flags = 'not json'");
    storage.close();
    const before = scratchDirs();
    const logger = memoryLogger();
    expect(() => runRulesDiff({ dir, logger })).toThrow();
    expect(logger.events()).toEqual(["rules/diff_started", "rules/diff_failed"]);
    expect(scratchDirs()).toEqual(before);
  });

  test("a data dir without raw.db fails, logged, and creates nothing", () => {
    const logger = memoryLogger();
    expect(() => runRulesDiff({ dir, logger })).toThrow();
    expect(logger.events()).toEqual(["rules/diff_failed"]);
    expect(readdirSync(dir)).toEqual([]);
  });
});
