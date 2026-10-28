// The big chart of the selected metric, By date (a point per bucket) or By match (a rolling
// average whose window reaches back before the period). Passive: each column's value is its SVG
// title on hover, and the period's numbers are the tiles'.
import { useMemo } from "react";
import type { Season } from "../../../shared/periods";
import type { PeriodView } from "../../../shared/schemas/responses";
import { ROLLING_WINDOW, trendStats } from "../../../shared/trends";
import { useWidth } from "../../components/useWidth";
import { autoNote, chartSummary, FEW, lineGeometry, linePoints, modeText, seasonMarks, type ChartMode, type LineGeometry, type LinePoint } from "../../logic/trend-chart";
import { formatMetric, isRate, METRICS, rawValue, type MetricId, type XMode } from "../../logic/trends";
import styles from "./Trends.module.css";

const heightFor = (width: number) => (width < 560 ? 200 : 280);

function Plot({ g, points, width, height, label, marks, avgText }: { g: LineGeometry; points: readonly LinePoint[]; width: number; height: number; label: string; marks: { x: number; name: string }[]; avgText: string | null }) {
  const { plot } = g;
  return (
    <svg className={styles.chart} width={width} height={height} role="img" aria-label={label}>
      {g.yTicks.map((t) => (
        <g key={t.y}>
          <line className={styles.grid} x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} />
          <text className={styles.axis} x={plot.left - 6} y={t.y + 4} textAnchor="end">{t.label}</text>
        </g>
      ))}
      {marks.map((m) => (
        <g key={m.name}>
          <line className={styles.mark} x1={m.x} x2={m.x} y1={plot.top} y2={plot.bottom} />
          <text className={styles.axis} x={m.x + 3} y={plot.top + 10}>{m.name}</text>
        </g>
      ))}
      {g.avgY !== null && avgText !== null && (
        <g>
          <line className={styles.avg} x1={plot.left} x2={plot.right} y1={g.avgY} y2={g.avgY} />
          <text className={styles.axis} x={plot.right} y={g.avgY - 4} textAnchor="end">avg {avgText}</text>
        </g>
      )}
      <path className={styles.line} d={g.path} />
      {g.dots.map((d) => <circle key={`${String(d.x)},${String(d.y)}`} className={d.hollow ? styles.hollow : styles.dot} cx={d.x} cy={d.y} r={4} />)}
      {g.columns.map((c) => (
        <g key={c.x} className={styles.col}>
          <rect x={c.x} y={plot.top} width={c.w} height={plot.bottom - plot.top} />
          <line x1={g.xOf(c.i)} x2={g.xOf(c.i)} y1={plot.top} y2={plot.bottom} />
          <title>{points[c.i]?.title}</title>
        </g>
      ))}
      {g.xLabels.map((l) => <text key={l.x} className={styles.axis} x={l.x} y={height - 6} textAnchor={l.anchor}>{l.text}</text>)}
    </svg>
  );
}

export function TrendChart({ view, metric, chart, seasons, onX }: { view: PeriodView; metric: MetricId; chart: ChartMode; seasons: readonly Season[]; onX: (x: XMode) => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { mode } = chart;
  const label = METRICS.find((m) => m.id === metric)?.label ?? metric;
  const avg = rawValue(metric, trendStats(view.aggregate));
  const avgText = avg === null ? null : formatMetric(metric, avg);
  // Kept across resizes: only the geometry follows the width, and By match can hold thousands of points.
  const points = useMemo(() => linePoints(mode, metric, view), [mode, metric, view]);
  const height = heightFor(width);
  const g = width > 0 ? lineGeometry(points, avg, { width, height }, { fmt: (v) => formatMetric(metric, v), rate: isRate(metric) }) : null;
  const marks = g && mode === "date" ? seasonMarks(view.buckets, seasons).map((m) => ({ x: g.xOf(m.i), name: m.name })) : [];

  return (
    <section className={styles.panel} aria-labelledby="trend-chart-h">
      <div className={styles.panelHead}>
        <h3 id="trend-chart-h" className={styles.h3}>{label} · {modeText(mode, view.bucket)}</h3>
        <div className={styles.xmode} role="group" aria-label="X axis">
          <button type="button" aria-pressed={mode === "date"} onClick={() => { onX("date"); }}>By date</button>
          <button type="button" aria-pressed={mode === "match"} onClick={() => { onX("match"); }}>By match</button>
        </div>
      </div>
      {chart.auto && <p className={styles.note}>{autoNote(chart.withData, view.bucket)}</p>}
      <div ref={ref} className={styles.plotBox} style={{ minHeight: height }}>
        {mode === "match" && view.rolling.length === 0 ? (
          <p className={styles.note}>By match needs {ROLLING_WINDOW} matches with these filters.</p>
        ) : width > 0 && g === null ? (
          <p className={styles.note}>Nothing measured for {label} in this period.</p>
        ) : (
          g && <Plot g={g} points={points} width={width} height={height} label={chartSummary(label, mode, view.bucket, points.length, avgText)} marks={marks} avgText={avgText} />
        )}
      </div>
      <div className={styles.key}>
        {avgText !== null && (
          <span>
            <svg width="18" height="8" aria-hidden="true"><line className={styles.avg} x1="0" x2="18" y1="4" y2="4" /></svg>
            period average
          </span>
        )}
        {mode === "match" ? (
          <span>each point = your last {ROLLING_WINDOW} matches</span>
        ) : (
          <span>
            <svg width="12" height="12" aria-hidden="true"><circle className={styles.hollow} cx="6" cy="6" r="4" /></svg>
            hollow dot = under {FEW} matches
          </span>
        )}
      </div>
    </section>
  );
}
