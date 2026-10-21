# WP4c-b Retention split — review

Plan and full per-finding log: `docs/plans/2026-10-20-wp4c-b-retention-split.md` (Review log).

- **Passes**:
  - Round 1: code-review high, arch-reviewer (sonnet), security-reviewer and /simplify.
  - Round 2 (delta only): code-review low, arch-reviewer (sonnet) and security-reviewer.
- **Outcome**: 2 rounds, no security findings. Round 1 had 16 findings plus the /simplify ones.
  7 were fixed, 1 was deferred, and the rest were verified with the reason logged. Round 2 had
  only two wording nits, which close a round.
  - Deferred to BACKLOG (Watch list): flagged matches stay whole forever, including expected
    flags such as `camera_on_roster` on a spectated match. That was the user's decision 3. The
    watch item has a size trigger.
  - Deferred to BACKLOG by the user: /simplify altitude #1, verify before deleting. Rebuild the
    record from the kept events plus the snapshot, and keep the match whole on any difference.
    Due before mid-January 2027.
- **What mattered**:
  - **A dense rule newer than the snapshot** (code-review and arch, round 1): its outputs would
    read null on older thinned matches, with no flag. The snapshot now stores `denseRules`, and
    `thinned_snapshot_covers_dense` flags any dense rule missing from it.
  - **`events_ts` index**: only the time-based delete used it. Migration 2 hadn't shipped yet,
    so the drop went into migration 2 rather than a new migration.
  - **Exempt re-checks** run only on a rule-version change, so a check fixed without a bump
    leaves its matches whole. This fails safe; the ADR records it.
- **Held throughout**: the 46-match check gave the same result before and after review: 45
  thinned, 1 exempt, 1 lobby; raw.db 98.1 → 27.3 MB; at most 97 ms per match; rules-diff "no
  change". The final run was on a copy reset to raw migration 1. After deploy, the live raw.db
  migrated 1 → 2 and rules-diff over 13 matches gave "no change".
