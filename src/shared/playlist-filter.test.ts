import { describe, expect, test } from "vitest";
import { inFilter, playlistsPresent, type PlaylistFilter } from "./playlist-filter";

// One id per group, plus the second private id and an unmapped one.
const RANKED = 13;
const CASUAL = 3;
const EXTRA = 17;
const LTM = 38;
const PRIVATE = 6;
const EXTERNAL = 26;
const TOURNAMENT = 34;
const OFFLINE = 8;
const UNKNOWN = 999;

const filters: PlaylistFilter[] = ["everything", "ranked", "casual", "extra", "private"];
const matching = (id: number | null) => filters.filter((f) => inFilter(id, f));

describe("inFilter", () => {
  test.each([
    [RANKED, ["everything", "ranked"]],
    [CASUAL, ["everything", "casual"]],
    [EXTRA, ["everything", "extra"]],
    [LTM, ["everything", "extra"]],
    [PRIVATE, ["private"]],
    [EXTERNAL, ["private"]],
    [TOURNAMENT, ["everything"]],
    [OFFLINE, []],
    [UNKNOWN, ["everything"]],
    [null, ["everything"]],
  ] as const)("playlist %s is in %j", (id, expected) => {
    expect(matching(id)).toEqual(expected);
  });

  test("casual is the 1–4 player playlists only", () => {
    expect([1, 2, 3, 4].every((id) => inFilter(id, "casual"))).toBe(true);
  });

  test("a single playlist matches only itself, in any group", () => {
    expect(inFilter(OFFLINE, { playlist: OFFLINE })).toBe(true);
    expect(inFilter(PRIVATE, { playlist: PRIVATE })).toBe(true);
    expect(inFilter(RANKED, { playlist: OFFLINE })).toBe(false);
    expect(inFilter(null, { playlist: OFFLINE })).toBe(false);
  });
});

describe("playlistsPresent", () => {
  test("distinct, sorted, without nulls", () => {
    expect(playlistsPresent([13, null, 3, 13, 26, 3])).toEqual([3, 13, 26]);
    expect(playlistsPresent([])).toEqual([]);
  });
});
