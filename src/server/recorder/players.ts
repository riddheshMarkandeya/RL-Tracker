/** Every bot has this PrimaryId, so bots are told apart by name within a match. */
export const BOT_ID = "Unknown|0|0";

/** A player's identity within one match. */
export const playerKey = (p: { PrimaryId?: unknown; Name?: unknown }) => (p.PrimaryId === BOT_ID ? `bot:${String(p.Name)}` : String(p.PrimaryId));
