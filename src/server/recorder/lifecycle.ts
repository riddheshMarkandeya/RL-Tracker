// The match lifecycle as a pure state machine: which match each event belongs to, and when a
// match opens, goes live, ends and closes. One match is open at a time, and the wire guid is only
// a hint: after a private game the old match's teardown arrives under the next match's guid, so
// whatever is open owns every event until a MatchDestroyed (any guid) closes it.

export type Phase = "pending" | "live" | "ended";
/** How a match closed: the stream's MatchDestroyed, or one of the recorder's orphan causes. */
export type CloseVia = "destroyed" | OrphanCause;
export const ORPHAN_CAUSES = ["timeout", "restart", "superseded"] as const;
export type OrphanCause = (typeof ORPHAN_CAUSES)[number];

export interface OpenMatch {
  guid: string;
  phase: Phase;
  sawInitialized: boolean;
  /** retagged / guid_mismatch are reported once per match. */
  reportedGuid: boolean;
}

export interface Life {
  open: OpenMatch | null;
}

export type Effect =
  | { kind: "opened"; guid: string; resumed: boolean }
  | { kind: "live"; guid: string; joinedInProgress: boolean }
  | { kind: "ended"; guid: string }
  /** `phase` is the phase at close: "pending" means it never became a game (a lobby). */
  | { kind: "closed"; guid: string; phase: Phase; via: CloseVia }
  | { kind: "retagged"; guid: string; wireGuid: string }
  | { kind: "guid_mismatch"; guid: string; wireGuid: string };

export interface StepResult {
  life: Life;
  /** The match to store the event under, or null to drop it. */
  fileUnder: string | null;
  effects: Effect[];
}

/** The synthetic event the recorder stores when it closes a match itself. */
export const RECORDER_CLOSED = "RecorderClosed";
const CLOSE_MARKERS = new Set(["MatchDestroyed", RECORDER_CLOSED]);
export const isCloseMarker = (name: string) => CLOSE_MARKERS.has(name);
/** The data the recorder stores with its close marker. */
export const recorderClosedData = (guid: string, cause: OrphanCause) => ({ MatchGuid: guid, Reason: cause });

/** How a match closed, from its last stored event; null while it is still open. Throws on an unknown cause. */
export function closeViaOf(last: { name: string; data: string } | undefined): CloseVia | null {
  if (!last || !isCloseMarker(last.name)) return null;
  if (last.name !== RECORDER_CLOSED) return "destroyed";
  const reason = (JSON.parse(last.data) as { Reason?: unknown }).Reason;
  const cause = ORPHAN_CAUSES.find((c) => c === reason);
  if (!cause) throw new Error(`unknown close reason ${String(reason)}`);
  return cause;
}

/** Phase changes by event name; anything not listed leaves the phase alone. */
const TRANSITIONS: Readonly<Record<string, Partial<Record<Phase, Phase>>>> = {
  MatchInitialized: { pending: "live" },
  CountdownBegin: { pending: "live" },
  RoundStarted: { pending: "live" },
  GoalScored: { pending: "live" },
  MatchEnded: { pending: "ended", live: "ended" },
};

export const initialLife = (): Life => ({ open: null });

const fresh = (guid: string): OpenMatch => ({ guid, phase: "pending", sawInitialized: false, reportedGuid: false });

/** Applies one event's phase change to `m` in place, returning the effects. */
function advance(m: OpenMatch, name: string): Effect[] {
  if (name === "MatchInitialized") m.sawInitialized = true;
  const next = TRANSITIONS[name]?.[m.phase];
  if (!next) return [];
  const effects: Effect[] = [];
  if (m.phase === "pending") effects.push({ kind: "live", guid: m.guid, joinedInProgress: !m.sawInitialized });
  if (next === "ended") effects.push({ kind: "ended", guid: m.guid });
  m.phase = next;
  return effects;
}

/** The state a match had reached, from its stored event names (close markers skipped). */
export function rebuild(guid: string, names: readonly string[]): OpenMatch {
  const m = fresh(guid);
  for (const name of names) if (!isCloseMarker(name)) advance(m, name);
  return m;
}

const close = (m: OpenMatch, via: CloseVia): Effect => ({ kind: "closed", guid: m.guid, phase: m.phase, via });

/**
 * `resume` returns a guid's stored event names when it already has rows (a match reopened after
 * Reconnect), so it continues from the phase it reached rather than from pending.
 */
export function step(life: Life, ev: { name: string; guid: string }, resume?: (guid: string) => string[] | null): StepResult {
  if (ev.guid === "") return { life, fileUnder: null, effects: [] };
  const effects: Effect[] = [];
  let open = life.open ? { ...life.open } : null;

  if (open && ev.name === "MatchCreated" && ev.guid !== open.guid) {
    effects.push(close(open, "superseded"));
    open = null;
  }
  if (!open) {
    if (isCloseMarker(ev.name)) return { life: { open: null }, fileUnder: null, effects };
    const history = resume?.(ev.guid) ?? null;
    open = history ? rebuild(ev.guid, history) : fresh(ev.guid);
    effects.push({ kind: "opened", guid: ev.guid, resumed: history !== null });
  } else if (ev.guid !== open.guid && !open.reportedGuid) {
    open.reportedGuid = true;
    effects.push({ kind: open.phase === "ended" ? "retagged" : "guid_mismatch", guid: open.guid, wireGuid: ev.guid });
  }

  const fileUnder = open.guid;
  if (ev.name === "MatchDestroyed") {
    effects.push(close(open, "destroyed"));
    return { life: { open: null }, fileUnder, effects };
  }
  effects.push(...advance(open, ev.name));
  return { life: { open }, fileUnder, effects };
}

/** Closes the open match on the recorder's own initiative (no MatchDestroyed came). */
export function orphan(life: Life, cause: OrphanCause): { life: Life; effects: Effect[] } {
  if (!life.open) return { life, effects: [] };
  return { life: { open: null }, effects: [close(life.open, cause)] };
}
