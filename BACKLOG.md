# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[feature, High, Substantial]** v1 roadmap: `docs/plans/2026-10-16-v1-roadmap.md`. Next:
  WP3a Recorder (start in plan mode).
  - WP3a: read `docs/research/2026-10-19-weekend-captures.md` first (findings plus the user's
    requirements: built-in dedup, stat checks, declarative design).
  - WP3a: captures from `scripts/capture.ts` are already sampled to ~2.4 UpdateState/s
    (one per 500 ms plus the latest one before each event); when importing, sample on the
    file's `t`, not wall clock.
- [ ] **[design, High, Standard]** WP3b open decision: crash restart and a hidden window. Task
  Scheduler doesn't restart a task that crashes after launching (tested, see
  `docs/decisions/2026-10-16-bun-runtime.md`), so a mid-session crash silently stops recording
  until the next logon. Choose a supervising wrapper loop (recommended: restart in seconds with
  backoff, logs each restart, can also launch hidden) or a repeating trigger with "don't start a
  new instance". Also hide `bun.exe`'s console (`--windows-hide-console` or the wrapper).

## Watch list
- [ ] **[bug (latent), Low, Trivial]** Windows antivirus may hold a fresh backup `.partial` and
  fail its rename (EPERM/EBUSY), aborting a pre-migration startup. Trigger: a real
  `backup/failed` on the rename → retry it briefly. Record: Review log round 3 #8 in
  `docs/plans/2026-10-16-wp2-storage.md`.
