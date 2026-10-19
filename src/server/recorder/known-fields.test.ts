import { describe, expect, test } from "vitest";
import { unknownFields } from "./known-fields";

describe("unknownFields", () => {
  test("a known event with known keys has none", () => {
    expect(unknownFields("GoalScored", { MatchGuid: "G", GoalSpeed: 1, Scorer: { Name: "" } })).toEqual([]);
    expect(unknownFields("UpdateState", { MatchGuid: "G", Game: { Arena: "cs_p", Teams: [] }, Players: [{ Name: "A", Boost: 33 }] })).toEqual([]);
  });

  test("an unknown event is null", () => {
    expect(unknownFields("BallExploded", { MatchGuid: "G" })).toBeNull();
  });

  test("names unknown top-level, Game and player keys by path", () => {
    expect(unknownFields("UpdateState", { MatchGuid: "G", Extra: 1, Game: { Arena: "x", Weather: "rain" }, Players: [{ Name: "A" }, { Name: "B", Hat: 1, Mood: 2 }] })).toEqual([
      "Extra",
      "Game.Weather",
      "Players[].Hat",
      "Players[].Mood",
    ]);
  });

  test("reports each player key once per event", () => {
    expect(unknownFields("UpdateState", { Players: [{ Hat: 1 }, { Hat: 2 }] })).toEqual(["Players[].Hat"]);
  });
});
