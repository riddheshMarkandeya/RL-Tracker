import { describe, expect, test } from "vitest";
import { createAnonymiser, leaks } from "./make-fixture";

const state = {
  MatchGuid: "AB08",
  Players: [
    { Name: "Real Name", PrimaryId: "Epic|abc123|0", Shortcut: 1, Loadout: ["Body_Octane"], Attacker: { Name: "Other \"Q\"" } },
    { Name: "Other \"Q\"", PrimaryId: "XboxOne|999|0", Shortcut: 2 },
    { Name: "Sticks", PrimaryId: "Unknown|0|0", Shortcut: 3 },
  ],
  Game: {
    Teams: [{ Name: "Blue", TeamNum: 0 }, { Name: "Club Of Mine", TeamNum: 1 }],
    Winner: "Club Of Mine",
    Target: { Name: "Real Name", Shortcut: 1 },
    Arena: "cs_p",
  },
};

describe("createAnonymiser", () => {
  test("replaces player names, ids and club names everywhere, keeping bots, Blue/Orange and other fields", () => {
    const a = createAnonymiser();
    a.learn(state);
    expect(a.anonymise(state)).toEqual({
      MatchGuid: "AB08",
      Players: [
        { Name: "Player 1", PrimaryId: "Epic|anon1|0", Shortcut: 1, Loadout: ["Body_Octane"], Attacker: { Name: "Player 2" } },
        { Name: "Player 2", PrimaryId: "XboxOne|anon2|0", Shortcut: 2 },
        { Name: "Sticks", PrimaryId: "Unknown|0|0", Shortcut: 3 },
      ],
      Game: {
        Teams: [{ Name: "Blue", TeamNum: 0 }, { Name: "Club 1", TeamNum: 1 }],
        Winner: "Club 1",
        Target: { Name: "Player 1", Shortcut: 1 },
        Arena: "cs_p",
      },
    });
  });

  test("maps the same real value to the same fake across events", () => {
    const a = createAnonymiser();
    a.learn(state);
    a.anonymise(state);
    expect(a.anonymise({ PlayerName: "Other \"Q\"", PrimaryId: "XboxOne|999|0" })).toEqual({ PlayerName: "Player 2", PrimaryId: "XboxOne|anon2|0" });
    expect(a.anonymise({ MainTarget: { Name: "Real Name" }, SecondaryTarget: { Name: "Sticks" } })).toEqual({
      MainTarget: { Name: "Player 1" },
      SecondaryTarget: { Name: "Sticks" },
    });
  });

  test("empty names and ids stay empty (a replay GoalScored's blank Scorer marks it as the duplicate)", () => {
    const a = createAnonymiser();
    expect(a.anonymise({ Scorer: { Name: "", PrimaryId: "" }, Teams: [{ Name: "" }] })).toEqual({ Scorer: { Name: "", PrimaryId: "" }, Teams: [{ Name: "" }] });
    expect(a.realValues()).toEqual([]);
  });

  test("a name first seen outside UpdateState still gets a fake", () => {
    const a = createAnonymiser();
    expect(a.anonymise({ Scorer: { Name: "Newcomer" } })).toEqual({ Scorer: { Name: "Player 1" } });
  });
});

describe("leaks", () => {
  test("finds a real value left anywhere in the decoded data, and nothing in clean data", () => {
    const a = createAnonymiser();
    a.learn(state);
    expect(leaks(a.anonymise(state), a.realValues())).toEqual([]);
    expect(leaks({ Note: "said Real Name here" }, a.realValues())).toEqual(["Real Name"]);
  });
});
