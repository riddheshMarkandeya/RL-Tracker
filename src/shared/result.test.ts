import { describe, expect, test } from "vitest";
import { resultFor, type ResultInput } from "./result";

const match = (over: Partial<ResultInput> = {}): ResultInput => ({ winnerTeamNum: null, endKind: "completed", closedVia: "destroyed", ...over });

describe("resultFor", () => {
  test("with a winner: win on the winning team, loss on the other", () => {
    expect(resultFor(match({ winnerTeamNum: 1 }), 1)).toBe("win");
    expect(resultFor(match({ winnerTeamNum: 1 }), 0)).toBe("loss");
  });

  test("a winner stands whatever the end: a decided win after a leave or a restart is still a win", () => {
    expect(resultFor(match({ winnerTeamNum: 0, endKind: "left" }), 0)).toBe("win");
    expect(resultFor(match({ winnerTeamNum: 0, endKind: "orphaned", closedVia: "restart" }), 0)).toBe("win");
  });

  test("no winner after a leave is a loss", () => {
    expect(resultFor(match({ endKind: "left" }), 0)).toBe("loss");
  });

  test.each(["superseded", "timeout"] as const)("no winner, orphaned by %s, is a loss like a leave", (closedVia) => {
    expect(resultFor(match({ endKind: "orphaned", closedVia }), 1)).toBe("loss");
  });

  test("no winner, orphaned by a restart, is unknown: the tracker was down and play may have gone on", () => {
    expect(resultFor(match({ endKind: "orphaned", closedVia: "restart" }), 0)).toBeNull();
  });

  test("an ended match with no winner is unknown, not a loss", () => {
    expect(resultFor(match({ endKind: "completed" }), 0)).toBeNull();
    expect(resultFor(match({ endKind: "early_end" }), 0)).toBeNull();
  });

  test("a player never on a team has no result", () => {
    expect(resultFor(match({ winnerTeamNum: 0 }), null)).toBeNull();
    expect(resultFor(match({ endKind: "left" }), null)).toBeNull();
  });
});
