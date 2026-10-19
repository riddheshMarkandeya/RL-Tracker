// Every event name and key seen in the 2026-10 captures. A new one means the game changed what it
// sends, which may need a summary handler or a dedup rule, so the recorder logs it once per run.
import { isObject, type Data } from "./envelope";

const EVENTS: Readonly<Record<string, readonly string[]>> = {
  BallHit: ["Players", "Ball"],
  BoostPickup: ["Player", "Location", "BoostAmount", "BoostType", "bReplay"],
  ClockUpdatedSeconds: ["TimeSeconds", "bOvertime"],
  CountdownBegin: [],
  CrossbarHit: ["BallLocation", "BallSpeed", "ImpactForce", "BallLastTouch"],
  GoalReplayEnd: [],
  GoalReplayStart: [],
  GoalReplayWillEnd: [],
  GoalScored: ["GoalSpeed", "GoalTime", "ImpactLocation", "Scorer", "BallLastTouch", "Assister"],
  MatchCreated: [],
  MatchDestroyed: [],
  MatchEnded: ["WinnerTeamNum"],
  MatchInitialized: [],
  MatchPaused: [],
  MatchUnpaused: [],
  PlayerJoined: ["PlayerName", "PrimaryId"],
  PlayerLeft: ["PlayerName", "PrimaryId"],
  PodiumStart: [],
  RoundStarted: [],
  StatfeedEvent: ["EventName", "Type", "MainTarget", "SecondaryTarget"],
  UpdateState: ["Players", "Game"],
};

const GAME = new Set(["Teams", "PlaylistId", "TimeSeconds", "bOvertime", "Ball", "bReplay", "bHasWinner", "Winner", "Arena", "bHasTarget", "Target"]);
const PLAYER = new Set([
  "Name", "PrimaryId", "Shortcut", "TeamNum", "Score", "Goals", "Shots", "Assists", "Saves", "Touches", "CarTouches", "Demos", "Loadout",
  "bOnGround", "bHasCar", "Speed", "Boost", "bBoosting", "bPowersliding", "bSupersonic", "bOnWall", "PickupClass", "bDemolished", "Attacker",
]);
const TOP = new Map(Object.entries(EVENTS).map(([name, keys]) => [name, new Set(["MatchGuid", ...keys])]));

/** `obj`'s keys not in `known`, as `prefix` + key. */
const extras = (obj: Data, known: ReadonlySet<string>, prefix: string) => Object.keys(obj).filter((k) => !known.has(k)).map((k) => prefix + k);

/** Paths of keys not seen before (`Game.X`, `Players[].X`), or null for an unknown event name. */
export function unknownFields(name: string, data: Data): string[] | null {
  const top = TOP.get(name);
  if (!top) return null;
  const found = extras(data, top, "");
  if (name === "UpdateState") {
    if (isObject(data.Game)) found.push(...extras(data.Game, GAME, "Game."));
    if (Array.isArray(data.Players)) for (const p of data.Players) if (isObject(p)) found.push(...extras(p, PLAYER, "Players[]."));
  }
  return [...new Set(found)];
}
