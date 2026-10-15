# RL Tracker — v1 feature map

## Destination
A locked feature spec for the v1 local Windows tracker. It covers what is captured, how sessions
and periods work, what each view shows, and the stack. Choices that would block a later web or
mobile app are avoided, but that app is not designed here.

## Notes
- Research baseline: `docs/research/2026-10-15-rl-stats-api-and-trackers.md`. The Stats API
  claims that decisions depend on were verified against the official page on 2026-10-15.
- Grilling transcripts with the user's own answers:
  `docs/plans/2026-10-15-rl-tracker-grill-round1.md`, `…-round2.md`.
- Rule: if a feature needs data the Stats API doesn't send in normal online play, it is cut or
  deferred. It is never worked around with BakkesMod or memory reading, because EAC blocks those.
- UI tickets also load `ui-implementation-guidelines`. Chart work loads `dataviz`.

## Decisions so far
- **Destination**: a v1 local spec; the future app is out of scope (round 1, Q1).
- **Whose data**: one user, with an editable list of "my IDs". Multi-user can come later (Q2).
- **Viewing**: a dashboard in the browser on your own PC, mainly a recap after play. A cheap
  live running total is optional (Q3, Q4).
- **Playlists**: all are recorded, with a playlist filter; ranked is the default view (Q5).
- **MMR**: out of v1. Revisit if the Stats API adds it or a clean source appears (Q6).
- **Teammates and opponents**: names and IDs are stored. Features ship only if trivial, otherwise
  later (Q7).
- **Session**: ends after 30 minutes without a match; a manual "start new session" button (Q8).
- **Periods**:
  - Storage: UTC.
  - Display: local time, with a 4am day cutoff.
  - Units: weeks start Monday; calendar months.
  - Seasons: an editable table seeded with S22 2026-03-11, S23 2026-06-09 and S24 2026-09-23.
  - Rolling views: last 7 and last 30 days (Q9).
- **Recap content**:
  - Wins and losses, win %, and streaks.
  - Goals, assists, saves, shots, demos and score, as totals and per game; shooting %.
  - Statfeed counts and crossbar hits.
  - A by-playlist breakdown and the match list.
  - Headline: a comparison with your 30-day average.
  - Cheap extras: hardest shot and fastest goal (`BallHit` post-hit speed) and a touch heatmap.
  - Whiffs are not possible (Q10).
- **Stack**: TypeScript end to end, with Node for the background program and dashboard server, and
  SQLite (Q11).
- **Running**: auto-start at Windows login, idle until the game's port opens. The performance
  footprint must be measured and shown to be low (Q12).
- **Incomplete matches**:
  - Every match is recorded with a flag.
  - A forfeit counts normally.
  - A match you leave counts as a loss.
  - A match you join in progress counts as a full game (Q13).
- **Identifying you**: guessed from the camera target and confirmed by you, with an editable ID
  list (Q14).
- **Playlist ID mapping** (research): there is no official table.
  - Best source: rlapi's `population.py`, last updated Nov 2024. Ranked IDs: 10/11/13, 27–30 and
    34.
  - Gap: the Ranked Quads ID is unknown (Casual Quads = 4, seen live).
  - Approach: keep the mapping as data and store the raw ID. Show an unknown ID as "Unknown
    playlist (id)" with ranked left unknown, and log it. Unknown IDs are filled in by observing
    them live.
  - Notes: `docs/research/2026-10-15-rl-playlist-ids.md`.
- **What the stream really sends** (live capture, details in
  `docs/research/2026-10-15-live-capture-findings.md`):
  - Car state (boost, speed, supersonic, on ground) arrives for you and your own team, and never
    for opponents. `BoostPickup` never fires. So your own boost stats are possible, but
    pad-pickup stats are not.
  - `Game.Target` was always you in 1v1, 2v2 and 4v4.
  - Playlists: Casual Quads = 4, Ranked Duel = 10, Ranked Doubles = 11. Ignore the leading
    `PlaylistId: 0` states.
  - `MatchEnded`, `PodiumStart`, `Win` and `MVP` fire only when you stay to the end. Leaving,
    abandoning, leaving during the countdown and your own forfeit all produce just
    `MatchDestroyed`, so they can't be told apart, and all count as a loss under Q13.
  - Exception: if the match was already decided (an overtime goal, or 0 s left with different
    scores), take the winner from the score. Snapshot the scoreboard at `MatchEnded`, because
    players leave during the podium.
  - A missing `MatchInitialized` means you joined in progress.
  - Team names can be club names, so key results on `TeamNum`. Bots are `Unknown|0|0`.
  - There is no party information.
  - The game binds `0.0.0.0`, so the tracker connects to `127.0.0.1`.
- **Confirmed assumptions**: the raw event stream is kept so new stats can be recomputed later;
  period views use the recap shape plus a trend chart; data stays local.
- **Raw event storage** (2026-10-15). This revisits "raw stream kept forever", because the
  capture measured 300–450 MB per hour at 30/s.
  - Every event except `UpdateState` is stored in full.
  - `UpdateState` is downsampled to about 2/s, and `Loadout[]` is stored once per match. This is
    roughly 1/15 of the size.
  - A retention script deletes raw events older than a configurable age.
  - Match records (the per-match scoreboard and result) are never deleted by retention. So old
    matches keep their stats, but new stats can't be recomputed past the retention window.
  - The default age is open (see "Not yet specified").

## Open tickets

### Live capture of a real match
Question: What does the stream actually send in normal online play?
- Are boost, speed and `BoostPickup` present?
- What is the full list of `StatfeedEvent.EventName` values?
- Does `Game.Target` reliably point at you while you play?
- Which `MatchGuid` and `PlaylistId` values appear? Do they match the IDs in rlapi's
  `population.py`? What are the IDs for Ranked and Casual Quads, if you play them?
- Which events fire when you leave, disconnect, forfeit or join in progress?
- How many messages per second arrive at a given `PacketSendRate`?

Type: task. It needs a throwaway capture script plus about 3 matches from the user, including one
left early.
Blocked by: none
Status: done (2026-10-15). 6 online matches were captured. Findings are in
`docs/research/2026-10-15-live-capture-findings.md`. Left to observe once live (no ticket needed):
the Ranked Quads ID, an opponent's forfeit, a disconnect, and rarer Statfeed names.

### Background program form
Question: How does the background program start and show it's alive?
- Startup method: Task Scheduler, the Startup folder, a Windows service, or a tray app.
- Does it need a tray icon or status indicator?
- How does the user open the dashboard from it?

Type: grilling
Blocked by: none
Status: open

### Recap layout
Question: What should the session recap look like? This covers the headline comparison, the order
of the sections, and how flagged matches and the extras are shown.
Type: prototype
Blocked by: none. The live capture is done: your own team's boost and speed are available, and
opponents' are not.
Status: open

### Period views and trends
Question: How do the day, week, month, season and rolling views differ from the recap?
- Which trend charts belong on them?
- How do you move between periods?

Type: prototype
Blocked by: Recap layout
Status: open

### Teammate and opponent features
Question: Are any teammate or opponent features trivial enough for v1? Examples: win rate with a
duo partner, or "played this opponent before". If none are, which come first later?
User input (2026-10-15):
- Friends are added manually.
- The tracker suggests frequent co-players as friends to add.
- Stats with friends cover every playlist, not only 2v2.

Capture facts:
- There is no party field.
- `PrimaryId` is stable for humans.
- Bots are `Unknown|0|0` and are excluded.

Left to grill:
- The threshold for suggesting a friend.
- Which stats appear with a friend: W/L and win % per playlist? Their stats as well, given
  their car state is visible?
- Opponent history.
- Whether friend stats is v1 or a fast follow, given Q7's "only if trivial".

Type: grilling
Blocked by: none (the live capture is done)
Status: open

### Dashboard stack
Question: Which front-end approach and chart library should the dashboard use (plain TS vs. a
framework)? Is it served by the background program itself or by a separate server?
Type: grilling
Blocked by: Recap layout, Period views and trends
Status: open

## Not yet specified
- A live running total during play: what it shows and where (browser tab or overlay), and whether
  it's worth building at all.
- Backup and export of the SQLite data (e.g. CSV), and what happens on a reinstall.
- The default raw-event retention age, and how the retention script runs (on startup, or
  manually).
- How a later API update that adds MMR would be folded in.

## Out of scope
- Designing the web or mobile app: it's a "maybe, future" item, so v1 only avoids blocking it.
- Getting MMR in v1: there is no sanctioned source. OCR is fragile. It is deferred by the user.
- Whiffs: the API sends no whiff event and no car position, so there's nothing to infer them from.
- BakkesMod and memory-reading data sources: EAC blocks them in online play.
- Multiple users or a shared database: the user deferred this beyond v1.
