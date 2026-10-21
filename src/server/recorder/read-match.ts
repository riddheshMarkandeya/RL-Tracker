// Reads a closed match back from raw.db into a checked summary. The live recorder and recompute
// both go through here, so a match rebuilds exactly as it was first recorded.
import { DENSE_PLAYER_COLUMNS, DENSE_RULE_IDS } from "../rules/registry";
import { runChecks, type CheckFailure } from "./checks";
import { dedupe } from "./dedup";
import { computeExtras } from "./extras";
import { closeViaOf, rebuild, RECORDER_CLOSED, type CloseVia } from "./lifecycle";
import type { RawStore, ThinnedOutputs } from "./store";
import { summarise, type MatchSummary } from "./summary";

/**
 * A thinned match's raw events no longer support the dense rules, so their outputs come from the
 * snapshot: a roster key it has no value for had none when thinned.
 */
function applySnapshot(summary: MatchSummary, { outputs, ruleVersions }: ThinnedOutputs): void {
  summary.cameraKey = outputs.cameraKey;
  for (const r of summary.roster) {
    const values = summary.extras?.players[r.key];
    if (!values) continue;
    for (const column of DENSE_PLAYER_COLUMNS) values[column] = outputs.players[r.key]?.[column] ?? null;
  }
  const onRoster = new Set(summary.roster.map((r) => r.key));
  const keys = new Set([outputs.cameraKey, ...Object.keys(outputs.players)]);
  summary.thinned = {
    ruleVersions: Object.fromEntries(DENSE_RULE_IDS.flatMap((id) => (ruleVersions[id] === undefined ? [] : [[id, ruleVersions[id]]]))),
    offRoster: [...keys].filter((k): k is string => k !== null && !onRoster.has(k)),
    unsnapshotted: DENSE_RULE_IDS.filter((id) => !outputs.denseRules.includes(id)),
  };
}

/** Why a stored match can't be read as a record. */
export type Unreadable = "open" | "trimmed" | "lobby";

/**
 * How a stored match closed, or why it isn't a record: no close marker yet (live, or a lost
 * marker), its start deleted (`minSeq` above 0), or a lobby that never went live.
 */
export function readableAs(store: Pick<RawStore, "lastOf" | "names">, guid: string, minSeq: number): { via: CloseVia } | { unreadable: Unreadable } {
  const via = closeViaOf(store.lastOf(guid));
  if (via === null) return { unreadable: "open" };
  if (minSeq > 0) return { unreadable: "trimmed" };
  if (rebuild(guid, store.names(guid)).phase === "pending") return { unreadable: "lobby" };
  return { via };
}

/** Throws whatever the read or a handler throws; callers decide how a lost summary degrades. */
export function readMatch(
  store: Pick<RawStore, "matchEvents"> & Partial<Pick<RawStore, "thinnedOutputs">>,
  guid: string,
  via: CloseVia,
): { summary: MatchSummary; failures: CheckFailure[] } {
  // Events first: a recompute running beside retention reads outside its transaction, and full
  // events with the snapshot taken from them is harmless, while thinned events with no snapshot
  // would recompute wrong car stats unflagged.
  const events = store.matchEvents(guid);
  const snapshot = store.thinnedOutputs?.(guid);
  const { kept, dropped } = dedupe(events.filter((e) => e.name !== RECORDER_CLOSED));
  const summary = summarise(guid, kept, { via, dedupDropped: dropped });
  // Deliberately broad: whatever a malformed event breaks in the extras, the base record still
  // stands, with the extras null and the failure flagged.
  try {
    summary.extras = computeExtras(kept, summary);
  } catch (err) {
    summary.extrasError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  }
  if (snapshot) applySnapshot(summary, snapshot);
  const failures = runChecks(summary);
  summary.flags = failures.map((f) => f.id);
  return { summary, failures };
}
