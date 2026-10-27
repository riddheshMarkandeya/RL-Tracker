import { describe, expect, test } from "vitest";
import { MOOD_LINES, TRIGGERS, type TriggerId } from "./copy";
import { pick, type PickInput, type StoredPick } from "./pick";
import type { Fired } from "./triggers";

const first = () => 0;
const last = () => 0.999;
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const on = (id: TriggerId, over: Partial<Fired> = {}): Fired => ({ id, values: {}, ...over });

const input = (over: Partial<PickInput> = {}): PickInput => ({ mood: "usual", fired: [], stored: null, refit: false, reroll: false, recent: new Map(), rng: first, ...over });
const stored = (over: Partial<StoredPick> = {}): StoredPick => ({ moodBand: "usual", moodLine: "usual-3", quipTrigger: null, quipLine: null, ...over });

describe("pick: a first view", () => {
  test("a mood line from the band, and no quip when nothing fired", () => {
    expect(pick(input({ mood: "great" }))).toMatchObject({ moodBand: "great", moodLine: "great-1", quipTrigger: null, quipLine: null, tier: null });
    expect(pick(input({ mood: "great", rng: last })).moodLine).toBe("great-8");
  });

  test("the rarest tier that fired wins, whatever fired below it", () => {
    const fired = [on("win_streak"), on("marathon"), on("ot_wins"), on("hard_shot")];
    const p = pick(input({ fired }));
    expect(p.tier).toBe("rare");
    expect(["ot_wins", "hard_shot"]).toContain(p.quipTrigger);
    expect(pick(input({ fired: [...fired, on("savior")] })).quipTrigger).toBe("savior");
  });

  test("random within the tier: every fired trigger's lines are in the pool", () => {
    const fired = [on("win_streak"), on("marathon")];
    const seen = new Set([0, 0.3, 0.6, 0.99].map((r) => pick(input({ fired, rng: () => r })).quipTrigger));
    expect(seen).toEqual(new Set(["win_streak", "marathon"]));
  });

  test("inert triggers are ignored even if handed in", () => {
    expect(pick(input({ fired: [on("bicycle_goal"), on("marathon")] })).quipTrigger).toBe("marathon");
    expect(pick(input({ fired: [on("duo_good")] })).quipTrigger).toBeNull();
  });

  test("aerial-or-long picks only lines of the kinds that happened", () => {
    const aerial = ids(TRIGGERS.aerial_or_long.lines.filter((l) => l.kind === "aerial"));
    for (const r of [0, 0.5, 0.99]) expect(aerial).toContain(pick(input({ fired: [on("aerial_or_long", { kinds: ["aerial"] })], rng: () => r })).quipLine);
  });
});

describe("pick: repeat avoidance", () => {
  test("skips lines shown recently", () => {
    const recent = new Map([["usual-1", 5], ["usual-2", 6]]);
    expect(pick(input({ recent })).moodLine).toBe("usual-3");
    expect(pick(input({ recent })).poolExhausted).toBe(false);
  });

  test("when every line is recent, the least recently shown one", () => {
    const recent = new Map(ids(MOOD_LINES.usual).map((id, i) => [id, 100 - i] as const));
    const p = pick(input({ recent }));
    expect(p.moodLine).toBe("usual-8");
    expect(p.poolExhausted).toBe(true);
  });
});

describe("pick: a stored pick", () => {
  test("a finished session keeps it, even when its band or the winning tier changed", () => {
    const s = stored({ moodBand: "good", moodLine: "good-4", quipTrigger: "marathon", quipLine: "marathon-2" });
    expect(pick(input({ mood: "rough", fired: [on("savior"), on("marathon")], stored: s }))).toMatchObject(s);
    expect(pick(input({ mood: "rough", stored: stored() }))).toMatchObject(stored());
    expect(pick(input({ fired: [on("savior")], stored: stored() })).quipTrigger).toBeNull();
  });

  test("a finished session re-picks a quip whose trigger stopped firing, since its numbers are gone", () => {
    const s = stored({ moodLine: "usual-4", quipTrigger: "marathon", quipLine: "marathon-2" });
    expect(pick(input({ fired: [on("win_streak")], stored: s }))).toMatchObject({ moodLine: "usual-4", quipTrigger: "win_streak" });
  });

  test("a finished session re-picks only a part whose line no longer exists", () => {
    const s = stored({ moodLine: "usual-gone", quipTrigger: "marathon", quipLine: "marathon-2" });
    const p = pick(input({ fired: [on("marathon")], stored: s }));
    expect(p).toMatchObject({ moodBand: "usual", moodLine: "usual-1", quipTrigger: "marathon", quipLine: "marathon-2" });
  });

  test("ids a later copy edit renamed or removed are re-picked", () => {
    const s = stored({ moodBand: "meh", moodLine: "meh-1", quipTrigger: "old_trigger", quipLine: "marathon-2" });
    expect(pick(input({ fired: [on("marathon")], stored: s }))).toMatchObject({ moodBand: "usual", moodLine: "usual-1", quipTrigger: "marathon", quipLine: "marathon-1" });
  });

  test("a live session keeps what still fits", () => {
    const s = stored({ quipTrigger: "marathon", quipLine: "marathon-2" });
    expect(pick(input({ refit: true, fired: [on("marathon"), on("win_streak")], stored: s }))).toMatchObject(s);
  });

  test("a live session re-picks the mood when the band moves, keeping the quip", () => {
    const s = stored({ moodBand: "short", moodLine: "short-2", quipTrigger: "marathon", quipLine: "marathon-2" });
    expect(pick(input({ refit: true, mood: "great", fired: [on("marathon")], stored: s }))).toMatchObject({ moodBand: "great", moodLine: "great-1", quipTrigger: "marathon", quipLine: "marathon-2" });
  });

  test("a live session re-picks the quip when a rarer tier fires or its trigger stops firing", () => {
    const s = stored({ quipTrigger: "marathon", quipLine: "marathon-2" });
    const rarer = pick(input({ refit: true, fired: [on("marathon"), on("hard_shot")], stored: s }));
    expect(rarer).toMatchObject({ moodLine: "usual-3", quipTrigger: "hard_shot" });
    expect(pick(input({ refit: true, fired: [on("win_streak")], stored: s })).quipTrigger).toBe("win_streak");
    expect(pick(input({ refit: true, fired: [], stored: s })).quipTrigger).toBeNull();
  });

  test("a live session picks a first quip once a trigger fires", () => {
    expect(pick(input({ refit: true, fired: [on("marathon")], stored: stored() })).quipTrigger).toBe("marathon");
  });

  test("a live session's aerial line goes when only a long goal is left to tell", () => {
    const s = stored({ quipTrigger: "aerial_or_long", quipLine: "aerial-long-1" });
    expect(pick(input({ refit: true, fired: [on("aerial_or_long", { kinds: ["long"] })], stored: s })).quipLine).toBe("aerial-long-2");
  });
});

describe("pick: reroll", () => {
  test("never returns the same lines when others exist", () => {
    const s = stored({ moodLine: "usual-1", quipTrigger: "marathon", quipLine: "marathon-1" });
    for (const r of [0, 0.5, 0.99]) {
      const p = pick(input({ reroll: true, fired: [on("marathon")], stored: s, rng: () => r }));
      expect(p.moodLine).not.toBe("usual-1");
      expect(p.quipLine).not.toBe("marathon-1");
    }
  });

  test("even when every other line is recent", () => {
    const recent = new Map(ids(MOOD_LINES.usual).map((id, i) => [id, i === 0 ? 1 : 100 + i] as const));
    expect(pick(input({ reroll: true, stored: stored({ moodLine: "usual-1" }), recent })).moodLine).toBe("usual-2");
  });

  test("stays inside the kind's lines", () => {
    const s = stored({ quipTrigger: "aerial_or_long", quipLine: "aerial-long-1" });
    const p = pick(input({ reroll: true, fired: [on("aerial_or_long", { kinds: ["aerial"] })], stored: s }));
    expect(p.quipLine).toBe("aerial-long-3");
  });

  test("uses the band as it is now", () => {
    expect(pick(input({ reroll: true, mood: "great", stored: stored() })).moodBand).toBe("great");
  });
});
