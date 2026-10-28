// Where the goals came from: an SVG pitch with a mark per placed goal (its <title> holds the
// details; a click can open its match) and, beside it, the same counts as text.
import { useEffect } from "react";
import { useLinkClickHandler } from "react-router";
import { GOAL_LINE_Y, SIDE_WALL_X } from "../../shared/constants";
import type { Goal, MyMatchWire } from "../../shared/schemas/responses";
import { goalMarks, goalSummary, MAP_H, MAP_W, markScale, type GoalMark, type SideSummary } from "../logic/goal-map";
import { plural } from "../logic/format";
import { useSettings } from "../queries";
import { cx } from "./cx";
import styles from "./GoalMap.module.css";

// Pitch lines in map units, from the field's own: a 2900-wide, 1100-deep box and a 1786-wide goal.
const BOX_DEPTH = (MAP_W * 1100) / (2 * GOAL_LINE_Y);
const BOX_WIDTH = (MAP_H * 2900) / (2 * SIDE_WALL_X);
const GOAL_WIDTH = (MAP_H * 1786) / (2 * SIDE_WALL_X);
/** Room past the walls for a mark on the edge (a touch in a goal mouth is drawn on the line). */
const PAD = 12;

/** With `hrefFor`, a mark is a link to its match: for the mouse only, as screen readers get the svg's label and the counts beside it. */
export function GoalMap({ matches, goals, viewKey, hrefFor }: { matches: MyMatchWire[]; goals: Goal[]; viewKey: string; hrefFor?: (guid: string) => string }) {
  const { marks, skipped } = goalMarks(matches, goals, useSettings());
  const summary = goalSummary(matches, goals);
  const k = markScale(goals.length);

  // Unseen in real data: a match with goals but no team for you can't be oriented, so its goals
  // are left out. Keyed on what's skipped, so a refetch of the same view doesn't warn again: a
  // refetch makes a new array, so the dependency is its JSON and the effect reads it back from that.
  const skippedKey = JSON.stringify(skipped);
  useEffect(() => {
    for (const s of JSON.parse(skippedKey) as typeof skipped) console.warn("[rlt] recap/goal_no_team", s);
  }, [viewKey, skippedKey]);

  return (
    <div className={styles.wrap}>
      <div>
        <svg
          className={styles.pitch}
          viewBox={`${String(-PAD)} ${String(-PAD)} ${String(MAP_W + 2 * PAD)} ${String(MAP_H + 2 * PAD)}`}
          // A group, not an img: axe holds that an image has no links inside, even ones out of the tab order.
          role="group"
          aria-label={`Where ${plural(summary.scored.total, "goal")} for and ${String(summary.conceded.total)} against came from`}
        >
          <Field />
          {marks.map((m) => (hrefFor ? <LinkedMark key={m.key} mark={m} k={k} href={hrefFor(m.matchGuid)} /> : <Mark key={m.key} mark={m} k={k} />))}
        </svg>
        <ul className={styles.key}>
          <li><svg width="12" height="12" aria-hidden="true"><circle className={styles.yours} cx="6" cy="6" r="5" /></svg>your goal</li>
          <li><svg width="12" height="12" aria-hidden="true"><circle className={styles.mate} cx="6" cy="6" r="4.5" /></svg>teammate's goal</li>
          <li><svg width="12" height="12" aria-hidden="true"><circle className={styles.conceded} cx="6" cy="6" r="5" /></svg>conceded</li>
          <li><svg width="14" height="14" aria-hidden="true"><rect className={styles.keyShape} x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" /></svg>aerial goal</li>
          <li><svg width="16" height="16" aria-hidden="true"><circle className={styles.keyShape} cx="8" cy="8" r="4" /><circle className={styles.defl} cx="8" cy="8" r="7" /></svg>deflected: the other team touched it last</li>
          <li className={styles.note}>Each mark is the scoring team's last touch.</li>
        </ul>
      </div>
      <div className={styles.summary}>
        <SideCounts label="Scored" side={summary.scored} tone="blue" />
        {summary.scored.total > 0 && <p className={styles.note}>You scored {summary.yours} of the team's {summary.scored.total}.</p>}
        <SideCounts label="Conceded" side={summary.conceded} tone="orange" />
        <p className={styles.note}>Close: within a quarter of the pitch from goal. Long: from halfway or further.</p>
      </div>
    </div>
  );
}

function Field() {
  const mid = MAP_H / 2;
  return (
    <g aria-hidden="true">
      <rect className={styles.field} x="1" y="1" width={MAP_W - 2} height={MAP_H - 2} rx="28" />
      <line className={styles.line} x1={MAP_W / 2} x2={MAP_W / 2} y1="1" y2={MAP_H - 1} />
      <circle className={styles.line} cx={MAP_W / 2} cy={mid} r={MAP_H * 0.12} />
      <rect className={styles.line} x="1" y={mid - BOX_WIDTH / 2} width={BOX_DEPTH} height={BOX_WIDTH} />
      <rect className={styles.line} x={MAP_W - 1 - BOX_DEPTH} y={mid - BOX_WIDTH / 2} width={BOX_DEPTH} height={BOX_WIDTH} />
      <rect className={styles.ourGoal} x="0" y={mid - GOAL_WIDTH / 2} width="5" height={GOAL_WIDTH} />
      <rect className={styles.theirGoal} x={MAP_W - 5} y={mid - GOAL_WIDTH / 2} width="5" height={GOAL_WIDTH} />
      <text className={styles.label} x="12" y={MAP_H - 12}>your goal</text>
      <text className={styles.label} x={MAP_W - 12} y={MAP_H - 12} textAnchor="end">their goal</text>
    </g>
  );
}

function Mark({ mark: m, k }: { mark: GoalMark; k: number }) {
  const tone = m.side === "conceded" ? styles.conceded : m.yours ? styles.yours : styles.mate;
  const s = 6.5 * k;
  return (
    <g>
      <title>{m.title}</title>
      {m.aerial ? (
        <rect className={tone} x={m.x - s} y={m.y - s} width={2 * s} height={2 * s} transform={`rotate(45 ${String(m.x)} ${String(m.y)})`} />
      ) : (
        <circle className={tone} cx={m.x} cy={m.y} r={7 * k} />
      )}
      {m.deflected && <circle className={styles.defl} cx={m.x} cy={m.y} r={11 * k} />}
    </g>
  );
}

// Out of the tab order and hidden from screen readers: the match cards reach the same matches. The
// click handler keeps navigation in the app and leaves modified and middle clicks to the browser.
function LinkedMark({ mark, k, href }: { mark: GoalMark; k: number; href: string }) {
  // JSX types every <a> as HTML; react-router's handler only reads the event's button and keys.
  const onClick = useLinkClickHandler(href);
  return (
    <a className={styles.link} href={href} tabIndex={-1} aria-hidden="true" onClick={onClick}>
      <Mark mark={mark} k={k} />
    </a>
  );
}

function SideCounts({ label, side, tone }: { label: string; side: SideSummary; tone: "blue" | "orange" }) {
  const placed = side.close + side.mid + side.long;
  const parts = [
    `${String(side.close)} close`,
    `${String(side.mid)} mid`,
    `${String(side.long)} long`,
    side.ownGoals > 0 && plural(side.ownGoals, "own goal"),
    side.unplaced > 0 && `${String(side.unplaced)} not placed`,
  ].filter(Boolean);
  return (
    <div>
      <h3 className={styles.h3}>
        <svg width="12" height="12" aria-hidden="true"><circle className={tone === "blue" ? styles.yours : styles.conceded} cx="6" cy="6" r="5" /></svg>
        {label} · <span className="num">{side.total}</span>
        {side.aerial > 0 && <span className={styles.note}> · {side.aerial} aerial</span>}
      </h3>
      {side.total === 0 ? (
        <p className={styles.note}>None.</p>
      ) : (
        <>
          {placed > 0 && (
            <div className={cx(styles.bar, tone === "blue" ? styles.barBlue : styles.barOrange)} aria-hidden="true">
              {(["close", "mid", "long"] as const).map((r) => side[r] > 0 && <i key={r} className={styles[r]} style={{ width: `${String((100 * side[r]) / placed)}%` }} />)}
            </div>
          )}
          <p className={cx(styles.note, "num")}>{parts.join(" · ")}</p>
        </>
      )}
    </div>
  );
}
