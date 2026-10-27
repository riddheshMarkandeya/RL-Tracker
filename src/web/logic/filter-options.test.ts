import { describe, expect, test } from "vitest";
import { filterOptions, filterValue, parseFilter } from "./filter-options";

const flat = (groups: ReturnType<typeof filterOptions>) => groups.map((g) => [g.label, g.options.map((o) => `${o.value}=${o.label}`)]);

describe("filterOptions", () => {
  test("only groups with a playlist present, each with its 'All' entry, in id order", () => {
    expect(flat(filterOptions([11, 2, 10, 53, 17], "everything"))).toEqual([
      [null, ["everything=Everything (excl. private)"]],
      ["Ranked", ["ranked=All ranked", "10=Ranked Duel", "11=Ranked Doubles"]],
      ["Casual", ["casual=All casual", "2=Doubles"]],
      ["Extra modes", ["extra=All extra modes", "17=Hoops", "53=Honor Duel"]],
    ]);
  });

  test("private, then unmapped, offline and tournament ids under Other", () => {
    expect(flat(filterOptions([6, 999, 8, 34], "everything")).slice(1)).toEqual([
      ["Private", ["private=Private matches"]],
      ["Other", ["8=Exhibition", "34=Official Tournament", "999=Unknown playlist (999)"]],
    ]);
  });

  test("the selected filter stays listed when nothing in it is present", () => {
    expect(flat(filterOptions([], { playlist: 13 }))).toEqual([
      [null, ["everything=Everything (excl. private)"]],
      ["Other", ["13=Ranked Standard"]],
    ]);
    expect(flat(filterOptions([2], "ranked"))).toContainEqual(["Other", ["ranked=All ranked"]]);
  });
});

describe("filter in the URL", () => {
  test("a filter round-trips through its query value", () => {
    for (const f of ["everything", "ranked", "casual", "extra", "private", { playlist: 53 }] as const) expect(parseFilter(filterValue(f))).toEqual({ filter: f, bad: false });
  });

  test("left out means everything; a bad value falls back to everything and says so", () => {
    expect(parseFilter(null)).toEqual({ filter: "everything", bad: false });
    expect(parseFilter("bogus")).toEqual({ filter: "everything", bad: true });
  });
});
