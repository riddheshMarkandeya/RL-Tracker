import { expect, test } from "vitest";
import { staleAfter, staleAfterTables } from "./invalidation";

const q = (queryKey: readonly unknown[], data?: unknown) => ({ queryKey, state: { data } });
// A match's session started today or yesterday (its first match may have begun before the cutoff).
const TODAY = "2026-10-26";
const YESTERDAY = "2026-10-25";
const detail = (key: string, next: string | null, day = "2026-10-24", nextMonth: string | null = "N") => q(["session", key, "everything"], { key, next, day, nextMonth });

test("an older session's detail from before that day is spared: a new match or a break can't move it", () => {
  expect(staleAfter("C", TODAY)(detail("A", "B"))).toBe(false);
  expect(staleAfter(null, null)(detail("A", "B"))).toBe(false);
});

test("after a match, an older session of that day or later is stale: a new session there changes its \"1st of N that day\"", () => {
  expect(staleAfter("C", TODAY)(detail("A", "B", YESTERDAY))).toBe(true);
  expect(staleAfter("C", TODAY)(detail("A", "B", "2026-10-26"))).toBe(true);
});

test("after a match, an older session with no next month yet is stale: the match may have started one", () => {
  expect(staleAfter("C", TODAY)(detail("A", "B", "2026-09-10", null))).toBe(true);
  expect(staleAfter(null, null)(detail("A", "B", "2026-09-10", null))).toBe(false);
  // Not this month's: only a month after its own can gain a first session.
  expect(staleAfter("C", TODAY)(detail("A", "B", "2026-10-02", null))).toBe(false);
  // Across a month boundary: a match on the 1st can start that month's first session.
  expect(staleAfter("C", "2026-11-01")(detail("A", "B", "2026-10-15", null))).toBe(true);
});

test("a detail of a shape it doesn't know is stale", () => {
  const unknown = q(["session", "A", "everything"], { key: "A", next: "B", nextMonth: "N" });
  expect(staleAfter("C", TODAY)(unknown)).toBe(true);
  expect(staleAfter(null, null)(unknown)).toBe(true);
});

test("a break starts no session, so it spares older sessions of any day", () => {
  expect(staleAfter(null, null)(detail("A", "B", YESTERDAY))).toBe(false);
});

test("the event's own session, and the newest one (no next yet), are stale", () => {
  expect(staleAfter("C", TODAY)(detail("C", null))).toBe(true);
  expect(staleAfter("C", TODAY)(detail("C", "D"))).toBe(true);
  expect(staleAfter("D", TODAY)(detail("C", null))).toBe(true);
  expect(staleAfter(null, null)(detail("C", null))).toBe(true);
});

test("a detail with no data yet is stale", () => {
  expect(staleAfter("C", TODAY)(q(["session", "A", "everything"]))).toBe(true);
});

test("every other key is stale by default, lists and keys added later alike", () => {
  expect(staleAfter("C", TODAY)(q(["sessions", "list", "everything", "2026-10-01", "2026-10-14"]))).toBe(true);
  expect(staleAfter("C", TODAY)(q(["sessions", "current", "everything"], { session: null }))).toBe(true);
  expect(staleAfter("C", TODAY)(q(["period", "last7", "ranked"], {}))).toBe(true);
  expect(staleAfter(null, null)(q(["something-new"]))).toBe(true);
});

test("settings are spared: only a save changes them, and it writes the answer into the cache", () => {
  expect(staleAfter("C", TODAY)(q(["settings"], {}))).toBe(false);
  expect(staleAfter(null, null)(q(["settings"], {}))).toBe(false);
});

test("after an ids or seasons save, everything but settings and the two tables is stale", () => {
  // Neither table's rows depend on the other's, and the save put its own answer in the cache.
  expect(staleAfterTables(q(["ids"], {}))).toBe(false);
  expect(staleAfterTables(q(["seasons"], {}))).toBe(false);
  expect(staleAfterTables(q(["settings"], {}))).toBe(false);
  expect(staleAfterTables(q(["session", "A", "everything"], { key: "A", next: "B", day: "2026-01-01", nextMonth: "N" }))).toBe(true);
  expect(staleAfterTables(q(["period", "last7", "ranked"], {}))).toBe(true);
  expect(staleAfterTables(q(["something-new"]))).toBe(true);
});
