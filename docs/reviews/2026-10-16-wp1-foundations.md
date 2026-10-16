# WP1 Foundations — review

Plan and full per-finding log: `docs/plans/2026-10-16-wp1-foundations.md` (Review log).

- **Passes**: round 1 ran code-review high, arch-reviewer (sonnet), security-reviewer and
  /simplify. Round 2 reviewed only the delta from snapshot `a54c9bf`, with code-review low,
  arch-reviewer and security-reviewer.
- **Outcome**: 2 rounds. Round 1 fixed 10 code-review findings and 4 arch doc nits, plus one
  /simplify edit. Round 2 fixed docs and comment nits only. Nothing deferred or disputed.
- **What mattered**: the logger's rotation could drop lines and delete rotated history when a
  rename failed, for example on a locked file. Rotation now fills the first free slot and keeps
  the line. Errors keep their `code`/`cause`, caller fields can't overwrite the logger's keys,
  and console pipe errors can't crash the process.
- **Skipped on purpose** (they would reverse recorded decisions): having capture.ts reuse the
  logger or the port constant (it stays standalone), dropping the multi-process rotation guard
  (from plan review finding 3), and replacing the import-time `log` instance.
- **Open**: the user should press Ctrl+C on the edited capture.ts and check the log for
  `shutdown`.
