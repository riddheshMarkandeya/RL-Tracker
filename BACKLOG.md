# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[feature, High, Substantial]** v1 roadmap: `docs/plans/2026-10-16-v1-roadmap.md`. Next:
  WP8 (Settings), split 2026-10-28: WP8a and WP8b (the You and Seasons tables, the section list)
  deployed 2026-10-28 and checked by the user (phone width, the pending guess answered); left: add
  S25 when it starts (`docs/plans/2026-10-28-wp8a-settings.md`,
  `docs/plans/2026-10-28-wp8b-settings-tables.md`). WP7 (Trends) is deployed: WP7b (the big chart,
  rolling 20, the W/L chart with click-through, `docs/plans/2026-10-28-wp7b-trends-charts.md`) and
  WP7a (Trends page, controls and tiles, `docs/plans/2026-10-27-wp7a-trends-page.md`). WP6c (share card, `docs/plans/2026-10-27-wp6c-share-card.md`) is deployed. WP6b (remarks, `docs/plans/2026-10-27-wp6b-remarks.md`) is deployed. WP6a
  (recap pages) is deployed: WP6a-c (match page, Matches & numbers, links,
  `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`), WP6a-b (Overview sections 5–8,
  `docs/plans/2026-10-27-wp6a-b-overview-sections.md`) and WP6a-a (recap navigation,
  `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`). WP5b (web shell; WP5b-b harness and install,
  `docs/plans/2026-10-21-wp5b-b-harness-install.md`) is deployed. WP5a-a and WP5a-b (API, `docs/plans/2026-10-21-wp5a-b-api.md`) are deployed. WP4c-a (rule registry, `rules-diff`) and WP4c-b (retention split,
  `docs/plans/2026-10-20-wp4c-b-retention-split.md`) are deployed. WP4b's open flag `mvp_count` is
  closed: a podium with no award is normal, so the check flags only more than one award (`mvp` v2,
  commit 87881b5); after the 2026-10-26 recompute no stored match has it.
  - **[design, Low, Trivial]** Add back the themes midnight, dusk, steel and daylight (values in the
    `prototype/settings-layout` tokens; each needs a `tokens.css` block, and the token test covers
    it). Daylight has the real cost: every chart gets checked in light mode, and so does the WP6c
    share card's corner glow (built for dark themes). Record:
    `docs/plans/2026-10-21-wp5b-a-web-shell.md`.
  - **[design, Low, Trivial]** Around 2026-12-27, check the "What stood out" threshold
    (`STOOD_OUT_MIN_PCT`, 10%). On 2026-10-27, the 5 sessions that had a baseline had 4–6 stats past
    ±10% (3–5 past ±20%). Every baseline was under a month old (13–65 matches), so swings ran
    large. Re-run that table against full 30-day baselines and pick the number then. Record:
    `docs/plans/2026-10-27-wp6a-b-overview-sections.md`.
  - **[design, Low, Trivial]** Check the goal map's top/bottom against a goal you remember:
    +X is assumed to be blue's left, which nothing has verified. A wrong guess mirrors the map top
    to bottom; left/right (your goal) is confirmed by real data. Fix it in `toScreen`, which has
    the tests. Record: `docs/plans/2026-10-27-wp6a-b-overview-sections.md`.
  - **[feature, Low, Standard]** Per-tier and per-trigger remark switches: deferred from v1
    (user, 2026-10-28, simplest settings first). WP8a ships only the master and mood-line
    switches, which change what's shown and not the pick; clock and speed go through
    `fillRemark` there. If the switches come back, they drop triggers before `pick()`, and a
    stored pick whose trigger is switched off re-picks, as a cut line does. Record:
    `docs/plans/2026-10-27-wp6b-remarks.md`, `docs/plans/2026-10-28-wp8a-settings.md`.
  - **[performance, Low, Standard]** The remarks GET and ↻ each build the full `sessionDetail`
    (session cut, goals, summaries, baseline), so a recap load does that work twice. Fine at 76
    matches; give remarks a lighter read if recap loads get slow. Record:
    `docs/plans/2026-10-27-wp6b-remarks.md` (Review log).
  - **[design, Low, Standard]** The remarks GET writes the first pick, and the request-header
    guard covers only non-GET methods, so another site could fix first-view lines (and fill the
    repeat history) for sessions you haven't opened, if it guessed their keys and the port. Make
    the first-view write a POST, or send the header on that GET, if the app is ever reachable
    beyond localhost. Record: `docs/plans/2026-10-27-wp6b-remarks.md` (Review log).
  - WP3a's manual check still open: Ctrl+C on `bun run start` mid-match should end `tracker.log`
    with `app/stopped` (Git Bash can't send a console SIGINT). The shutdown endpoint path is
    covered by `src/server/main.test.ts`.
  - WP3b's manual check still open: sign out and back in, and the tracker should autostart
    (`supervisor/started`, then `app/started`).
- [ ] **[design, Med, Trivial]** The "no data" toast is suppressed over the full-screen game and
  only waits in the notification panel. (Its body now names the ini problem to fix.) WP5's status
  display is the reliable signal (`statsConfig()` carries the same diagnosis). WP8 has no toast switch, dropped
  2026-10-28 (user, simplest settings first). An urgent/priority toast is still untried. Record: Verification results in
  `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[performance, Med, Standard]** The tracker's working set peaked at 108–111 MB in the three
  10× replay runs made with Rocket League open, against the user's 100 MB threshold (WP3b decision
  4). It's one ~75 MB step at replay start, then flat, while private bytes barely moved: likely
  shared or file-backed pages, not heap. Next: measure private bytes vs shared WS in a real match.
  Record: "Footprint" in `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[design, Med, Standard]** Retention: verify before deleting. Before the thinning
  transaction, rebuild the match from the kept events plus the snapshot and compare its record
  with the full one. On any difference, keep it whole and log `retention/thin_mismatch`. Today a
  future rule that reads a field thinning drops is caught only by the field-list test and the
  coarse fixtures; this checks every real match before an irreversible delete. About 15 lines
  and a test, one extra rebuild per match, no schema change. Do it before mid-January 2027, when
  the first matches reach 90 days. Record: Review log (`/simplify` altitude #1) in
  `docs/plans/2026-10-20-wp4c-b-retention-split.md`.
- [ ] **[bug, Low, Trivial]** Install: if replacing an exe fails after the tracker is stopped
  (antivirus holding the fresh `.new.exe` past `replace`'s 10 s), install throws before
  `schtasks /Run`, so nothing records until the next logon. Restart the task anyway, as the
  dashboard swap already does, then report. Record: Review log in
  `docs/plans/2026-10-21-wp5b-b-harness-install.md`.
- [ ] **[refactor, Med, Standard]** Replace `staleAfter`'s narrowed `match_ended` refresh with
  refetch-everything (roadmap "UI interaction defaults", Cache). Revisits WP6a-a's design: it took
  four review rounds and is still disputed, to save a few ms on a local API. Record: Review log
  rounds 1, 2, 6, 7 in `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`.
- [ ] **[refactor, Low, Standard]** `scripts/capture.ts` keeps its own envelope parse
  (`eventNameOf`/`matchGuidOf`), hardcoded URL and reconnect loop; reuse `parseFrame`,
  `statsApiUrl` and maybe `startStatsClient`, or retire it now the recorder stores raw events.
  Record: Review log in `docs/plans/2026-10-19-wp3a-recorder.md`.
- [ ] **[design, Low, Trivial]** Drop the totals row from the recap's Matches & numbers table
  (`src/web/pages/recap/Matches.tsx`, the `<tfoot>`, and the header comment that mentions it). The
  user doesn't want totals there, as on the Friends page's match-by-match table (user, 2026-10-28,
  Friends prototype review).
- [ ] **[design, Med, Standard]** Display layer drift across pages (user, 2026-10-28). Tokens,
  panels, tables and team colours are shared, but each page grew its own:
  - big-number type: condensed italic (recap scorebug and tiles, Trends title), plain Segoe
    (match page title, share card, Friends prototype);
  - tile anatomy: four kinds (recap `.tiles`/`.stat`, Trends `.tile`, share card `.tile`, the
    Friends prototype's), with different label case, size and order;
  - heading placement: sentence-case headings above panels (Recap, Trends, Settings) against
    uppercase headings inside panels (Friends prototype).
  Fix: one shared Tile and one section-heading pattern in `src/web/components`, then move pages onto
  them. The share card keeps its own scale (a 360px image), but its record should use the same
  face. WP9 builds Friends on the existing primitives, so it doesn't add a fifth tile.
  - Colour roles: the code mostly follows an unwritten rule, blue/orange = your side / the other
    side (`TEAM_TONE` in `MatchView.tsx`, `GoalMap`, the Friends zones) and green/red = result
    (`--win`/`--loss`). Write it down, then fix the leaks: the match page falls back to blue/orange
    meaning the game's own team colours when "yours" is unknown (one colour, two meanings); the
    share card's blue/orange background is decoration only; `--up`/`--down` is a second green/red
    pair for deltas next to `--win`/`--loss`. Decide whether the pairs merge or the rule says why
    they're separate.
- [ ] **[feature, Low, Standard]** Settings › Appearance: choose the colour pair for sides (blue /
  orange) and for results (green / red), each on its own and apart from the theme (user,
  2026-10-28). Also helps red-green colour blindness. The pairs are already tokens
  (`--blue`/`--orange`, `--win`/`--loss` in `src/web/styles/tokens.css`), so it's a setting that
  overrides them on `<html>`, plus a check that each pair stays readable on every theme. Do it after
  the colour-roles part of the drift item above, so each token has one meaning first.
- [ ] **[feature, Low, TBD]** After v1: trio "with" (two friends on your team) and duo "against"
  (two friends on the other team) on the Friends page. WP9's UI is single-friend, but its friend
  API takes a list of friend ids (user, 2026-10-28), so this is mostly a picker plus a column
  group per extra member. Raised 2026-10-28 in
  the Friends prototype review (`prototype/friends-page`).

## Watch list
- [ ] **[design, Low, Standard]** Trigger: an `ids/unknown_platform` warn in tracker.log, or the first
  `PS5|` or `Switch|` id in my_ids. The You table maps the raw primary-id prefix to a platform name
  (`src/shared/platforms.ts`); PS5 and Switch are mapped on assumption, never seen in a capture, and
  any other prefix shows as itself. Fit the table to the real prefix. Record:
  `docs/plans/2026-10-28-wp8b-settings-tables.md`.
- [ ] **[performance, Low, Standard]** Trigger: `/api/played-days` getting slow as matches pile up
  (paging the Trends strip's year feels slow, or the request log shows it). It reads every result
  on each request just for one year's ticks, plus the first day and total. Read only the year's
  range for the ticks, and get the first day and total from a cheap count. Record:
  `docs/plans/2026-10-27-wp7a-trends-page.md` (Review log).
- [ ] **[design, Low, Standard]** Trigger: a `[rlt] share/null_stat` warn in the browser console.
  A share card tile (streak, goals, assists, saves, shots, MVPs, demos) got a null stat and shows
  "–"; a session with a played match shouldn't give one. Then fit the handling to that session.
  Record: `docs/plans/2026-10-27-wp6c-share-card.md`.
- [ ] **[feature, Low, Standard]** Trigger: deciding to record which goals were bicycle kicks. The
  `bicycle_goal` remark is inert: the game sends `BicycleHit` (34 of 76 matches) but no bicycle-goal
  event, so a rule would have to tie a BicycleHit to a goal's origin touch (an order no data has
  shown yet). Record: `docs/plans/2026-10-27-wp6b-remarks.md`.
- [ ] **[feature, Low, Standard]** Trigger: deciding to record demos taken. The `demoed_a_lot`
  remark is inert: the Demolish statfeed's victim (`SecondaryTarget`) is in raw events but not
  recorded; a `statfeed_counts` bump plus a recompute would add it. Record:
  `docs/plans/2026-10-27-wp6b-remarks.md`.
- [ ] **[design, Low, Standard]** Trigger: a `[rlt] recap/player_no_team` warn in the browser
  console. A scoreboard player with a null team is listed under "Unknown team" (none in real data
  on 2026-10-27). Then fit the handling to that match. Record:
  `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`.
- [ ] **[design, Low, Standard]** Trigger: a `[rlt] recap/goal_no_team` warn in the browser
  console. A match with goals but a null `me.teamNum` can't be oriented, so its goals are left off
  the goal map and its counts (0 of 76 player rows had a null team). Then fit the handling to that
  match. Record: `docs/plans/2026-10-27-wp6a-b-overview-sections.md`.
- [ ] **[design, Low, Standard]** Trigger: a `replay_playback` flag (a stretch of a match's
  states at least 90% `bReplay`). Replay playback of a match you left, or of one never recorded,
  still gets stored as play; a finished match's guid is refused. Then fit the handling to that
  real stream. Record: `git log --grep=finished_match_stays_closed`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a match cut at a `RecorderClosed` with events
  stored after it (both real cuts were at a MatchDestroyed). Thinning keeps the last state of the
  whole list, not of the cut, so it can drop the state that gives the cut match its `ended_at`.
  Then keep the last state before the cut too. Record: `git log --grep=finished_match_stays_closed`.
- [ ] **[design, Low, Standard]** Trigger: a stored match you played with a null `playlist_id`
  (none among the first 65). `latest`'s `playlistsPresent` drops null ids, so a history of only
  such matches reads "Not enough data yet" under a narrow filter. Then add a played-anything flag
  to `latestResponse`. Record: `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`.
- [ ] **[test, Low, Standard]** Trigger: Playwright sharding, `workers` above 1, or a spec rename
  that puts `shell.spec.ts` before `recap.spec.ts`. Both share the rich-seed stack, and the shell
  spec's replay and session break change it, so the recap spec must run first. Then give the
  replay spec its own stack. Record: `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`.
- [ ] **[design, Low, Standard]** Trigger: a `query/two_yous` warn in `tracker.log` (two of your
  ids in one match, never seen). Pages take the camera's player, else the lowest key; check that
  match and fit the rule to it. Record: `docs/plans/2026-10-21-wp5a-a-query-logic.md`.
- [ ] **[design, Low, Standard]** Trigger: a `retention/kept_whole` with reason `trimmed` (a match
  that lost its start; only the old time-based retention could cut one, and it never reached a
  match) or a `retention/thin_failed` that repeats daily. Look at that match, then thin it or
  drop the row. Record: `docs/plans/2026-10-20-wp4c-b-retention-split.md`.
- [ ] **[design, Low, Standard]** Flagged matches are kept whole for good, including expected
  cases such as `camera_on_roster` on a spectated match (1 of 46 so far, about 2 MB each).
  Trigger: `exempt` rows hold more raw.db than the thinned ones, or one check accounts for most of
  them. Then decide whether that check's matches should thin. Record: Review log in
  `docs/plans/2026-10-20-wp4c-b-retention-split.md`.
- [ ] **[design, Low, Standard]** Match records treat only team 0 and 1 as real teams (user's
  choice). Knockout (playlist 54, an 8-player free-for-all) may number teams per player, and then
  its players would get no team and no result. Trigger: a captured Knockout match → check its
  `TeamNum`s and decide. Record: Review log round 6 in
  `docs/plans/2026-10-20-wp4a-match-records.md`.
- [ ] **[bug (latent), Low, Standard]** A match whose close marker failed to store is never closed,
  so recompute skips it on every run, and retention keeps it whole and logs it daily once it is
  90 days old. Trigger: a real `records/recompute_skipped` with reason `open` at warn, or a
  `retention/kept_whole` with reason `open` → let recompute close it (as `restart`) or add a
  manual close. Record: Review log
  round 2 in `docs/plans/2026-10-20-wp4a-match-records.md`.
- [ ] **[bug (latent), Low, Standard]** A supervisor killed on its own (Task Scheduler's End)
  leaves the tracker running unsupervised; a later supervisor exits on the taken port, so a crash
  of that orphan isn't restarted. Trigger: a real `supervisor/stopped` with code 3 at logon or
  install → tie the child to the supervisor (a job object) or let a new supervisor adopt it.
  Same orphan, narrower: `bun run stop` in the moment a restarted tracker hasn't bound its port
  yet ends the supervisor and leaves that tracker running.
  Record: WP3b Review log round 1 in `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[bug (latent), Low, Trivial]** Windows antivirus may hold a fresh backup `.partial` and
  fail its rename (EPERM/EBUSY), aborting a pre-migration startup. Trigger: a real
  `backup/failed` on the rename → retry it briefly. Record: Review log round 3 #8 in
  `docs/plans/2026-10-16-wp2-storage.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a match whose clock stepped back (it fails the car_ms range). The woodwork window compares `ev.ts - lastWoodworkTs` unclamped, so crossbar hits after the step go uncounted until the clock catches up. Record: Review log round 11, BB7, in `docs/plans/2026-10-20-wp4b-match-extras.md`.
- [ ] **[feature, Low, Standard]** Trigger: a `goals_placed` flag (a goal whose scorer didn't
  resolve gets no goal-map point; none seen in 214 goals). Look at that match's real event order,
  then give such goals a team fitted to it. Record: Review log round 4 in
  `docs/plans/2026-10-20-wp4b-match-extras.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a rule change that drops one goal and adds
  another in the same match (`rules-diff` shows goal values moved where the goal count didn't
  change). Goal rows are keyed by order, so equal counts look aligned. Then
  key goals by something stable (e.g. the GoalScored seq). Record: Review log round 3 in
  `docs/plans/2026-10-20-wp4c-a-rule-registry.md`.
