// Duplicate events the game sends, dropped before anything reads a match. raw.db keeps them, so
// a corrected rule reaches old matches through recompute.
import type { StoredEvent } from "./store";

interface DedupRule {
  id: string;
  event: string;
  /** `prev` is the previous kept event with the same name. */
  isDuplicate(ev: StoredEvent, prev: StoredEvent | undefined): boolean;
}

const sameData = (a: StoredEvent, b: StoredEvent | undefined) => b !== undefined && JSON.stringify(a.data) === JSON.stringify(b.data);

const RULES: readonly DedupRule[] = [
  {
    // Sent again when the goal replay ends or is skipped; all three markers always come together.
    id: "replay_goal",
    event: "GoalScored",
    isDuplicate: ({ data }) => (data.Scorer as { Name?: unknown } | undefined)?.Name === "" && data.GoalSpeed === 0 && data.GoalTime === 0,
  },
  { id: "repeat_crossbar", event: "CrossbarHit", isDuplicate: sameData },
  { id: "repeat_ballhit", event: "BallHit", isDuplicate: sameData },
];

export function dedupe(events: readonly StoredEvent[]): { kept: StoredEvent[]; dropped: Record<string, number> } {
  const kept: StoredEvent[] = [];
  const dropped: Record<string, number> = {};
  const prevByName = new Map<string, StoredEvent>();
  for (const ev of events) {
    const prev = prevByName.get(ev.name);
    const rule = RULES.find((r) => r.event === ev.name && r.isDuplicate(ev, prev));
    if (rule) {
      dropped[rule.id] = (dropped[rule.id] ?? 0) + 1;
      continue;
    }
    prevByName.set(ev.name, ev);
    kept.push(ev);
  }
  return { kept, dropped };
}
