// The six tiles: the period's value, its change against the previous period, and a sparkline over
// the buckets. A tile picks the metric the big chart plots.
import type { PeriodView } from "../../../shared/schemas/responses";
import { trendStats } from "../../../shared/trends";
import assistIcon from "../../assets/icons/Assist.png";
import goalIcon from "../../assets/icons/Goal.png";
import saveIcon from "../../assets/icons/Save.png";
import shotIcon from "../../assets/icons/Shot.png";
import { METRICS, metricDelta, metricValue, sparkPath, type Delta, type MetricId, type TrendIcon } from "../../logic/trends";
import { cx } from "../../components/cx";
import styles from "./Trends.module.css";

const ICONS: Record<TrendIcon, string> = { Goal: goalIcon, Shot: shotIcon, Assist: assistIcon, Save: saveIcon };

/** "▲ 5 pts" with the direction in words for screen readers, or a muted "≈". */
function DeltaText({ delta }: { delta: Delta }) {
  if (delta.dir === "same") return <span className={styles.muted}>≈ <span className="visually-hidden">about the same</span></span>;
  return (
    <span className={delta.dir === "up" ? styles.up : styles.down}>
      <span aria-hidden="true">{delta.dir === "up" ? "▲" : "▼"}</span>
      <span className="visually-hidden">{delta.dir}</span> {delta.text}
    </span>
  );
}

/** Passive: the tile's value and delta are its text, so the line is hidden from screen readers. */
function Sparkline({ path }: { path: string | null }) {
  return (
    <svg className={styles.spark} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      {path && <path d={path} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function MetricTiles({ view, metric, onMetric }: { view: PeriodView; metric: MetricId; onMetric: (m: MetricId) => void }) {
  const cur = trendStats(view.aggregate);
  const prev = view.previous ? trendStats(view.previous.aggregate) : null;
  const buckets = view.buckets.map((b) => b.stats);
  return (
    <div className={styles.tiles} role="group" aria-label="Metric to chart">
      {METRICS.map((m) => {
        const delta = metricDelta(m.id, cur, prev);
        return (
          <button key={m.id} type="button" className={styles.tile} aria-pressed={m.id === metric} onClick={() => { onMetric(m.id); }}>
            <span className={styles.lbl}>
              {m.icon && <img className={styles.ico} src={ICONS[m.icon]} alt="" />}
              {m.label}
            </span>
            <span className={cx(styles.value, "num")}>{metricValue(m.id, cur)}</span>
            <span className={styles.delta}>{delta ? <DeltaText delta={delta} /> : " "}</span>
            <Sparkline path={sparkPath(m.id, buckets)} />
          </button>
        );
      })}
    </div>
  );
}
