# WP8a review summary

Date: 2026-10-28. The full log is in the Review log of `docs/plans/2026-10-28-wp8a-settings.md`.

- Tier: Substantial (design tier; ~660 non-test lines). Three rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Round 2 (delta from `e8c4246`) ran code-review low, arch-reviewer (sonnet) and security-reviewer.
  Round 3 (delta from `6a86731`) ran code-review low and security-reviewer. Security found nothing
  in any round.
- Fixed:
  - The rolling-window field kept focus after a save, reverts on a failed save, and resyncs only
    when the stored settings change.
  - Settings saves run one at a time, so an older answer can't overwrite a newer one.
  - A failed settings load no longer holds the app on "Loading" through retries.
  - A match no longer refetches settings.
  - The Trends chart takes the window from the page; one group filter list; one window default.
- Escalated to the user: an invalid window draft resets when another setting saves (the third
  finding on the draft's sync). Recommended: keep it.
- Verified, no fix needed: a duplicate idempotent POST on Enter + blur; the app's first-load gate;
  a whole-period refetch on a window change; and the /simplify judgment calls listed in the log.
