# WP5b-b review summary

Date: 2026-10-21. Full log: Review log in `docs/plans/2026-10-21-wp5b-b-harness-install.md`.

- Tier: Substantial (design tier; ~740 lines, a new e2e harness and install changes). 4 rounds.
- Round 1: code-review high, arch-reviewer (sonnet), security-reviewer, /simplify (4 angles).
  Round 2 (full, on the delta): code-review high, arch-reviewer, security-reviewer. Round 3:
  code-review high and medium, security-reviewer. Round 4: code-review low, clean.
- Fixed:
  - The e2e console-error check never listened (a fixture only `afterEach` asked for); once it did,
    it caught Chrome's favicon 404, fixed in the page with an empty icon.
  - A failed dashboard swap left the tracker stopped; install now restarts it and then reports the
    failure. A `web.old` left by a failed rollback is kept as the backup, not deleted.
  - Install leftover cleanup can no longer throw over the real outcome.
  - axe measured contrast mid-transition (reduced motion now on).
  - Harness: whole-tree kill on teardown timeout, temp dir removed on failure paths, spawn and
    stdin errors handled, timeouts ordered so the stack's diagnostics arrive first, the fixture's
    own timeout, output drained before reporting, a readiness fetch timeout.
  - `staticDir` narrowed to `string` (the null branch was dead).
  - /simplify: `freePort` shared in `src/server/testing.ts`; the stack reuses `requestStop`.
- Verified, no fix: the hidden h1s in the placeholder pages (WP6a replaces them); `staticDir` from
  the data dir; stack cleanup for throws with no real failure path (upheld twice, settled).
- Skipped from /simplify, each with a reason in the log: parallel install builds, the second vite
  build in `deploy`, the swap rollback, the APPDATA guard, the two-level timeouts.
- Deferred → BACKLOG: a failed exe replace after the stop leaves the tracker stopped (older than
  this change).
- Security: no findings in any round.
- Live: forced dashboard-swap failure (a held file) and the `web.old` recovery, both on the real
  install.
