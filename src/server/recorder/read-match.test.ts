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
