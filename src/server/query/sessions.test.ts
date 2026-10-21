import { describe, expect, test } from "vitest";
import { SESSION_GAP_MS } from "../../shared/constants";
import { currentSession, cutSessions, sessionsPlayed, type SessionMatch } from "./sessions";

// Sessions work on instants only, so no time zone is involved.
const MIN = 60_000;
const m = (guid: string, startMin: number, lengthMin = 6): SessionMatch => ({ guid, startedAt: startMin * MIN, endedAt: (startMin + lengthMin) * MIN });
const keys = (ms: SessionMatch[], breaks: number[] = []) => cutSessions(ms, breaks).map((s) => s.guids);

describe("cutSessions", () => {
  test("no matches, no sessions", () => {
    expect(cutSessions([], [])).toEqual([]);
  });

  test("a gap of exactly 30 min keeps the session; 1 ms more cuts it", () => {
    const a = m("a", 0, 6);
    const b: SessionMatch = { guid: "b", startedAt: a.endedAt + SESSION_GAP_MS, endedAt: a.endedAt + SESSION_GAP_MS + 6 * MIN };
    const c: SessionMatch = { guid: "c", startedAt: b.endedAt + SESSION_GAP_MS + 1, endedAt: b.endedAt + SESSION_GAP_MS + 1 + 6 * MIN };
    expect(keys([a, b, c])).toEqual([["a", "b"], ["c"]]);
  });

  test("the gap is measured from the latest end so far, when matches overlap", () => {
    // b starts inside a and ends before it; c is 30 min after a's end but 40 after b's.
    const a = m("a", 0, 20);
    const b = m("b", 5, 5);
    const c = m("c", 50);
    expect(keys([a, b, c])).toEqual([["a", "b", "c"]]);
  });

  test("a session spans its first start to its latest end, keyed by the first match", () => {
    const [s] = cutSessions([m("b", 10), m("a", 0, 30)], []);
    expect(s).toEqual({ key: "a", guids: ["a", "b"], startedAt: 0, endedAt: 30 * MIN, lastStartedAt: 10 * MIN });
  });

  test("unsorted input is sorted by start, then guid", () => {
    expect(keys([m("c", 20), m("b", 0), m("a", 0), m("d", 10)])).toEqual([["a", "b", "d", "c"]]);
  });

  test("a break between matches cuts there; one before the first or after the last doesn't", () => {
    const ms = [m("a", 0), m("b", 10), m("c", 20)];
    expect(keys(ms, [-5 * MIN, 8 * MIN, 40 * MIN])).toEqual([["a"], ["b", "c"]]);
  });

  test("a break at the next match's exact start cuts; one at the previous start doesn't", () => {
    const ms = [m("a", 0), m("b", 10)];
    expect(keys(ms, [10 * MIN])).toEqual([["a"], ["b"]]);
    expect(keys(ms, [0])).toEqual([["a", "b"]]);
  });

  test("a break during a match cuts before the next one", () => {
    expect(keys([m("a", 0), m("b", 10)], [3 * MIN])).toEqual([["a"], ["b"]]);
  });

  test("several breaks between two matches cut once; breaks elsewhere cut too", () => {
    const ms = [m("a", 0), m("b", 10), m("c", 20), m("d", 30)];
    expect(keys(ms, [7 * MIN, 8 * MIN, 25 * MIN])).toEqual([["a"], ["b", "c"], ["d"]]);
  });
});

describe("sessionsPlayed", () => {
  const sessions = cutSessions([m("a", 0), m("b", 10), m("c", 100), m("d", 200)], []);
  const row = (guid: string, playlistId: number, played = true) => ({ guid, playlistId, me: played ? {} : null });

  test("keeps sessions with one of your matches under the filter", () => {
    // a+b: ranked and spectated; c: private only; d: spectated only.
    const rows = [row("a", 13), row("b", 13, false), row("c", 6), row("d", 13, false)];
    expect(sessionsPlayed(sessions, rows, "everything").map((s) => s.key)).toEqual(["a"]);
    expect(sessionsPlayed(sessions, rows, "private").map((s) => s.key)).toEqual(["c"]);
  });
});

describe("currentSession", () => {
  const sessions = cutSessions([m("a", 0), m("b", 10)], []);
  const end = 16 * MIN;

  test("the last session while within the gap of its end", () => {
    expect(currentSession(sessions, [], end + SESSION_GAP_MS)?.key).toBe("a");
  });

  test("none once the gap has passed", () => {
    expect(currentSession(sessions, [], end + SESSION_GAP_MS + 1)).toBeNull();
  });

  test("none after a break placed after its last match began", () => {
    expect(currentSession(sessions, [12 * MIN], end + MIN)).toBeNull();
    expect(currentSession(sessions, [end + MIN], end + 2 * MIN)).toBeNull();
  });

  test("a break before its last match doesn't end it", () => {
    expect(currentSession(cutSessions([m("a", 0)], [-MIN]), [-MIN], 7 * MIN)?.key).toBe("a");
  });

  test("none without sessions", () => {
    expect(currentSession([], [], 0)).toBeNull();
  });
});
