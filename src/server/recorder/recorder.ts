// From Stats API frames to stored matches: envelope → unknown-field log → sampler → lifecycle →
// raw store. Each finished match is read back through dedup → summary → checks and handed to the
// hook. One match is open at a time; the lifecycle decides which events belong to it.
import type { Db } from "../db/sqlite";
import type { Logger } from "../log";
import type { CheckFailure } from "./checks";
import { parseFrame, type Data, type StatsEvent } from "./envelope";
import { unknownFields } from "./known-fields";
import { initialLife, isCloseMarker, orphan, ORPHAN_TIMEOUT_MS, rebuild, RECORDER_CLOSED, recorderClosedData, step, type CloseVia, type Effect, type Life, type OrphanCause } from "./lifecycle";
import { readMatch } from "./read-match";
import { createUpdateStateSampler, UPDATE_STATE_INTERVAL_MS } from "./sampler";
import { createRawStore, newTrimState, trimForStorage, type TrimState } from "./store";
import type { MatchSummary } from "./summary";

export interface RecorderOptions {
  raw: Db;
  logger: Logger;
  /**
   * Called synchronously when a match that reached play closes. A guid that comes back after
   * Reconnect closes, and calls this, again, so whatever it writes must be an upsert.
   */
  onMatchFinished: (summary: MatchSummary, failures: CheckFailure[]) => void;
  orphanTimeoutMs?: number;
  /** The clock for closes not driven by a frame (startup recovery). */
  now?: () => number;
}

interface Frame {
  t: number;
  event: string;
  ev: StatsEvent;
}

/** Write state for the open match. */
interface Current {
  guid: string;
  /** null until a seq lookup succeeds; each write retries it. */
  seq: number | null;
  trim: TrimState;
  stored: number;
  storeFailed: number;
}

const C = "recorder";

export function createRecorder(opts: RecorderOptions) {
  const { logger, onMatchFinished, orphanTimeoutMs = ORPHAN_TIMEOUT_MS, now = Date.now } = opts;
  const store = createRawStore(opts.raw);
  const sampler = createUpdateStateSampler<Frame>(UPDATE_STATE_INTERVAL_MS);
  let life: Life = initialLife();
  let cur: Current | null = null;
  /** Time of the last frame with a guid: the open match's last sign of life. */
  let lastActivity: number | null = null;
  /** Unknown names and fields, and bad-frame reasons, are logged once per run. */
  const reported = new Set<string>();

  const once = (key: string, report: () => void) => {
    if (reported.has(key)) return;
    reported.add(key);
    report();
  };

  function open(guid: string, seq: number | null): Current {
    cur = { guid, seq, trim: newTrimState(), stored: 0, storeFailed: 0 };
    return cur;
  }

  function nextSeq(guid: string): number | null {
    try {
      return store.nextSeq(guid);
    } catch (err) {
      // Broad on purpose, like insert below: a failing raw.db degrades to dropped events. Guessing
      // 0 would collide with a reopened match's rows, so each write retries it (a failure there is
      // logged as the insert's).
      logger.error(C, "store_failed", { guid, op: "nextSeq", err });
      return null;
    }
  }

  /** A guid's stored event names if it has any, so a reopened match resumes its phase. */
  function resume(guid: string): string[] | null {
    try {
      const names = store.names(guid);
      return names.length ? names : null;
    } catch (err) {
      logger.error(C, "store_failed", { guid, op: "names", err });
      return null;
    }
  }

  function storeEvent(m: Current, name: string, data: Data, t: number): void {
    const trimmed = trimForStorage(name, data, m.trim);
    if (!trimmed) return;
    try {
      m.seq ??= store.nextSeq(m.guid);
      store.insert({ guid: m.guid, seq: m.seq, ts: t, name, data: trimmed });
      m.seq++;
      m.stored++;
    } catch (err) {
      // Broad on purpose: whatever stops one write (disk full, a locked or closed db), the event
      // is dropped and recording goes on. Logged once per match; match_closed carries the count.
      m.storeFailed++;
      if (m.storeFailed === 1) logger.error(C, "store_failed", { guid: m.guid, op: "insert", name, err });
    }
  }

  function current(guid: string): Current {
    if (cur?.guid !== guid) throw new Error(`recorder: no write state for open match ${guid}`);
    return cur;
  }

  /** Reads a closed match back and hands its summary to the hook. */
  function finish(guid: string, via: CloseVia): void {
    let summary: MatchSummary;
    let failures: CheckFailure[];
    try {
      ({ summary, failures } = readMatch(store, guid, via));
    } catch (err) {
      // Broad on purpose: a read failure or a bug in a handler or check loses this summary, not
      // the recording. The raw events stay, so recompute can rebuild it.
      logger.error(C, "summary_failed", { guid, err });
      return;
    }
    for (const f of failures) logger.warn(C, "check_failed", { guid, check: f.id, detail: f.detail });
    logger.info(C, "summary", {
      guid,
      endKind: summary.endKind,
      playlistId: summary.playlistId,
      score: summary.score,
      winner: summary.winner?.teamNum ?? null,
      winnerSource: summary.winner?.source ?? null,
      mvp: summary.mvp?.name ?? null,
      mvpSource: summary.mvp?.source ?? null,
      players: summary.roster.length,
      dedupDropped: summary.dedupDropped,
      flags: summary.flags,
    });
    try {
      onMatchFinished(summary, failures);
    } catch (err) {
      // Broad on purpose: the hook is outside the recorder, and its failure must not stop recording.
      logger.error(C, "hook_failed", { guid, err });
    }
  }

  function apply(e: Effect, t: number, ev?: StatsEvent): void {
    switch (e.kind) {
      case "opened": {
        const m = open(e.guid, nextSeq(e.guid));
        if (e.resumed) logger.info(C, "reopened", { guid: e.guid, fromSeq: m.seq });
        else logger.info(C, "match_opened", { guid: e.guid, by: ev?.name });
        return;
      }
      case "live":
        logger.info(C, "match_live", { guid: e.guid, joinedInProgress: e.joinedInProgress });
        return;
      case "ended":
        logger.info(C, "match_ended", { guid: e.guid, winner: ev?.data.WinnerTeamNum ?? null });
        return;
      case "refused": {
        const replay = ((ev?.data.Game ?? {}) as Data).bReplay;
        logger.info(C, "finished_match_event_dropped", { guid: e.guid, by: ev?.name, replay: typeof replay === "boolean" ? replay : null });
        return;
      }
      case "retagged":
        logger.info(C, "teardown_retagged", { guid: e.guid, wireGuid: e.wireGuid });
        return;
      case "guid_mismatch":
        logger.warn(C, "guid_mismatch", { guid: e.guid, wireGuid: e.wireGuid, event: ev?.name });
        return;
      case "closed": {
        const m = current(e.guid);
        if (e.via !== "destroyed") storeEvent(m, RECORDER_CLOSED, recorderClosedData(e.guid, e.via), t);
        cur = null;
        logger.info(C, "match_closed", { guid: e.guid, via: e.via, phase: e.phase, stored: m.stored, storeFailed: m.storeFailed });
        // It never got past the lobby: nothing was played, so there is nothing to summarise.
        if (e.phase === "pending") logger.info(C, "lobby_discarded", { guid: e.guid, via: e.via });
        else finish(e.guid, e.via);
        return;
      }
    }
  }

  function process(f: Frame): void {
    const r = step(life, f.ev, resume);
    life = r.life;
    // A MatchDestroyed belongs to the match it closes, so it is stored before the close runs; a
    // supersede closes the old match before the new one's MatchCreated is stored.
    const isDestroy = (e: Effect) => e.kind === "closed" && e.via === "destroyed";
    for (const e of r.effects) if (!isDestroy(e)) apply(e, f.t, f.ev);
    if (r.fileUnder) storeEvent(current(r.fileUnder), f.ev.name, f.ev.data, f.t);
    for (const e of r.effects) if (isDestroy(e)) apply(e, f.t, f.ev);
  }

  function closeOrphan(cause: OrphanCause, t: number): void {
    const r = orphan(life, cause);
    life = r.life;
    for (const e of r.effects) apply(e, t);
  }

  /** Writes the sampler's held state, so the last scoreboard is stored before a close or exit. */
  function flush(): void {
    const held = sampler.flush();
    if (held) process(held);
  }

  /** A parsed frame: unknown-field log, then the sampler, then the lifecycle. */
  function accept(ev: StatsEvent, t: number): void {
    const unknown = unknownFields(ev.name, ev.data);
    if (unknown === null) {
      once(`event:${ev.name}`, () => {
        logger.warn(C, "unknown_event", { name: ev.name });
      });
    } else {
      for (const field of unknown) {
        once(`field:${ev.name}.${field}`, () => {
          logger.info(C, "unknown_field", { event: ev.name, field });
        });
      }
    }
    if (ev.guid !== "") lastActivity = t;
    for (const f of sampler.offer({ t, event: ev.name, ev })) process(f);
  }

  return {
    /** One WebSocket frame, received at `t` (ms). */
    handleFrame(raw: string, t: number): void {
      const parsed = parseFrame(raw);
      if (!parsed.ok) {
        once(`bad_frame:${parsed.reason}`, () => {
          logger.warn("stats_api", "bad_frame", { reason: parsed.reason, sample: raw.slice(0, 200) });
        });
        return;
      }
      const { ev } = parsed;
      try {
        accept(ev, t);
      } catch (err) {
        // Broad on purpose: the stream is another program's data, and an exception escaping into
        // the socket handler would end the process without writing the held state.
        once(`frame_failed:${ev.name}`, () => {
          logger.error(C, "frame_failed", { event: ev.name, guid: ev.guid, err });
        });
      }
    },

    /** Orphans the open match once it has been silent for the timeout. */
    checkIdle(t: number): void {
      if (!life.open || lastActivity === null || t - lastActivity < orphanTimeoutMs) return;
      flush();
      closeOrphan("timeout", t);
    },

    /**
     * Closes a match the last run left open (it crashed or was killed mid-match). Matches are
     * serial, so only the newest stored event's match can be one.
     */
    recoverAtStartup(): void {
      try {
        const last = store.lastEvent();
        if (!last || isCloseMarker(last.name)) return;
        const m = rebuild(last.guid, store.names(last.guid));
        open(m.guid, store.nextSeq(m.guid));
        life = { open: m, refused: null };
        logger.info(C, "recovered", { guid: m.guid, phase: m.phase });
      } catch (err) {
        // Broad on purpose: whatever stops recovery, the recorder can still record new matches.
        logger.error(C, "recover_failed", { err });
        cur = null;
        life = initialLife();
        return;
      }
      closeOrphan("restart", now());
    },

    /** True while a match is open, so retention leaves raw.db alone. */
    isRecording: () => life.open !== null,
    status: () => ({ guid: life.open?.guid ?? null, phase: life.open?.phase ?? null }),
    flush,
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
