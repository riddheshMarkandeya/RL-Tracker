// Reads a closed match back from raw.db into a checked summary. The live recorder and recompute
// both go through here, so a match rebuilds exactly as it was first recorded.
import { runChecks, type CheckFailure } from "./checks";
import { dedupe } from "./dedup";
import { computeExtras } from "./extras";
import { RECORDER_CLOSED, type CloseVia } from "./lifecycle";
import type { RawStore } from "./store";
import { summarise, type MatchSummary } from "./summary";

/** Throws whatever the read or a handler throws; callers decide how a lost summary degrades. */
export function readMatch(store: Pick<RawStore, "matchEvents">, guid: string, via: CloseVia): { summary: MatchSummary; failures: CheckFailure[] } {
  const { kept, dropped } = dedupe(store.matchEvents(guid).filter((e) => e.name !== RECORDER_CLOSED));
  const summary = summarise(guid, kept, { via, dedupDropped: dropped });
  // Deliberately broad: whatever a malformed event breaks in the extras, the base record still
  // stands, with the extras null and the failure flagged.
  try {
    summary.extras = computeExtras(kept, summary);
  } catch (err) {
    summary.extrasError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  }
  const failures = runChecks(summary);
  summary.flags = failures.map((f) => f.id);
  return { summary, failures };
}
