# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[feature, High, Substantial]** v1 roadmap: `docs/plans/2026-10-16-v1-roadmap.md`. Next:
  WP3b Background process (start in plan mode).
  - WP3b: wire `recorder.isRecording` into `scheduleMaintenance` and the HTTP host; the
    "Stats API off" state needs process detection (roadmap WP3b notes).
  - WP3a's manual check still open: Ctrl+C on `bun run start` mid-match should end `tracker.log`
    with `app/stopped` (Git Bash can't send a console SIGINT).
- [ ] **[design, High, Standard]** WP3b open decision: crash restart and a hidden window. Task
  Scheduler doesn't restart a task that crashes after launching (tested, see
  `docs/decisions/2026-10-16-bun-runtime.md`), so a mid-session crash silently stops recording
  until the next logon. Choose a supervising wrapper loop (recommended: restart in seconds with
  backoff, logs each restart, can also launch hidden) or a repeating trigger with "don't start a
  new instance". Also hide `bun.exe`'s console (`--windows-hide-console` or the wrapper).

- [ ] **[refactor, Low, Standard]** `scripts/capture.ts` keeps its own envelope parse
  (`eventNameOf`/`matchGuidOf`), hardcoded URL and reconnect loop; reuse `parseFrame`,
  `statsApiUrl` and maybe `startStatsClient`, or retire it now the recorder stores raw events.
  Record: Review log in `docs/plans/2026-10-19-wp3a-recorder.md`.
- [ ] **[performance, Low, Trivial]** `Db.run` re-prepares its statement on every call and raw.db
  runs WAL with `synchronous=FULL`, so each stored event fsyncs on the socket thread. Use cached
  statements (`db.query(sql).run`) and `PRAGMA synchronous = NORMAL` for raw.db; measure in WP3b's
  footprint check. Record: Review log in `docs/plans/2026-10-19-wp3a-recorder.md`.

## Watch list
- [ ] **[bug (latent), Low, Trivial]** Windows antivirus may hold a fresh backup `.partial` and
  fail its rename (EPERM/EBUSY), aborting a pre-migration startup. Trigger: a real
  `backup/failed` on the rename → retry it briefly. Record: Review log round 3 #8 in
  `docs/plans/2026-10-16-wp2-storage.md`.
