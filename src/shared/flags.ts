// Why a match is flagged: its counted numbers were guessed or cut short, or a data check failed.
// A forfeit ends early but counts normally, so it isn't a reason.
import type { ResultInput } from "./result";

export const FLAG_REASONS = ["left", "lost_ending", "joined", "winner_decided", "mvp_inferred", "check_failed"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

// Spelled out rather than imported, so src/shared stays free of server code; the record's columns check these same values.
export interface FlagInput {
  endKind: ResultInput["endKind"];
  joinedInProgress: boolean;
  winnerSource: "match_ended" | "decided" | null;
  mvpSource: "statfeed" | "inferred" | null;
  checkFailed: boolean;
}

/** The reasons, in FLAG_REASONS order; [] for a match that isn't flagged. */
export function flagReasons(m: FlagInput): FlagReason[] {
  const on: Record<FlagReason, boolean> = {
    left: m.endKind === "left",
    lost_ending: m.endKind === "orphaned",
    joined: m.joinedInProgress,
    winner_decided: m.winnerSource === "decided",
    mvp_inferred: m.mvpSource === "inferred",
    check_failed: m.checkFailed,
  };
  return FLAG_REASONS.filter((r) => on[r]);
}
