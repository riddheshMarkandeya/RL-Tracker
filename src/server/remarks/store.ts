// The recap headline for a session under a filter: picked on first view, stored, and kept on
// revisits. Only the session still going on is re-fitted as matches land (and a pick made while
// it was, on the first view after); ↻ re-rolls.
import { filterValue, type PlaylistFilter } from "../../shared/playlist-filter";
import type { Remarks } from "../../shared/schemas/responses";
import type { Pages } from "../api/pages";
import type { Db } from "../db/sqlite";
import type { Logger } from "../log";
import { MOOD_LINES, TRIGGERS } from "./copy";
import { pick, type StoredPick } from "./pick";
import { moodOf, triggersFor } from "./triggers";

const C = "remarks";
/** Lines shown in this many of the latest sessions aren't picked again while others are left. */
const RECENT_SESSIONS = 10;

interface PickRow {
  mood_band: string;
  mood_line: string;
  quip_trigger: string | null;
  quip_line: string | null;
  picked_at: number;
}

const textOf = (lines: readonly { id: string; text: string }[], id: string) => lines.find((l) => l.id === id)?.text ?? "";

export function createRemarks({ tracker, pages, logger, now = Date.now, rng = Math.random }: { tracker: Db; pages: Pages; logger: Logger; now?: () => number; rng?: () => number }) {
  function recent(): Map<string, number> {
    const rows = tracker.all<{ line_id: string; at: number }>(
      `SELECT line_id, MAX(shown_at) AS at FROM remark_shown
       WHERE session_key IN (SELECT session_key FROM remark_shown GROUP BY session_key ORDER BY MAX(shown_at) DESC LIMIT ?)
       GROUP BY line_id`,
      RECENT_SESSIONS,
    );
    return new Map(rows.map((r) => [r.line_id, r.at]));
  }

  /** Null when the session is unknown or has nothing of yours under the filter. */
  function remarks(key: string, filter: PlaylistFilter, reroll: boolean): Remarks | null {
    const detail = pages.sessionDetail(key, filter);
    if (!detail?.matches.length) return null;
    const f = filterValue(filter);
    const mood = moodOf(detail.aggregate, detail.baseline);
    const fired = triggersFor(detail);
    return tracker.transaction(() => {
      const row = tracker.get<PickRow>("SELECT mood_band, mood_line, quip_trigger, quip_line, picked_at FROM remark_picks WHERE session_key = ? AND filter = ?", key, f);
      const stored: StoredPick | null = row ? { moodBand: row.mood_band, moodLine: row.mood_line, quipTrigger: row.quip_trigger, quipLine: row.quip_line } : null;
      const history = recent();
      // A pick made before the session's last match ended saw only part of it, so it's still live.
      const refit = detail.current || (row !== undefined && row.picked_at < detail.endedAt);
      const p = pick({ mood: mood.band, fired, stored, refit, reroll, recent: history, rng });
      const shown = [p.moodLine, p.quipLine].filter((id): id is string => id !== null && id !== stored?.moodLine && id !== stored?.quipLine);
      const changed = p.moodBand !== stored?.moodBand || p.moodLine !== stored.moodLine || p.quipTrigger !== stored.quipTrigger || p.quipLine !== stored.quipLine;
      if (changed || reroll) {
        const at = now();
        tracker.run(
          "INSERT OR REPLACE INTO remark_picks (session_key, filter, mood_band, mood_line, quip_trigger, quip_line, picked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          key, f, p.moodBand, p.moodLine, p.quipTrigger, p.quipLine, at,
        );
        for (const id of shown) tracker.run("INSERT INTO remark_shown (line_id, session_key, shown_at) VALUES (?, ?, ?)", id, key, at);
        logger.info(C, "remark_picked", {
          sessionKey: key,
          filter: f,
          reason: stored === null ? "first" : reroll ? "reroll" : "refit",
          band: p.moodBand,
          computedBand: mood.band,
          z: mood.z,
          n: mood.n,
          fired: fired.map((t) => t.id),
          tier: p.tier,
          trigger: p.quipTrigger,
          moodLine: p.moodLine,
          quipLine: p.quipLine,
          shown,
          recentCount: history.size,
          poolExhausted: p.poolExhausted,
        });
      } else if (refit && !detail.current) {
        // The refit kept everything; the pick has now seen the whole session, so it's final.
        const at = now();
        tracker.run("UPDATE remark_picks SET picked_at = ? WHERE session_key = ? AND filter = ?", at, key, f);
        logger.info(C, "remark_final", { sessionKey: key, filter: f, pickedAt: row?.picked_at, endedAt: detail.endedAt, at });
      }
      const quip = p.quipTrigger === null || p.quipLine === null ? null : {
        trigger: p.quipTrigger,
        text: textOf(TRIGGERS[p.quipTrigger].lines, p.quipLine),
        values: fired.find((t) => t.id === p.quipTrigger)?.values ?? {},
      };
      return { mood: { band: p.moodBand, text: textOf(MOOD_LINES[p.moodBand], p.moodLine) }, quip };
    });
  }

  return {
    get: (key: string, filter: PlaylistFilter) => remarks(key, filter, false),
    reroll: (key: string, filter: PlaylistFilter) => remarks(key, filter, true),
  };
}

export type RemarksStore = ReturnType<typeof createRemarks>;
