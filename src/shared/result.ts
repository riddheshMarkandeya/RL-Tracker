// A match's result for one player, from the stored record. Pages call this with the team of
// whichever player is "you", so confirming or rejecting an ID re-labels every match without a
// recompute.

// Spelled out rather than imported: src/shared stays free of server code, and the record's
// columns check these same values.
export interface ResultInput {
  winnerTeamNum: number | null;
  endKind: "completed" | "early_end" | "left" | "orphaned";
  closedVia: "destroyed" | "timeout" | "restart" | "superseded";
}

export type Result = "win" | "loss";

/**
 * A winner decides it. Without one, leaving counts as a loss, and so does a match the tracker
 * closed because the next one began or the game went quiet. After a restart the tracker was down
 * and play may have gone on, so the result is unknown (null), shown as no result rather than a loss.
 */
export function resultFor(m: ResultInput, myTeamNum: number | null): Result | null {
  if (myTeamNum === null) return null;
  if (m.winnerTeamNum !== null) return m.winnerTeamNum === myTeamNum ? "win" : "loss";
  if (m.endKind === "left") return "loss";
  if (m.endKind === "orphaned" && m.closedVia !== "restart") return "loss";
  return null;
}
