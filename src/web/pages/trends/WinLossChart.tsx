// Wins up and losses down per bucket, with W and L on the axis so it never reads by colour alone.
// Each bucket with matches is a whole-column link in the tab order: a day opens its recap, a week
// or month opens that period here. It is the page's only way into them.
import { useLinkClickHandler } from "react-router";
import type { Season } from "../../../shared/periods";
import type { PeriodView } from "../../../shared/schemas/responses";
import { useWidth } from "../../components/useWidth";
import { bucketHref, seasonMarks, wlEnds, wlGeometry, wlLabel, wlRecord, type WlGeometry } from "../../logic/trend-chart";
import type { TrendsState } from "../../logic/trends";
import styles from "./Trends.module.css";

const HEIGHT = 110;

type Column = WlGeometry["columns"][number];

function Bars({ c }: { c: Column }) {
  return (
    <>
      {c.win && <path className={styles.winBar} d={c.win.d} />}
      {c.loss && <path className={styles.lossBar} d={c.loss.d} />}
    </>
  );
}

// A hook per link, so one small component per column. JSX types every <a> as HTML; the handler
// only reads the event's button and keys.
function BucketLink({ c, href, label, top, height }: { c: Column; href: string; label: string; top: number; height: number }) {
  const onClick = useLinkClickHandler(href);
  return (
    <a className={styles.wlLink} href={href} aria-label={label} onClick={onClick}>
      <rect className={styles.hit} x={c.x} y={top} width={c.w} height={height} />
      <Bars c={c} />
      <title>{label}</title>
    </a>
  );
}

export function WinLossChart({ view, state, seasons }: { view: PeriodView; state: TrendsState; seasons: readonly Season[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const kind = view.bucket;
  const g = width > 0 ? wlGeometry(view.buckets, { width, height: HEIGHT }, wlEnds(view.buckets, kind)) : null;
  const hint = kind === "day" ? "select a day to open its recap" : `select a ${kind} to open it`;
  return (
    <section className={styles.panel} aria-labelledby="wl-chart-h">
      <h3 id="wl-chart-h" className={styles.h3}>
        Wins and losses · per {kind} <span className={styles.hint2}>· {hint}</span>
      </h3>
      <div ref={ref} className={styles.plotBox} style={{ minHeight: HEIGHT }}>
        {g && (
          <svg className={styles.chart} width={width} height={HEIGHT} role="group" aria-label={`Wins and losses per ${kind}`}>
            <line className={styles.grid} x1={g.plot.left} x2={g.plot.right} y1={g.mid} y2={g.mid} />
            <text className={styles.axis} x={4} y={g.plot.top + 12} aria-hidden="true">W</text>
            <text className={styles.axis} x={4} y={g.plot.bottom - 2} aria-hidden="true">L</text>
            {seasonMarks(view.buckets, seasons).map((m) => {
              // At the bucket's centre, which the big chart's point also stands for (its x scale differs).
              const c = g.columns[m.i];
              const x = c ? c.x + c.w / 2 : g.plot.left;
              return (
                <g key={m.name} aria-hidden="true">
                  <line className={styles.mark} x1={x} x2={x} y1={g.plot.top} y2={g.plot.bottom} />
                  <text className={styles.axis} x={x + 3} y={g.plot.top + 10}>{m.name}</text>
                </g>
              );
            })}
            {g.columns.map((c, i) => {
              const b = view.buckets[i];
              if (!b) return null;
              const href = bucketHref(b, kind, state);
              return href === null ? (
                <g key={b.day} aria-hidden="true">
                  <Bars c={c} />
                  <title>{wlRecord(b, kind)}</title>
                </g>
              ) : (
                <BucketLink key={b.day} c={c} href={href} label={wlLabel(b, kind)} top={g.plot.top} height={g.plot.bottom - g.plot.top} />
              );
            })}
            {g.xLabels.map((l) => (
              <text key={l.anchor} className={styles.axis} x={l.x} y={HEIGHT - 6} textAnchor={l.anchor} aria-hidden="true">{l.text}</text>
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}
