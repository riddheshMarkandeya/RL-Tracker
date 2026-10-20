import { describe, expect, test } from "vitest";
import { playlistInfo } from "./playlists";

describe("playlistInfo", () => {
  test("known ids", () => {
    expect(playlistInfo(13)).toEqual({ name: "Ranked Standard", group: "ranked", ranked: true });
    expect(playlistInfo(2)).toEqual({ name: "Doubles", group: "casual", ranked: false });
    expect(playlistInfo(6)).toEqual({ name: "Private Match", group: "private", ranked: false });
    expect(playlistInfo(27)).toEqual({ name: "Ranked Hoops", group: "ranked", ranked: true });
    expect(playlistInfo(38)).toMatchObject({ group: "ltm", ranked: false });
  });

  test("4 is Casual Quads, not Chaos: the id was reused (seen live)", () => {
    expect(playlistInfo(4)).toEqual({ name: "Casual Quads", group: "casual", ranked: false });
  });

  test("an unknown id, or none, names itself and has no group or ranked flag", () => {
    expect(playlistInfo(999)).toEqual({ name: "Unknown playlist (999)", group: null, ranked: null });
    expect(playlistInfo(null)).toEqual({ name: "Unknown playlist", group: null, ranked: null });
  });

  test("menu states are not playlists", () => {
    expect(playlistInfo(0).group).toBeNull();
    expect(playlistInfo(-2).group).toBeNull();
  });
});
