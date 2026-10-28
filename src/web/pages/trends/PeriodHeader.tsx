// The period's title line (title with ‹ ›, its days, "still running", what it's compared with) and
// its stats line (W–L, matches, sessions, best streak, MVPs, the ⚑ left-early note).
import type { RefObject } from "react";
import type { PeriodRange, PeriodSpec, Season } from "../../../shared/periods";
import type { PeriodView } from "../../../shared/schemas/responses";
import mvpIcon from "../../assets/icons/MVP.png";
import { plural } from "../../logic/format";
import { comparedText, periodTitle, rangeText, showsRunning, stepTarget } from "../../logic/trends";
import { cx } from "../../components/cx";
import styles from "./Trends.module.css";

export function PeriodHeader({
  spec,
  range,
  days,
  ctx,
  view,
  titleRef,
  onStep,
}: {
  spec: PeriodSpec;
  range: PeriodRange;
  /** The first and last day shown; null for a period with none yet (a season entered ahead). */
  days: { from: string; last: string } | null;
  ctx: { today: string; seasons: readonly Season[]; firstDay: string | null };
  /** The loaded period, for what it's compared with; undefined while it loads. */
  view: PeriodView | undefined;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onStep: (spec: PeriodSpec) => void;
}) {
  const noun = spec.kind === "week" || spec.kind === "month" || spec.kind === "season" ? spec.kind : null;
  const earlier = noun ? stepTarget(spec, -1, ctx) : null;
  const later = noun ? stepTarget(spec, 1, ctx) : null;
  const parts = [
    days && rangeText(days, ctx),
    showsRunning(spec, range.running) && "still running",
    view && comparedText(spec, { hasPrevious: view.previous !== null, previousMatches: view.previous?.aggregate.matches ?? 0 }, ctx),
  ].filter((p): p is string => typeof p === "string");
  return (
    <div className={styles.head}>
      {noun && (
        <button type="button" className={styles.step} aria-label={`Earlier ${noun}`} disabled={!earlier} onClick={() => { if (earlier) onStep(earlier); }}>‹</button>
      )}
      <h2 className={styles.title} ref={titleRef} tabIndex={-1}>{periodTitle(spec, ctx)}</h2>
      {noun && (
        <button type="button" className={styles.step} aria-label={`Later ${noun}`} disabled={!later} onClick={() => { if (later) onStep(later); }}>›</button>
      )}
      <span className={styles.muted}>{parts.join(" · ")}</span>
    </div>
  );
}

export function StatsLine({ view }: { view: PeriodView }) {
  const a = view.aggregate;
  const left = a.leftEarly ?? 0;
  return (
    <div className={styles.stats}>
      <span className={cx(styles.record, "num")}>
        <span className={styles.win}>{a.wins ?? 0}W</span> – <span className={styles.loss}>{a.losses ?? 0}L</span>
      </span>
      <span className={styles.muted}>
        {plural(a.matches, "match", "matches")} · {plural(view.sessions, "session")} · best streak W{a.bestWinStreak ?? 0} ·{" "}
        <img className={styles.ico} src={mvpIcon} alt="MVPs" /> ×{a.mvps ?? 0}
      </span>
      {left > 0 && (
        <span className={styles.flag} title="Leaving a match counts as a loss, so these pull win % down">
          ⚑ includes {plural(left, "match", "matches")} you left early
        </span>
      )}
    </div>
  );
}
