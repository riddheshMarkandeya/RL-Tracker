import { expect, test } from "vitest";
import type { SessionSummary } from "../../shared/schemas/responses";
import { chipText } from "./chip";

const session = (wins: number, losses: number): SessionSummary => ({
  key: "g1", day: "2026-10-21", ordinal: 1, ofDay: 1, startedAt: 0, endedAt: 1, matches: wins + losses, wins, losses, results: [],
});

test("the chip shows the session's W–L with an en dash", () => {
  expect(chipText(session(4, 2))).toBe("This session: 4–2");
  expect(chipText(session(0, 1))).toBe("This session: 0–1");
});

test("no session, no chip (no fake 0–0)", () => {
  expect(chipText(null)).toBeNull();
  expect(chipText(undefined)).toBeNull();
});

test("a session with no result yet (every match without a W/L) shows no chip rather than 0–0", () => {
  expect(chipText({ ...session(0, 0), matches: 2, results: [null, null] })).toBeNull();
});
