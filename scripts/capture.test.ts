import { describe, expect, test } from "vitest";
import { eventNameOf, matchGuidOf } from "./capture";

describe("eventNameOf", () => {
  test("returns the Event of a real envelope line", () => {
    const frame = '{"Event":"MatchEnded","Data":"{\\"WinnerTeamNum\\":1}"}';
    expect(eventNameOf(frame)).toBe("MatchEnded");
  });

  test("returns null for junk", () => {
    expect(eventNameOf("not json")).toBeNull();
    expect(eventNameOf("[1,2]")).toBeNull();
    expect(eventNameOf('{"Data":{}}')).toBeNull();
  });
});

describe("matchGuidOf", () => {
  test("reads MatchGuid from the nested Data string", () => {
    expect(matchGuidOf('{"Event":"MatchDestroyed","Data":"{\\"MatchGuid\\":\\"89C6\\"}"}')).toBe("89C6");
  });

  test("returns null when Data is missing or not JSON", () => {
    expect(matchGuidOf('{"Event":"MatchDestroyed"}')).toBeNull();
    expect(matchGuidOf("not json")).toBeNull();
  });
});
