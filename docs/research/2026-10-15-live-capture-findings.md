# Live capture of the Stats API: findings

Ticket: "Live capture of a real match" (`docs/plans/2026-10-15-rl-tracker-features-map.md`).

Source: one capture run on 2026-10-15, about 42 minutes, over WebSocket (`ws://127.0.0.1:49124`)
at `PacketSendRate=30`. It holds 6 online matches and 2 offline sessions. The raw NDJSON (188 MB)
is in `captures/`, which is gitignored because it holds other players' names and IDs. The
throwaway capture and analysis scripts were not kept.

| # | Playlist | What the user did | `MatchEnded` | Result shown in the stream |
|---|---|---|---|---|
| 1 | 2 (casual 2v2) | Joined in progress; your team won 4–3 on an overtime goal; left during the replay (inferred) | no | none |
| — | 9 (Training) | Offline, no `MatchGuid` | — | — |
| 3 | 10 (Ranked Duel) | Forfeited at 0–4 with 146 s left | no | none |
| 4 | 11 (Ranked Doubles) | Played to the end, lost 2–5 | yes, `w=1` | `bHasWinner`, `Winner=Orange` |
| 5 | 11 (Ranked Doubles) | Played to the end, won 3–0 | yes, `w=0` | `bHasWinner`, `Winner=Blue` |
| 6 | 4 (casual Quads) | Left during the 3-2-1 countdown | no | none |
| — | 21 (Custom Training) | Offline, no `MatchGuid` | — | — |
| 8 | 4 (casual Quads) | Abandoned at 0–1 with 224 s left | no | none |

## Answers

**Wire format**
- Every WebSocket frame held exactly one `{Event, Data}` envelope, and none were concatenated.
- `Data` was always a JSON-encoded string, so it must be parsed twice on WebSocket too.
- The game listens on `0.0.0.0:49124`, not localhost only, so anything on the LAN can read the
  stream. The tracker should connect to `127.0.0.1`. Firewall exposure needs a note in the spec.
- Nothing is sent in menus. Offline modes (Training, Custom Training) do send events, but with
  `MatchGuid: ""`. Ignore anything without a GUID.

**Rate and volume**
- `UpdateState` arrived at 30.0/s at `PacketSendRate=30`. The gap between packets was 34 ms
  (p50), 35 ms (p95) and 58 ms at most.
- An `UpdateState` is about 4 KB in 2v2 and grows with player count, mostly because of
  `Loadout[]` arrays.
- The raw stream comes to about **300–450 MB per hour of play**. This conflicts with the decision
  to keep the raw event stream forever (see "Decisions to revisit").

**Boost, speed and `BoostPickup`** (the research said these were SPECTATOR-only, which is partly
wrong)
- Car state (`Boost`, `Speed`, `bHasCar`, `bOnGround`, `bSupersonic`, `bBoosting`) **is sent for
  you and your own team, bots included**. It was present 96–100% of the time in every playlist.
- It is **never sent for opponents**, human or bot: 0% in every playlist.
- Fields are left out when their value is falsy. `Boost` is missing when it is 0, and
  `bBoosting` only appears when it is true. Treat a missing `Boost` as 0 while `bHasCar` is true.
- `bDemolished` never appeared. Demos came only from `StatfeedEvent Demolish`.
- `BoostPickup` **never fired**, so it is spectator-only.
- This makes your own boost stats possible: average boost, time at 0 and at 100, and time
  supersonic, all sampled from `UpdateState`. Boost collected per pad is not possible.

**Statfeed `EventName` values seen** (EventName / localized `Type`)
- Shot / Shot on Goal ×33
- Goal ×19
- Save ×10
- Demolish / Demolition ×8
- Assist ×6
- Win ×4
- BicycleHit / Bicycle Hit ×3
- HatTrick / Hat Trick ×2
- MVP ×2
- Savior ×1
- OvertimeGoal / Overtime Goal ×1
- LongGoal / Long Goal ×1

Still not seen: EpicSave, AerialGoal, Clear, Center, PoolShot and others. Store `EventName` raw
and display unknown names as they arrive. `Win` and `MVP` fire at `MatchEnded`, and only when it
fires.

**Identifying you through `Game.Target`**
- Across all matches (1v1, 2v2 and 4v4), the target outside replays was **never anyone but you**.
- There was no target before your car spawned and during goal replays (`bHasTarget` false).
- The user's ID is `Rocinante_.` = `Epic|7d1894456e94432a929fb2982478eb1d|0`.

**`MatchGuid`, `PlaylistId`, team names and player IDs**
- Observed playlist IDs: 2 = casual Doubles, 10 = Ranked Duel and 11 = Ranked Doubles, all
  matching rlapi. **Casual Quads = 4**, which reuses Chaos's old ID. Arenas for it are named
  `Labs_4v4_Arena15_*`. 9 = Training and 21 = Custom Training, both offline.
- Ranked Quads was not observed, since the user doesn't play it.
- The first few states of an online match carry `PlaylistId: 0` (Main Menu) before the real
  ID. Take the playlist from the last non-zero value.
- `MatchGuid` is 32 hex characters and stays the same all match. Events from your own join and
  the `PlayerLeft` burst after `MatchDestroyed` carry an empty GUID.
- **`Teams[].Name` can be a club name**, e.g. `DEEZ NUTS` or `THE N1CKERS`, not just
  Blue/Orange. `Game.Winner` is that name. Key everything on `TeamNum` and
  `MatchEnded.WinnerTeamNum`, never on names.
- `PrimaryId` takes forms like `Epic|<hex>|0` and `XboxOne|<num>|0`. Bots are `Unknown|0|0`
  with names that get reused, so they can't be told apart. Exclude them from teammate and
  opponent features.

**Party information**
- No event and no field marks a party. This was checked against every key in the capture and
  against the official field list.
- Possible ways to infer it:
  - The same teammate `PrimaryId` across back-to-back matches.
  - Join timing, which is untested.
  - A manual "duo partner" list.

**Match lifecycle and how matches end**
- **Played to the end** (2 matches), in this order:
  1. The last goal and its replay
  2. `MatchEnded{WinnerTeamNum}`
  3. `PodiumStart` about 3 s later
  4. `bHasWinner` true and `Winner` set in `UpdateState`
  5. Players leave during the podium
  6. `MatchDestroyed`
- Players leave during the podium, so the last `UpdateState` can be missing players (match 4 ended
  with 1 of 4). **Snapshot the scoreboard at `MatchEnded`**, or take the last state that had all
  players, never simply the last state.
- **You leave, forfeit or abandon** (4 cases): `MatchDestroyed` arrives with **no `MatchEnded`, no
  `PodiumStart` and no `Win`/`MVP` statfeed**. When this happens during a goal replay, the replay's
  duplicate `GoalScored` is cut off.
  - **The user's own forfeit can't be told apart from leaving.** Both count as a loss under Q13,
    so the result is the same. Only the flag's label can't be "forfeit".
  - An opponent forfeiting was not observed.
- **Match 1 is the edge case.** The overtime goal had already decided it (4–3 to your team), but
  you left before `MatchEnded`. Counting it as a leave makes it a loss, which is wrong. Rule: if
  `MatchEnded` is missing, the last live state is in overtime (or at 0 s), and the scores differ,
  the match was decided, so the winner comes from the score. Otherwise it's a leave, so a loss.
- **Joining in progress**: `MatchInitialized` doesn't fire (match 1). In every match that started
  normally, `MatchInitialized` came 0–11 s after `MatchCreated`.
- **Leaving during the countdown** (match 6): `MatchInitialized` and `CountdownBegin` fired, then
  `MatchDestroyed`, with no `RoundStarted` and the clock at 300. Under Q13 this counts as a loss.
  A "didn't play a second" flag might be wanted. Note that ranked counts it as an abandon too.
- **Player churn**: a player who leaves is replaced by a bot (`PlayerLeft` p, then
  `PlayerJoined` bot), and a human can later replace the bot (match 8).
- Disconnects were not tested. Expect them to look like a leave.

**Other wire surprises**
- `GoalScored` fires **twice per goal**: once live, and again at `GoalReplayEnd` with
  `GoalSpeed: 0` and `GoalTime: 0`. Count goals from the live one, or from `StatfeedEvent Goal`.
  `GoalReplayWillEnd` also fires when the replay isn't skipped.
- The `ImpactLocation` of the live `GoalScored` looked stale in match 1 (`0,0,0`, then the
  previous goal's location). Don't use it for a goal heatmap without more checking.
- `BallHit` speeds and `GoalSpeed` look like **km/h**, not uu/s as the doc says. A kickoff touch
  read 93.7.
- `CrossbarHit` also fires during goal replays and on the podium. Count it only when not in a
  replay and before `MatchEnded`.

## Second capture (2026-10-16)

Source: about 100 minutes, 15 casual 2v2 matches (playlist 2) with one friend at
`PacketSendRate=30`. The file is 733 MB, about 440 MB per hour, and is in `captures/`.

**Attribution: only `UpdateState` carries `PrimaryId`**
- `BallHit.Players[]`, `StatfeedEvent.MainTarget` and `CrossbarHit.BallLastTouch.Player` have
  only `Name`, `Shortcut` and `TeamNum`.
- To attribute these events to a player, map `Shortcut` to `PrimaryId` through the current match's
  `UpdateState.Players[]`. Matching on `PrimaryId` directly finds nothing.
- In `BallHit`, `Players[0]` is taken as the hitter. With that rule, the hardest-shot values
  (110–170 km/h) look plausible.

**`CrossbarHit` repeats**
- Each hit arrives as consecutive identical events (same `BallLocation`, `BallSpeed` and
  `ImpactForce`), so de-duplicate them.
- After de-duplication, one match still had 63 hits, most likely the ball rolling along the bar. Count
  at most one hit per time window (for example 1 s), on top of the existing replay and podium rule.

**Early ends with `MatchEnded`**
- 5 of 15 matches sent a normal `MatchEnded{WinnerTeamNum}` with time left on the clock (19–164 s).
  Two were wins (3–0 at 139 s, 4–1 at 39 s) and three were losses.
- These look like forfeits that end the match for everyone. Which team forfeited wasn't confirmed
  with the user.
- So unlike your own leave, an early end like this keeps its winner, and the normal result rule
  applies. A "forfeit" flag could be derived from `MatchEnded` arriving with
  `TimeSeconds > 0` and no overtime.

**Other**
- New Statfeed names: `AerialGoal`, `EpicSave` and `Savior` (localized types not recorded).
- A bot (`Unknown|0|0`) joined your team for part of one match while the friend was out, then the
  friend returned. Friend features must ignore the bot and keep the friend's match.
- No leaves, joins in progress or inferred results this time: every match sent `MatchEnded`.

**Where goals came from** (checked for the Recap layout goal map, 63 live goals by all players)
- `BallHit` carries `Ball.Location`. The last `BallHit` before a live `GoalScored` matched
  `GoalScored.BallLastTouch.Player` for 62 of 63 goals.
- That very last touch was by the **defending** team for 9 of 63 goals (14%): failed saves,
  deflections, one right after kickoff. In all 9, the scoring team had touched the ball earlier in
  the same kickoff (0–6.2 s before). So take a goal's origin as the scoring team's last touch since
  `RoundStarted`, and mark it "deflected" when the other team touched it after. No pure own goal
  (no scoring-team touch at all) occurred.
- `GoalScored.ImpactLocation` again lagged one goal behind, so it can't place the goal itself.
- Aerial goals: the 4 `AerialGoal` statfeeds were exactly the goals whose scoring touch was high,
  with ball `Z` 588–815. Every other goal's touch was at `Z` ≤ 430. Use the statfeed to mark aerial
  goals; ball `Z` at your own touches can count aerial touches (threshold to pick, about 500).

## Still unanswered
- The Ranked Quads ID. The unknown-ID path covers it: it will be logged when first seen.
- Which team forfeited in the early ends above, and what a disconnect looks like.
- The rest of the Statfeed names (they accumulate naturally).

## Decisions to revisit
- **Keeping the raw event stream forever** (Confirmed assumptions in the map) clashes with
  300–450 MB per hour at 30/s. Options:
  - Keep every non-`UpdateState` event raw, plus a downsampled `UpdateState` (e.g. 2/s,
    without `Loadout`, which is constant per match: store it once).
  - Lower `PacketSendRate`.
  - Compress.
- **"Car state is SPECTATOR-only"** no longer holds for your own team. That opens own-boost stats
  for the Recap layout ticket.
- **Q13 "a forfeit counts normally"**: the user's own forfeit is indistinguishable from leaving.
  Both are losses, so only the flag's wording is affected.
