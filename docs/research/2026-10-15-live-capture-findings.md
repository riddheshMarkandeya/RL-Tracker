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

## Still unanswered
- The Ranked Quads ID. The unknown-ID path covers it: it will be logged when first seen.
- What an opponent's forfeit looks like, and what a disconnect looks like.
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
