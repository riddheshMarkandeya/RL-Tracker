// Picks a session's headline: a mood line for its band and at most one quip from the rarest tier
// that fired. Pure: the caller hands in the stored pick, the recent history and the RNG.
import { MOOD_LINES, TIERS, TRIGGERS, type Band, type Line, type Tier, type TriggerId } from "./copy";
import type { Fired } from "./triggers";

/** As stored: plain ids, which a later copy edit may have removed. */
export interface StoredPick {
  moodBand: string;
  moodLine: string;
  quipTrigger: string | null;
  quipLine: string | null;
}

export interface PickInput {
  mood: Band;
  fired: readonly Fired[];
  stored: StoredPick | null;
  /** The session is still going on: a stored part that no longer fits is re-picked. */
  refit: boolean;
  /** ↻: re-pick both parts, avoiding the lines shown now. */
  reroll: boolean;
  /** Line id → when it was last shown, over the recent sessions. */
  recent: ReadonlyMap<string, number>;
  rng: () => number;
}

export interface Pick {
  moodBand: Band;
  moodLine: string;
  quipTrigger: TriggerId | null;
  quipLine: string | null;
  /** The quip's tier. */
  tier: Tier | null;
  /** Every candidate line had been shown recently. */
  poolExhausted: boolean;
}

interface Candidate {
  trigger: TriggerId;
  line: Line;
}

const MOOD_BAND_OF = new Map(Object.entries(MOOD_LINES).flatMap(([band, lines]) => lines.map((l) => [l.id, band as Band] as const)));
const QUIP_OF = new Map(Object.entries(TRIGGERS).flatMap(([trigger, t]) => t.lines.map((line): [string, Candidate] => [line.id, { trigger: trigger as TriggerId, line }])));

const fits = (line: Line, f: Fired) => line.kind === undefined || (f.kinds ?? []).includes(line.kind);

/** A line not shown recently if there is one, else the least recently shown; never `avoid` unless it's all there is. */
function choose<T>(pool: readonly T[], idOf: (x: T) => string, { recent, rng }: PickInput, avoid: string | null): { chosen: T | null; exhausted: boolean } {
  const others = pool.filter((x) => idOf(x) !== avoid);
  const from = others.length ? others : pool;
  const fresh = from.filter((x) => !recent.has(idOf(x)));
  if (fresh.length) return { chosen: fresh[Math.floor(rng() * fresh.length)] ?? null, exhausted: false };
  const oldest = [...from].sort((a, b) => (recent.get(idOf(a)) ?? 0) - (recent.get(idOf(b)) ?? 0))[0] ?? null;
  return { chosen: oldest, exhausted: from.length > 0 };
}

/** The stored mood line's band if it's still kept, else null. */
function keptMood({ stored, mood, refit }: PickInput): Band | null {
  const band = stored === null ? undefined : MOOD_BAND_OF.get(stored.moodLine);
  if (band === undefined || band !== stored?.moodBand) return null;
  return refit && band !== mood ? null : band;
}

/**
 * The stored quip if it's still kept ("none" for a kept empty quip), else null. A finished
 * session keeps it while its trigger still fires, whatever the tier now; its numbers come from
 * the trigger, so one that stopped firing (a recompute) can't be shown.
 */
function keptQuip({ stored, refit }: PickInput, active: readonly Fired[], tier: Tier | null, candidates: readonly Candidate[]): Candidate | "none" | null {
  if (stored === null) return null;
  if (stored.quipTrigger === null) return !refit || tier === null ? "none" : null;
  const quip = stored.quipLine === null ? undefined : QUIP_OF.get(stored.quipLine);
  if (quip?.trigger !== stored.quipTrigger) return null;
  const stillFits = refit ? candidates.some((c) => c.line.id === quip.line.id) : active.some((f) => f.id === quip.trigger && fits(quip.line, f));
  return stillFits ? quip : null;
}

export function pick(input: PickInput): Pick {
  const { mood, fired, stored, reroll } = input;
  const active = fired.filter((f) => TRIGGERS[f.id].inert === undefined);
  const tier = TIERS.find((t) => active.some((f) => TRIGGERS[f.id].tier === t)) ?? null;
  const candidates: Candidate[] = active
    .filter((f) => TRIGGERS[f.id].tier === tier)
    .flatMap((f) => TRIGGERS[f.id].lines.filter((line) => fits(line, f)).map((line) => ({ trigger: f.id, line })));

  const moodBand = reroll ? null : keptMood(input);
  const moodPick = moodBand === null ? choose(MOOD_LINES[mood], (l) => l.id, input, stored?.moodLine ?? null) : null;
  const quipKept = reroll ? null : keptQuip(input, active, tier, candidates);
  const quipPick = quipKept === null ? choose(candidates, (c) => c.line.id, input, stored?.quipLine ?? null) : null;
  const quip = quipKept === "none" ? null : (quipKept ?? quipPick?.chosen ?? null);

  return {
    moodBand: moodBand ?? mood,
    // Every band has lines, so a pick always finds one.
    moodLine: moodBand !== null && stored ? stored.moodLine : (moodPick?.chosen?.id ?? ""),
    quipTrigger: quip?.trigger ?? null,
    quipLine: quip?.line.id ?? null,
    tier: quip === null ? null : TRIGGERS[quip.trigger].tier,
    poolExhausted: (moodPick?.exhausted ?? false) || (quipPick?.exhausted ?? false),
  };
}
