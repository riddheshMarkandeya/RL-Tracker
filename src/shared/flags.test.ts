import { describe, expect, test } from "vitest";
import { flagReasons, type FlagInput } from "./flags";

const match = (over: Partial<FlagInput> = {}): FlagInput => ({
  endKind: "completed",
  joinedInProgress: false,
  winnerSource: "match_ended",
  mvpSource: "statfeed",
  checkFailed: false,
  ...over,
});

describe("flagReasons", () => {
  test("a full match, or a forfeit, isn't flagged", () => {
    expect(flagReasons(match())).toEqual([]);
    expect(flagReasons(match({ endKind: "early_end" }))).toEqual([]);
  });

  test("no MVP or no winner at all isn't a flag by itself", () => {
    expect(flagReasons(match({ mvpSource: null, winnerSource: null }))).toEqual([]);
  });

  test("each reason alone", () => {
    expect(flagReasons(match({ endKind: "left", winnerSource: null }))).toEqual(["left"]);
    expect(flagReasons(match({ endKind: "orphaned", winnerSource: null }))).toEqual(["lost_ending"]);
    expect(flagReasons(match({ joinedInProgress: true }))).toEqual(["joined"]);
    expect(flagReasons(match({ winnerSource: "decided" }))).toEqual(["winner_decided"]);
    expect(flagReasons(match({ mvpSource: "inferred" }))).toEqual(["mvp_inferred"]);
    expect(flagReasons(match({ checkFailed: true }))).toEqual(["check_failed"]);
  });

  test("several reasons come out in a fixed order", () => {
    expect(flagReasons(match({ checkFailed: true, mvpSource: "inferred", winnerSource: "decided", endKind: "left", joinedInProgress: true }))).toEqual([
      "left",
      "joined",
      "winner_decided",
      "mvp_inferred",
      "check_failed",
    ]);
  });
});
