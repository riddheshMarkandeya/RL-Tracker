import { describe, expect, test } from "vitest";
import { BANDS, MOOD_LINES, PLACEHOLDERS, TRIGGERS } from "./copy";

const allLines = () => [...BANDS.flatMap((b) => MOOD_LINES[b]), ...Object.values(TRIGGERS).flatMap((t) => t.lines)];

describe("the remark pool", () => {
  test("every line id is unique", () => {
    const ids = allLines().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every placeholder is one the renderer knows", () => {
    const used = allLines().flatMap((l) => [...l.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(0);
    for (const p of used) expect(PLACEHOLDERS).toContain(p);
  });

  test("every band and trigger has lines; mood lines carry no numbers", () => {
    for (const b of BANDS) {
      expect(MOOD_LINES[b].length).toBeGreaterThan(0);
      for (const l of MOOD_LINES[b]) expect(l.text).not.toMatch(/\{/);
    }
    for (const t of Object.values(TRIGGERS)) expect(t.lines.length).toBeGreaterThan(0);
  });

  test("the aerial-or-long lines each name their kind, and no other trigger's do", () => {
    for (const [id, t] of Object.entries(TRIGGERS)) {
      for (const l of t.lines) expect(l.kind !== undefined).toBe(id === "aerial_or_long");
    }
    expect(new Set(TRIGGERS.aerial_or_long.lines.map((l) => l.kind))).toEqual(new Set(["aerial", "long"]));
  });

  test("hard-shot lines leave the unit to the renderer", () => {
    for (const l of TRIGGERS.hard_shot.lines) expect(l.text).not.toMatch(/km\/h|mph/);
  });
});
