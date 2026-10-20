# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[feature, High, Substantial]** v1 roadmap: `docs/plans/2026-10-16-v1-roadmap.md`. Next:
  the milestone after WP4a (install autostart and play normally), then WP5a Query logic and API
  (start in plan mode). After the WP4b commit: restart the tracker (`bun run stop`, then sign in
  again or start it by hand) and run `bun run recompute` to backfill the extras.
  - WP3a's manual check still open: Ctrl+C on `bun run start` mid-match should end `tracker.log`
    with `app/stopped` (Git Bash can't send a console SIGINT). The shutdown endpoint path is
    covered by `src/server/main.test.ts`.
  - WP3b's manual check still open: sign out and back in, and the tracker should autostart
    (`supervisor/started`, then `app/started`).
- [ ] **[design, Med, Trivial]** The "no data" toast is suppressed over the full-screen game and
  only waits in the notification panel. (Its body now names the ini problem to fix.) WP5's status
  display is the reliable signal (`statsConfig()` carries the same diagnosis); WP8 (toast
  switch) decides whether to try an urgent/priority toast. Record: Verification results in
  `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[performance, Med, Standard]** The tracker's working set peaked at 108–111 MB in the three
  10× replay runs made with Rocket League open, against the user's 100 MB threshold (WP3b decision
  4). It's one ~75 MB step at replay start, then flat, while private bytes barely moved: likely
  shared or file-backed pages, not heap. Next: measure private bytes vs shared WS in a real match.
  Record: "Footprint" in `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[test-coverage, Med, Standard]** `src/server/main.test.ts` is flaky: 1 of 4 `bun run check`
  runs on 2026-10-20 failed one of its process tests. One run failed "a second instance exits 3…"
  with a `JSON Parse error: Unexpected EOF`; another failed "shutdown with the header answers 202
  first…". The file has been unchanged since WP3b, and the failures look like timing between spawn
  and HTTP. Found while closing the WP4b review.
- [ ] **[refactor, Low, Standard]** `scripts/capture.ts` keeps its own envelope parse
  (`eventNameOf`/`matchGuidOf`), hardcoded URL and reconnect loop; reuse `parseFrame`,
  `statsApiUrl` and maybe `startStatsClient`, or retire it now the recorder stores raw events.
  Record: Review log in `docs/plans/2026-10-19-wp3a-recorder.md`.

## Watch list
- [ ] **[design, Low, Standard]** Match records treat only team 0 and 1 as real teams (user's
  choice). Knockout (playlist 54, an 8-player free-for-all) may number teams per player, and then
  its players would get no team and no result. Trigger: a captured Knockout match → check its
  `TeamNum`s and decide. Record: Review log round 6 in
  `docs/plans/2026-10-20-wp4a-match-records.md`.
- [ ] **[bug (latent), Low, Standard]** A match whose close marker failed to store is never closed,
  so recompute skips it on every run. Trigger: a real `records/recompute_skipped` with reason
  `open` at warn → let recompute close it (as `restart`) or add a manual close. Record: Review log
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
