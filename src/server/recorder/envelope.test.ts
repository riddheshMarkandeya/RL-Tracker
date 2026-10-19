import { describe, expect, test } from "vitest";
import { parseFrame } from "./envelope";

describe("parseFrame", () => {
  test("parses the double-encoded Data of a real frame", () => {
    const raw = '{"Event":"MatchEnded","Data":"{\\"MatchGuid\\":\\"AB08\\",\\"WinnerTeamNum\\":1}"}';
    expect(parseFrame(raw)).toEqual({ ok: true, ev: { name: "MatchEnded", guid: "AB08", data: { MatchGuid: "AB08", WinnerTeamNum: 1 } } });
  });

  test("accepts Data as an object too", () => {
    expect(parseFrame('{"Event":"RoundStarted","Data":{"MatchGuid":"X"}}')).toEqual({
      ok: true,
      ev: { name: "RoundStarted", guid: "X", data: { MatchGuid: "X" } },
    });
  });

  test("a missing or non-string MatchGuid reads as empty", () => {
    expect(parseFrame('{"Event":"PodiumStart","Data":"{}"}')).toMatchObject({ ok: true, ev: { guid: "" } });
    expect(parseFrame('{"Event":"PodiumStart","Data":"{\\"MatchGuid\\":5}"}')).toMatchObject({ ok: true, ev: { guid: "" } });
  });

  test.each([
    ["not json", "not_json"],
    ["[1]", "no_event"],
    ['{"Data":"{}"}', "no_event"],
    ['{"Event":"X"}', "bad_data"],
    ['{"Event":"X","Data":"nope"}', "bad_data"],
    ['{"Event":"X","Data":"[1]"}', "bad_data"],
  ])("rejects %s as %s", (raw, reason) => {
    expect(parseFrame(raw)).toEqual({ ok: false, reason });
  });
});
