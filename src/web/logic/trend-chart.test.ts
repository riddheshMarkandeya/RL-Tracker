import { describe, expect, test } from "vitest";
import { dayStart, shiftDay, type Season } from "../../shared/periods";
import type { PeriodView } from "../../shared/schemas/responses";
import type { TrendStats } from "../../shared/trends";
import { autoNote, bucketHref, bucketLabel, chartMode, chartSummary, LINE_PAD, modeText, linePoints, lineGeometry, seasonMarks, wlEnds, wlGeometry, wlLabel, wlRecord, type LinePoint } from "./trend-chart";
import type { TrendsState } from "./trends";

type ViewBucket = PeriodView["buckets"][number];

const stats = (matches: number, wins = matches, extra: Partial<TrendStats> = {}): TrendStats => ({
  matches,
  wins: matches ? wins : null,
  losses: matches ? matches - wins : null,
  winPct: matches ? wins / matches : null,
  shootingPct: null,
  perGame: { goals: null, assists: null, saves: null, shots: null },
  ...extra,
});

/** Day buckets from `from`, one per entry of `matches`. */
function days(from: string, matches: number[]): ViewBucket[] {
  return matches.map((n, i) => {
    const day = shiftDay(from, i);
    return { from: dayStart(day), to: dayStart(shiftDay(day, 1)), day, stats: stats(n), session: n ? `s-${day}` : null };
  });
}

function first(bs: ViewBucket[]): ViewBucket {
  const [b] = bs;
  if (!b) throw new Error("no bucket");
  return b;
}

const rolling = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1, startedAt: dayStart("2026-10-05") + i, stats: stats(20, 10) }));

describe("the x axis", () => {
  test("auto picks By match under 6 buckets with matches, when the rolling line has 6 points", () => {
    const five = days("2026-10-01", [1, 1, 1, 1, 1, 0, 0]);
    expect(chartMode("auto", five, 6)).toEqual({ mode: "match", auto: true, withData: 5 });
    expect(chartMode("auto", five, 5)).toEqual({ mode: "date", auto: false, withData: 5 });
    expect(chartMode("auto", days("2026-10-01", [1, 1, 1, 1, 1, 1]), 40)).toEqual({ mode: "date", auto: false, withData: 6 });
  });

  test("an asked mode wins", () => {
    const five = days("2026-10-01", [1, 1, 1, 1, 1]);
    expect(chartMode("date", five, 40).mode).toBe("date");
    expect(chartMode("match", days("2026-10-01", [1, 1, 1, 1, 1, 1, 1]), 0)).toEqual({ mode: "match", auto: false, withData: 7 });
  });

  test("the auto note names the bucket kind", () => {
    expect(autoNote(2, "day", 20)).toBe("Only 2 days with matches here, so this shows a rolling average of 20 matches instead. Pick By date to see them.");
    expect(autoNote(1, "week", 20)).toMatch(/^Only 1 week with matches here/);
    expect(autoNote(1, "week", 10)).toContain("a rolling average of 10 matches");
  });
});

describe("labels", () => {
  test("the heading and the chart's summary", () => {
    expect(modeText("date", "week", 20)).toBe("per week");
    expect(modeText("match", "day", 20)).toBe("rolling 20 matches");
    expect(modeText("match", "day", 35)).toBe("rolling 35 matches");
    expect(chartSummary("Win %", "date", "day", 20, 30, "52%")).toBe("Win % per day over 30 days; period average 52%");
    expect(chartSummary("Win %", "match", "day", 20, 1, null)).toBe("Win % rolling 20 matches over 1 match");
  });

  test("per kind", () => {
    expect(bucketLabel("2026-10-13", "day", "en-GB")).toBe("Tue 13 Oct");
    expect(bucketLabel("2026-10-12", "week", "en-GB")).toBe("Week of Mon 12 Oct");
    expect(bucketLabel("2026-10-01", "month", "en-GB")).toBe("October 2026");
  });

  test("a W/L column says its record and where it goes", () => {
    const b = first(days("2026-10-13", [5]));
    expect(wlLabel({ ...b, stats: stats(5, 3) }, "day", "en-GB")).toBe("Tue 13 Oct: 3 wins, 2 losses. Open its recap.");
    expect(wlLabel({ ...b, day: "2026-10-12", stats: stats(1) }, "week", "en-GB")).toBe("Week of Mon 12 Oct: 1 win, 0 losses. Open that week.");
    expect(wlRecord({ ...b, stats: stats(0) }, "day", "en-GB")).toBe("Tue 13 Oct: no matches");
  });
});

describe("points", () => {
  const view = (buckets: ViewBucket[], n = 0) => ({ bucket: "day" as const, buckets, rolling: rolling(n) });

  test("by date: a value per bucket with matches, hollow under 3, a title per point", () => {
    const pts = linePoints("date", "win", view(days("2026-10-13", [2, 0, 4])), 20, "en-GB");
    expect(pts.map((p) => [p.value, p.hollow])).toEqual([
      [1, true],
      [null, false],
      [1, false],
    ]);
    expect(pts.map((p) => p.title)).toEqual(["Tue 13 Oct: 100% · 2 matches (under 3)", "Wed 14 Oct: no matches", "Thu 15 Oct: 100% · 4 matches"]);
  });

  test("by match: each point's window, and whether it reaches before the period", () => {
    const pts = linePoints("match", "win", view([], 21), 20, "en-GB");
    expect(pts).toHaveLength(21);
    expect(pts[0]?.title).toBe("Match 1 · 5 Oct: 50% · last 20 matches (reaches before this period)");
    expect(pts[20]?.title).toBe("Match 21 · 5 Oct: 50% · last 20 matches");
    expect(pts.every((p) => !p.hollow)).toBe(true);
    const ten = linePoints("match", "win", view([], 21), 10, "en-GB");
    expect([ten[8]?.title.endsWith("last 10 matches (reaches before this period)"), ten[9]?.title.endsWith("last 10 matches")]).toEqual([true, true]);
  });
});

const pt = (value: number | null, hollow = false): LinePoint => ({ value, hollow, title: "", short: "" });
const box = { width: 400, height: 200 };
const fmt = (v: number) => v.toFixed(2);

describe("the line chart's geometry", () => {
  test("the y range includes the average and stays at or above 0", () => {
    const g = lineGeometry([pt(0.2), pt(0.3)], 0.9, box, { fmt, rate: false });
    const ys = g?.yTicks.map((t) => Number(t.label)) ?? [];
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeGreaterThan(0.9);
  });

  test("a rate never runs past 100%; a flat series still gets a span", () => {
    const g = lineGeometry([pt(1), pt(1)], 1, box, { fmt, rate: true });
    expect(g?.yTicks.map((t) => t.label)).toEqual(["0.85", "0.93", "1.00"]);
    const flat = lineGeometry([pt(0), pt(0)], 0, box, { fmt, rate: false });
    expect(new Set(flat?.yTicks.map((t) => t.y)).size).toBe(3);
  });

  test("a single point is centred", () => {
    const g = lineGeometry([pt(0.5)], 0.5, box, { fmt, rate: true });
    const left = g?.columns[0];
    expect(g?.dots[0]?.x).toBeCloseTo((left?.x ?? 0) + (left?.w ?? 0) / 2);
  });

  test("the path skips empty points; nothing to plot gives null", () => {
    const g = lineGeometry([pt(0.5), pt(null), pt(0.7)], 0.6, box, { fmt, rate: true });
    expect(g?.path.match(/[ML]/g)).toEqual(["M", "L"]);
    expect(g?.dots).toHaveLength(2);
    expect(lineGeometry([pt(null)], null, box, { fmt, rate: true })).toBeNull();
  });

  test("hollow dots under 3 matches; no dots past 80 points", () => {
    expect(lineGeometry([pt(0.5, true), pt(0.6)], 0.5, box, { fmt, rate: true })?.dots.map((d) => d.hollow)).toEqual([true, false]);
    const many = Array.from({ length: 81 }, (_, i) => pt(i % 2));
    expect(lineGeometry(many, 0.5, box, { fmt, rate: true })?.dots).toEqual([]);
  });

  test("hover columns are capped at one per 4 px, each standing for its nearest point", () => {
    const many = Array.from({ length: 1000 }, (_, i) => pt(i % 2));
    const g = lineGeometry(many, 0.5, box, { fmt, rate: true });
    const cols = g?.columns ?? [];
    expect(cols.length).toBeLessThanOrEqual(400 / 4);
    expect(cols[0]?.i).toBe(0);
    expect(cols.at(-1)?.i).toBe(999);
    const few = lineGeometry([pt(1), pt(2), pt(3)], 2, box, { fmt, rate: false });
    expect(few?.columns.map((c) => c.i)).toEqual([0, 1, 2]);
  });

  test("each hover column holds the area nearest its point, the plot end to end", () => {
    const g = lineGeometry([pt(1), pt(2), pt(3)], 2, box, { fmt, rate: false });
    const left = LINE_PAD.l;
    const right = box.width - LINE_PAD.r;
    const midX = (left + right) / 2;
    expect(g?.columns.map((c) => [c.x, c.x + c.w])).toEqual([
      [left, (left + midX) / 2],
      [(left + midX) / 2, (midX + right) / 2],
      [(midX + right) / 2, right],
    ]);
    expect(g?.xOf(1)).toBe(midX);
  });

  test("x labels: first, middle and last", () => {
    const pts = ["a", "b", "c", "d", "e"].map((short) => ({ ...pt(1), short }));
    expect(lineGeometry(pts, 1, box, { fmt, rate: false })?.xLabels.map((l) => [l.text, l.anchor])).toEqual([
      ["a", "start"],
      ["c", "middle"],
      ["e", "end"],
    ]);
  });
});

describe("season marks", () => {
  const seasons: Season[] = [
    { id: 1, name: "S22", startDate: "2026-03-11" },
    { id: 2, name: "S23", startDate: "2026-10-03" },
    { id: 3, name: "S24", startDate: "2026-10-01" },
  ];

  test("only a start strictly inside the plotted span, at the bucket holding it", () => {
    expect(seasonMarks(days("2026-10-01", [0, 0, 0, 0, 0]), seasons)).toEqual([{ i: 2, name: "S23" }]);
  });

  test("all time's month buckets, from the first one's edge", () => {
    const months = ["2026-02-01", "2026-03-01", "2026-04-01"].map((day, i, all) => ({
      from: dayStart(day),
      to: dayStart(all[i + 1] ?? "2026-05-01"),
      day,
      stats: stats(1),
      session: null,
    }));
    expect(seasonMarks(months, seasons)).toEqual([{ i: 1, name: "S22" }]);
  });
});

describe("the W/L chart", () => {
  test("the axis ends at the buckets' first days, a clipped week at the period's start", () => {
    const week = { ...first(days("2025-12-29", [1])), from: dayStart("2026-01-01"), day: "2025-12-29" };
    expect(wlEnds([week], "week", "en-GB")).toEqual({ first: "1 Jan", last: "1 Jan" });
  });

  test("heights scale to the largest count; a zero bar is left out", () => {
    const bs = days("2026-10-01", [4, 2, 0]).map((b, i) => (i === 1 ? { ...b, stats: stats(2, 0) } : b));
    const g = wlGeometry(bs, box);
    const [a, b, c] = g.columns;
    expect(a?.loss).toBeNull();
    expect(b?.win).toBeNull();
    expect(c?.win ?? c?.loss ?? null).toBeNull();
    expect((b?.loss?.h ?? 0) * 2).toBeCloseTo(a?.win?.h ?? 0);
  });

  test("bars stay at most 24 px wide, with a gap", () => {
    const g = wlGeometry(days("2026-10-01", [1, 1]), { width: 1000, height: 100 });
    expect(g.columns[0]?.win?.w).toBe(24);
    const narrow = wlGeometry(days("2026-10-01", Array.from({ length: 30 }, () => 1)), { width: 300, height: 100 });
    const [first, second] = narrow.columns;
    expect((second?.win?.x ?? 0) - ((first?.win?.x ?? 0) + (first?.win?.w ?? 0))).toBeCloseTo(2);
  });
});

describe("where a bucket goes", () => {
  const state: TrendsState = { spec: { kind: "last30" }, filter: "ranked", metric: "saves", year: 2025, x: "date" };

  test("a day opens its session's recap under the filter; an empty one goes nowhere", () => {
    const bs = days("2026-10-12", [3, 0]);
    expect(bucketHref(first(bs), "day", state)).toBe("/recap/s-2026-10-12?filter=ranked");
    expect(bucketHref(first(bs.slice(1)), "day", state)).toBeNull();
  });

  test("a week or month opens that period on Trends, the year and x axis reset", () => {
    const b = first(days("2026-10-12", [3]));
    expect(bucketHref({ ...b, session: null }, "week", state)).toBe("/trends?kind=week&day=2026-10-12&filter=ranked&metric=saves");
    expect(bucketHref({ ...b, day: "2026-10-01", session: null }, "month", state)).toBe("/trends?kind=month&day=2026-10-01&filter=ranked&metric=saves");
  });
});
