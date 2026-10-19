# Weekend captures (Oct 17–18): Stats API behaviour

Date: 2026-10-19. Input to WP3a (Recorder).
This note extends `docs/research/2026-10-15-live-capture-findings.md`. Items marked *(confirms)* were already found there.

Sources:
- `captures/capture-2026-10-17T21-44-35-957Z.ndjson`
- `captures/capture-2026-10-18T21-43-38-384Z.ndjson`
- `captures/capture.log`

The analysis scripts were throwaway and lived in the session scratchpad.

**What was played:**
- Casual 2v2 (playlist 2).
- Ranked 3v3 (playlist 13) and casual 3v3 (playlist 3).
- Private 2v2s (playlist 6), plus one spectated private 1v1.
- Freeplay and custom training. Custom training is mostly drills: shots, saves, aerials.

## Findings

### Duplicates and ordering
1. *(confirms)* **Every goal sends `GoalScored` twice.**
   - The first is the real goal: scorer, speed, assister.
   - The second arrives when the replay ends or is skipped. It has an empty scorer, speed 0, `GoalTime` 0 and `bReplay=true`.
   - Counting raw events doubles the goals.
2. **After a private game, the old match's teardown is tagged with the next match's guid.**
   - `MatchDestroyed` and the `PlayerLeft`s carry the new guid.
   - For about 5 s, `UpdateState` under the new guid still shows the old game: old arena, final score, `Winner`, `bReplay`.
   - This caused the duplicate `match_end` lines in `capture.log` (D900F932, D7B2C270).
   - Not only after private games: the recorder's import of all 4 captures found 5 retagged teardowns. 4 were private (Oct 18), and one was casual on Oct 16 (F26679C2's teardown under F1EBF2AA, playlist 2).
3. **The new guid appears before `MatchCreated`**, in one `UpdateState` or a `PlayerJoined`.
4. **A player first shows up with `TeamNum` 255** (not on a team yet), and with a `Shortcut` that changes later.
5. **Recording can start mid-match**: the Oct 18 capture has no `MatchCreated` for its first match.
6. **A lobby can be created and torn down with no game.** Private D900F932 lasted 10 s. It isn't a match.

### Outcome
7. **The winner can't be derived from the score.**
   - 0116A7EE ended with `WinnerTeamNum` 0 while the score was 2–3: the other side forfeited or left.
   - `Game.Winner` is empty at `MatchEnded` and only filled in at `PodiumStart`.
   - `WinnerTeamNum` on `MatchEnded` is the source.
8. **Forfeits and early ends are common.**
   - 9 of the 42 matches ended with time left and no overtime (from 171 s down to 19 s left).
   - The clock gives no time left at `MatchEnded` itself: every match, overtime included, gets a `TimeSeconds: 0` reading just before `MatchEnded`. Time left shows in the reading before that one. A full match counts down 3, 2, 1, 0; a forfeit jumps to 0 from where it stopped (0116A7EE: 68, then 0).
   - In overtime the clock counts up, so a high reading there is not time left (39BF9A28 reached 132 in overtime and completed normally).
   - B6AC8902 ended 3–0 after all three opponents left.
9. **Overtime:** `bOvertime` is set and the clock counts *up* from 0, so `TimeSeconds` at the end is the overtime's length (up to 180 s seen).
10. **MVP:** at most one `StatfeedEvent` `MVP` per match, naming the player in `MainTarget`.
    - 41 MVPs across 42 `MatchEnded` (corrected 2026-10-19 in WP3a plan review).
    - F6FE4498 (Oct 17) sent `MatchEnded` but no `PodiumStart` and no MVP.
    - Every match with a `PodiumStart` had exactly one.
11. **Your team number differs between matches** (0 or 1; private games reshuffle each game). Decide win or loss from your `TeamNum` in that match.
12. **Team names are club names.**
    - Your side shows as "Naked Panda Mediation".
    - Opponents show as their club, or as "Blue"/"Orange".
    - Once the opponent's name was a raw ID (`9379E2D6673BFFF3`).
    - Never key on the name.

### Roster
13. **The final `Players` list isn't the roster.**
    - Leavers drop out of it, and backfill players appear mid-match.
    - 15676E50 ended in overtime with only 2 of 6 listed.
    - Build the roster across the match and keep each leaver's last stats.
14. **Bots** have the PrimaryId `Unknown|0|0` (20 seen: Outlaw, Hound, Sticks, Rainmaker, …). No name list is needed.

### Other modes
15. *(confirms the `BoostPickup` part)* **Spectating:**
    - You aren't in `Players`; you appear only in `PlayerJoined`/`PlayerLeft` and as the camera `Target`.
    - It's the only match with `BoostPickup` events (211 in the 1v1), so the game seems to send those only while you spectate.
16. **Freeplay and training (playlists 9 and 21):**
    - The guid is empty, the clock counts up, and pauses happen there.
    - Your goals arrive as `GoalScored`. Ignore guid `''`.

## Requirements for WP3a (user, 2026-10-19)
- **Built-in de-duplication.** Detecting and dropping duplicate events (replay `GoalScored`, mis-tagged teardown, repeated `match_end`) is part of the recorder's core design, not a patch per stat.
- **One source of truth each** for winner and MVP, chosen by the rules above and robust to forfeits and leavers.
- **A minimum sanity check on every stat a match record includes.** Examples: goals equal the score, at most one MVP, a winner exists exactly when `MatchEnded` arrives, a non-negative clock. A check that fails is logged and flags the record rather than silently storing it.
- **Simple, declarative structure, not a chain of if/else.** For example:
  - a small match state machine (pending → live → ended → closed);
  - per-event handlers;
  - stat rules and checks as data (a table of rule objects).
- **Bots are flagged** by PrimaryId.

## Captures still wanted
Each one confirms a mode's event stream before WP3a relies on it:
- Ranked 1v1 and 2v2. This weekend had only casual 2v2 and ranked or casual 3v3.
- Tournaments (bracket rounds: one guid per round? what happens between rounds?).
- Honor duels (new this season).
- Limited-time casual modes (Heatseeker, Rumble, Dropshot, Hoops, Snow Day, …). Different balls and rules may break the goal and score assumptions.
- Extra modes (Rumble, Hoops, Dropshot, Snow Day) if not covered as LTMs.
- Watching a saved replay. It must not count as a match; its stream is unknown.
- Spectating from an online match (not private), and ball-cam/director changes while spectating.
- Leaving a match early yourself (abandon, and the penalty) and voting to forfeit, from your side.
- A disconnect or crash mid-match, then rejoining via Reconnect.
- A party-leader queue cancel, and a match that never starts (lobby time-out).
- A private match with bots, and the "Play with bots" offline mode (are bots `Unknown|0|0` there too?).
- Workshop or custom maps, if you use them (does the arena name come through?).
- Free play with a game paused for a long time, and alt-tabbing (gaps in `UpdateState`).
