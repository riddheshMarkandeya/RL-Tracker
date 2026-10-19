/** About two states a second, enough to follow the scoreboard. */
export const UPDATE_STATE_INTERVAL_MS = 500;

/** The sampler only reads `t` (ms) and `event`; callers attach whatever else they carry. */
export interface Sampled {
  t: number;
  event: string | null;
}

export interface Line extends Sampled {
  raw: string;
}

/**
 * Keeps every non-UpdateState line and roughly one UpdateState per `intervalMs`. The latest
 * dropped UpdateState is held and written just before the next other event (and by `flush` on
 * exit), so the scoreboard at MatchEnded, a goal or a disconnect is never lost. Writing a held
 * state restarts the interval; otherwise once-a-second events like ClockUpdatedSeconds would
 * each add a state and push the rate well past one per interval.
 */
export function createUpdateStateSampler<L extends Sampled>(intervalMs: number) {
  let lastKeptT = Number.NEGATIVE_INFINITY;
  let held: L | null = null;
  return {
    offer(line: L): L[] {
      if (line.event !== "UpdateState") {
        if (!held) return [line];
        const out = [held, line];
        lastKeptT = held.t;
        held = null;
        return out;
      }
      // t is wall-clock when live, so a backwards clock step (negative elapsed) counts as a full interval
      const elapsed = line.t - lastKeptT;
      if (elapsed >= 0 && elapsed < intervalMs) {
        held = line;
        return [];
      }
      lastKeptT = line.t;
      held = null;
      return [line];
    },
    flush(): L | null {
      const out = held;
      held = null;
      return out;
    },
  };
}

export type Sampler<L extends Sampled> = ReturnType<typeof createUpdateStateSampler<L>>;
