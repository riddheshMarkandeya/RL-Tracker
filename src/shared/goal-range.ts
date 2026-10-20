// A goal's range class from its stored distance (uu from the scoring touch to the goal attacked).
// Applied when a page reads it, so a changed threshold reaches every match.
import { GOAL_LINE_Y } from "./constants";

export type GoalRange = "close" | "mid" | "long";

/** A quarter of the pitch length. */
const CLOSE_UNDER = GOAL_LINE_Y / 2;
/** Half the pitch: from the centre line or further back. */
const LONG_FROM = GOAL_LINE_Y;

export function goalRange(distance: number): GoalRange {
  if (distance < CLOSE_UNDER) return "close";
  return distance >= LONG_FROM ? "long" : "mid";
}
