# WP8b review summary

Date: 2026-10-28. The full log is in the Review log of `docs/plans/2026-10-28-wp8b-settings-tables.md`.

- Tier: Substantial (design tier; ~800 non-test lines). Two rounds.
- Round 1 ran code-review high, arch-reviewer (opus), security-reviewer and /simplify (4 angles).
  Round 2 (delta from `f4ee442`) ran code-review low, arch-reviewer (sonnet) and security-reviewer.
  Security found nothing in either round.
- Fixed:
  - The Seasons editor's races (a late save or delete landing on a row edited since, a double
    Delete, a Retry clickable while its retry was in flight): every table action now waits while
    a save or delete is pending.
  - Name clashes fold only A-Z, as SQLite's NOCASE does, so the form never refuses a name the
    server would take.
  - `ids/unknown_platform` is warned once per prefix per run, not on every list read.
  - A field's error clears once it changes; a section link never writes a hash.
  - One write header and one whole-answer write hook for settings, ids and seasons; a table write
    no longer refetches the other table.
- Verified, no fix needed: stored remark picks keep their band after an id's answer (the plan's
  cache decision), and the /simplify judgment calls listed in the log.
- Nothing deferred or disputed.
