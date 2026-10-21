import { RETENTION_DAYS } from "../../shared/constants";
import type { Logger } from "../log";
import { readableAs, readMatch } from "../recorder/read-match";
import { createRawStore, type ThinnedOutputs } from "../recorder/store";
import type { MatchSummary } from "../recorder/summary";
import { statesToDrop } from "../recorder/thin";
import { DENSE_PLAYER_COLUMNS, DENSE_RULE_IDS, RECORDED_RULE_VERSIONS } from "../rules/registry";
import type { Db } from "./sqlite";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Pages returned per incremental_vacuum step: 16 MB at the default 4 KB page size. */
const VACUUM_PAGES = 4096;

const setImmediateYield = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

export interface RetentionOptions {
  now: () => Date;
  /** True while a match is being recorded; retention gives way to it. */
  isRecording: () => boolean;
  /** True once the app is shutting down; the run stops at the next match boundary. */
  stopping?: () => boolean;
  logger: Logger;
  /** Lets other work run between matches. */
  yieldFn?: () => Promise<void>;
  vacuumPages?: number;
}

export interface RetentionResult {
  /** skipped: recording when it began; stopped: recording started, or shutdown began, part-way. */
  status: "done" | "skipped" | "stopped";
  thinned: number;
  exempt: number;
  /** Not a record (lobby, open, trimmed), so nothing to snapshot from. */
  keptWhole: number;
  /** readMatch threw; retried next run. */
  failed: number;
  /** UpdateStates deleted. */
  states: number;
}

const C = "retention";

type Versions = Readonly<Record<string, number>>;

/** Key by key, so reordering the registry doesn't count as a change. */
const sameVersions = (a: Versions, b: Versions) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/** The dense outputs the thinned events can't give back; keys with no value are left out. */
function snapshotOf(summary: MatchSummary): ThinnedOutputs["outputs"] {
  const players: ThinnedOutputs["outputs"]["players"] = {};
  for (const [key, values] of Object.entries(summary.extras?.players ?? {})) {
    const dense = Object.fromEntries(DENSE_PLAYER_COLUMNS.map((c) => [c, values[c] ?? null]));
    if (Object.values(dense).some((v) => v !== null)) players[key] = dense;
  }
  return { cameraKey: summary.cameraKey, players, denseRules: [...DENSE_RULE_IDS] };
}

/**
 * Past RETENTION_DAYS, thins each whole match (its last event past the cutoff) to the UpdateStates
 * the scoreboard rules need, after snapshotting what the rest gave the dense rules; every other
 * event is kept forever. A match flagged under the current rules stays whole as the rule corpus,
 * re-checked only when the recorded rule versions change. Then returns the freed pages to the
 * filesystem. Logs and rethrows a SQLite failure.
 */
export async function runRetention(raw: Db, opts: RetentionOptions): Promise<RetentionResult> {
  const { now, isRecording, stopping = () => false, logger, yieldFn = setImmediateYield } = opts;
  const { vacuumPages = VACUUM_PAGES } = opts;
  const started = performance.now();
  const counts: Omit<RetentionResult, "status"> = { thinned: 0, exempt: 0, keptWhole: 0, failed: 0, states: 0 };
  /** Lets other work run, then says why the run must stop, if it must. */
  const pause = async (): Promise<"recording" | "shutdown" | undefined> => {
    await yieldFn();
    if (stopping()) return "shutdown";
    return isRecording() ? "recording" : undefined;
  };
  const stop = (reason: "recording" | "shutdown"): RetentionResult => {
    // Deleted rows' pages stay on the freelist; the next run's vacuum returns them.
    logger.info(C, "stopped", { reason, ...counts });
    return { status: "stopped", ...counts };
  };
  const freePages = () => raw.pragma("freelist_count") as number;
  const store = createRawStore(raw);
  const decidedAt = () => now().getTime();
  const versionsJson = JSON.stringify(RECORDED_RULE_VERSIONS);

  /** One match past the cutoff: kept whole, exempt or thinned. */
  function decide(guid: string, minSeq: number): void {
    const r = readableAs(store, guid, minSeq);
    if ("unreadable" in r) {
      counts.keptWhole++;
      // A lost close marker or a cut start is a shape to fit when one appears; a lobby is small.
      logger[r.unreadable === "lobby" ? "info" : "warn"](C, "kept_whole", { guid, reason: r.unreadable });
      return;
    }
    // Read outside the deleting transaction: it has a close marker, so no event can still arrive.
    const events = store.matchEvents(guid);
    let summary: MatchSummary;
    try {
      // Without thinnedOutputs: the match isn't thinned yet, so the events are whole.
      summary = readMatch({ matchEvents: () => events }, guid, r.via).summary;
    } catch (err) {
      // Broad on purpose: whatever one match's data breaks, it stays whole and the rest go on.
      counts.failed++;
      logger.error(C, "thin_failed", { guid, err });
      return;
    }
    if (summary.flags.length) {
      raw.run(
        "INSERT OR REPLACE INTO retention_matches (match_guid, status, decided_at, rule_versions, flags) VALUES (?, 'exempt', ?, ?, ?)",
        guid,
        decidedAt(),
        versionsJson,
        JSON.stringify(summary.flags),
      );
      counts.exempt++;
      logger.info(C, "exempt", { guid, flags: summary.flags });
      return;
    }
    const t0 = performance.now();
    const drop = new Set(statesToDrop(events));
    const states = events.filter((e) => e.name === "UpdateState");
    const bytes = states.filter((e) => drop.has(e.seq)).reduce((sum, e) => sum + JSON.stringify(e.data).length, 0);
    raw.transaction(() => {
      for (const seq of drop) raw.run("DELETE FROM events WHERE match_guid = ? AND seq = ?", guid, seq);
      raw.run(
        "INSERT OR REPLACE INTO retention_matches (match_guid, status, decided_at, rule_versions, outputs, states_before, states_after) VALUES (?, 'thinned', ?, ?, ?, ?, ?)",
        guid,
        decidedAt(),
        versionsJson,
        JSON.stringify(snapshotOf(summary)),
        states.length,
        states.length - drop.size,
      );
    });
    counts.thinned++;
    counts.states += drop.size;
    logger.info(C, "thinned", { guid, before: states.length, after: states.length - drop.size, kb: Math.round(bytes / 1024), ms: Math.round(performance.now() - t0) });
  }

  try {
    if (isRecording()) {
      logger.info(C, "skipped_recording");
      return { status: "skipped", ...counts };
    }
    const cutoff = now().getTime() - RETENTION_DAYS * DAY_MS;
    // Whole matches only, so retention never splits one. Lobbies, open and trimmed matches get no
    // row and are re-scanned each run; cheap at this scale.
    const candidates = raw.all<{ guid: string; minSeq: number; status: string | null; versions: string | null }>(
      `SELECT e.match_guid AS guid, MIN(e.seq) AS minSeq, r.status AS status, r.rule_versions AS versions
       FROM events e LEFT JOIN retention_matches r ON r.match_guid = e.match_guid
       WHERE r.status IS NOT 'thinned'
       GROUP BY e.match_guid HAVING MAX(e.ts) < ? ORDER BY MIN(e.id)`,
      cutoff,
    );
    for (const c of candidates) {
      if (c.status === "exempt" && sameVersions(JSON.parse(c.versions ?? "{}") as Versions, RECORDED_RULE_VERSIONS)) continue;
      decide(c.guid, c.minSeq);
      const reason = await pause();
      if (reason) return stop(reason);
    }
    // In steps, so a large backlog can't block the event loop in one go. Counting the freelist,
    // re-read after each pause, keeps the recorder's inserts between steps out of the figure.
    let vacuumed = 0;
    for (;;) {
      const free = freePages();
      if (free === 0) break;
      raw.run(`PRAGMA incremental_vacuum(${String(vacuumPages)})`);
      const left = freePages();
      vacuumed += free - left;
      if (left === free) {
        // Without incremental auto_vacuum the pragma frees nothing, and the file never shrinks.
        logger.warn(C, "vacuum_noop", { freePages: left, autoVacuum: raw.pragma("auto_vacuum") });
        break;
      }
      if (left === 0) break;
      const reason = await pause();
      if (reason) return stop(reason);
    }
    const mb = Math.round(((vacuumed * (raw.pragma("page_size") as number)) / 1024 / 1024) * 100) / 100;
    logger.info(C, "done", { candidates: candidates.length, ...counts, mb, ms: Math.round(performance.now() - started) });
    return { status: "done", ...counts };
  } catch (err) {
    logger.error(C, "failed", { ...counts, err });
    throw err;
  }
}
