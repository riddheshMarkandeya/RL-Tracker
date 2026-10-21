// Dev tool: what the working tree's rules would change in the stored records. Recomputes every
// match from the data dir's raw.db into a scratch tracker.db, then compares it with the data
// dir's tracker.db. Both are opened read-only: the data dir gets only the `rules/diff_*` log lines
// (and the empty WAL side files a read-only open leaves).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../db/migrate";
import { trackerMigrations } from "../db/migrations";
import { openDb, type Db } from "../db/sqlite";
import { createLogger, type Logger } from "../log";
import { createRawStore } from "../recorder/store";
import { RULES, type Rule } from "../rules/registry";
import { recomputeAll, type RecomputeResult } from "./recompute";

/** Each compared table, with its key columns; the match guid comes first. An `idx` key column is an order. */
export const TABLES: readonly { name: string; key: readonly string[] }[] = [
  { name: "matches", key: ["guid"] },
  { name: "match_players", key: ["match_guid", "player_key"] },
  { name: "match_goals", key: ["match_guid", "idx"] },
  { name: "match_player_statfeed", key: ["match_guid", "player_key", "event_name"] },
];

/** Compared on their own terms rather than as moved values. */
const SPECIAL = new Set(["matches.check_flags", "matches.rule_versions"]);

export interface ColumnMove {
  /** "table.column". */
  column: string;
  moved: number;
  /** Over the moved rows that are numbers on both sides; null when none are. */
  maxAbsDelta: number | null;
  meanDelta: number | null;
  /** Moved rows in a match where none of the column's listed rules changed version, was added or was removed. */
  rowsUnbumped: number;
  /** The rules whose `outputs` name it; empty when no rule claims it. */
  owners: readonly string[];
}

export interface RecordsDiff {
  moved: ColumnMove[];
  /** Rows by table that only one side has, outside the kept matches. */
  onlyBase: Record<string, number>;
  onlyNext: Record<string, number>;
  /**
   * By positional table: matches with rows added or dropped. Their values there aren't compared
   * column by column (later rows shifted); the match still counts as changed.
   */
  reshaped: Record<string, number>;
  /** By check id: the matches that gained or lost the flag. */
  flags: Record<string, { gained: string[]; lost: string[] }>;
  /** By rule id: the matches whose version of it changed or that gained or lost it. */
  ruleVersions: Record<string, number>;
  /** Base matches with no rule versions (recorded before they were stored): no bump check. */
  unversioned: number;
  /** Base matches the recompute didn't write (skipped, or no raw events left); their record stands. */
  kept: string[];
  /**
   * Matches, sorted, whose stored values changed while no rule changed version, was added or was
   * removed: a rule changed without a bump, or what moved has no rule yet.
   */
  unbumped: string[];
  /**
   * Moved columns none of whose listed rules was bumped, or that no rule lists, whatever else was
   * bumped: worth a look, not an error. The lists are best-effort, since rules feed each other and
   * a bumped rule can move columns it doesn't list.
   */
  toReview: string[];
}

type Row = Record<string, unknown>;
type Versions = Record<string, number> | null;

const columnsOf = (db: Db, table: string) => db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name);

/** A table's rows by key, in key order, so the per-match lists (flags, kept) are in guid order. */
function keyed(db: Db, table: string, key: readonly string[]): Map<string, Row> {
  return new Map(db.all<Row>(`SELECT * FROM ${table} ORDER BY ${key.join(", ")}`).map((r) => [JSON.stringify(key.map((k) => r[k])), r]));
}

function parseVersions(v: unknown): Versions {
  return typeof v === "string" ? (JSON.parse(v) as Record<string, number>) : null;
}

/** The rule ids whose versions differ between two maps, or that one lacks; null when the base's are unknown. */
function changedRules(base: Versions, next: Versions): Set<string> | null {
  if (base === null) return null;
  const ids = new Set([...Object.keys(base), ...Object.keys(next ?? {})]);
  return new Set([...ids].filter((id) => base[id] !== next?.[id]));
}

const flagsOf = (r: Row | undefined) => new Set(typeof r?.check_flags === "string" ? (JSON.parse(r.check_flags) as string[]) : []);

function ownersByColumn(rules: readonly Rule[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const r of rules) for (const out of r.outputs ?? []) owners.set(out, [...(owners.get(out) ?? []), r.id]);
  return owners;
}

/** Per common match, by guid: the rule ids whose version changed, or that one side lacks; null when the base's are unknown. */
type Changed = Map<string, Set<string> | null>;

/** One table's keyed rows on both sides, and what decides which are compared and how. */
interface TableRows {
  b: Map<string, Row>;
  n: Map<string, Row>;
  guidOf: (r: Row) => string;
  /** Matches on both sides whose positional rows were added or dropped: not compared here. */
  reshaped: Set<string>;
  changed: Changed;
}

/** How one column moved over a table's compared rows, and in which matches; null when it didn't. */
function moveOf({ b, n, guidOf, reshaped, changed }: TableRows, table: string, col: string, owners: string[]): { move: ColumnMove; guids: Set<string> } | null {
  const guids = new Set<string>();
  let moved = 0;
  let rowsUnbumped = 0;
  let numeric = 0;
  let sum = 0;
  let maxAbs = 0;
  for (const [k, br] of b) {
    const nr = n.get(k);
    const guid = guidOf(br);
    if (!nr || reshaped.has(guid) || br[col] === nr[col]) continue;
    moved++;
    guids.add(guid);
    const [bv, nv] = [br[col], nr[col]];
    if (typeof bv === "number" && typeof nv === "number") {
      numeric++;
      sum += nv - bv;
      maxAbs = Math.max(maxAbs, Math.abs(nv - bv));
    }
    // No matches row on either side means unknown versions, like a null map.
    const rulesChanged = changed.get(guid) ?? null;
    if (rulesChanged !== null && !owners.some((w) => rulesChanged.has(w))) rowsUnbumped++;
  }
  if (!moved) return null;
  return { move: { column: `${table}.${col}`, moved, maxAbsDelta: numeric ? maxAbs : null, meanDelta: numeric ? sum / numeric : null, rowsUnbumped, owners }, guids };
}

/** Compares two trackers' records, `base` as stored and `next` as recomputed. */
export function diffRecords(base: Db, next: Db, rules: readonly Rule[] = RULES): RecordsDiff {
  const diff: RecordsDiff = { moved: [], onlyBase: {}, onlyNext: {}, reshaped: {}, flags: {}, ruleVersions: {}, unversioned: 0, kept: [], unbumped: [], toReview: [] };
  const baseMatches = keyed(base, "matches", ["guid"]);
  const nextMatches = keyed(next, "matches", ["guid"]);
  const kept = new Set<string>();
  const touched = new Set<string>();

  // Per base match: kept if it wasn't recomputed; else which rules changed version, and its flags.
  const changed: Changed = new Map();
  for (const [k, b] of baseMatches) {
    const guid = String(b.guid);
    const n = nextMatches.get(k);
    if (!n) {
      kept.add(guid);
      continue;
    }
    const rulesChanged = changedRules(parseVersions(b.rule_versions), parseVersions(n.rule_versions));
    changed.set(guid, rulesChanged);
    if (rulesChanged === null) diff.unversioned++;
    for (const id of rulesChanged ?? []) diff.ruleVersions[id] = (diff.ruleVersions[id] ?? 0) + 1;
    const [bf, nf] = [flagsOf(b), flagsOf(n)];
    for (const f of nf) {
      if (bf.has(f)) continue;
      (diff.flags[f] ??= { gained: [], lost: [] }).gained.push(guid);
      touched.add(guid);
    }
    for (const f of bf) {
      if (nf.has(f)) continue;
      (diff.flags[f] ??= { gained: [], lost: [] }).lost.push(guid);
      touched.add(guid);
    }
  }
  diff.kept = [...kept];

  const owners = ownersByColumn(rules);
  for (const { name, key } of TABLES) {
    // An `idx` key is an order: a row added or dropped shifts every later one.
    const positional = key.includes("idx");
    const baseCols = columnsOf(base, name);
    const n = name === "matches" ? nextMatches : keyed(next, name, key);
    // An older schema without the table: every recomputed row is new.
    if (!baseCols.length) {
      if (n.size) diff.onlyNext[name] = n.size;
      continue;
    }
    const b = name === "matches" ? baseMatches : keyed(base, name, key);
    const guidOf = (r: Row) => String(r[key[0] ?? ""]);
    const onlyBase = [...b].filter(([k, r]) => !n.has(k) && !kept.has(guidOf(r))).map(([, r]) => guidOf(r));
    const onlyNext = [...n].filter(([k]) => !b.has(k)).map(([, r]) => guidOf(r));
    if (onlyBase.length) diff.onlyBase[name] = onlyBase.length;
    if (onlyNext.length) diff.onlyNext[name] = onlyNext.length;
    // Rows added or dropped in a match on both sides change it.
    const rowsChanged = [...onlyBase, ...onlyNext].filter((g) => changed.has(g));
    for (const g of rowsChanged) touched.add(g);
    // In a positional table its later rows shifted, so its values there aren't compared.
    const reshaped = new Set(positional ? rowsChanged : []);
    if (reshaped.size) diff.reshaped[name] = reshaped.size;
    const rows: TableRows = { b, n, guidOf, reshaped, changed };
    const nextCols = new Set(columnsOf(next, name));
    for (const col of baseCols.filter((c) => nextCols.has(c) && !key.includes(c) && !SPECIAL.has(`${name}.${c}`))) {
      const found = moveOf(rows, name, col, owners.get(`${name}.${col}`) ?? []);
      if (!found) continue;
      const { move, guids } = found;
      diff.moved.push(move);
      for (const g of guids) touched.add(g);
      // An unlisted column is reviewed even when some rule was bumped: that bump can hide another, unbumped change.
      if (!move.rowsUnbumped) continue;
      const why = move.owners.length ? `with none of its listed rules bumped (${move.owners.join(", ")})` : "and no rule lists it";
      diff.toReview.push(`${move.column} moved in ${String(move.rowsUnbumped)} row(s) ${why}`);
    }
  }
  // Known versions, none changed, yet a changed value: a rule changed without a bump, or what moved has no rule.
  diff.unbumped = [...touched].filter((g) => changed.get(g)?.size === 0).sort();
  return diff;
}

/** Whether any stored value would change; rule versions alone don't count. */
export const hasChanges = (d: RecordsDiff) =>
  d.moved.length > 0 || Object.keys(d.onlyBase).length > 0 || Object.keys(d.onlyNext).length > 0 || Object.keys(d.flags).length > 0;

export interface RulesDiffReport {
  diff: RecordsDiff;
  recompute: RecomputeResult;
  /** Kept matches that still have raw events (recompute skipped them, or they failed), and those with none. */
  kept: { skipped: number; noRaw: number };
  /** Matches retention thinned: a dense rule's change can't move their frozen columns. */
  thinned: number;
  /** The scratch dir, kept only when a match failed to recompute: its tracker.log says why. */
  scratchDir: string | null;
}

const C = "rules";

/**
 * Recomputes the data dir `dir`'s matches under the working tree's rules into a scratch DB and
 * diffs them with its stored records. Throws when the data dir's DBs can't be opened, or the
 * scratch DB or the diff fails; the scratch dir is then removed.
 */
export function runRulesDiff({ dir, logger }: { dir: string; logger: Logger }): RulesDiffReport {
  const started = performance.now();
  let raw: Db | null = null;
  let base: Db | null = null;
  let next: Db | null = null;
  let scratchDir: string | null = null;
  let keepScratch = false;
  try {
    raw = openDb(join(dir, "raw.db"), { readonly: true });
    base = openDb(join(dir, "tracker.db"), { readonly: true });
    const store = createRawStore(raw);
    const rawGuids = new Set(store.matches().map((m) => m.guid));
    logger.info(C, "diff_started", { dir, matches: rawGuids.size });
    scratchDir = mkdtempSync(join(tmpdir(), "rltracker-rules-diff-"));
    // Recompute, the writer and the migration log here, so the data dir's log gets no line about the scratch DB.
    const scratchLogger = createLogger({ dir: scratchDir, echo: false });
    // A throwaway DB: no fsync per recomputed match.
    next = openDb(join(scratchDir, "tracker.db"), { synchronous: "normal" });
    migrate(next, "tracker", trackerMigrations, { logger: scratchLogger });
    const recompute = recomputeAll({ raw, tracker: next, logger: scratchLogger });
    const diff = diffRecords(base, next);
    const skipped = diff.kept.filter((g) => rawGuids.has(g)).length;
    // Kept for a failed match, whose recompute_failed line is in the scratch log; the report prints its path.
    const failed = recompute.failed > 0;
    const thinned = [...rawGuids].filter((g) => store.thinnedOutputs(g) !== undefined).length;
    const report: RulesDiffReport = { diff, recompute, kept: { skipped, noRaw: diff.kept.length - skipped }, thinned, scratchDir: failed ? scratchDir : null };
    logger.info(C, "diff_done", {
      recomputed: recompute.written,
      skipped: recompute.skipped,
      failed: recompute.failed,
      thinned,
      moved: Object.fromEntries(diff.moved.map((m) => [m.column, m.moved])),
      unbumped: diff.unbumped,
      toReview: diff.toReview,
      scratchLog: failed ? join(scratchDir, "tracker.log") : null,
      ms: Math.round(performance.now() - started),
    });
    keepScratch = failed;
    return report;
  } catch (err) {
    logger.error(C, "diff_failed", { dir, err });
    throw err;
  } finally {
    // Closed before the removal: Windows won't delete an open DB file.
    next?.close();
    raw?.close();
    base?.close();
    if (scratchDir && !keepScratch) {
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn(C, "diff_cleanup_failed", { scratchDir, err });
      }
    }
  }
}

const fmt = (n: number | null) => (n === null ? "" : String(Math.round(n * 100) / 100));

/** The report as plain text for the terminal. */
export function formatReport({ diff, recompute, kept, thinned, scratchDir }: RulesDiffReport): string {
  const out: string[] = [];
  const skipped = Object.entries(recompute.skipped).map(([k, v]) => `${k} ${String(v)}`);
  out.push(`recomputed ${String(recompute.written)}, failed ${String(recompute.failed)}${skipped.length ? `, skipped: ${skipped.join(", ")}` : ""}`);
  if (kept.skipped + kept.noRaw) out.push(`kept as stored: ${String(kept.skipped)} not recomputed (skipped or failed), ${String(kept.noRaw)} with no raw events`);
  if (thinned) out.push(`thinned: ${String(thinned)} matches (car stats and camera frozen at thinning)`);
  if (scratchDir) out.push(`a match failed to recompute: see recompute_failed in ${join(scratchDir, "tracker.log")}`);
  if (!hasChanges(diff)) out.push("no change");
  const owned = diff.moved.filter((m) => m.owners.length);
  const unowned = diff.moved.filter((m) => !m.owners.length);
  const table = (rows: ColumnMove[]) => rows.map((m) => `  ${m.column}: ${String(m.moved)} row(s)${m.maxAbsDelta === null ? "" : `, max |Δ| ${fmt(m.maxAbsDelta)}, mean Δ ${fmt(m.meanDelta)}`}`);
  if (owned.length) out.push("moved:", ...table(owned));
  if (unowned.length) out.push("moved, no owning rule:", ...table(unowned));
  const reshaped = Object.entries(diff.reshaped);
  if (reshaped.length) out.push(`rows added or dropped, values not compared: ${reshaped.map(([t, n]) => `${t} in ${String(n)} match(es)`).join(", ")}`);
  for (const [side, rows] of [["only in the stored records", diff.onlyBase], ["only in the recompute", diff.onlyNext]] as const) {
    const entries = Object.entries(rows);
    if (entries.length) out.push(`${side}: ${entries.map(([t, n]) => `${t} ${String(n)}`).join(", ")}`);
  }
  for (const [id, { gained, lost }] of Object.entries(diff.flags)) out.push(`flag ${id}: +${String(gained.length)} ${gained.join(" ")} / -${String(lost.length)} ${lost.join(" ")}`);
  const versions = Object.entries(diff.ruleVersions);
  if (versions.length) out.push(`rule versions changed: ${versions.map(([id, n]) => `${id} (${String(n)} matches)`).join(", ")}`);
  if (diff.unversioned) out.push(`${String(diff.unversioned)} stored match(es) have no rule versions: no bump check for them`);
  for (const r of diff.toReview) out.push(`review: ${r}`);
  if (diff.unbumped.length) {
    const shown = diff.unbumped.slice(0, 5).join(" ") + (diff.unbumped.length > 5 ? " …" : "");
    out.push(`WARNING: ${String(diff.unbumped.length)} match(es) changed with no rule version bumped (all in rules/diff_done): ${shown}`);
    out.push("  bump the rule that changed, or add a recorded rule for what moved if none covers it");
  }
  return out.join("\n");
}
