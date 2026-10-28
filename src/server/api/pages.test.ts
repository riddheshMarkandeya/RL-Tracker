import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createQueryReader } from "../query/read";
import { createRecordWriter } from "../records/save";
import { openStorage, type Storage } from "../storage";
import { goal, ME, memoryLogger, player, record, THEM } from "../testing";
import { ROLLING_WINDOW } from "../../shared/trends";
import { createPages } from "./pages";

// Local days follow the process's zone; UTC keeps the expected instants readable.
const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = zone;
});

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-pages-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', 1)", ME);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const MIN = 60_000;
/** A UTC instant on 2026-mm-dd. */
const t = (mo: number, d: number, h: number, mi = 0) => Date.UTC(2026, mo - 1, d, h, mi);
const CASUAL = 2; // Doubles
const RANKED = 13; // Ranked Standard

function seed() {
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  /** A match of yours, 5 minutes long. */
  const play = (guid: string, at: number, { playlistId = RANKED, won = true } = {}) => {
    writer.save(record(guid, at, {}, { endedAt: at + 5 * MIN, playlistId, winnerTeamNum: won ? 0 : 1 }));
  };
  const watch = (guid: string, at: number) => {
    writer.save(record(guid, at, { players: [player(THEM, 0), player("Epic|x|0", 1)], goals: [], statfeed: [] }, { endedAt: at + 5 * MIN }));
  };
  const pages = (now = t(12, 31, 12)) => createPages({ reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), now: () => now });
  return { play, watch, pages };
}

describe("session list", () => {
  test("spectating still cuts sessions but isn't listed; newest first, numbered within the day", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10, 0));
    watch("W", t(10, 10, 10, 25)); // bridges A and E: 50 min apart, each gap under 30
    play("E", t(10, 10, 10, 50), { won: false });
    watch("S", t(10, 10, 14)); // a session with nothing of yours
    play("D", t(10, 10, 18));
    const { sessions } = pages().sessionList("everything", "2026-10-10", "2026-10-10");
    expect(sessions.map((s) => [s.key, s.ordinal, s.ofDay, s.matches, s.wins, s.losses, s.results])).toEqual([
      ["D", 2, 2, 1, 1, 0, ["win"]],
      ["A", 1, 2, 2, 1, 1, ["win", "loss"]],
    ]);
    expect(sessions[1]).toMatchObject({ day: "2026-10-10", startedAt: t(10, 10, 10, 0), endedAt: t(10, 10, 10, 55) });
  });

  test("the numbering counts only the sessions under the filter", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 10), { playlistId: CASUAL });
    play("B", t(10, 10, 14));
    play("C", t(10, 10, 18));
    const ranked = pages().sessionList("ranked", "2026-10-01", "2026-10-31").sessions;
    expect(ranked.map((s) => [s.key, s.ordinal, s.ofDay])).toEqual([
      ["C", 2, 2],
      ["B", 1, 2],
    ]);
  });

  test("the current session comes from the whole cut, even when its latest match was spectated", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 18));
    watch("W", t(10, 10, 18, 20));
    const p = pages(t(10, 10, 18, 40));
    expect(p.sessionList("everything", "2026-10-10", "2026-10-10").currentKey).toBe("A");
    expect(p.currentSummary("everything")?.key).toBe("A");
    expect(p.currentSummary("casual")).toBeNull();
    // Only a key the filtered list can hold.
    expect(p.sessionList("casual", "2026-10-10", "2026-10-10").currentKey).toBeNull();
    // Over the gap after the spectated match's end: no current session.
    expect(pages(t(10, 10, 19, 0)).currentSummary("everything")).toBeNull();
  });

  test("the current chip is null when the current session has only spectating", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    watch("W", t(10, 10, 18));
    expect(pages(t(10, 10, 18, 10)).currentSummary("everything")).toBeNull();
  });
});

describe("a session starting before the 4am cutoff", () => {
  // Starts 03:40 on Nov 1, so its day is Oct 31; its second match starts after 04:00.
  function across() {
    const s = seed();
    s.play("A", t(11, 1, 3, 40));
    s.play("B", t(11, 1, 4, 10), { won: false });
    return s.pages();
  }

  test("is listed whole on the earlier day and folded whole into the earlier month", () => {
    const p = across();
    expect(p.sessionList("everything", "2026-10-31", "2026-10-31").sessions.map((s) => [s.key, s.day, s.matches])).toEqual([["A", "2026-10-31", 2]]);
    expect(p.sessionList("everything", "2026-11-01", "2026-11-01").sessions).toEqual([]);
    expect(p.monthFolds("everything", "2026-12-01").months).toEqual([{ month: "2026-10", sessions: 1, wins: 1, losses: 1 }]);
    expect(p.monthFolds("everything", "2026-10-31").months).toEqual([]);
  });

  test("counts in both periods it touches, each match in its own", () => {
    const p = across();
    for (const [spec, matches] of [
      [{ kind: "day", day: "2026-10-31" }, 1],
      [{ kind: "day", day: "2026-11-01" }, 1],
      [{ kind: "month", day: "2026-10-15" }, 1],
      [{ kind: "month", day: "2026-11-15" }, 1],
      [{ kind: "year", day: "2026-11-15" }, 2],
    ] as const) {
      const period = p.period(spec, "everything", ROLLING_WINDOW);
      expect([period?.aggregate.matches, period?.sessions], JSON.stringify(spec)).toEqual([matches, 1]);
    }
  });
});

describe("session detail", () => {
  test("your matches under the filter, every playlist played, goals, and the current flag", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10), { playlistId: CASUAL, won: false });
    watch("W", t(10, 10, 10, 20));
    const d = pages(t(10, 10, 10, 30)).sessionDetail("A", "ranked");
    expect(d?.current).toBe(true);
    expect(d?.matches.map((m) => m.guid)).toEqual(["A"]);
    expect(d?.aggregate).toMatchObject({ matches: 1, wins: 1 });
    expect(d?.byPlaylist.map((b) => b.playlistId)).toEqual([RANKED]);
    expect(d?.playlistsPresent).toEqual([CASUAL, RANKED]);
    expect(d?.goals.map((g) => g.matchGuid)).toEqual(["A", "A"]);
    expect(d?.summary).toMatchObject({ key: "A", matches: 1 });
    expect([d?.key, d?.startedAt, d?.endedAt]).toEqual(["A", t(10, 10, 10), t(10, 10, 10, 25)]);
  });

  test("an unknown or stale key is null", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10));
    expect(pages().sessionDetail("B", "everything")).toBeNull();
    expect(pages().sessionDetail("nope", "everything")).toBeNull();
  });

  test("prev and next skip sessions with nothing under the filter", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 14), { playlistId: CASUAL });
    watch("W", t(10, 10, 16));
    play("C", t(10, 11, 18));
    play("D", t(10, 12, 18), { playlistId: CASUAL });
    const p = pages();
    expect([p.sessionDetail("C", "ranked")?.prev, p.sessionDetail("C", "ranked")?.next]).toEqual(["A", null]);
    expect([p.sessionDetail("C", "everything")?.prev, p.sessionDetail("C", "everything")?.next]).toEqual(["B", "D"]);
    // A session with nothing under the filter still finds its neighbours by time.
    expect(p.sessionDetail("B", "ranked")).toMatchObject({ summary: null, matches: [], prev: "A", next: "C" });
  });

  test("month steps land on the nearest session in the month before or after, skipping empty months", () => {
    const { play, pages } = seed();
    play("JUL", t(7, 20, 18));
    play("SEP1", t(9, 3, 18));
    play("SEP2", t(9, 20, 18), { playlistId: CASUAL });
    play("SEP3", t(9, 28, 18));
    play("OCT1", t(10, 2, 18));
    play("OCT2", t(10, 9, 18));
    const p = pages();
    const months = (key: string, f: "everything" | "ranked" = "everything") => {
      const d = p.sessionDetail(key, f);
      return [d?.prevMonth, d?.nextMonth];
    };
    // Back to the previous month's newest, on to the next month's first; August is empty.
    expect(months("OCT2")).toEqual(["SEP3", null]);
    expect(months("SEP2")).toEqual(["JUL", "OCT1"]);
    expect(months("JUL")).toEqual([null, "SEP1"]);
    // Under a filter, only its sessions count.
    expect(months("OCT1", "ranked")).toEqual(["SEP3", null]);
  });

  test("the baseline is the 30 days before the start, under the same filter", () => {
    const { play, pages } = seed();
    play("OLD", t(9, 1, 10)); // over 30 days before
    play("R", t(10, 1, 10));
    play("C", t(10, 2, 10), { playlistId: CASUAL, won: false });
    play("S", t(10, 20, 10));
    const p = pages();
    expect(p.sessionDetail("S", "ranked")?.baseline).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    expect(p.sessionDetail("S", "everything")?.baseline).toMatchObject({ matches: 2, wins: 1, losses: 1 });
  });
});

describe("match detail, periods and seasons", () => {
  test("a match with its players, goals, result and session", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10), { won: false });
    const m = pages().matchDetail("B");
    expect(m?.match.guid).toBe("B");
    expect(m?.players.map((x) => [x.playerKey, x.isMe])).toEqual([
      [ME, true],
      [THEM, false],
    ]);
    expect(m?.goals).toHaveLength(2);
    expect([m?.result, m?.sessionKey]).toEqual(["loss", "A"]);
    expect(pages().matchDetail("nope")).toBeNull();
    expect(pages().sessionKeyOf("B")).toBe("A");
  });

  test("a period: its range, your aggregate under the filter, playlists played", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10), { playlistId: CASUAL });
    watch("W", t(10, 10, 12));
    const period = pages().period({ kind: "day", day: "2026-10-10" }, "casual", ROLLING_WINDOW);
    expect(period).toMatchObject({
      range: { from: t(10, 10, 4), to: t(10, 11, 4), running: false },
      aggregate: { matches: 1 },
      playlistsPresent: [CASUAL, RANKED],
      sessions: 1,
    });
    expect(pages().period({ kind: "day", day: "2026-10-10" }, "private", ROLLING_WINDOW)?.sessions).toBe(0);
  });

  test("a period's buckets: a 03:30 match counts toward the day before", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 3, 30));
    play("B", t(10, 10, 12), { won: false });
    const period = pages().period({ kind: "month", day: "2026-10-01" }, "everything", ROLLING_WINDOW);
    expect(period?.bucket).toBe("day");
    expect(period?.buckets).toHaveLength(31);
    const on = (day: string) => period?.buckets.find((b) => b.day === day)?.stats;
    expect(on("2026-10-09")).toMatchObject({ matches: 1, wins: 1, losses: 0, winPct: 1 });
    expect(on("2026-10-10")).toMatchObject({ matches: 1, wins: 0, losses: 1, winPct: 0 });
    expect(on("2026-10-11")).toMatchObject({ matches: 0, winPct: null, perGame: { goals: null } });
  });

  test("a month is compared with the month before, under the same filter", () => {
    const { play, pages } = seed();
    play("S", t(9, 5, 12));
    play("C", t(9, 6, 12), { playlistId: CASUAL });
    play("O", t(10, 5, 12));
    const period = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", ROLLING_WINDOW);
    expect(period?.previous?.range).toEqual({ from: t(9, 1, 4), to: t(10, 1, 4), running: false });
    expect(period?.previous?.aggregate.matches).toBe(1);
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.previous).toBeNull();
  });

  test("all time under a filter starts at the filter's first month", () => {
    const { play, pages } = seed();
    play("C", t(8, 20, 12), { playlistId: CASUAL });
    play("R", t(10, 5, 12));
    const days = (filter: "ranked" | "everything") => pages().period({ kind: "all" }, filter, ROLLING_WINDOW)?.buckets.map((b) => b.day);
    expect(days("ranked")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(days("everything")?.[0]).toBe("2026-08-01");
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.firstDay).toBe("2026-10-05");
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.buckets.map((b) => b.stats.matches)).toEqual([1, 0, 0]);
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.bucket).toBe("month");
  });

  test("rolling points: the first window reaches back before the period, played and under the filter", () => {
    const { play, watch, pages } = seed();
    for (let d = 1; d <= 19; d++) play(`S${String(d)}`, t(9, d, 12));
    play("C", t(9, 25, 12), { playlistId: CASUAL, won: false }); // outside the filter: not counted
    watch("W", t(9, 26, 12)); // spectated: not counted
    play("O1", t(10, 5, 12), { won: false });
    play("O2", t(10, 6, 12), { won: false });
    const { rolling } = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", ROLLING_WINDOW) ?? { rolling: [] };
    expect(rolling.map((p) => [p.n, p.startedAt, p.stats.matches, p.stats.wins])).toEqual([
      [1, t(10, 5, 12), 20, 19],
      [2, t(10, 6, 12), 20, 18],
    ]);
    expect(pages().period({ kind: "month", day: "2026-10-01" }, "casual", ROLLING_WINDOW)?.rolling).toEqual([]);
  });

  test("the rolling window size comes from the caller: with 5 and nothing before, the first point is match 5", () => {
    const { play, pages } = seed();
    for (let d = 1; d <= 6; d++) play(`M${String(d)}`, t(10, d, 12), { won: d % 2 === 0 });
    const { rolling } = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", 5) ?? { rolling: [] };
    expect(rolling.map((p) => [p.n, p.stats.matches, p.stats.wins])).toEqual([
      [5, 5, 2],
      [6, 5, 3],
    ]);
  });

  test("a day bucket opens the day's first listed session under the filter, else the session holding its first match", () => {
    const { play, pages } = seed();
    play("X1", t(10, 10, 3, 30)); // starts on the 9th by the cutoff, runs past it
    play("X2", t(10, 10, 3, 55));
    play("X3", t(10, 10, 4, 20));
    play("K", t(10, 10, 8), { playlistId: CASUAL }); // filtered out
    play("Y", t(10, 10, 12));
    play("Z1", t(10, 20, 3, 40)); // only its tail falls on the 20th
    play("Z2", t(10, 20, 4, 5));
    const period = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", ROLLING_WINDOW);
    const session = (day: string) => period?.buckets.find((b) => b.day === day)?.session;
    expect([session("2026-10-09"), session("2026-10-10"), session("2026-10-19"), session("2026-10-20")]).toEqual(["X1", "Y", "Z1", "Z1"]);
    expect(session("2026-10-11")).toBeNull();
    expect(pages().period({ kind: "month", day: "2026-10-01" }, "casual", ROLLING_WINDOW)?.buckets.find((b) => b.day === "2026-10-10")?.session).toBe("K");
    expect(pages().period({ kind: "this_year" }, "ranked", ROLLING_WINDOW)?.buckets.every((b) => b.session === null)).toBe(true);
  });

  test("played days: per local day under the filter; the first day and total ignore it", () => {
    const { play, watch, pages } = seed();
    play("C", t(3, 2, 12), { playlistId: CASUAL });
    play("A", t(10, 10, 3, 30));
    play("B", t(10, 10, 12));
    play("D", t(10, 9, 20));
    watch("W", t(10, 12, 12));
    play("Y", t(1, 1, 3)); // 2025-12-31 by the cutoff
    expect(pages().playedDays(2026, "ranked")).toEqual({
      days: [
        { day: "2026-10-09", matches: 2 },
        { day: "2026-10-10", matches: 1 },
      ],
      firstDay: "2025-12-31",
      totalMatches: 5,
    });
    expect(pages().playedDays(2025, "everything").days).toEqual([{ day: "2025-12-31", matches: 1 }]);
  });

  test("an unknown season is null; seasons are listed", () => {
    const { pages } = seed();
    expect(pages().period({ kind: "season", id: 99 }, "everything", ROLLING_WINDOW)).toBeNull();
    expect(pages().seasons().map((s) => s.name)).toEqual(["S22", "S23", "S24"]);
  });

  test("the goal list follows the filter", () => {
    const { pages } = seed();
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    writer.save(record("A", t(10, 10, 10), { goals: [goal(0, ME)] }, { endedAt: t(10, 10, 10, 5) }));
    writer.save(record("B", t(10, 10, 10, 10), { goals: [goal(1, THEM)] }, { endedAt: t(10, 10, 10, 15), playlistId: CASUAL }));
    expect(pages().sessionDetail("A", "casual")?.goals.map((g) => g.matchGuid)).toEqual(["B"]);
  });
});
