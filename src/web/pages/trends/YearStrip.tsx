// One year at a glance: season bands and months to pick, grey ticks on the days you played, the
// selected period shaded and today marked. Scrolls sideways on a narrow screen.
import type { CSSProperties } from "react";
import type { PeriodSpec, Season } from "../../../shared/periods";
import { yearStrip } from "../../logic/trends";
import styles from "./Trends.module.css";

const place = ({ left, width }: { left: number; width: number }): CSSProperties => ({ left: `${String(left)}%`, width: `calc(${String(width)}% - 2px)` });

export function YearStrip({
  year,
  today,
  seasons,
  spec,
  selected,
  days,
  onPick,
}: {
  year: number;
  today: string;
  seasons: readonly Season[];
  spec: PeriodSpec;
  selected: { from: string; to: string } | null;
  days: readonly { day: string; matches: number }[];
  onPick: (spec: PeriodSpec) => void;
}) {
  const strip = yearStrip({ year, today, seasons, spec, selected, days });
  return (
    <>
      <div className={styles.stripWrap}>
        <div className={styles.strip} role="group" aria-label={`Seasons and months of ${String(year)}`}>
          {strip.seasons.map((s) => (
            <button
              key={s.id ?? "before"}
              type="button"
              className={styles.season}
              style={place(s)}
              disabled={s.disabled}
              aria-pressed={s.disabled ? undefined : s.pressed}
              onClick={() => { if (s.id !== null) onPick({ kind: "season", id: s.id }); }}
            >
              {s.label}
            </button>
          ))}
          {strip.months.map((m) => (
            <button key={m.day} type="button" className={styles.month} style={place(m)} disabled={m.disabled} aria-pressed={m.disabled ? undefined : m.pressed} onClick={() => { onPick({ kind: "month", day: m.day }); }}>
              {m.label}
            </button>
          ))}
          {strip.ticks.map((t) => (
            <span key={t.day} className={styles.tick} style={{ left: `${String(t.left)}%`, height: t.height }} aria-hidden="true" />
          ))}
          {strip.selected && <div className={styles.selected} style={{ left: `${String(strip.selected.left)}%`, width: `max(3px, ${String(strip.selected.width)}%)` }} aria-hidden="true" />}
          {strip.today !== null && <div className={styles.today} style={{ left: `${String(strip.today)}%` }} aria-hidden="true" />}
        </div>
      </div>
      <p className={styles.hint}>Pick a season or month. Grey ticks are days you played; taller means more matches.</p>
    </>
  );
}
