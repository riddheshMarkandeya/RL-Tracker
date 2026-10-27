// Which of an old match's UpdateStates retention can delete. A state goes only when it changes
// nothing the scoreboard rules read: the summary's roster, presence, score, clock, playlist and
// arena, and the Shortcut lookups that resolve statfeed targets and the play view's references,
// all read the projected fields below and nothing else of an UpdateState. What else reads a state
// (car samples, the camera target, bReplay for both) is dense: retention snapshots those outputs
// before thinning, so a thinned match recomputes the rest and keeps the snapshot for them. The
// replay_playback check also reads bReplay, so it skips a thinned match.
// Kept states stay byte-for-byte. A player's first appearance always changes the projection, so
// the state carrying their stored Loadout is kept.
import { isObject, type Data } from "./envelope";
import type { StoredEvent } from "./store";
import { num, objects, players } from "./summary";

export const PLAYER_FIELDS: readonly string[] = ["Name", "PrimaryId", "Shortcut", "TeamNum", "Score", "Goals", "Shots", "Assists", "Saves", "Touches", "Demos"];
/** TimeSeconds is compared with the running clock rather than projected. */
export const GAME_FIELDS: readonly string[] = ["Teams", "PlaylistId", "Arena", "bOvertime", "TimeSeconds"];
/** Known fields thinning may lose: read only by dense rules, or by nothing. */
export const DENSE_OR_UNREAD: Readonly<Record<"game" | "player", readonly string[]>> = {
  game: ["Ball", "bReplay", "bHasWinner", "Winner", "bHasTarget", "Target"],
  player: ["CarTouches", "Loadout", "bOnGround", "bHasCar", "Speed", "Boost", "bBoosting", "bPowersliding", "bSupersonic", "bOnWall", "PickupClass", "bDemolished", "Attacker"],
};

/**
 * A missing scoreboard (null) and an incomplete one (an array) stay apart: the summary counts only
 * the second as rejected. Undefined and missing fields both serialise as null, as both read as null.
 */
function projection(data: Data, game: Data): string {
  return JSON.stringify([
    players(data).map((p) => PLAYER_FIELDS.map((f) => p[f])),
    Array.isArray(game.Teams) ? objects(game.Teams).map((t) => [t.TeamNum, t.Score]) : null,
    game.PlaylistId,
    game.Arena,
    game.bOvertime,
  ]);
}

const clockOf = (data: Data): number | null => num(data.TimeSeconds);

/**
 * The seqs of `events`' UpdateStates to delete, from one match's events in seq order. A state is
 * kept when it is the first or last, when its projection differs from the previous state's (the
 * original one, not the previous kept one), or when it reads a clock other than the running one,
 * the last finite reading of any event.
 */
export function statesToDrop(events: readonly StoredEvent[]): number[] {
  const states = events.filter((e) => e.name === "UpdateState");
  const first = states[0];
  const last = states.at(-1);
  const drop: number[] = [];
  let prev: string | null = null;
  let clock: number | null = null;
  for (const ev of events) {
    if (ev.name !== "UpdateState") {
      if (ev.name === "ClockUpdatedSeconds") clock = clockOf(ev.data) ?? clock;
      continue;
    }
    const game = isObject(ev.data.Game) ? ev.data.Game : {};
    const t = clockOf(game);
    const proj = projection(ev.data, game);
    const keep = ev === first || ev === last || proj !== prev || (t !== null && t !== clock);
    if (!keep) drop.push(ev.seq);
    prev = proj;
    clock = t ?? clock;
  }
  return drop;
}
