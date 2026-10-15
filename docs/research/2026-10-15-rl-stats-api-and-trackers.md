# Rocket League Stats API, MMR sources, prior-art trackers, seasons

Researched 2026-10-15. Feeds: which features to build in a personal RL stats tracker (local Windows session tracker first, maybe web/mobile later). Every claim has a source tag `[Sn]`, listed under Sources. Inferences are kept in their own section.

## Summary

- **The official Stats API is a local, unauthenticated socket.** You turn it on in `<Install Dir>\TAGame\Config\TAStatsAPI.ini`, which falls back to `DefaultStatsAPI.ini`. It serves TCP on port 49123 and WebSocket on port 49124, and sends JSON envelopes `{Event, Data}`. `PacketSendRate` is 0 by default, which disables it, and it is capped at 120/s [S1]. It shipped on 2026-04-28 together with Easy Anti-Cheat (EAC) [S3]. WebSocket support and commands came in v2.72 (2026-08-04) [S2].
- **What it covers:** 22 events and 6 commands. The periodic `UpdateState` tick gives the per-player match scoreboard for every player in the match: name, PrimaryId (platform|uid), team, Score, Goals, Shots, Assists, Saves, Touches, CarTouches, Demos. It also gives the game state: team scores, `PlaylistId`, clock, overtime, winner, arena [S1].
- **No MMR, rank, division, season or skill data appears anywhere in the documented API** [S1]. Several independent client projects also say so explicitly [S10].
- **The API does not mark which player is "you".** There is no "local player" field. Community trackers infer your team from the camera target (`Game.Target` / `bHasTarget`) [S1][S9]. Car-state fields (Boost, Speed, bOnGround, bSupersonic…) and `BoostPickup` are marked SPECTATOR-only [S1].
- **MMR sources have mostly closed.** EAC (2026-04-28) blocks BakkesMod in online play [S3], and the BakkesMod injector now refuses to inject into EAC builds [S6]. So the BakkesMod `MMRWrapper` [S5] no longer works for ranked tracking. RL v2.66 (2026-03-10) added an opt-in in-game MMR display on playlist tiles and the end-of-ranked-match scoreboard, but that is UI only and not machine-readable [S4]. I could not verify that a public tracker.gg RL API exists (Cloudflare-blocked).
- **Prior art agrees on what a "session" means:** per-playlist W/L, current streak, and MMR change for the session (BakkesMod RocketStats, SessionPlugin [S7][S8]; Stats-API-based OBS session counter [S9]). Deeper trackers add per-game averages: goals, shots, saves, shooting %, plus statfeed counts (epic saves, aerial goals, …) [S7]. ballchasing adds replay-derived boost, movement, positioning and demo categories [S11].
- **Seasons run about 13 weeks.** S22 started 2026-03-11 UTC [S4], S23 on 2026-06-09/10 [S12], S24 on 2026-09-23 9 AM PT [S13]. S24's season-long LTE runs to Dec 9 [S13]. No official programmatic season calendar was found.

## Stats API

### Mechanics (all from [S1] unless tagged)

| Item | Detail |
|---|---|
| Enable | Edit `<Install Dir>\TAGame\Config\TAStatsAPI.ini` (or `DefaultStatsAPI.ini` if the former doesn't exist), section `[TAGame.MatchStatsExporter_TA]`, **before launching**. ini changes need a client restart. |
| `PacketSendRate` | float, default 0 (= disabled). Number of `UpdateState` packets per second, capped at 120. |
| `Port` | int, default **49123**: local **TCP** listener. 0 disables it. Must differ from WebPort. |
| `WebPort` | int, default **49124**: local **WebSocket** listener. 0 disables it. Must differ from Port. WebSocket was added in v2.72, 2026-08-04 [S2]. |
| Envelope | `{"Event": "<Name>", "Data": {…}}`. Commands: `{"Command": "<Name>", "Data": {…}}`. |
| Timing | `UpdateState` arrives at PacketSendRate. Other events arrive "on the same tick that the event occurs, regardless of PacketSendRate". |
| Auth / registration | None documented. The page describes a local socket on the player's machine and gives no keys or sign-up [S1]. |
| Introduced | Shipped with the EAC update on 2026-04-28, framed as the replacement for overlay plugins like SimpleAOB [S3]. |
| Field markers | CONDITIONAL = only present when relevant. **SPECTATOR = only sent while spectating.** TEAM = only sent when you're on the same team as the player described. REPLAY = only relevant during replays. |
| `MatchGuid` | "Only set for online or LAN matches" (stated on every event). |

Community-reported wire details (secondary, from client code, not in the official doc):
- On TCP the `Data` field may arrive as a **JSON-encoded string**, so it has to be parsed twice. Frames are concatenated JSON objects with no delimiter [S10][S14].
- The game re-streams `UpdateState` during goal replays with `bReplay=true`. Exclude those ticks from derived stats [S10].
- If the client stops draining the socket, the RL game thread can block on `send()`, so use a dedicated reader thread [S10].
- `PrimaryId` is not unique for bots, which share a placeholder [S14].
- Playlist IDs are not documented officially. A community map: 1–4 Casual 1v1–4v4, 6 Private, 10 Ranked 1v1, 11 Ranked 2v2, 13 Ranked 3v3, 61 Ranked 4v4, 27 Ranked Hoops, 28 Ranked Rumble, 29 Ranked Dropshot, 30 Ranked Snow Day, 34 Tournament, 63 Heatseeker [S9].

Patch fixes since launch: v2.76 (2026-09-22) fixed `GoalScored` not firing in replays. It also changed **no-contest matches to report -1 as the winning team** [S15].

### Events and fields (complete list per [S1])

| Event | When | Data fields |
|---|---|---|
| `UpdateState` | Every 1/PacketSendRate s | `MatchGuid`; **`Players[]`**: `Name`, `PrimaryId` (`Platform\|Uid\|Splitscreen`, e.g. `Steam\|123\|0`, `Epic\|456\|0`), `Shortcut`, `TeamNum` (0 Blue/1 Orange), `Score`, `Goals`, `Shots`, `Assists`, `Saves`, `Touches`, `CarTouches`, `Demos`, `Loadout[]` (asset names by slot), SPECTATOR: `bHasCar`, `Speed` (uu/s), `Boost` (0–100), `bBoosting`, `bOnGround`, `bOnWall`, `bPowersliding`, `bDemolished`, `bSupersonic`, `PickupClass` (Rumble); CONDITIONAL `Attacker{Name,Shortcut,TeamNum}` when demolished. **`Game`**: `Teams[]{Name,TeamNum,Score,ColorPrimary,ColorSecondary}`, `PlaylistId`, `TimeSeconds` (remaining), `bOvertime`, `Ball{Speed, TeamNum (last touch team; 255 = untouched)}`, `bReplay`, `bHasWinner`, `Winner` (team name), `Arena` (e.g. `Stadium_P`), `bHasTarget`, CONDITIONAL `Target{Name,Shortcut,TeamNum}` (player being viewed), CONDITIONAL `Frame`, `Elapsed` (replay only) |
| `BallHit` | 1 frame after a hit | `MatchGuid`, `Players[]{Name,Shortcut,TeamNum}`, `Ball{PreHitSpeed, PostHitSpeed, Location{X,Y,Z}}` |
| `BoostPickup` (SPECTATOR) | Pad/pill collected | `MatchGuid`, `Player{Name,Shortcut,TeamNum}`, `Location{X,Y,Z}`, `BoostAmount`, `BoostType` (`BoostType_Pad` / `BoostType_Pill`), `bReplay` |
| `ClockUpdatedSeconds` | Clock changes | `MatchGuid`, `TimeSeconds`, `bOvertime` |
| `CountdownBegin` | Each round's countdown starts | `MatchGuid` |
| `CrossbarHit` | Ball hits crossbar | `MatchGuid`, `BallLocation{X,Y,Z}`, `BallSpeed`, `ImpactForce`, `BallLastTouch{Player{Name,Shortcut,TeamNum}, Speed}` |
| `GoalReplayStart` | Goal replay starts | `MatchGuid` |
| `GoalReplayWillEnd` | Ball explodes in goal replay (not if skipped) | `MatchGuid` |
| `GoalReplayEnd` | Goal replay ends | `MatchGuid` |
| `GoalScored` | Goal | `MatchGuid`, `GoalSpeed` (uu/s), `GoalTime` (length of previous round, s), `ImpactLocation{X,Y,Z}`, `Scorer{Name,Shortcut,TeamNum}`, CONDITIONAL `Assister{…}`, `BallLastTouch{Player{…}, Speed}` |
| `MatchCreated` | All teams created/replicated | `MatchGuid` |
| `MatchInitialized` | First countdown starts | `MatchGuid` |
| `MatchEnded` | Match ends, winner chosen | `MatchGuid`, `WinnerTeamNum` (-1 = no contest since v2.76 [S15]) |
| `MatchDestroyed` | Leaving the game | `MatchGuid` |
| `MatchPaused` / `MatchUnpaused` | Admin pause/unpause | `MatchGuid` |
| `PlayerJoined` / `PlayerLeft` | Player added/removed | `MatchGuid`, `PlayerName`, `PrimaryId` |
| `PodiumStart` | Podium state after match | `MatchGuid` |
| `ReplayCreated` | Match-history replay loaded (not goal replays) | `MatchGuid`, `FileName`, `Date` |
| `RoundStarted` | Active state after countdown | `MatchGuid` |
| `StatfeedEvent` | Someone earns a stat | `MatchGuid`, `EventName` (asset name, e.g. `Demolish`, `Save`), `Type` (**localized** label, e.g. "Demolition"), `MainTarget{Name,Shortcut,TeamNum}`, CONDITIONAL `SecondaryTarget{…}` |

The doc does not list `BallHit`, `ClockUpdatedSeconds`, `CountdownBegin` etc. as replay-filtered. Only `BoostPickup` and `UpdateState` carry `bReplay`.

Commands (client → game) [S1]: `ChangePOV{Focus: "Ball"|"<shortcut>", Perspective: Fly|SoftAttach|HardAttach|PlayerView|AutoCam|Camera_Director}` (SPECTATOR/REPLAY), `LoadReplay{FileName|Path}`, `SeekReplay{Frame|TimeSeconds}` (REPLAY), `SetGameSpeed{Speed}` (REPLAY), `SetHUDVisibility{bVisible}`, `SetMatchPaused{bPaused}`.

### Limitations

- **No MMR, rank, tier, division, season, or skill rating** in any event [S1].
- **No local-player identity.** Nothing marks which `Players[]` entry is the person running the client [S1]. Community workaround: take the team of the camera `Target` when not in a replay [S9].
- **Car-state telemetry is spectator-only.** That covers Boost, Speed, ground/wall/supersonic flags, and BoostPickup [S1]. No continuous car or ball positions exist in any mode. Positions arrive only at hit, goal and crossbar moments [S1][S14].
- **Platform: PC** (an ini file under the install directory) [S1]. EAC is required for online play on PC, including Steam Deck/Linux [S3]. The doc does not say whether the API works in online ranked. Third-party trackers report it working in "any online playlist or a private match" [S9].
- `MatchGuid` is absent in offline matches [S1].
- **Terms of use:** the developer page states no ToS, rate limits or restrictions [S1]. Psyonix's announcement presents it as the sanctioned replacement for overlay mods [S3]. No separate developer ToS was found (open question).

## MMR / rank sources

| Source | Status | Notes / caveats |
|---|---|---|
| Stats API | No MMR [S1] | — |
| In-game "Visible MMR" (v2.66, 2026-03-10) | Live | Opt-in setting. Shows MMR on Competitive playlist tiles and on the end-of-match scoreboard for Ranked; Casual is unaffected [S4]. UI only: no file or API found. |
| BakkesMod `MMRWrapper` | **Effectively dead for online** | The SDK exposes `GetPlayerMMR`, `GetPlayerRank`, `GetPlayerSkillRating`, `GetCurrentPlaylist`, `IsRanked`, `RegisterMMRNotifier` [S5]. But "Community mods will not run when EAC is enabled" and mods are offline/LAN/replay only [S3]. Injector commit 2026-05-05: "Prevent injection into EAC versions of the RL" [S6]. RocketStats, SessionPlugin and other MMR-session plugins depended on it [S7][S8]. |
| tracker.gg / RL Tracker Network API | **Unverified** | tracker.gg/developers is behind Cloudflare and could not be read. Secondary sources (not authoritative) say no public RL API is obtainable [S16]. Scraping the site would face the Cloudflare challenge seen here. Its ToS on scraping was not checked. |
| ballchasing.com API | Live, token auth, rate limited per patron tier [S11] | Gives replay stats and per-player `rank` filters (min/max rank), but not your live MMR [S11]. Needs replay files uploaded. |
| Manual entry | Always possible | The user reads the in-game MMR (v2.66 display) and types it in. |

## Prior-art features

**BakkesMod session plugins (pre-EAC):**
- **SessionPlugin** [S8]: per-playlist session view showing **MMR gain/loss, wins, losses, current win/loss streak**.
- **RocketStats** [S7]: session information "(MMR, win, loss, streak…)" in game and in OBS. Its `Stats` struct holds `games`, `myMMR`, `MMRChange`, `MMRCumulChange`, `win`, `loss`, `streak`. It also holds counts for Clear, Assist, Center, AerialHit, BicycleHit, ShotOnGoal, Save, EpicSave, Goal, OwnGoal, LongGoal, PoolShot, AerialGoal, TurtleGoal, BicycleGoal, OvertimeGoal, BackwardsGoal, HoopsSwishGoal. Each count exists in "you", "Team" and "Total" variants, both per session and cumulative ("Cumul"). Derived ShootingPercentage is kept at the same three levels. Rank-tier images are included.

**Stats-API-based trackers (post-EAC):**
- OBS session counter [S9]: **per-mode W/L and streak**. A session ends after 4 h with no counted match. Bots, free play and training are excluded. Leaving early counts as a loss, and a ranked reconnect reverses it. Forfeits count as losses. Manual count correction is supported.
- chumstats [S10]: W/L, score, MVP, per-player goals/assists/saves/shots/demos, goal speed, goal XYZ, crossbar hits, touch heatmap from `BallHit` XYZ, and derived wall/ground/air %, supersonic % and speed. It notes that MMR/rank/season standings are not on the socket. Some of its derived stats conflict with the official SPECTATOR markers (see Open questions).
- Many more exist on GitHub, all built since 2026-04: overlays, head-to-head W/L per opponent, Discord RPC, and local dashboards. Head-to-head works by keying on `PrimaryId` [S17].

**ballchasing.com (replay-derived) [S11]:** the per-player stats object has five categories.
- `core`: shots, shots_against, goals, goals_against, saves, assists, score, mvp, shooting_percentage, epic_saves, clears, centers, aerial_hits, first_touches, flip_resets, crossbar_hits, bicycle_hits, juggle_hits.
- `boost`: bpm, bcpm, avg_amount, collected/stolen amounts and counts (big/small), overfill, used while supersonic, time/percent at zero and full, time/percent in the 0–25/25–50/50–75/75–100 bands.
- `movement`: avg_speed, total_distance, time/percent slow/boost/supersonic speed, time/percent ground/low air/high air, powerslide time/count/average.
- `positioning`: avg distance to ball (with and without possession) and to mates, time/percent in defensive/neutral/offensive third and half, behind/in front of ball, most back/forward, closest/farthest from ball.
- `demo`: inflicted/taken, split by half.

Replay metadata includes `match_guid`, `playlist_id`, `season`, `season_type`, `date` and `duration`. Filters include playlist, season, match-result and min/max rank.

**tracker.gg / RLTracker:** pages could not be read (Cloudflare). Secondary sources mention match history with per-match MMR changes and a live desktop app [S16]. Not verified against tracker.gg itself.

**Commonly valued (pattern across [S7][S8][S9][S10][S11]):** session W/L and win %, current/longest streak, MMR delta per session (per playlist), games played, per-game averages (goals, assists, saves, shots, score, demos), shooting %, MVP count, per-playlist separation, and an automatic session boundary (idle gap). Advanced: boost economy, speed/air time, positioning, goal speed, and head-to-head vs specific opponents.

## Seasons

- S22 launched with v2.66 on 2026-03-10 4 PM PT / 2026-03-11 00:00 UTC [S4]. S23 launched with v2.70 on 2026-06-09 4 PM PT [S12]. S24 v2.76 is scheduled for 2026-09-22 4 PM PT [S15], with the season going live 2026-09-23 9 AM PT [S13].
- S24 announcement: "Run it Up LTE: September 23 to December 9", with challenge titles tracking "Season 24 Wins and MVPs" [S13]. It does not explicitly state the season end date.
- Top-100 ranked leaderboard rewards are per season (S24) [S13].
- **Programmatic source:** none found. The Stats API has no season field [S1]. ballchasing exposes a `season` number per replay, but only for uploaded replays [S11].

## Inferences (mine, not stated by sources)

- **Session-first is fully feasible from the Stats API.** You can get a per-match record from `MatchEnded` plus the last `UpdateState` (scoreboard row and `PlaylistId`), with `MatchGuid` as the dedupe key. That record supports W/L, streaks, per-game and per-period averages, shooting % (Goals/Shots), MVP (highest Score on the winning team, approximately), and playlist splits. Daily/weekly/monthly rollups are just aggregations over stored matches.
- **MMR delta per session cannot be automated** from sanctioned sources now. Options: (a) manual MMR entry at session start and end, (b) OCR of the v2.66 end-of-match MMR display (fragile; any ToS implications unchecked), (c) omit it. This is the main feature gap versus pre-EAC plugins.
- **Identifying "me":** use the camera `Target` majority vote [S9]. Once the user's `PrimaryId` is known (configured or learned), match on it instead. That is more robust for multi-account use and spectating.
- **Season boundaries** will have to be a hand-maintained table of dates (S22 03-11, S23 06-10, S24 09-23, S25 about 12-09/10 inferred from the LTE end) or user-configurable.
- `MatchGuid` (32 hex characters) [S1] has the same shape as ballchasing's `match_guid` [S11]. That could allow later enrichment with replay-derived stats (boost, positioning), but this is unverified.
- Leaving early: `MatchEnded` may not fire if the user quits, so a match with `MatchDestroyed` and no `MatchEnded` should be recorded as abandoned (or as a loss, like [S9]).

## Open questions

1. **Spectator-only fields in practice:** does `UpdateState` include Boost/Speed/bOnGround for the local player (or teammates, under the TEAM marker) during normal online play? [S1] marks them SPECTATOR. chumstats [S10] claims per-player boost and derived air/wall % in its own matches. This needs a live capture.
2. Does the Stats API work in all online playlists, including ranked, tournaments and LTEs? There is no official statement; third parties say yes [S9].
3. Is there any official season start/end calendar or endpoint? What is S24's official end date?
4. Does tracker.gg currently offer an RL API to new developers, and does its ToS allow personal lookups? This could not be read.
5. Are there developer terms for the Stats API (data storage, redistribution, commercial use)? None are on the page.
6. Does `StatfeedEvent.EventName` have a full enumerated list (e.g. `EpicSave`, `AerialGoal`, `Clear`, `Center`, `MVP`)? It is not documented. Capture it live.
7. Does `MatchEnded` fire for forfeits, and for the leaver when they quit mid-match?

## Sources

- [S1] Rocket League Stats API (official developer doc). https://www.rocketleague.com/en/developer/stats-api (read via the r.jina.ai reader because direct fetch was Cloudflare-blocked; page content dated after v2.72)
- [S2] Rocket League Patch Notes v2.72 (2026-08-04). https://www.rocketleague.com/news/rocket-league-patch-notes-v2-72
- [S3] "Easy Anti-Cheat Comes to Rocket League on PC Today" (2026-04-28). https://www.rocketleague.com/news/easy-anti-cheat-comes-to-rocket-league-on-pc-today
- [S4] Rocket League Patch Notes v2.66 (2026-03-10, Visible MMR). https://www.rocketleague.com/en/news/rocket-league-patch-notes-v2-66
- [S5] BakkesModSDK `MMRWrapper.h`. https://github.com/bakkesmodorg/BakkesModSDK/blob/master/include/bakkesmod/wrappers/MMRWrapper.h
- [S6] BakkesModInjectorCpp commit history ("Prevent injection into EAC versions of the RL", 2026-05-05). https://github.com/bakkesmodorg/BakkesModInjectorCpp/commits
- [S7] RocketStats (BakkesMod plugin) README and `RocketStats/RocketStats.h`. https://github.com/Lyliya/RocketStats
- [S8] SessionPlugin README. https://github.com/MeineZ/BMSessionPlugin (bakkesplugins id 151)
- [S9] rocket-league-obs-session-counter README and `overlay.html`. https://github.com/geo242/rocket-league-obs-session-counter
- [S10] chumstats README. https://github.com/brendanwelsh/chumstats
- [S11] ballchasing.com API docs. https://ballchasing.com/doc/api
- [S12] Patch Notes v2.70: Season 23 Live. https://www.rocketleague.com/news/rocket-league-patch-notes-v270-season-23-live
- [S13] "Rocket League Heads to the Streets in Season 24". https://www.rocketleague.com/news/rocket-league-heads-to-the-streets-in-season-24
- [S14] DevJMD/rocket-league-stats-api README and `src/protocol/decode.ts`. https://github.com/DevJMD/rocket-league-stats-api
- [S15] S24 Patch Notes v2.76. https://www.rocketleague.com/news/rocket-league-s24-patch-notes-v276
- [S16] Secondary only, not authoritative: Overwolf dev forum https://discuss.developers.overwolf.com/t/rl-get-roaster-rank/1075 ; WeCoach "Best Rocket League Trackers in 2026" https://wecoach.gg/blog/article/best-rocket-league-trackers-in-2026
- [S17] GitHub repository search "rocket league stats api websocket 49123" (e.g. Florentde29/rl-h2h, noxygalaxy/rl-discord-rpc). https://github.com/search?q=rocket+league+stats+api&type=repositories
