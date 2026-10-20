import type { Data } from "./envelope";

/** Every bot has this PrimaryId, so bots are told apart by name within a match. */
export const BOT_ID = "Unknown|0|0";

/** A player's identity within one match. */
export const playerKey = (p: { PrimaryId?: unknown; Name?: unknown }) => (p.PrimaryId === BOT_ID ? `bot:${String(p.Name)}` : String(p.PrimaryId));

/**
 * The roster key of an event's player reference (Name, Shortcut, TeamNum, no id): its Shortcut in
 * the latest state if name and team agree, else a unique name+team match on the roster.
 */
export function resolveTarget(latestPlayers: readonly Data[], roster: Iterable<{ key: string; name: string; teamNum: number | null }>, target: Data): string | null {
  const name = typeof target.Name === "string" ? target.Name : null;
  const team = typeof target.TeamNum === "number" ? target.TeamNum : null;
  const byShortcut = latestPlayers.find((p) => p.Shortcut === target.Shortcut);
  if (byShortcut?.Name === name && byShortcut.TeamNum === team) return playerKey(byShortcut);
  const matches = [...roster].filter((r) => r.name === name && r.teamNum === team);
  return matches.length === 1 ? (matches[0]?.key ?? null) : null;
}
