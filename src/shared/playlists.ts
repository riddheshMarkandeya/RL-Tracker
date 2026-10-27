// Playlist ids as the Stats API reports them (Game.PlaylistId), from community lists checked
// against live play. Records store the raw id, so a correction here reaches past matches.

export type PlaylistGroup = "ranked" | "casual" | "extra" | "ltm" | "private" | "tournament" | "offline";

export interface Playlist {
  name: string;
  group: PlaylistGroup;
  ranked: boolean;
}

const p = (name: string, group: PlaylistGroup, ranked = false): Playlist => ({ name, group, ranked });

export const PLAYLISTS: Readonly<Record<number, Playlist>> = {
  1: p("Duel", "casual"),
  2: p("Doubles", "casual"),
  3: p("Standard", "casual"),
  // Was Chaos; the game reuses the id for Casual Quads.
  4: p("Casual Quads", "casual"),
  6: p("Private Match", "private"),
  7: p("Season", "offline"),
  8: p("Exhibition", "offline"),
  9: p("Training", "offline"),
  10: p("Ranked Duel", "ranked", true),
  11: p("Ranked Doubles", "ranked", true),
  12: p("Ranked Solo Standard", "ranked", true),
  13: p("Ranked Standard", "ranked", true),
  15: p("Snow Day", "extra"),
  16: p("Rocket Labs", "extra"),
  17: p("Hoops", "extra"),
  18: p("Rumble", "extra"),
  19: p("Workshop", "offline"),
  20: p("Custom Training Editor", "offline"),
  21: p("Custom Training", "offline"),
  22: p("Custom Tournament", "tournament"),
  23: p("Dropshot", "extra"),
  24: p("LAN Match", "offline"),
  25: p("Anniversary", "ltm"),
  26: p("External Match", "private"),
  27: p("Ranked Hoops", "ranked", true),
  28: p("Ranked Rumble", "ranked", true),
  29: p("Ranked Dropshot", "ranked", true),
  30: p("Ranked Snow Day", "ranked", true),
  31: p("Ghost Hunt", "ltm"),
  32: p("Beach Ball", "ltm"),
  33: p("Spike Rush", "ltm"),
  // Ranked, but with its own tournament rank rather than a playlist MMR.
  34: p("Official Tournament", "tournament", true),
  35: p("Rocket Labs", "ltm"),
  37: p("Dropshot Rumble", "ltm"),
  38: p("Heatseeker", "ltm"),
  41: p("Boomer Ball", "ltm"),
  43: p("Heatseeker Doubles", "ltm"),
  44: p("Winter Breakaway", "ltm"),
  46: p("Gridiron", "ltm"),
  47: p("Super Cube", "ltm"),
  48: p("Tactical Rumble", "ltm"),
  49: p("Spring Loaded", "ltm"),
  50: p("Speed Demon", "ltm"),
  52: p("Gotham City Rumble", "ltm"),
  // Seen live as a 1v1 against a friend (not private, which is 6); the name is the user's.
  53: p("Honor Duel", "extra"),
  54: p("Knockout", "ltm"),
  62: p("Nike FC Showdown", "ltm"),
  64: p("Haunted Heatseeker (2v2)", "ltm"),
  65: p("Haunted Heatseeker (3v3)", "ltm"),
  66: p("Heatseeker Ricochet", "ltm"),
  67: p("Spooky Cube", "ltm"),
  68: p("G-Force Frenzy", "ltm"),
  70: p("Dropshot Rumble (2v2)", "ltm"),
};

export type PlaylistInfo = Playlist | { name: string; group: null; ranked: null };

/** The playlist for an id; an unmapped one is named by its id, with no group or ranked flag. */
export function playlistInfo(id: number | null): PlaylistInfo {
  const known = id === null ? undefined : PLAYLISTS[id];
  return known ?? { name: id === null ? "Unknown playlist" : `Unknown playlist (${String(id)})`, group: null, ranked: null };
}
