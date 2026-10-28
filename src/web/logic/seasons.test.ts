import { describe, expect, test } from "vitest";
import { conflictError, seasonErrors, seasonRows } from "./seasons";

const S22 = { id: 1, name: "S22", startDate: "2026-03-11" };
const S23 = { id: 2, name: "S23", startDate: "2026-06-09" };
const S24 = { id: 3, name: "S24", startDate: "2026-09-23" };

describe("seasonRows", () => {
  test("ordered by start; each ends the day before the next starts; the one holding today is current", () => {
    expect(seasonRows([S24, S22, S23], "2026-07-01")).toEqual([
      { ...S22, end: "2026-06-08", state: "past" },
      { ...S23, end: "2026-09-22", state: "current" },
      { ...S24, end: null, state: "upcoming" },
    ]);
  });

  test("the last one is still running once it has started, current from its first day", () => {
    expect(seasonRows([S22, S24], "2026-09-23").at(-1)).toEqual({ ...S24, end: null, state: "current" });
    expect(seasonRows([S22, S24], "2026-09-22")).toEqual([
      { ...S22, end: "2026-09-22", state: "current" },
      { ...S24, end: null, state: "upcoming" },
    ]);
  });

  test("before the first season, none is current", () => {
    expect(seasonRows([S22], "2026-01-01")).toEqual([{ ...S22, end: null, state: "upcoming" }]);
  });
});

describe("seasonErrors", () => {
  const rows = [S22, S23, S24];
  test("a blank name and a missing or bad date", () => {
    expect(seasonErrors(rows, { name: "  ", start: "" })).toEqual({ name: "Give it a name.", start: "Pick a start date." });
    expect(seasonErrors(rows, { name: "S25", start: "2026-02-30" })).toEqual({ start: "Pick a start date." });
  });

  test("a name too long", () => {
    expect(seasonErrors(rows, { name: "x".repeat(21), start: "2026-12-09" })).toEqual({ name: "Keep it to 20 characters." });
  });

  test("a name another season has, in any case, and a start another season has", () => {
    expect(seasonErrors(rows, { name: " s23 ", start: "2026-09-23" })).toEqual({ name: "Another season is called S23.", start: "S24 already starts on that day." });
  });

  test("case folds only A-Z, as the server's NOCASE does, so the form never refuses what the server takes", () => {
    expect(seasonErrors([{ id: 9, name: "Été", startDate: "2026-12-09" }], { name: "été", start: "2027-03-09" })).toEqual({});
  });

  test("a row checked against itself doesn't clash", () => {
    expect(seasonErrors(rows, { name: "S23", start: "2026-06-09" }, 2)).toEqual({});
    expect(seasonErrors(rows, { name: "S25", start: "2026-12-09" })).toEqual({});
  });
});

describe("conflictError", () => {
  test("the server's clash codes give the same text as the form", () => {
    expect(conflictError("duplicate_name", [S22], { name: "s22", start: "2026-12-09" })).toEqual({ name: "Another season is called S22." });
    expect(conflictError("duplicate_start", [S22], { name: "S25", start: "2026-03-11" })).toEqual({ start: "S22 already starts on that day." });
  });

  test("a clash the page's list doesn't show yet still names the field", () => {
    expect(conflictError("duplicate_name", [], { name: "S25", start: "2026-12-09" })).toEqual({ name: "Another season is called S25." });
    expect(conflictError("duplicate_start", [], { name: "S25", start: "2026-12-09" })).toEqual({ start: "Another season already starts on that day." });
  });
});
