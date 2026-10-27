import { describe, expect, test } from "vitest";
import { initialLife, orphan, rebuild, step, untilFinished, type Effect, type Life } from "./lifecycle";

type Ev = [name: string, guid: string];

/** Runs events through `step`; returns where each was filed, every effect, and the final state. */
function run(events: Ev[], life: Life = initialLife(), resume?: (guid: string) => string[] | null) {
  const filed: (string | null)[] = [];
  const effects: Effect[] = [];
  for (const [name, guid] of events) {
    const r = step(life, { name, guid }, resume);
    life = r.life;
    filed.push(r.fileUnder);
    effects.push(...r.effects);
  }
  return { filed, effects, life };
}

const kinds = (effects: Effect[]) => effects.map((e) => (e.kind === "closed" ? `closed:${e.phase}:${e.via}` : e.kind));

describe("step", () => {
  test("a normal match: opened → live → ended → closed, all filed under its guid", () => {
    const { filed, effects, life } = run([
      ["UpdateState", "A"],
      ["MatchCreated", "A"],
      ["MatchInitialized", "A"],
      ["RoundStarted", "A"],
      ["GoalScored", "A"],
      ["MatchEnded", "A"],
      ["PodiumStart", "A"],
      ["MatchDestroyed", "A"],
    ]);
    expect(filed).toEqual(Array(8).fill("A"));
    expect(kinds(effects)).toEqual(["opened", "live", "ended", "closed:ended:destroyed"]);
    expect(effects[1]).toEqual({ kind: "live", guid: "A", joinedInProgress: false });
    expect(life.open).toBeNull();
  });

  test("guid '' is never filed and never changes state", () => {
    const { filed, effects } = run([
      ["MatchCreated", ""],
      ["MatchInitialized", ""],
      ["UpdateState", ""],
      ["MatchDestroyed", ""],
    ]);
    expect(filed).toEqual([null, null, null, null]);
    expect(effects).toEqual([]);
  });

  test("guid '' while a match is open is ignored too", () => {
    const { filed, life } = run([
      ["MatchInitialized", "A"],
      ["PlayerLeft", ""],
      ["MatchDestroyed", ""],
    ]);
    expect(filed).toEqual(["A", null, null]);
    expect(life.open?.phase).toBe("live");
  });

  test("joined in progress: live without MatchInitialized", () => {
    const { effects } = run([
      ["UpdateState", "A"],
      ["RoundStarted", "A"],
    ]);
    expect(effects[1]).toEqual({ kind: "live", guid: "A", joinedInProgress: true });
  });

  test.each(["CountdownBegin", "RoundStarted", "GoalScored", "MatchInitialized"])("%s makes a pending match live", (name) => {
    expect(run([["MatchCreated", "A"], [name, "A"]]).life.open?.phase).toBe("live");
  });

  test("MatchEnded from pending goes live (joined in progress) then ended", () => {
    const { effects, life } = run([
      ["UpdateState", "A"],
      ["MatchEnded", "A"],
    ]);
    expect(kinds(effects)).toEqual(["opened", "live", "ended"]);
    expect(effects[1]).toMatchObject({ joinedInProgress: true });
    expect(life.open?.phase).toBe("ended");
  });

  test("leaving mid-match closes from live", () => {
    expect(kinds(run([["MatchInitialized", "A"], ["MatchDestroyed", "A"]]).effects)).toEqual(["opened", "live", "closed:live:destroyed"]);
  });

  test("a lobby with no game closes from pending", () => {
    const { effects } = run([
      ["MatchCreated", "L"],
      ["PlayerJoined", "L"],
      ["PlayerLeft", "L"],
      ["MatchDestroyed", "L"],
    ]);
    expect(kinds(effects)).toEqual(["opened", "closed:pending:destroyed"]);
  });

  test("private teardown: the next guid's events after MatchEnded stay with the open match, and MatchDestroyed closes it", () => {
    const { filed, effects } = run([
      ["MatchInitialized", "A"],
      ["MatchEnded", "A"],
      ["PodiumStart", "A"],
      ["UpdateState", "B"],
      ["UpdateState", "B"],
      ["MatchDestroyed", "B"],
      ["PlayerLeft", ""],
      ["MatchCreated", "B"],
    ]);
    expect(filed).toEqual(["A", "A", "A", "A", "A", "A", null, "B"]);
    expect(kinds(effects)).toEqual(["opened", "live", "ended", "retagged", "closed:ended:destroyed", "opened"]);
    expect(effects[3]).toEqual({ kind: "retagged", guid: "A", wireGuid: "B" });
  });

  test("a different guid while live is filed under the open match with one guid_mismatch", () => {
    const { filed, effects } = run([
      ["MatchInitialized", "A"],
      ["UpdateState", "X"],
      ["BallHit", "X"],
    ]);
    expect(filed).toEqual(["A", "A", "A"]);
    expect(kinds(effects)).toEqual(["opened", "live", "guid_mismatch"]);
  });

  test.each([
    ["pending", [["MatchCreated", "A"]] as Ev[]],
    ["live", [["MatchInitialized", "A"]] as Ev[]],
    ["ended", [["MatchInitialized", "A"], ["MatchEnded", "A"]] as Ev[]],
  ])("MatchCreated with another guid supersedes a %s match", (phase, before) => {
    const { filed, effects, life } = run([...before, ["MatchCreated", "B"]]);
    expect(filed.at(-1)).toBe("B");
    expect(effects.slice(-2)).toEqual([
      { kind: "closed", guid: "A", phase, via: "superseded" },
      { kind: "opened", guid: "B", resumed: false },
    ]);
    expect(life.open).toMatchObject({ guid: "B", phase: "pending" });
  });

  test("a close marker with no open match is ignored", () => {
    expect(run([["MatchDestroyed", "A"]])).toMatchObject({ filed: [null], effects: [] });
  });

  test("a guid with history resumes in its rebuilt phase instead of pending", () => {
    const history: Record<string, string[]> = { A: ["MatchCreated", "MatchInitialized", "RoundStarted"] };
    const { effects, life } = run([["UpdateState", "A"], ["MatchDestroyed", "A"]], initialLife(), (g) => history[g] ?? null);
    expect(effects).toEqual([
      { kind: "opened", guid: "A", resumed: true },
      { kind: "closed", guid: "A", phase: "live", via: "destroyed" },
    ]);
    expect(life.open).toBeNull();
  });

  const finished: Record<string, string[]> = { A: ["MatchCreated", "MatchInitialized", "MatchEnded", "MatchDestroyed"] };

  test("a guid whose history reached ended is refused: nothing filed, nothing opened", () => {
    const { filed, effects, life } = run([["UpdateState", "A"]], initialLife(), (g) => finished[g] ?? null);
    expect(filed).toEqual([null]);
    expect(effects).toEqual([{ kind: "refused", guid: "A" }]);
    expect(life).toEqual({ open: null, refused: { guid: "A", sawState: true } });
  });

  test("scrubbing a replay: the refusal survives its close markers, is reported at the refusal and its first state, and resume is asked once", () => {
    const asked: string[] = [];
    const resume = (g: string) => (asked.push(g), finished[g] ?? null);
    const { filed, effects } = run(
      [
        ["MatchCreated", "A"],
        ["UpdateState", "A"],
        ["MatchDestroyed", "A"],
        ["MatchCreated", "A"],
        ["UpdateState", "A"],
      ],
      initialLife(),
      resume,
    );
    expect(filed).toEqual([null, null, null, null, null]);
    expect(effects).toEqual([
      { kind: "refused", guid: "A" },
      { kind: "refused", guid: "A" },
    ]);
    expect(asked).toEqual(["A"]);
  });

  test.each([
    ["pending", ["MatchCreated", "MatchDestroyed"]],
    ["live", ["MatchCreated", "MatchInitialized", "RecorderClosed"]],
  ])("a guid whose history stopped %s still resumes", (phase, names) => {
    const { filed, life } = run([["UpdateState", "A"]], initialLife(), () => names);
    expect(filed).toEqual(["A"]);
    expect(life.open).toMatchObject({ guid: "A", phase });
  });

  test("another guid opening clears the refusal", () => {
    const { filed, effects, life } = run(
      [
        ["UpdateState", "A"],
        ["MatchCreated", "B"],
      ],
      initialLife(),
      (g) => finished[g] ?? null,
    );
    expect(filed).toEqual([null, "B"]);
    expect(effects).toEqual([
      { kind: "refused", guid: "A" },
      { kind: "opened", guid: "B", resumed: false },
    ]);
    expect(life.refused).toBeNull();
  });
});

describe("untilFinished", () => {
  const evs = (...names: string[]) => names.map((name, i) => ({ name, i }));

  test("no close: everything, no cut", () => {
    const events = evs("MatchInitialized", "MatchEnded", "PodiumStart");
    expect(untilFinished(events)).toEqual({ events, cut: null });
  });

  test("a close before ended (a Reconnect) is not a cut", () => {
    const events = evs("MatchInitialized", "MatchDestroyed", "UpdateState", "MatchEnded", "MatchDestroyed");
    expect(untilFinished(events)).toEqual({ events, cut: events[4] });
  });

  test("a retagged teardown between MatchEnded and MatchDestroyed is kept, cut at the destroy", () => {
    const events = evs("MatchInitialized", "MatchEnded", "PodiumStart", "UpdateState", "MatchDestroyed");
    expect(untilFinished(events)).toEqual({ events, cut: events[4] });
  });

  test("a tail after the first close past ended is dropped", () => {
    const events = evs("MatchInitialized", "MatchEnded", "MatchDestroyed", "MatchCreated", "GoalScored", "MatchDestroyed");
    expect(untilFinished(events)).toEqual({ events: events.slice(0, 3), cut: events[2] });
  });

  test("a recorder restart marker after ended is a cut", () => {
    const events = evs("MatchInitialized", "MatchEnded", "RecorderClosed", "UpdateState");
    expect(untilFinished(events)).toEqual({ events: events.slice(0, 3), cut: events[2] });
  });
});

describe("rebuild", () => {
  test("folds stored event names to the phase they reached, ignoring close markers", () => {
    expect(rebuild("A", ["MatchCreated"])).toMatchObject({ guid: "A", phase: "pending" });
    expect(rebuild("A", ["UpdateState", "RoundStarted", "MatchDestroyed"])).toMatchObject({ phase: "live", sawInitialized: false });
    expect(rebuild("A", ["MatchInitialized", "MatchEnded", "MatchDestroyed", "RecorderClosed"])).toMatchObject({ phase: "ended", sawInitialized: true });
  });
});

describe("orphan", () => {
  test("closes the open match with the given cause", () => {
    const { life } = run([["MatchInitialized", "A"]]);
    expect(orphan(life, "timeout")).toEqual({ life: { open: null, refused: null }, effects: [{ kind: "closed", guid: "A", phase: "live", via: "timeout" }] });
  });

  test("an orphaned pending match closes from pending (a lobby: no hook)", () => {
    const { life } = run([["MatchCreated", "A"]]);
    expect(orphan(life, "restart").effects).toEqual([{ kind: "closed", guid: "A", phase: "pending", via: "restart" }]);
  });

  test("does nothing with no open match", () => {
    expect(orphan(initialLife(), "timeout")).toEqual({ life: { open: null, refused: null }, effects: [] });
  });

  test("keeps a refusal", () => {
    expect(orphan({ open: null, refused: { guid: "A", sawState: false } }, "timeout").life).toEqual({ open: null, refused: { guid: "A", sawState: false } });
  });
});
