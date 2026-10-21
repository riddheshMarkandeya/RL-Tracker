import { describe, expect, test } from "vitest";
import { pinsOf, renderDefinitions, unbumpedConstants } from "./definitions";
import type { Rule } from "./registry";

const rule = (over: Partial<Rule>): Rule => ({
  id: "a_rule",
  area: "extras",
  rule: "The rule.",
  checks: [],
  evidence: "What it rests on.",
  version: 1,
  applied: "recorded",
  refs: ["docs/x.md"],
  ...over,
});

describe("renderDefinitions", () => {
  test("says it's generated and gives the rule-change flow", () => {
    const doc = renderDefinitions([rule({})]);
    expect(doc).toMatch(/^# /);
    expect(doc).toContain("bun run definitions");
    expect(doc.indexOf("bun run rules-diff")).toBeLessThan(doc.indexOf("bun run deploy"));
  });

  test("renders every field of a rule", () => {
    const doc = renderDefinitions([
      rule({ id: "aerial_touch", version: 2, constants: { AERIAL_MIN_Z: 550 }, checks: ["extras_in_range"], outputs: ["match_players.aerial_touches"], refs: ["docs/a.md", "docs/b.md"] }),
    ]);
    expect(doc).toContain("### `aerial_touch` · v2 · recorded");
    expect(doc).toContain("The rule.");
    expect(doc).toContain("`AERIAL_MIN_Z` = 550");
    expect(doc).toContain("`extras_in_range`");
    expect(doc).toContain("`match_players.aerial_touches`");
    expect(doc).toContain("What it rests on.");
    expect(doc).toContain("`docs/a.md`, `docs/b.md`");
  });

  test("marks a dense rule in its heading, and explains the mark", () => {
    const doc = renderDefinitions([rule({ id: "car_sampling", dense: true }), rule({ id: "plain" })]);
    expect(doc).toContain("### `car_sampling` · v1 · recorded · dense");
    expect(doc).toContain("### `plain` · v1 · recorded\n");
    expect(doc).toContain("A *dense* rule reads every UpdateState");
  });

  test("leaves out empty fields", () => {
    const doc = renderDefinitions([rule({})]);
    expect(doc).not.toContain("**Constants**");
    expect(doc).not.toContain("**Checks**");
    expect(doc).not.toContain("**Writes**");
    expect(doc).not.toContain("· dense");
  });

  test("groups by area in a fixed order and skips empty areas", () => {
    const doc = renderDefinitions([rule({ id: "g", area: "goals" }), rule({ id: "r", area: "recording" })]);
    expect(doc.indexOf("## Recording")).toBeGreaterThan(0);
    expect(doc.indexOf("## Recording")).toBeLessThan(doc.indexOf("## Goals"));
    expect(doc).not.toContain("## Extras");
  });

  test("ends with one newline", () => {
    expect(renderDefinitions([rule({})])).toMatch(/[^\n]\n$/);
  });
});

describe("constant pins", () => {
  const rules = [rule({ id: "aerial_touch", constants: { AERIAL_MIN_Z: 550 } }), rule({ id: "winner" })];

  test("pin each rule with constants at its version", () => {
    expect(pinsOf(rules)).toEqual({ aerial_touch: { version: 1, constants: { AERIAL_MIN_Z: 550 } } });
  });

  test("a constant changed at the pinned version needs a bump", () => {
    const changed = [rule({ id: "aerial_touch", constants: { AERIAL_MIN_Z: 500 } })];
    expect(unbumpedConstants(changed, pinsOf(rules))).toEqual(["aerial_touch"]);
  });

  test("a bumped, new or unchanged rule needs nothing", () => {
    const pins = pinsOf(rules);
    expect(unbumpedConstants(rules, pins)).toEqual([]);
    expect(unbumpedConstants([rule({ id: "aerial_touch", version: 2, constants: { AERIAL_MIN_Z: 500 } })], pins)).toEqual([]);
    expect(unbumpedConstants([rule({ id: "new_rule", constants: { X: 1 } })], pins)).toEqual([]);
    expect(unbumpedConstants([rule({ id: "aerial_touch", constants: { B: 2, A: 1 } })], { aerial_touch: { version: 1, constants: { A: 1, B: 2 } } })).toEqual([]);
  });

  test("listing another constant isn't a change; unlisting or renaming one is", () => {
    const pins = pinsOf(rules);
    expect(unbumpedConstants([rule({ id: "aerial_touch", constants: { AERIAL_MIN_Z: 550, SIDE_WALL_X: 4096 } })], pins)).toEqual([]);
    expect(unbumpedConstants([rule({ id: "aerial_touch", constants: {} })], pins)).toEqual(["aerial_touch"]);
    expect(unbumpedConstants([rule({ id: "aerial_touch", constants: { AERIAL_Z: 500 } })], pins)).toEqual(["aerial_touch"]);
    expect(unbumpedConstants([rule({ id: "aerial_touch", constants: { AERIAL_Z: 550 } })], pins)).toEqual(["aerial_touch"]);
  });
});
