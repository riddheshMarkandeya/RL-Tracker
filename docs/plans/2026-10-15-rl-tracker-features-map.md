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
  - Gap: the Quads IDs added in Season 20 are unknown.
  - Approach: keep the mapping as data and store the raw ID. Show an unknown ID as "Unknown
    playlist (id)" with ranked left unknown, and log it. Unknown IDs are filled in by observing
    them live.
  - Notes: `docs/research/2026-10-15-rl-playlist-ids.md`.
- **Confirmed assumptions**: the raw event stream is kept so new stats can be recomputed later;
  period views use the recap shape plus a trend chart; data is kept forever and stays local.

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
Status: open

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
Blocked by: Live capture of a real match, because boost/speed availability changes which stats
exist
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
Type: grilling
Blocked by: Live capture of a real match, to confirm IDs are stable for all players
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
- How a later API update that adds MMR would be folded in.

## Out of scope
- Designing the web or mobile app: it's a "maybe, future" item, so v1 only avoids blocking it.
- Getting MMR in v1: there is no sanctioned source. OCR is fragile. It is deferred by the user.
- Whiffs: the API sends no whiff event and no car position, so there's nothing to infer them from.
- BakkesMod and memory-reading data sources: EAC blocks them in online play.
- Multiple users or a shared database: the user deferred this beyond v1.
