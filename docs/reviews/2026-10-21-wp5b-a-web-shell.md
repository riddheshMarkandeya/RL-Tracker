# WP5b-a review summary

Date: 2026-10-21. Full log: Review log in `docs/plans/2026-10-21-wp5b-a-web-shell.md`.

- Tier: Substantial (design tier; ~1,275 lines, a new web stack). 3 rounds.
- Round 1: code-review high, arch-reviewer (sonnet), security-reviewer, /simplify (4 angles).
  Rounds 2 and 3 (delta): code-review low, arch-reviewer (sonnet), security-reviewer.
- Fixed:
  - API failures that left no log or a raw error: no answer, a non-JSON 2xx, a timeout while
    reading the body.
  - Requests without a timeout.
  - Retries of 4xx and schema failures.
  - Header confirms:
    - focus fell to the page after a send;
    - Yes stayed live after the action became unavailable;
    - no announcement after Start new session;
    - both actions stayed live after Quit or with the tracker down.
  - A double sessions refetch in the clicking tab.
  - A second stream if the SharedWorker errored twice.
  - Duplicated hub wiring.
  - The `check` script repeating the others.
- Verified, no fix: `ConfirmButton` using the header stylesheet (it is a header action).
- Skipped from /simplify, each with a reason in the log:
  - `css: true` against `readFileSync`;
  - a server-side "stopped" signal;
  - pruning hub ports;
  - a shared backoff helper;
  - status dedupe.
- Deferred → BACKLOG: narrowing `match_ended`'s invalidate once WP6a adds heavy queries.
- Security: no findings in any round.
- Live: a Chrome re-check after round 1 (keyboard Start, cancel on tracker loss, Quit).
