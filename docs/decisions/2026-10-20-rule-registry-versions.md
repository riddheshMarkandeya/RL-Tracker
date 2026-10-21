# One rule registry; each match stores the rule versions it was computed under

Date: 2026-10-20

## Context
The stat rules are our own reading of the Stats API. Before this change their current form lived
only in code, and the reasoning was spread over ADRs, plan review logs and the roadmap. Two of
WP4b's rules were written down only in its review log. WP5a–WP7 will add a dozen more rules, and
recompute can silently change stored stats when a rule changes. The full plan, its review and the
review log are in `docs/plans/2026-10-20-wp4c-a-rule-registry.md`.

## Decision
1. **`src/server/rules/registry.ts` is the single current source** for every stat rule: its text,
   the real exported constants, the checks that guard it, evidence, a version, when it applies
   (stored / recorded / read), the columns it writes, and history refs.
   - `docs/definitions.md` is generated from the registry, and a test fails when it is stale.
   - Plans and ADRs are dated history.
2. **Per-match rule versions are a JSON map** `{ruleId: version}` in `matches.rule_versions`
   (tracker migration 4). This was the user's choice over one ruleset integer. It holds only
   "recorded" rules; stored and read rules can't differ between matches. A null map means
   before WP4c.
3. **`bun run rules-diff`** recomputes every match into a scratch DB and compares it with the
   stored records.
   - It opens the data dir's DBs read-only, never through `openStorage`.
   - Only `rules/diff_*` lines reach the normal log.
4. **Two-level bump check** (user's choice, after a stop-rule escalation):
   - **WARNING**: a match whose stored values, flags or rows changed while no rule changed
     version, was added or was removed. The full list goes to the log.
   - **`review:` line**: a moved column whose listed rules weren't bumped. `outputs` are
     best-effort, so this is a prompt to look, not an error.
5. **Guards for a bump hiding another change**: one bump clears every match's WARNING.
   - `constant-pins.json` ties each rule's constants to its version. A constant changed,
     unlisted or renamed at the pinned version fails `bun run check`, and `bun run definitions`
     refuses.
   - A moved column no rule lists always gets a `review:` line.
   - The flow says to change one rule per rules-diff run.
   - A dependency graph was weighed and not taken: most rules feed shared steps, so it would
     rarely separate the hidden change, and it needs a larger hand-kept list.
6. **Positional rows**: a match whose goal rows (keyed by `idx`) were added or dropped counts as
   changed, and its goal values aren't compared column by column.

## Why
- **The map over one integer**: a later change (WP4c-b freezing car stats for thinned matches)
  needs to say which rules a match's numbers rest on, rule by rule.
- **Two levels**: rules feed each other (`aerial_touches` reads five), so a hand-listed owner set
  was never complete. Four review rounds each found another gap, each producing a false warning.
  Dagster versions code and propagates staleness through the graph. dbt CI tools (Datafold,
  Recce) make the data diff the artefact and use lineage only to narrow it. Here the per-match
  check needs no lineage, so it can't false-alarm; lineage only scopes the soft lines.

## Files touched
- `src/server/rules/{registry,definitions}.ts` and their tests.
- `src/server/records/rules-diff.ts` and its test.
- `scripts/{definitions,rules-diff}.ts`.
- `src/server/db/{migrations,sqlite}.ts`.
- `src/server/records/{record,save}.ts`.
- The exported constants in the recorder and in `src/shared/goal-range.ts`.
- `docs/definitions.md`.

## Verification
- `bun run check`: 474 tests.
- 46 real matches: no change.
- A throwaway constant change warned, and the warning cleared once the rule was bumped.
- The deployed dir gave no change before and after deploy.

## Related
- `docs/reviews/2026-10-20-wp4c-a-rule-registry.md`
- `docs/decisions/2026-10-20-match-extras-play-view.md`
- `docs/plans/2026-10-16-v1-roadmap.md` (WP4c-b retention)
