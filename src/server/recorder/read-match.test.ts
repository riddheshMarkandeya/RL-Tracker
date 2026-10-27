import { describe, expect, test, vi } from "vitest";
import { readMatch } from "./read-match";
import type { StoredEvent, ThinnedOutputs } from "./store";

const extrasThrow = vi.hoisted(() => ({ on: false }));
vi.mock("./extras", async (importOriginal) => {
  const real = await importOriginal<typeof import("./extras")>();
  return {
    ...real,
    computeExtras: (...args: Parameters<typeof real.computeExtras>) => {
      if (extrasThrow.on) throw new TypeError("boom");
      return real.computeExtras(...args);
    },
  };
});

test("a throw in the extras leaves the base summary, with the extras null and flagged", () => {
  extrasThrow.on = true;
  try {
    const events: StoredEvent[] = [{ seq: 0, ts: 0, name: "RoundStarted", data: {} }];
    const { summary, failures } = readMatch({ matchEvents: () => events }, "G", "destroyed");
    expect(summary.guid).toBe("G");
    expect(summary.extras).toBeNull();
    expect(failures.find((f) => f.id === "extras_computed")?.detail).toMatch(/TypeError: boom/);
    expect(summary.flags).toContain("extras_computed");
  } finally {
    extrasThrow.on = false;
  }
});

const A = "Epic|A|0";
const B = "Epic|B|0";
const player = (name: string, id: string, shortcut: number, boost: number) => ({ Name: name, PrimaryId: id, Shortcut: shortcut, TeamNum: 0, bHasCar: true, Boost: boost });
const state = (seq: number, boost: number): StoredEvent => ({
  seq,
  ts: seq * 1000,
  name: "UpdateState",
  data: {
    Players: [player("A", A, 1, boost), player("B", B, 2, boost)],
    Game: { PlaylistId: 13, bHasTarget: true, Target: { Name: "A", Shortcut: 1, TeamNum: 0 } },
  },
});
// Joined in progress, so every state is in play: A and B both get car samples, and A the camera.
const events: StoredEvent[] = [state(0, 10), state(1, 10), state(2, 10)];

const snapshot = (over: Partial<ThinnedOutputs["outputs"]> = {}): ThinnedOutputs => ({
  outputs: { cameraKey: B, players: { [B]: { car_ms: 9000, boost_avg: 77, supersonic_ms: 5, empty_boost_ms: 6 } }, denseRules: ["car_sampling", "car_stats", "camera_identity"], ...over },
  ruleVersions: { car_sampling: 7, car_stats: 8, camera_identity: 9, roster: 4 },
});

describe("readMatch on a thinned match", () => {
  test("without a snapshot nothing is substituted", () => {
    const { summary } = readMatch({ matchEvents: () => events, thinnedOutputs: () => undefined }, "G", "destroyed");
    expect(summary.thinned).toBeNull();
    expect(summary.cameraKey).toBe(A);
    expect(summary.extras?.players[A]?.car_ms).toBe(2000);
    expect(summary.extras?.players[A]?.boost_avg).toBe(10);
  });

  test("the snapshot's car stats, camera and dense rule versions replace the recomputed ones", () => {
    const { summary } = readMatch({ matchEvents: () => events, thinnedOutputs: () => snapshot() }, "G", "destroyed");
    expect(summary.cameraKey).toBe(B);
    expect(summary.extras?.players[B]).toMatchObject({ car_ms: 9000, boost_avg: 77, supersonic_ms: 5, empty_boost_ms: 6 });
    // A key the snapshot lacks had no car stats when it was thinned.
    expect(summary.extras?.players[A]).toMatchObject({ car_ms: null, boost_avg: null, supersonic_ms: null, empty_boost_ms: null });
    // Columns that aren't dense still recompute.
    expect(summary.extras?.players[A]?.woodwork_hits).toBe(0);
    expect(summary.thinned).toEqual({ ruleVersions: { car_sampling: 7, car_stats: 8, camera_identity: 9 }, offRoster: [], unsnapshotted: [] });
    expect(summary.flags).not.toContain("thinned_snapshot_on_roster");
    expect(summary.flags).not.toContain("thinned_snapshot_covers_dense");
  });

  test("a snapshot key that isn't on the roster is flagged", () => {
    const off = snapshot({ cameraKey: "Epic|Gone|0", players: { "Epic|Old|0": { car_ms: 1, boost_avg: null, supersonic_ms: null, empty_boost_ms: null } } });
    const { summary, failures } = readMatch({ matchEvents: () => events, thinnedOutputs: () => off }, "G", "destroyed");
    expect(summary.thinned?.offRoster).toEqual(["Epic|Gone|0", "Epic|Old|0"]);
    expect(failures.find((f) => f.id === "thinned_snapshot_on_roster")?.detail).toMatch(/Epic\|Gone\|0, Epic\|Old\|0/);
  });

  test("a dense rule the snapshot predates is flagged", () => {
    const { summary, failures } = readMatch({ matchEvents: () => events, thinnedOutputs: () => snapshot({ denseRules: ["car_sampling", "car_stats"] }) }, "G", "destroyed");
    expect(summary.thinned?.unsnapshotted).toEqual(["camera_identity"]);
    expect(failures.find((f) => f.id === "thinned_snapshot_covers_dense")?.detail).toMatch(/camera_identity/);
  });

  test("events are read before the snapshot", () => {
    const order: string[] = [];
    readMatch(
      {
        matchEvents: () => (order.push("events"), events),
        thinnedOutputs: () => (order.push("snapshot"), undefined),
      },
      "G",
      "destroyed",
    );
    expect(order).toEqual(["events", "snapshot"]);
  });
});

describe("readMatch on a finished match with events stored after its close", () => {
  const ev = (seq: number, name: string, data: Record<string, unknown> = {}): StoredEvent => ({ seq, ts: seq * 1000, name, data: { MatchGuid: "G", ...data } });
  const scoreboard = (seq: number, goals: number, bReplay = false) =>
    ev(seq, "UpdateState", {
      Game: { Teams: [{ TeamNum: 0, Score: goals }, { TeamNum: 1, Score: 0 }], PlaylistId: 10, TimeSeconds: 100, bOvertime: false, Arena: "cs_p", bReplay },
      Players: [
        { Name: "A", PrimaryId: A, Shortcut: 1, TeamNum: 0, Goals: goals },
        { Name: "B", PrimaryId: B, Shortcut: 2, TeamNum: 1, Goals: 0 },
      ],
    });
  const goal = (seq: number) => ev(seq, "GoalScored", { Scorer: { Name: "A", Shortcut: 1, TeamNum: 0 }, GoalTime: seq });
  const match = [ev(0, "MatchCreated"), ev(1, "MatchInitialized"), scoreboard(2, 0), goal(3), scoreboard(4, 1), ev(5, "MatchEnded", { WinnerTeamNum: 0 })];
  // Replay playback re-sends the guid: scrubbing opens and destroys it again, and its goals replay.
  const replayTail = [ev(50, "MatchCreated"), scoreboard(51, 0, true), goal(52), scoreboard(53, 1, true), ev(54, "MatchDestroyed")];

  test("it ends at its first close: the replay tail moves neither ended_at nor via, and adds no goal", () => {
    const events = [...match, ev(10, "MatchDestroyed"), ...replayTail, ev(60, "RecorderClosed", { Reason: "timeout" })];
    const { summary } = readMatch({ matchEvents: () => events }, "G", "timeout");
    expect(summary.endedAt).toBe(10_000);
    expect(summary.closedVia).toBe("destroyed");
    expect(summary.flags).not.toContain("goal_events_equal_score");
  });

  test("a replay of a match left mid-game isn't cut, but its all-replay stretch is flagged", () => {
    const left = [ev(0, "MatchCreated"), ev(1, "MatchInitialized"), ...Array.from({ length: 25 }, (_, i) => scoreboard(2 + i, 0, i % 5 === 0)), ev(30, "MatchDestroyed")];
    const replay = [ev(50, "MatchCreated"), ...Array.from({ length: 25 }, (_, i) => scoreboard(51 + i, 0, true)), ev(80, "MatchDestroyed")];
    const { summary } = readMatch({ matchEvents: () => [...left, ...replay] }, "G", "destroyed");
    expect(summary.flags).toContain("replay_playback");
    expect(readMatch({ matchEvents: () => left }, "G", "destroyed").summary.flags).not.toContain("replay_playback");
  });

  test("a recorder close bounds a stretch too: a crashed match's live states don't dilute its replay's", () => {
    const crashed = [ev(0, "MatchCreated"), ev(1, "MatchInitialized"), ...Array.from({ length: 25 }, (_, i) => scoreboard(2 + i, 0, i % 5 === 0)), ev(30, "RecorderClosed", { Reason: "timeout" })];
    const replay = [ev(50, "MatchCreated"), ...Array.from({ length: 25 }, (_, i) => scoreboard(51 + i, 0, true)), ev(80, "RecorderClosed", { Reason: "timeout" })];
    expect(readMatch({ matchEvents: () => [...crashed, ...replay] }, "G", "timeout").summary.flags).toContain("replay_playback");
  });

  test("a recorder close after the end is a cut too, ending at the last event before it", () => {
    const events = [...match, ev(8, "PodiumStart"), ev(9, "RecorderClosed", { Reason: "timeout" }), ...replayTail];
    const { summary } = readMatch({ matchEvents: () => events }, "G", "destroyed");
    expect(summary.endedAt).toBe(8000);
    expect(summary.closedVia).toBe("timeout");
    expect(summary.flags).not.toContain("goal_events_equal_score");
  });
});
