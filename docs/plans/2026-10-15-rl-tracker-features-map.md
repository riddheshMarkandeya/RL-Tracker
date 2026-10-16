# RL Tracker — v1 feature map

## Destination
A locked feature spec for the v1 local Windows tracker. It covers what is captured, how sessions
and periods work, what each view shows, and the stack. Choices that would block a later web or
mobile app are avoided, but that app is not designed here.

## Notes
- Research baseline: `docs/research/2026-10-15-rl-stats-api-and-trackers.md`. The Stats API
  claims that decisions depend on were verified against the official page on 2026-10-15.
- Grilling transcripts with the user's own answers:
  `docs/plans/2026-10-15-rl-tracker-grill-round1.md`, `…-round2.md`, `…-round3.md` (teammates and
  opponents).
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
  - Added by "Period views and trends": this year (calendar year to date) and all time.
- **Recap content**:
  - Wins and losses, win %, and streaks.
  - Goals, assists, saves, shots, demos and score, as totals and per game; shooting %.
  - Statfeed counts and crossbar hits.
  - A by-playlist breakdown and the match list.
  - Headline: a comparison with your 30-day average.
  - Cheap extras: hardest shot and fastest goal (`BallHit` post-hit speed) and a touch heatmap.
    The touch heatmap was later replaced by a goal map (see "Recap layout").
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
  - Default age: **90 days** (user, 2026-10-16). Downsampled raw events come to about 20–30 MB
    per hour of play, so 90 days is roughly 1 GB at the prototype's pace (about 135 hours a year).
    The age is a setting (see "Settings page").
  - Every page reads match records only, never raw events. So anything a page shows is computed
    when the match ends and stored on the match record. Match records are about 2–5 KB each,
    roughly 3–6 MB a year.
- **Friends** (round 3, Q15–Q24). These are in v1 as the last work package. They pass Q7's "only
  if trivial" because everything is a query over data already stored, with no new capture.
  - Friends are added by hand and keyed on `PrimaryId`. The dashboard shows the last name seen, or
    a nickname you set.
  - Suggestions: a human who was your teammate in 3 or more matches across 2 or more sessions.
    Each suggestion has "add" and "never suggest". Bots are never suggested.
  - With a friend: W/L and win % per playlist, your stats with them compared to your overall
    stats, and their scoreboard stats. No boost or speed for them. "With them" means on your team
    at any point in the match.
  - Against a friend (head-to-head): W/L per playlist, your scoreboard line next to theirs per
    match with totals, and MVP count.
  - Where it shows: a "with teammate" filter next to the playlist filter, plus a Friends page with
    "with" and "against" tabs.
  - **Soloqueue** (user, 2026-10-16): the "with teammate" filter lists Anyone, then Soloqueue, then
    each friend. Soloqueue means matches where none of your added friends were on your team. A
    friend on the other team doesn't count, since you didn't queue together. The user wants it to
    see soloqueue performance in ranked. There is no party field, so a duo with
    someone not on your friends list counts as soloqueue.
  - Private matches (playlist 6) are recorded, but left out of overall stats and the 30-day average
    by default. They show on the Friends page and under an explicit Private filter.
  - Opponent history with random players is deferred. Player IDs are stored, so it costs nothing to
    add later.
- **Inferred MVP** (round 3, Q21). This applies to every match, not only friend views.
  - If the `MVP` statfeed fires, use it.
  - Otherwise, when the winner is known (from `MatchEnded` or the decided-match rule), the MVP is
    the highest score on the winning team, taken from the scoreboard snapshot and flagged as
    "inferred".
  - If the top two on the winning team have the same score, no MVP is inferred.
  - Inferred results and MVPs count normally.
- **Background program form** (2026-10-15):
  - Startup: a Task Scheduler "at log on" task for the current user (no admin, no console window).
    It restarts on crash and never starts a second instance. `npm run install-autostart` and
    `uninstall-autostart` add and remove it.
  - Single instance: bind the dashboard port (`127.0.0.1` only) before connecting to the game. If
    the port is taken, log that and exit. The game's Stats API port can't serve as the guard: two
    clients can both connect and record every match twice.
  - Stopping: `npm run stop` and a dashboard Quit button send a shutdown request that requires a
    custom header, so a web page can't trigger it cross-origin. Turning off autostart is separate
    (uninstall).
  - One Node process runs the recorder and the dashboard server, always on from login. While the
    game is closed, it tries the game's port every 5 s, backing off to 30 s.
  - Alive indicator: no tray icon in v1. The dashboard header shows "waiting for game",
    "connected", "recording match" or "Stats API off". One toast fires if the game is running and
    no data arrives within about 60 s.
  - Dashboard access: a fixed URL, plus a Start menu or desktop shortcut created at install. The
    browser never opens by itself.
  - Logs: a rotating file in `%LOCALAPPDATA%\RLTracker\`, 5 files of 5 MB each.
  - Later, not v1: open the dashboard when the game closes, a one-click or one-command setup, and a
    tray icon if checking the dashboard gets tedious.
- **Recap layout** (prototype, 2026-10-16). The reference is variant D of
  `prototypes/recap-layout/recap-prototype.html` (branch `prototype/recap-layout`). Variants A–G
  were explored over seven rounds.
  - Two pages per session: **Overview** and **Matches & numbers**.
  - Header: a session picker (a dropdown grouped by day, showing each session's time range, W–L,
    match count, length and a mini W/L strip), plus ‹ › to step. A day with more than one session
    labels it "2nd of 2 that day". Then the playlist filter and the "with teammate" filter.
  - "With teammate" lists Anyone, Soloqueue (see "Friends"), then only the **friends** who played
    in the selected session. It shows no match counts: the user asked for none in either dropdown (2026-10-16, revisiting the counts the recap
    prototype showed). It resets to Anyone when the friend isn't in the session, and is disabled when no friend is.
    Random teammates are left out, because a session can hold many one-off players.
  - Default filter on the recap: **everything except private**. This revisits Q5 ("ranked is the
    default view") for the recap: the user asked for an overview of the whole last session. Q5
    still stands for other views until "Period views and trends" decides them.
  - Overview order:
    1. A broadcast-style scorebug (from variant F): WINS | date, session length, win % and match
       count | LOSSES.
    2. A mood remark plus at most one quip (see "Recap remarks"), and the change
       against the 30-day average.
    3. Four big stat tiles: best streak, ended on, shooting % against average, MVP count.
    4. Match cards in wrapped rows: number, time, W/L and score, playlist, MVP icon, and an amber
       dot when flagged. Clicking one opens the match.
    5. Per-game stat cards against the 30-day average.
    6. "What stood out" next to "By playlist".
    7. The goal map (below).
    8. Extras cards: hardest shot, fastest goal, crossbar hits, your average boost, supersonic %,
       time on empty boost, aerial touches. Then a "Highlights" row of rare statfeed events (hat
       tricks, overtime goals, Savior, epic saves, aerial, long and bicycle goals), shown only when
       they happened.
  - Dropped: the statfeed chip panel (its common counts are in the stat cards, MVP in the tiles,
    rare ones in Highlights) and the touch heatmap.
  - **Goal map**: a sideways pitch with one dot per goal, at the **scoring team's last touch**
    since kickoff, for goals both scored and conceded. Your goals are filled, a teammate's are
    rings, conceded goals are orange. A dashed ring marks "deflected": the other team touched it
    last. Aerial goals (from the `AerialGoal` statfeed) are diamonds. Hovering shows match, speed,
    distance and height; clicking opens the match. Beside it: scored and conceded, split into
    close / mid-range / long, with an aerial count and your share of the team's goals. A pure own
    goal gets no dot, only a count. The rule was checked against the second capture (see the
    findings doc).
  - Flags: minimal. An amber dot on match cards, ⚑ on the match list, and a slim left-border note
    on the match page. No flag count.
  - Matches & numbers: with no match open, a full-width table of every match (#, time, playlist,
    result, score, G, A, Sv, Sh, Dm) with a totals row. It has no "with" column, because 3v3 can
    have two teammates. With a match open: a side list ("← All matches" on top), the scoreboard,
    that match's goal map, then its extras.
  - The 30-day baseline follows the active filters. Changing what the headline compares against
    (e.g. always ranked) should stay a small setting (see "Settings page").
  - Long history and long sessions (tested with about 90 sessions and a 40-match session):
    - The session picker lists the last 2 weeks by day. Older sessions fold into one collapsed group
      per month, showing session count and W–L. The real build loads a month's sessions only when it
      is opened. Mini W/L strips stop at 24 squares and show "+N" after that.
    - Sessions over 24 matches get denser match cards, about 13 per row.
    - The match list on Matches & numbers scrolls inside a viewport-high box and keeps the open
      match in view.
    - The numbers table is capped at 70% of the viewport, with its header and totals row pinned.
    - Goal-map marks shrink when a view has more than 60 goals.
  - Themes are CSS tokens. **Carbon** is the default. Also offered: slate, midnight, oled, dusk,
    steel and daylight (light). Accent colors avoid team blue and orange, win green, loss red and
    the flag amber.
- **Period views — the Trends page** (prototype, 2026-10-16). The reference is variant B of
  `prototypes/period-views/period-views-prototype.html` (branch `prototype/period-views`, which
  branches from `prototype/recap-layout` for the icons).
  - Trends is its own page, a second tab next to Recap in the header. The session picker stays on
    the recap.
  - Header: quick picks (Last 7 days, Last 30 days, This week, Last week, This year, All time),
    then the playlist and "with teammate" filters.
  - Default filter on Trends: **All ranked**. This upholds Q5 for this page: trends ask "am I
    getting better?", and casual and extra modes would blur that. The recap keeps "everything
    except private".
  - Playlist dropdown, the same on both pages:
    - Everything (excl. private).
    - Ranked: All ranked, then each ranked playlist.
    - Casual: All casual, then Casual 1v1, 2v2, 3v3 and 4v4.
    - Extra modes (Hoops, Rumble, …).
    - Private.
    - Only playlists with matches in the period appear. The list comes from the stored playlist
      IDs. "All casual" covers 1v1–4v4 only, because extra modes would skew per-game stats.
    - No counts in either dropdown.
  - Choosing a period, top to bottom:
    1. A year stepper (‹ 2026 ›).
    2. A year strip: season bands (clickable), month cells (clickable), and thin grey ticks for
       the days you played. The selected period is shaded and today is marked.
    3. The period title with ‹ › to step through weeks, months and seasons.
  - Period header: title, date range, "still running" for an unfinished calendar period, what it
    is compared with, W–L, matches, sessions, best streak and MVPs. When matches in the period
    were left early, an amber "⚑ includes N matches you left early" note appears, because they
    count as losses (Q13).
  - Six metric tiles, in the user's order: **Win %, Goals, Shots, Shooting %, Assists, Saves**
    (per game). Each tile shows the value, ▲▼ against the previous period of the same kind, and a
    sparkline. Score/game and Demos/game were dropped from Trends; they stay on the recap.
  - Comparison: the previous period of the same kind (last week, last month, the previous season,
    the previous 30 days). This year and all time have nothing earlier, and the header says so.
    The recap still compares against the 30-day average.
  - One big chart of the selected tile's metric, with a dotted period-average line and season
    start markers:
    - Points per day for 7 days, 30 days, a week or a month; per week for a season or a year;
      per month for all time.
    - Hollow dots mark buckets with under 3 matches.
    - An x-axis toggle between **By date** and **By match** (rolling average of the last 20
      matches). The rolling window reaches back before the period, so its first points are full
      windows.
    - Auto: when a filter leaves fewer than 6 buckets with matches (e.g. one friend over 30
      days), the chart switches to rolling-20 and says why. The user can switch back.
  - A wins-and-losses bar chart per bucket: wins up, losses down, with W/L letters on the axis.
    Clicking a day opens that day's recap; a week or month opens that period.
  - Rejected:
    - Variant A (tabs + six small charts): too many charts for "a few headline numbers". Its
      by-playlist and session list duplicate the filter and the recap.
    - Variant C (year calendar + drill-down table): a good way to browse, but table-heavy. Its
      day → recap path survives as clicking a day in the wins-and-losses chart.
    - A dashed previous-period line on the big chart: lining up day 3 with day 3 meant nothing and
      added noise. The tile deltas already answer "better than last time?".
  - Later, not v1: win % by hour or weekday, and win % by match number within a session.
- **Dashboard stack** (grilling, 2026-10-16). The dashboard has to render the recap and Trends
  prototypes. Those are plain JS template strings with hand-drawn SVG and no libraries.
  - Front end: **React + TypeScript**, built with Vite. Preact was considered. Its only real gain
    is size, which doesn't matter for a page served from your own PC, and React has better docs
    and examples. The user knows React a little.
  - Charts: hand-drawn SVG components ported from the prototypes (line, W/L bars, sparklines, goal
    map, year strip). No chart library: the goal map and year strip are custom anyway, and a
    library's styling would fight the theme tokens.
  - Server: the always-on Node process from "Background program form" serves everything with plain
    `node:http` and a tiny router: a JSON API under `/api`, the built static files, and the
    shutdown endpoint. Move to Hono if routing gets messy. A JSON API keeps a later web or mobile
    app unblocked.
  - Live updates: Server-Sent Events push the header status and "match ended". On "match ended",
    TanStack Query refetches the affected data, so the recap updates by itself.
  - URLs: React Router with real paths (e.g. `/recap/:session/match/:id`, `/trends?…`), with filters
    in the query string, so deep links, the back button and bookmarks work. The server returns
    `index.html` for any page path it doesn't recognize.
  - Validation: **Zod** schemas in `src/shared` validate query params and request bodies, and also
    provide the API's TypeScript types, so types and validation can't drift apart. This was chosen
    over hand-written parsers because the Settings page writes nested data (seasons table, ID list,
    friends).
  - Repo: one npm package with `src/server`, `src/web` and `src/shared`. `vite build` runs at
    install. In development, Vite's dev server forwards `/api` to Node.
  - Styling: plain CSS carrying over the prototypes' theme tokens as one global stylesheet, plus CSS
    Modules per component.
  - Tests: Vitest for the logic (aggregation, period bucketing, soloqueue and friend filters,
    inferred MVP), plus a short Playwright check that each page renders in a real browser.
  - Strict TypeScript and ESLint (`typescript-eslint` strict) across the whole codebase from day
    one, since the project starts with no code.
  - Not decided here: the SQLite driver (`node:sqlite` or `better-sqlite3`), which belongs to the
    recorder work.
- **Recap remarks** (grilling, 2026-10-16). The full line pool is in
  `2026-10-16-recap-remarks-copy.md`. The user chose not to review it so the jokes stay a surprise;
  they'll ask for cuts as they meet lines they dislike.
  - Voice: mostly deadpan commentator, with some roasting friend and self-aware tracker mixed in.
    It roasts you properly, but friends get only light teasing aimed at the pair. No swearing,
    though the `$#@%!` quick chat is allowed. Plenty of Rocket League in-jokes, at most one per
    line.
  - Headline: one mood line with no numbers, plus at most one quip that uses real numbers.
  - Mood is judged against how big the session was:
    z = (session win % − 30-day win %) / (50 / √n). |z| < 0.5 is usual, 0.5–1.5 is good or
    rough, and ≥ 1.5 is great or disaster (about 38 / 24 / 7 % of nights). A fixed ±6-point band
    was dropped because luck alone swings a 10-match night by ±16 points. Under 4 matches there's
    a separate "short" set that doesn't judge the night. The bands can be tuned later from the
    user's own history.
  - Triggers are sorted into tiers. The rarest tier that fired wins, with a random pick inside
    the tier. Legendary: hat trick, Savior, bicycle goal. Rare: an aerial or long goal, epic saves,
    overtime wins or losses, an MVP haul, a hard shot, a match where your team was shut out.
    Common: a win or loss streak, ending on a win or a loss, a duo's good or bad record, a
    soloqueue night, demos given or taken, crossbar hits, a marathon (3 h or more), late night
    (ending at 1am or later). No own-goal trigger, since that statfeed event isn't confirmed.
  - The pick is stored per session and filter combination on first view, so revisiting shows the
    same lines. ↻ stays in the real app. A line shown in the last ~10 sessions is skipped while
    other lines are still available.
  - Settings: remarks on/off, plus an on/off switch per trigger.

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
the Ranked Quads ID, an opponent's forfeit, a disconnect, rarer Statfeed names, and whether a
private match (bots are fine) sends a `MatchGuid` and `PlaylistId` 6. If it doesn't, head-to-head
only covers matchmade games, and the MVP tie-break stays unobserved.

### Background program form
Question: How does the background program start and show it's alive?
- Startup method: Task Scheduler, the Startup folder, a Windows service, or a tray app.
- Does it need a tray icon or status indicator?
- How does the user open the dashboard from it?

Type: grilling
Blocked by: none
Status: done (2026-10-15). See "Background program form" under Decisions so far.

### Recap layout
Question: What should the session recap look like? This covers the headline comparison, the order
of the sections, and how flagged matches and the extras are shown. Flags include an inferred
result or MVP. The recap also needs room for the "with teammate" filter.
Type: prototype
Blocked by: none. The live capture is done: your own team's boost and speed are available, and
opponents' are not.
Inputs: `HARs/rocketleague.com_profile.har` is a capture of the official rocketleague.com profile
page, added by the user. Extract usable icons and assets from it (playlist and rank icons, for
example) and look at its design for reference only, because the prototypes are our own design. The
file is gitignored because it may hold session cookies, so never quote headers from it. Load
`prototype`, `ui-implementation-guidelines` and `dataviz`.
Status: done (2026-10-16). See "Recap layout" under Decisions so far.

### Period views and trends
Question: How do the day, week, month, season and rolling views differ from the recap?
- Which trend charts belong on them?
- How do you move between periods?

User input (2026-10-16, from the recap review):
- A separate view or page from the session picker, for season, YTD and similar ranges.
- A few headline numbers and trend graphs. It doesn't need every stat.
- YTD is new: it isn't among Q9's periods yet.
- MMR is out of v1, so trends are win % and per-game stats over time, not rank.
- Start from the recap's look (variant D, carbon theme) so the views feel like one product.

Type: prototype
Blocked by: none (Recap layout is done)
Status: done (2026-10-16). See "Period views — the Trends page" under Decisions so far.

### Recap remarks copy
Question: What is the pool of random remarks and quips on the recap headline? This covers the
tone, the triggers (better or worse than usual, streaks, a duo's record, demos, crossbar, hard
shots, hat tricks, …) and how many variants each trigger needs so it doesn't repeat.
Inputs: the placeholder pool in `remarks()` in the recap prototype. The user wants them funny.
Type: grilling (`grill-me`)
Blocked by: none
Status: done (2026-10-16). See "Recap remarks" under Decisions so far.

### Daylight theme icons
Question: The game's statfeed icons (e.g. MVP) are white and fade on the light "daylight" theme.
Make dark or recolored versions, or tint them with CSS.
Type: task
Blocked by: none
Status: later (after v1 views are built)

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
Status: done (2026-10-15). The decisions are under "Friends" and "Inferred MVP" in Decisions so far,
and the transcript is `docs/plans/2026-10-15-rl-tracker-grill-round3.md`.

### Dashboard stack
Question: Which front-end approach and chart library should the dashboard use (plain TS vs. a
framework)? Is it served by the background program itself or by a separate server?
Type: grilling
Blocked by: none (Recap layout and Period views are done)
Status: done (2026-10-16). See "Dashboard stack" under Decisions so far.

### Settings page
Question: What can be changed on a settings page, and how is it laid out?
User input (2026-10-16): the user is "big on having settings and options to change things", for
example defaults and theme. To be mapped separately later.

Candidates already named elsewhere in this map:
- Theme (carbon by default).
- The default playlist filter per page (recap: everything except private; Trends: all ranked).
- What the recap headline compares against.
- Raw-event retention age (90 days by default).
- The rolling-window size on Trends (20).
- Your IDs list, friends and nicknames.
- The seasons table.
- The session gap (30 minutes), the day cutoff (4am) and the week start (Monday).
- Unknown playlist IDs.

Type: grilling (`grill-me`), then a prototype if the layout isn't obvious
Blocked by: none
Status: open (the user will pick it up later)

## Not yet specified
- A live running total during play: what it shows and where (browser tab or overlay), and whether
  it's worth building at all.
- Backup and export of the SQLite data (e.g. CSV), and what happens on a reinstall.
- How the retention script runs (on startup, or manually). The default age is decided: 90 days.
- How a later API update that adds MMR would be folded in.

## Out of scope
- Designing the web or mobile app: it's a "maybe, future" item, so v1 only avoids blocking it.
- Getting MMR in v1: there is no sanctioned source. OCR is fragile. It is deferred by the user.
- Whiffs: the API sends no whiff event and no car position, so there's nothing to infer them from.
- BakkesMod and memory-reading data sources: EAC blocks them in online play.
- Multiple users or a shared database: the user deferred this beyond v1.
