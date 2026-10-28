// The Trends page's two charts as pure geometry: the big chart of the selected metric (By date per
// bucket, or By match as a rolling average) and the W/L bars with where each bucket opens. Both are
// laid out at the measured pixel width, so axis text keeps its size on a phone.
import { dayOf, dayStart, monthOf, type Season } from "../../shared/periods";
import type { PeriodView } from "../../shared/schemas/responses";
import type { BucketKind } from "../../shared/trends";
import { dayLabel, monthLabel, plural, shortDayLabel, shortMonthLabel } from "./format";
import { recapPath } from "./recap";
import { metricValue, patchTrends, polyline, rawValue, trendsPath, type MetricId, type TrendsState, type XAsk, type XMode } from "./trends";

type ViewBucket = PeriodView["buckets"][number];
interface Box {
  width: number;
  height: number;
}

/** Under this many buckets with matches, auto shows By match… */
export const AUTO_BELOW = 6;
/** …if the rolling line has at least this many points. */
export const AUTO_MIN_POINTS = 6;
/** Past this many points the line stands alone, without dots. */
export const MAX_DOTS = 80;
/** The narrowest hover column, in px. */
const MIN_COLUMN = 4;

export interface ChartMode {
  mode: XMode;
  auto: boolean;
  withData: number;
}

export function chartMode(asked: XAsk, buckets: readonly ViewBucket[], rollingPoints: number): ChartMode {
  const withData = buckets.filter((b) => b.stats.matches > 0).length;
  if (asked !== "auto") return { mode: asked, auto: false, withData };
  const auto = withData < AUTO_BELOW && rollingPoints >= AUTO_MIN_POINTS;
  return { mode: auto ? "match" : "date", auto, withData };
}

export const autoNote = (withData: number, kind: BucketKind, window: number): string =>
  `Only ${plural(withData, kind)} with matches here, so this shows a rolling average of ${String(window)} matches instead. Pick By date to see them.`;

/** The big chart's heading after the metric: "per day", or "rolling 20 matches". */
export const modeText = (mode: XMode, kind: BucketKind, window: number): string => (mode === "match" ? `rolling ${String(window)} matches` : `per ${kind}`);

/** What the passive chart says to a screen reader: its numbers are the tiles'. */
export function chartSummary(metric: string, mode: XMode, kind: BucketKind, window: number, points: number, avg: string | null): string {
  const over = mode === "match" ? `over ${plural(points, "match", "matches")}` : `over ${plural(points, kind)}`;
  return `${metric} ${modeText(mode, kind, window)} ${over}${avg === null ? "" : `; period average ${avg}`}`;
}

export function bucketLabel(day: string, kind: BucketKind, locale?: string): string {
  if (kind === "month") return monthLabel(monthOf(day), locale);
  return kind === "week" ? `Week of ${dayLabel(day, locale)}` : dayLabel(day, locale);
}

/** The x axis's few labels, from a bucket's first day (a clipped week starts where the period does): "13 Oct", or "Oct 2026" for a month. */
function shortLabel(day: string, kind: BucketKind, locale?: string): string {
  return kind === "month" ? shortMonthLabel(monthOf(day), locale) : shortDayLabel(day, locale);
}

export interface LinePoint {
  value: number | null;
  hollow: boolean;
  /** The hover text. */
  title: string;
  /** The x axis label. */
  short: string;
}

/** Under this many matches a bucket's dot is hollow: its value swings on one game. */
export const FEW = 3;

export function linePoints(mode: XMode, metric: MetricId, view: Pick<PeriodView, "bucket" | "buckets" | "rolling">, window: number, locale?: string): LinePoint[] {
  if (mode === "match") {
    return view.rolling.map((r) => {
      const short = shortDayLabel(dayOf(r.startedAt), locale);
      const reaches = r.n < window ? " (reaches before this period)" : "";
      return {
        value: rawValue(metric, r.stats),
        hollow: false,
        title: `Match ${String(r.n)} · ${short}: ${metricValue(metric, r.stats)} · last ${String(window)} matches${reaches}`,
        short,
      };
    });
  }
  return view.buckets.map((b) => {
    const n = b.stats.matches;
    const label = bucketLabel(b.day, view.bucket, locale);
    const few = n > 0 && n < FEW;
    return {
      value: n > 0 ? rawValue(metric, b.stats) : null,
      hollow: few,
      title: n > 0 ? `${label}: ${metricValue(metric, b.stats)} · ${plural(n, "match", "matches")}${few ? ` (under ${String(FEW)})` : ""}` : `${label}: no matches`,
      short: shortLabel(dayOf(b.from), view.bucket, locale),
    };
  });
}

export interface LineGeometry {
  yTicks: { y: number; label: string }[];
  path: string;
  dots: { x: number; y: number; hollow: boolean }[];
  avgY: number | null;
  xLabels: { x: number; text: string; anchor: "start" | "middle" | "end" }[];
  /** Hover areas across the plot; each stands for its nearest point `i`. */
  columns: { x: number; w: number; i: number }[];
  /** Point `i`'s x. */
  xOf: (i: number) => number;
  plot: { left: number; right: number; top: number; bottom: number };
}

export const LINE_PAD = { l: 44, r: 10, t: 12, b: 22 };

/**
 * Fitted to the points and the average, padded by 15% and never below 0 (a rate never above 100%).
 * Null when no point has a value.
 */
export function lineGeometry(points: readonly LinePoint[], avg: number | null, { width, height }: Box, { fmt, rate }: { fmt: (v: number) => string; rate: boolean }): LineGeometry | null {
  const have = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  if (!have.length) return null;
  // A loop, not Math.min(...xs): By match on All time can pass more values than a call takes.
  let a = avg ?? Infinity;
  let b = avg ?? -Infinity;
  for (const v of have) {
    a = Math.min(a, v);
    b = Math.max(b, v);
  }
  const span = b - a || Math.abs(b) || 1;
  const lo = Math.max(0, a - span * 0.15);
  const hi = rate ? Math.min(1, b + span * 0.15) : b + span * 0.15;
  const plot = { left: LINE_PAD.l, right: width - LINE_PAD.r, top: LINE_PAD.t, bottom: height - LINE_PAD.b };
  const iw = plot.right - plot.left;
  const ih = plot.bottom - plot.top;
  const n = points.length;
  const x = (i: number) => plot.left + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => plot.bottom - ((v - lo) / (hi - lo)) * ih;

  const at = points.flatMap((p, i) => (p.value === null ? [] : [{ x: x(i), y: y(p.value), hollow: p.hollow }]));
  const count = Math.max(1, Math.min(n, Math.floor(iw / MIN_COLUMN)));
  // Points spread end to end, so the first and last always have one; each column runs halfway to
  // its neighbours' points, so it holds the area nearest its own.
  const picked = Array.from({ length: count }, (_, c) => (count < 2 ? 0 : Math.round((c * (n - 1)) / (count - 1))));
  const edge = (c: number) => (c <= 0 ? plot.left : c >= count ? plot.left + iw : (x(picked[c - 1] ?? 0) + x(picked[c] ?? 0)) / 2);
  const columns = picked.map((i, c) => ({ x: edge(c), w: edge(c + 1) - edge(c), i }));
  const labelAt = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return {
    yTicks: [lo, (lo + hi) / 2, hi].map((v) => ({ y: y(v), label: fmt(v) })),
    path: polyline(at),
    dots: n <= MAX_DOTS ? at : [],
    avgY: avg === null ? null : y(avg),
    xLabels: labelAt.map((i, j) => ({
      x: x(i),
      text: points[i]?.short ?? "",
      anchor: labelAt.length < 2 ? "middle" : j === 0 ? "start" : j === labelAt.length - 1 ? "end" : "middle",
    })),
    columns,
    xOf: x,
    plot,
  };
}

/** A season that starts strictly inside the plotted buckets, at the bucket holding its start. */
export function seasonMarks(buckets: readonly ViewBucket[], seasons: readonly Season[]): { i: number; name: string }[] {
  const from = buckets[0]?.from;
  const to = buckets.at(-1)?.to;
  if (from === undefined || to === undefined) return [];
  return seasons.flatMap((s) => {
    const start = dayStart(s.startDate);
    const i = buckets.findIndex((b) => start >= b.from && start < b.to);
    return start > from && start < to && i >= 0 ? [{ i, name: s.name }] : [];
  });
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rounded at the data end only, square at the baseline. */
  d: string;
}

export const WL_PAD = { l: 22, r: 6, t: 6, b: 20 };
const MAX_BAR = 24;
const BAR_GAP = 2;
const BAR_ROUND = 4;

function bar(x: number, y: number, w: number, h: number, up: boolean): Bar {
  const r = Math.min(BAR_ROUND, w / 2, h);
  const f = (v: number) => v.toFixed(1);
  const d = up
    ? `M${f(x)} ${f(y + h)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h)}Z`
    : `M${f(x)} ${f(y)}V${f(y + h - r)}Q${f(x)} ${f(y + h)} ${f(x + r)} ${f(y + h)}H${f(x + w - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w)} ${f(y + h - r)}V${f(y)}Z`;
  return { x, y, w, h, d };
}

export interface WlGeometry {
  mid: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** One per bucket: its full-height column, and its bars (null where the count is 0). */
  columns: { x: number; w: number; win: Bar | null; loss: Bar | null }[];
  xLabels: { x: number; text: string; anchor: "start" | "end" }[];
}

/** Wins up, losses down from a middle baseline, scaled to the largest count. */
export function wlGeometry(buckets: readonly ViewBucket[], { width, height }: Box, labels: { first: string; last: string } = { first: "", last: "" }): WlGeometry {
  const plot = { left: WL_PAD.l, right: width - WL_PAD.r, top: WL_PAD.t, bottom: height - WL_PAD.b };
  const iw = plot.right - plot.left;
  const mid = (plot.top + plot.bottom) / 2;
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.stats.wins ?? 0, b.stats.losses ?? 0)));
  const bw = buckets.length ? iw / buckets.length : iw;
  const w = Math.min(MAX_BAR, Math.max(1, bw - BAR_GAP));
  const scale = (v: number) => (v / max) * ((plot.bottom - plot.top) / 2 - 2);
  const columns = buckets.map((b, i) => {
    const cx = plot.left + i * bw;
    const bx = cx + (bw - w) / 2;
    const wins = b.stats.wins ?? 0;
    const losses = b.stats.losses ?? 0;
    return {
      x: cx,
      w: bw,
      win: wins > 0 ? bar(bx, mid - 1 - scale(wins), w, scale(wins), true) : null,
      loss: losses > 0 ? bar(bx, mid + 1, w, scale(losses), false) : null,
    };
  });
  return {
    mid,
    plot,
    columns,
    xLabels: [
      { x: plot.left, text: labels.first, anchor: "start" },
      { x: plot.right, text: labels.last, anchor: "end" },
    ],
  };
}

/** The W/L axis's first and last labels. */
export const wlEnds = (buckets: readonly ViewBucket[], kind: BucketKind, locale?: string) => {
  const label = (day: string | undefined) => (day === undefined ? "" : shortLabel(day, kind, locale));
  const last = buckets.at(-1);
  return { first: label(buckets[0] && dayOf(buckets[0].from)), last: label(last && dayOf(last.from)) };
};

/** Where a bucket's column goes: a day's recap under the filter, or that week or month on Trends; null for an empty bucket. */
export function bucketHref(b: ViewBucket, kind: BucketKind, state: TrendsState): string | null {
  if (b.stats.matches === 0) return null;
  if (kind === "day") return b.session === null ? null : recapPath(b.session, state.filter);
  return trendsPath(patchTrends(state, { spec: { kind, day: b.day }, year: null }));
}

/** "Tue 13 Oct: 3 wins, 2 losses", or "…: no matches". */
export function wlRecord(b: ViewBucket, kind: BucketKind, locale?: string): string {
  const record = b.stats.matches ? `${plural(b.stats.wins ?? 0, "win")}, ${plural(b.stats.losses ?? 0, "loss", "losses")}` : "no matches";
  return `${bucketLabel(b.day, kind, locale)}: ${record}`;
}

export function wlLabel(b: ViewBucket, kind: BucketKind, locale?: string): string {
  return `${wlRecord(b, kind, locale)}. ${kind === "day" ? "Open its recap." : `Open that ${kind}.`}`;
}
