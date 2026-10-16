# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[feature, High, Substantial]** v1 roadmap: `docs/plans/2026-10-16-v1-roadmap.md`. Next:
  WP1 Foundations (start in plan mode).
  - WP3a: captures from `scripts/capture.ts` are already sampled to ~2.4 UpdateState/s
    (one per 500 ms plus the latest one before each event); when importing, sample on the
    file's `t`, not wall clock.
