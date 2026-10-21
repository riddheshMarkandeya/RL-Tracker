# WP4c-a Rule registry and rules-diff — review

Plan and full per-finding log: `docs/plans/2026-10-20-wp4c-a-rule-registry.md` (Review log).

- **Passes**:
  - Round 1: code-review high, arch-reviewer (sonnet), security-reviewer and /simplify.
  - Rounds 2–9: code-review high and security on each delta, plus arch-reviewer where its
    findings were fixed (rounds 3–7).
- **Outcome**: 9 rounds, no security findings in any of them. About 60 findings, nearly all
  fixed. Round 9 had only comment nits, which close a round.
  - Deferred to BACKLOG (Watch list): a goal dropped and another added in the same match look
    aligned by `idx`.
  - Deferred, then dropped: a test that every non-key column has an owning rule. The two-level
    decision below makes `outputs` best-effort, and an unowned column's move now raises the
    per-match WARNING anyway.
- **What mattered**:
  - **Bump check** (rounds 1–4): every round found another rule whose hand-listed `outputs`
    missed a column, which gave a false "bump missing" warning. It went to the user under the
    stop rule. After a look at Dagster's code versions and dbt CI data diffs (Datafold, Recce),
    the user chose **two levels**. A WARNING when a match changed while no rule changed version
    (it can't false-alarm). A `review:` line when a moved column's listed rules weren't bumped.
  - **Round 5 → 6 reversal**: round 5 stopped counting an added or removed rule as a version
    change. Round 6 showed this made a WARNING nothing could clear, so it was reverted. Any
    version change in a match clears its WARNING, because every match shares the registry.
  - **Positional rows** (round 2, user's "decide"): a match whose goal rows were added or
    dropped is a row-level change, and its goal values aren't compared column by column.
  - **List order** (rounds 6–8): three rounds fixed one list at a time. It was fixed once at the
    source: `keyed()` reads every table in key order.
  - **Read-only open**: `openDb({ readonly })` leaves the deployed DBs byte-identical (empty
    `-shm`/`-wal` files can appear). `immutable` was rejected because of torn reads while the
    tracker writes.
- **Follow-up guards** (3 more rounds, user-approved): one bump clears every match's WARNING, so
  it can hide another rule's unbumped change. A dependency graph was weighed and not taken.
  Instead: `constant-pins.json` ties each rule's constants to its version (a changed, unlisted or
  renamed constant without a bump fails check), a moved column no rule lists always gets a
  `review:` line, and the flow says one rule per rules-diff run. Round 1 made unlisting free;
  round 2 showed that let a value past the pin, so only a newly listed constant is free.
- **Held throughout**: the 46-match scratch dir gave "no change" after every round. The deployed
  dir gave "no change" before and after deploy (13 matches, migration 4 applied). A throwaway
  `AERIAL_MIN_Z` 550 → 500 moved `aerial_touches` in 48 rows and warned on 31 matches. Bumping
  `aerial_touch` cleared the warning. The change was reverted.
- **Process notes**: the deploy's check step once failed in `host.test.ts`, which this change
  doesn't touch, because a 0 ms shutdown timer raced the client's fetch under parallel workers.
  The cause is added to the existing flaky-test BACKLOG item; the retry passed.
