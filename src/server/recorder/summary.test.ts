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
      winner: { teamNum: 1, source: "match_ended" },
      mvp: { name: "B", teamNum: 1, key: "Epic|B|0", source: "statfeed" },
      facts: { sawMatchEnded: true, sawPodium: true, mvpCount: 1, liveGoals: 1, minClock: 0 },
    });
    expect(s.startedAt).toBe(events[0]?.ts);
    expect(s.endedAt).toBe(events.at(-1)?.ts);
    expect(s.roster.map((r) => [r.name, r.presentAtEnd, r.stats.goals])).toEqual([
      ["A", true, 0],
      ["B", true, 1],
    ]);
  });

  test("a Winner name and a lead with time left make no winner", () => {
    const s = summarise("G", [ev("MatchInitialized"), state([{ name: "A" }], [3, 0], { Winner: "Club", bHasWinner: true }), ev("MatchDestroyed")], destroyed);
    expect(s.winner).toBeNull();
    expect(s.endKind).toBe("left");
  });

  test("a forfeit keeps MatchEnded's winner even against the score", () => {
    const s = summarise("G", [ev("MatchInitialized"), state([{ name: "A" }], [2, 3], { TimeSeconds: 136 }), ev("MatchEnded", { WinnerTeamNum: 0 }), ev("MatchDestroyed")], destroyed);
    expect(s).toMatchObject({ winner: { teamNum: 0, source: "match_ended" }, endKind: "early_end", score: [2, 3] });
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

  test("a players or teams entry that isn't an object is skipped", () => {
    const game = { Teams: [null, [], { TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 2 }] };
    const s = summarise("G", [ev("MatchInitialized"), ev("UpdateState", { Players: [null, 7, [], player({ name: "A" })], Game: game })], destroyed);
    expect(s.roster.map((r) => r.name)).toEqual(["A"]);
    expect(s.score).toEqual([1, 2]);
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
    expect(summarise("G", events, destroyed).mvp).toEqual({ name: "A", teamNum: 0, key: "Epic|A|0", source: "statfeed" });
  });

  test("an MVP whose shortcut points at someone else falls back to a unique name+team match, else stays unresolved", () => {
    const base = [ev("MatchInitialized"), state([{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1 }]), ev("MatchEnded", { WinnerTeamNum: 1 })];
    expect(summarise("G", [...base, mvp("B", 1, 1)], destroyed).mvp?.key).toBe("Epic|B|0");
    expect(summarise("G", [...base, mvp("Nobody", 7, 1)], destroyed).mvp).toEqual({ name: "Nobody", teamNum: 1, key: null, source: "statfeed" });
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

const feedEvent = (eventName: string, name: string, shortcut: number, team: number) => ev("StatfeedEvent", { EventName: eventName, MainTarget: { Name: name, Shortcut: shortcut, TeamNum: team } });
const target = (name: string, shortcut: number, team: number, replay = false) => ({ bHasTarget: true, bReplay: replay, Target: { Name: name, Shortcut: shortcut, TeamNum: team } });

describe("summarise: decided winner (no MatchEnded)", () => {
  const ab = [{ name: "A", shortcut: 1, team: 0, goals: 2 }, { name: "B", shortcut: 2, team: 1 }];

  test("a lead when the clock reads 0 is decided for the higher score", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(ab, [2, 0], { TimeSeconds: 0 }), ev("MatchDestroyed")], destroyed);
    expect(s.winner).toEqual({ teamNum: 0, source: "decided" });
    expect(s.endKind).toBe("left");
  });

  test("a lead in overtime is decided", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(ab, [0, 1], { TimeSeconds: 40, bOvertime: true })], { via: "timeout", dedupDropped: {} });
    expect(s.winner).toEqual({ teamNum: 1, source: "decided" });
  });

  test("a tie at 0 stays undecided, and a lead with time left is no winner", () => {
    expect(summarise("G", [ev("MatchInitialized"), state(ab, [1, 1], { TimeSeconds: 0 }), ev("MatchDestroyed")], destroyed).winner).toBeNull();
    expect(summarise("G", [ev("MatchInitialized"), state(ab, [2, 0], { TimeSeconds: 61 }), ev("MatchDestroyed")], destroyed).winner).toBeNull();
  });

  test("MatchEnded's winner is the source whenever it came", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(ab, [2, 0], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 1 })], destroyed);
    expect(s.winner).toEqual({ teamNum: 1, source: "match_ended" });
  });

  test("a scoreboard without both real teams doesn't replace the score, and decides nothing", () => {
    const partial = { TimeSeconds: 0, Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 255, Score: 3 }] };
    const alone = summarise("G", [ev("MatchInitialized"), state(ab, [0, 0], partial), ev("MatchDestroyed")], destroyed);
    expect(alone).toMatchObject({ score: null, winner: null });
    const after = summarise("G", [ev("MatchInitialized"), state(ab, [2, 1], { TimeSeconds: 5 }), state(ab, [0, 0], partial), ev("MatchDestroyed")], destroyed);
    expect(after).toMatchObject({ score: [2, 1], winner: { teamNum: 0, source: "decided" } });
    const noScore = { TimeSeconds: 0, Teams: [{ TeamNum: 0, Score: 0 }, { TeamNum: 1 }] };
    expect(summarise("G", [ev("MatchInitialized"), state(ab, [2, 1], { TimeSeconds: 5 }), state(ab, [0, 0], noScore), ev("MatchDestroyed")], destroyed)).toMatchObject({ score: [2, 1], winner: { teamNum: 0, source: "decided" } });
    const notGoals = { TimeSeconds: 0, Teams: [{ TeamNum: 0, Score: -1 }, { TeamNum: 1, Score: 0.5 }] };
    expect(summarise("G", [ev("MatchInitialized"), state(ab, [2, 1], { TimeSeconds: 5 }), state(ab, [0, 0], notGoals), ev("MatchDestroyed")], destroyed).score).toEqual([2, 1]);
    const oneBad = { TimeSeconds: 0, Teams: [{ TeamNum: 0, Score: -1 }, { TeamNum: 1, Score: 3 }] };
    expect(summarise("G", [ev("MatchInitialized"), state(ab, [2, 1], { TimeSeconds: 5 }), state(ab, [0, 0], oneBad), ev("MatchDestroyed")], destroyed)).toMatchObject({ score: [2, 1], winner: { teamNum: 0, source: "decided" } });
  });

  test("each rejected scoreboard before MatchEnded is counted; full ones, states without one and teardown aren't", () => {
    const partial = { Teams: [{ TeamNum: 0, Score: 1 }] };
    const badGoals = { Teams: [{ TeamNum: 0, Score: -1 }, { TeamNum: 1, Score: 0.5 }] };
    const events = [
      ev("MatchInitialized"),
      state(ab, [1, 0]),
      state(ab, [0, 0], partial),
      state(ab, [0, 0], { Teams: undefined }),
      state(ab, [0, 0], badGoals),
      ev("MatchEnded", { WinnerTeamNum: 0 }),
      state(ab, [0, 0], partial),
    ];
    expect(summarise("G", events, destroyed).facts.rejectedScoreboards).toBe(2);
  });

  test("a full scoreboard with an extra side that isn't a real team still updates the score", () => {
    const extra = { TimeSeconds: 0, Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 2 }, { TeamNum: 255, Score: 9 }] };
    const s = summarise("G", [ev("MatchInitialized"), state(ab, [0, 0], extra), ev("MatchDestroyed")], destroyed);
    expect(s).toMatchObject({ score: [1, 2], winner: { teamNum: 1, source: "decided" } });
  });

  test("with no score seen, MatchEnded's team is still the winner, but only a real team", () => {
    const ended = (team: number) => summarise("G", [ev("MatchInitialized"), ev("MatchEnded", { WinnerTeamNum: team })], destroyed).winner;
    expect(ended(1)).toEqual({ teamNum: 1, source: "match_ended" });
    expect([ended(-1), ended(255), ended(2), ended(0.5)]).toEqual([null, null, null, null]);
  });

  test("MatchEnded naming no team (-1 is a no contest) gives no winner, and isn't decided either", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(ab, [2, 0], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: -1 })], destroyed);
    expect(s.winner).toBeNull();
    expect(s.facts.endedWinnerTeamNum).toBe(-1);
  });
});

describe("summarise: MVP", () => {
  const roster = [
    { name: "A", shortcut: 1, team: 0, goals: 2 },
    { name: "C", shortcut: 3, team: 0, goals: 1 },
    { name: "B", shortcut: 2, team: 1, goals: 3 },
  ];

  test("with a winner and no MVP statfeed, the top scorer on the winning team is inferred", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(roster, [3, 3], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 0 })], destroyed);
    expect(s.mvp).toEqual({ name: "A", teamNum: 0, key: "Epic|A|0", source: "inferred" });
  });

  test("a tie for top score on the winning team means no MVP", () => {
    const tied = [{ name: "A", shortcut: 1, team: 0, goals: 1 }, { name: "C", shortcut: 3, team: 0, goals: 1 }];
    expect(summarise("G", [ev("MatchInitialized"), state(tied, [2, 0], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 0 })], destroyed).mvp).toBeNull();
  });

  test("a leaver on the winning team is not inferred MVP: the game awards it to a player still there", () => {
    const events = [
      ev("MatchInitialized"),
      state([{ name: "Leaver", shortcut: 4, team: 0, goals: 5 }, { name: "A", shortcut: 1, team: 0, goals: 1 }], [6, 0]),
      state([{ name: "A", shortcut: 1, team: 0, goals: 1 }], [6, 0], { TimeSeconds: 0 }),
      ev("MatchEnded", { WinnerTeamNum: 0 }),
    ];
    expect(summarise("G", events, destroyed).mvp?.name).toBe("A");
  });

  test("no winner, no inferred MVP", () => {
    expect(summarise("G", [ev("MatchInitialized"), state(roster, [3, 3]), ev("MatchDestroyed")], destroyed).mvp).toBeNull();
  });

  test("a statfeed MVP is the MVP with source statfeed", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(roster, [3, 3], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 0 }), mvp("C", 3, 0)], destroyed);
    expect(s.mvp).toEqual({ name: "C", teamNum: 0, key: "Epic|C|0", source: "statfeed" });
  });

  test("an unresolved statfeed MVP stays the statfeed's, with key null, and is never replaced by an inferred one", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(roster, [3, 3], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 0 }), mvp("Nobody", 9, 0)], destroyed);
    expect(s.mvp).toEqual({ name: "Nobody", teamNum: 0, key: null, source: "statfeed" });
  });

  test("a statfeed MVP whose team isn't a real one has no team", () => {
    const s = summarise("G", [ev("MatchInitialized"), state(roster, [3, 3], { TimeSeconds: 0 }), ev("MatchEnded", { WinnerTeamNum: 0 }), mvp("Nobody", 9, 255)], destroyed);
    expect(s.mvp).toEqual({ name: "Nobody", teamNum: null, key: null, source: "statfeed" });
  });
});

describe("summarise: teams seen, statfeed tally, camera", () => {
  test("teamsSeen ORs a bit per team the player was on, ignoring anything but 0 and 1", () => {
    const s = summarise("G", [state([{ name: "A", team: 255 }]), state([{ name: "A", team: 0 }]), state([{ name: "A", team: 1 }])], destroyed);
    expect(s.roster[0]?.teamsSeen).toBe(0b11);
    expect(summarise("G", [state([{ name: "A", team: 255 }])], destroyed).roster[0]?.teamsSeen).toBe(0);
    expect(summarise("G", [state([{ name: "A", team: 32 }])], destroyed).roster[0]).toMatchObject({ teamNum: null, teamsSeen: 0 });
  });

  test("every statfeed event is tallied per roster key; unresolved targets are counted", () => {
    const events = [
      state([{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1 }]),
      feedEvent("Shot", "A", 1, 0),
      feedEvent("Shot", "A", 1, 0),
      feedEvent("Goal", "A", 1, 0),
      feedEvent("Save", "B", 2, 1),
      feedEvent("Shot", "Ghost", 7, 1),
    ];
    const s = summarise("G", events, destroyed);
    expect(s.statfeed).toEqual({ "Epic|A|0": { Shot: 2, Goal: 1 }, "Epic|B|0": { Save: 1 } });
    expect(s.facts.unresolvedStatfeed).toBe(1);
  });

  const ab = [{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1 }];
  const following = (name: string, n: number) => Array.from({ length: n }, () => (name === "A" ? state(ab, [0, 0], target("A", 1, 0)) : state(ab, [0, 0], target("B", 2, 1))));

  test("cameraKey is the player the camera followed through play; replays and states after MatchEnded don't count", () => {
    const events = [
      ...following("A", 20),
      state(ab, [0, 0], target("B", 2, 1, true)),
      ev("MatchEnded", { WinnerTeamNum: 1 }),
      ...following("B", 30),
    ];
    const s = summarise("G", events, destroyed);
    expect(s.cameraKey).toBe("Epic|A|0");
    expect(s.facts.cameraTargets).toBe(20);
  });

  test("a stray frame on someone else still leaves the camera's player, but a split camera is a spectator's (C138256C: 71%)", () => {
    expect(summarise("G", [...following("A", 19), ...following("B", 1)], destroyed).cameraKey).toBe("Epic|A|0");
    expect(summarise("G", [...following("A", 14), ...following("B", 6)], destroyed)).toMatchObject({ cameraKey: null, facts: { cameraTargets: 20 } });
  });

  test("targets not yet on the scoreboard don't count against the share (C6C0A6B4: you, at team 255, before joining it)", () => {
    const early = Array.from({ length: 4 }, () => state([{ name: "B", shortcut: 2, team: 1 }], [0, 0], target("A", 1, 255)));
    expect(summarise("G", [...early, ...following("A", 70)], destroyed).cameraKey).toBe("Epic|A|0");
  });

  test("a target whose shortcut names someone else doesn't count; no target at all is null", () => {
    expect(summarise("G", [state(ab, [0, 0], target("Spectated", 1, 0))], destroyed)).toMatchObject({ cameraKey: null, facts: { cameraTargets: 1 } });
    expect(summarise("G", [state(ab)], destroyed)).toMatchObject({ cameraKey: null, facts: { cameraTargets: 0 } });
  });
});

describe("summarise: final player stats", () => {
  test("player stats catch up with states after MatchEnded: the game's scoreboard lags its statfeed (D99A293C)", () => {
    const ab = [{ name: "A", shortcut: 1, team: 0 }, { name: "B", shortcut: 2, team: 1 }];
    const events = [
      ev("MatchInitialized"),
      state(ab, [0, 0], { TimeSeconds: 0 }),
      ev("MatchEnded", { WinnerTeamNum: 0 }),
      // Stored milliseconds after the end, before the lagging stat arrived.
      state(ab, [9, 9], { TimeSeconds: 0 }),
      // A's last-second shot (and goal) reaches the scoreboard now; B has already left. Teardown
      // can arrive under the next match's guid, but it is still this game's scoreboard.
      ev("UpdateState", { ...state([{ name: "A", shortcut: 1, team: 0, goals: 1 }], [9, 9]).data, MatchGuid: "NEXT" }),
      // A teardown state with counters reset doesn't lower them.
      state([{ name: "A", shortcut: 1, team: 0 }], [9, 9]),
    ];
    const s = summarise("G", events, destroyed);
    expect(s.roster.map((r) => [r.name, r.stats.goals, r.stats.shots, r.stats.score, r.presentAtEnd])).toEqual([
      ["A", 1, 1, 100, true],
      ["B", 0, 0, 0, true],
    ]);
    expect(s.score).toEqual([0, 0]);
  });
});
