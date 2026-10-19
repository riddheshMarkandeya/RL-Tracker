import { describe, expect, test } from "vitest";
import type { StoredEvent } from "./store";
import { summarise } from "./summary";

let seq = 0;
const ev = (name: string, data: Record<string, unknown> = {}, ts = seq * 100): StoredEvent => ({ seq: seq++, ts, name, data });

interface P {
  name: string;
  id?: string;
  shortcut?: number;
  team?: number;
  goals?: number;
  assists?: number;
}
const player = ({ name, id = `Epic|${name}|0`, shortcut = 1, team = 0, goals = 0, assists = 0 }: P) => ({
  Name: name,
  PrimaryId: id,
  Shortcut: shortcut,
  TeamNum: team,
  Score: goals * 100,
  Goals: goals,
  Shots: goals,
  Assists: assists,
  Saves: 0,
  Touches: 3,
  Demos: 0,
});
const state = (players: P[], score: [number, number] = [0, 0], game: Record<string, unknown> = {}) =>
  ev("UpdateState", {
    Players: players.map(player),
    Game: { Teams: [{ TeamNum: 0, Score: score[0] }, { TeamNum: 1, Score: score[1] }], PlaylistId: 13, TimeSeconds: 120, bOvertime: false, Arena: "cs_p", ...game },
  });
const mvp = (name: string, shortcut: number, team: number) => ev("StatfeedEvent", { EventName: "MVP", MainTarget: { Name: name, Shortcut: shortcut, TeamNum: team } });

const destroyed = { via: "destroyed" as const, dedupDropped: {} };

describe("summarise", () => {
  test("a completed match: winner from MatchEnded, MVP from the statfeed, score from the state before MatchEnded", () => {
    const events = [
      ev("MatchCreated"),
      ev("MatchInitialized"),
      state([{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1, goals: 1 }], [0, 1], { TimeSeconds: 0 }),
      ev("GoalScored"),
      ev("MatchEnded", { WinnerTeamNum: 1 }),
      mvp("B", 2, 1),
      ev("PodiumStart"),
      // Teardown: B already gone; must not change the end snapshot.
      state([{ name: "A", shortcut: 1, team: 0 }], [0, 1], { TimeSeconds: 0, Winner: "Club" }),
      ev("MatchDestroyed"),
    ];
    const s = summarise("G", events, destroyed);
    expect(s).toMatchObject({
      guid: "G",
      playlistId: 13,
      arena: "cs_p",
      endKind: "completed",
      joinedInProgress: false,
      overtime: false,
      score: [0, 1],
      winnerTeamNum: 1,
      mvp: { name: "B", teamNum: 1, key: "Epic|B|0" },
      facts: { sawMatchEnded: true, sawPodium: true, mvpCount: 1, liveGoals: 1, minClock: 0 },
    });
    expect(s.startedAt).toBe(events[0]?.ts);
    expect(s.endedAt).toBe(events.at(-1)?.ts);
    expect(s.roster.map((r) => [r.name, r.presentAtEnd, r.stats.goals])).toEqual([
      ["A", true, 0],
      ["B", true, 1],
    ]);
  });

  test("the winner comes only from MatchEnded: a Winner name and a lead in the score don't make one", () => {
    const s = summarise("G", [ev("MatchInitialized"), state([{ name: "A" }], [3, 0], { Winner: "Club", bHasWinner: true }), ev("MatchDestroyed")], destroyed);
    expect(s.winnerTeamNum).toBeNull();
    expect(s.endKind).toBe("left");
  });

  test("a forfeit keeps MatchEnded's winner even against the score", () => {
    const s = summarise("G", [ev("MatchInitialized"), state([{ name: "A" }], [2, 3], { TimeSeconds: 136 }), ev("MatchEnded", { WinnerTeamNum: 0 }), ev("MatchDestroyed")], destroyed);
    expect(s).toMatchObject({ winnerTeamNum: 0, endKind: "early_end", score: [2, 3] });
  });

  test("an overtime end with clock above 0 is completed, not an early end", () => {
    const s = summarise("G", [ev("MatchInitialized"), state([{ name: "A" }], [1, 0], { TimeSeconds: 95, bOvertime: true }), ev("MatchEnded", { WinnerTeamNum: 0 }), ev("MatchDestroyed")], destroyed);
    expect(s).toMatchObject({ endKind: "completed", overtime: true });
  });

  test("a clock that counts down through 1 to 0 is a full match, from ClockUpdatedSeconds too", () => {
    const s = summarise(
      "G",
      [ev("MatchInitialized"), state([{ name: "A" }], [1, 0], { TimeSeconds: 1 }), ev("ClockUpdatedSeconds", { TimeSeconds: 0, bOvertime: false }), ev("MatchEnded", { WinnerTeamNum: 0 })],
      destroyed,
    );
    expect(s.endKind).toBe("completed");
  });

  test("a forfeit resets the clock to 0 just before MatchEnded: a jump from above 1 is an early end", () => {
    const s = summarise(
      "G",
      [
        ev("MatchInitialized"),
        state([{ name: "A" }], [2, 3], { TimeSeconds: 68 }),
        ev("ClockUpdatedSeconds", { TimeSeconds: 68, bOvertime: false }),
        ev("ClockUpdatedSeconds", { TimeSeconds: 0, bOvertime: false }),
        ev("MatchEnded", { WinnerTeamNum: 0 }),
      ],
      destroyed,
    );
    expect(s.endKind).toBe("early_end");
  });

  test("an overtime clock reset to 0 is still completed", () => {
    const s = summarise(
      "G",
      [ev("MatchInitialized"), state([{ name: "A" }], [1, 0], { TimeSeconds: 41, bOvertime: true }), ev("ClockUpdatedSeconds", { TimeSeconds: 0, bOvertime: false }), ev("MatchEnded", { WinnerTeamNum: 0 })],
      destroyed,
    );
    expect(s).toMatchObject({ endKind: "completed", overtime: true });
  });

  test("orphaned: no MatchEnded and not destroyed; with MatchEnded the result still stands", () => {
    expect(summarise("G", [ev("MatchInitialized"), state([{ name: "A" }])], { via: "timeout", dedupDropped: {} }).endKind).toBe("orphaned");
    expect(summarise("G", [ev("MatchInitialized"), state([{ name: "A" }], [0, 0], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 1 })], { via: "restart", dedupDropped: {} })).toMatchObject({
      endKind: "completed",
      closedVia: "restart",
    });
  });

  test("joined in progress: no MatchInitialized", () => {
    expect(summarise("G", [state([{ name: "A" }]), ev("RoundStarted")], destroyed).joinedInProgress).toBe(true);
  });

  test("the roster is built across the match: leavers keep their last line, backfills and bots are added", () => {
    const events = [
      ev("MatchInitialized"),
      state([{ name: "A", team: 0 }, { name: "Leaver", team: 1, goals: 1 }]),
      state([{ name: "A", team: 0, goals: 1 }, { name: "Leaver", team: 1, goals: 2 }]),
      state([{ name: "A", team: 0, goals: 1 }, { name: "Sticks", id: "Unknown|0|0", team: 1 }, { name: "Hound", id: "Unknown|0|0", team: 1 }]),
      ev("MatchEnded", { WinnerTeamNum: 1 }),
    ];
    const roster = summarise("G", events, destroyed).roster;
    expect(roster.map((r) => ({ key: r.key, team: r.teamNum, bot: r.isBot, present: r.presentAtEnd, goals: r.stats.goals }))).toEqual([
      { key: "Epic|A|0", team: 0, bot: false, present: true, goals: 1 },
      { key: "Epic|Leaver|0", team: 1, bot: false, present: false, goals: 2 },
      { key: "bot:Sticks", team: 1, bot: true, present: true, goals: 0 },
      { key: "bot:Hound", team: 1, bot: true, present: true, goals: 0 },
    ]);
  });

  test("team 255 (not on a team yet) never overwrites a real team", () => {
    const s = summarise("G", [state([{ name: "A", team: 255 }]), state([{ name: "A", team: 1 }]), state([{ name: "A", team: 255 }])], destroyed);
    expect(s.roster[0]?.teamNum).toBe(1);
  });

  test("the MVP resolves through the Shortcut map of the state just before it, not an earlier one", () => {
    const events = [
      ev("MatchInitialized"),
      state([{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1 }]),
      // Shortcuts swap mid-match.
      state([{ name: "A", shortcut: 2, team: 0 }, { name: "B", shortcut: 1, team: 1 }]),
      ev("MatchEnded", { WinnerTeamNum: 0 }),
      mvp("A", 2, 0),
    ];
    expect(summarise("G", events, destroyed).mvp).toEqual({ name: "A", teamNum: 0, key: "Epic|A|0" });
  });

  test("an MVP whose shortcut points at someone else falls back to a unique name+team match, else stays unresolved", () => {
    const base = [ev("MatchInitialized"), state([{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1 }]), ev("MatchEnded", { WinnerTeamNum: 1 })];
    expect(summarise("G", [...base, mvp("B", 1, 1)], destroyed).mvp?.key).toBe("Epic|B|0");
    expect(summarise("G", [...base, mvp("Nobody", 7, 1)], destroyed).mvp).toEqual({ name: "Nobody", teamNum: 1, key: null });
  });

  test("counts every MVP but reports the first", () => {
    const s = summarise("G", [state([{ name: "A", shortcut: 1 }]), mvp("A", 1, 0), mvp("A", 1, 0)], destroyed);
    expect(s.facts.mvpCount).toBe(2);
    expect(s.mvp?.name).toBe("A");
  });

  test("playlist is the last non-zero id; minClock is the lowest clock seen", () => {
    const s = summarise("G", [state([], [0, 0], { PlaylistId: 0, TimeSeconds: 300 }), state([], [0, 0], { PlaylistId: 4, TimeSeconds: 12 })], destroyed);
    expect(s.playlistId).toBe(4);
    expect(s.facts.minClock).toBe(12);
  });

  test("states after MatchEnded don't change the playlist or arena (a retagged next match's states)", () => {
    const events = [ev("MatchInitialized"), state([], [1, 0]), ev("MatchEnded", { WinnerTeamNum: 0 }), state([], [0, 0], { PlaylistId: 6, Arena: "other_p" })];
    expect(summarise("G", events, destroyed)).toMatchObject({ playlistId: 13, arena: "cs_p", score: [1, 0] });
  });

  test("carries the close cause and dedup counts", () => {
    expect(summarise("G", [ev("MatchCreated")], { via: "superseded", dedupDropped: { replay_goal: 3 } })).toMatchObject({
      closedVia: "superseded",
      dedupDropped: { replay_goal: 3 },
      score: null,
      flags: [],
    });
  });
});
