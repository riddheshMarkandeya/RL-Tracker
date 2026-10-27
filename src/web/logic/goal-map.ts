// Where goals came from: each placed goal's scoring touch on a top-down pitch, drawn sideways with
// your goal on the left, and the counts beside it. Kept apart from the Overview for the match page.
import { GOAL_LINE_Y, SIDE_WALL_X } from "../../shared/constants";
import { goalRange } from "../../shared/goal-range";
import type { Goal, MyMatchWire } from "../../shared/schemas/responses";

export const MAP_W = 560;
export const MAP_H = (MAP_W * SIDE_WALL_X) / GOAL_LINE_Y;

/**
 * A field point in map units. Team 0 attacks +Y, so team 1's view is the field turned half a circle.
 * Assumed, unverified: +X is on blue's left, so it is drawn at the top while blue attacks to the
 * right; were it the other way, the map would be mirrored top to bottom. Touches inside a
 * goal mouth (|y| past the goal line) are drawn on the line.
 */
export function toScreen(pos: { x: number; y: number }, myTeam: number): { x: number; y: number } {
  const turn = myTeam === 1 ? -1 : 1;
  const y = Math.max(-GOAL_LINE_Y, Math.min(GOAL_LINE_Y, pos.y * turn));
  return { x: ((y + GOAL_LINE_Y) / (2 * GOAL_LINE_Y)) * MAP_W, y: ((SIDE_WALL_X - pos.x * turn) / (2 * SIDE_WALL_X)) * MAP_H };
}

export type Side = "scored" | "conceded";

export interface GoalMark {
  key: string;
  x: number;
  y: number;
  side: Side;
  yours: boolean;
  aerial: boolean;
  deflected: boolean;
  title: string;
}

interface Sided {
  goal: Goal;
  /** 1-based position in the session, as on the match cards. */
  match: number;
  myTeam: number;
  side: Side;
  yours: boolean;
}

/** Each goal with its side from your team; matches where your team is unknown are set apart. */
function sided(matches: readonly MyMatchWire[], goals: readonly Goal[]): { goals: Sided[]; skipped: { guid: string; goals: number }[] } {
  const at = new Map(matches.map((m, i) => [m.guid, { m, n: i + 1 }]));
  const out: Sided[] = [];
  const skipped = new Map<string, number>();
  for (const goal of goals) {
    const found = at.get(goal.matchGuid);
    if (!found) continue;
    const me = found.m.me;
    if (me?.teamNum == null) {
      skipped.set(goal.matchGuid, (skipped.get(goal.matchGuid) ?? 0) + 1);
      continue;
    }
    const side = goal.teamNum === me.teamNum ? "scored" : "conceded";
    out.push({ goal, match: found.n, myTeam: me.teamNum, side, yours: side === "scored" && goal.scorerKey === me.playerKey });
  }
  return { goals: out, skipped: [...skipped].map(([guid, n]) => ({ guid, goals: n })) };
}

const metres = (uu: number) => `${String(Math.round(uu / 100))} m`;

function titleOf({ goal, match, side, yours }: Sided, distance: number, z: number): string {
  const who = side === "conceded" ? "conceded" : yours ? "your goal" : "a teammate's goal";
  return [
    `Match ${String(match)}`,
    who,
    goal.speedKmh !== null && `${String(Math.round(goal.speedKmh))} km/h`,
    `${metres(distance)} out`,
    // Height only for aerials: z is the ball's centre, so a ground ball would read "1 m up".
    goal.aerial && `aerial, ${metres(z)} up`,
    goal.deflected && (side === "scored" ? "an opponent touched it last" : "your team touched it last"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A mark per placed goal. Own goals and goals with no known scoring touch get none. */
export function goalMarks(matches: readonly MyMatchWire[], goals: readonly Goal[]): { marks: GoalMark[]; skipped: { guid: string; goals: number }[] } {
  const { goals: all, skipped } = sided(matches, goals);
  const marks = all.flatMap((s): GoalMark[] => {
    const { goal } = s;
    if (goal.ownGoal || goal.pos === null || goal.distance === null) return [];
    return [
      {
        key: `${goal.matchGuid}:${String(goal.idx)}`,
        ...toScreen(goal.pos, s.myTeam),
        side: s.side,
        yours: s.yours,
        aerial: goal.aerial,
        deflected: goal.deflected,
        title: titleOf(s, goal.distance, goal.pos.z),
      },
    ];
  });
  return { marks, skipped };
}

export interface SideSummary {
  total: number;
  close: number;
  mid: number;
  long: number;
  aerial: number;
  ownGoals: number;
  /** No known scoring touch: you joined after kickoff. */
  unplaced: number;
}

const emptySide = (): SideSummary => ({ total: 0, close: 0, mid: 0, long: 0, aerial: 0, ownGoals: 0, unplaced: 0 });

/** Counts per side; ranges only over placed goals, so own and unplaced goals are counted apart. */
export function goalSummary(matches: readonly MyMatchWire[], goals: readonly Goal[]): { scored: SideSummary; conceded: SideSummary; yours: number } {
  const out = { scored: emptySide(), conceded: emptySide(), yours: 0 };
  for (const { goal, side, yours } of sided(matches, goals).goals) {
    const s = out[side];
    s.total++;
    if (yours) out.yours++;
    if (goal.aerial) s.aerial++;
    if (goal.ownGoal) s.ownGoals++;
    else if (goal.distance === null) s.unplaced++;
    else s[goalRange(goal.distance)]++;
  }
  return out;
}

/** Smaller marks for a busy map, so a long session doesn't become one blob. */
export const markScale = (goals: number): number => (goals > 60 ? 0.65 : 1);
