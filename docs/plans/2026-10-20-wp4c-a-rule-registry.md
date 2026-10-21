# WP4c-a: Rule registry, generated definitions, per-match rule versions, `rules-diff`

## Context
Roadmap WP4c (`docs/plans/2026-10-16-v1-roadmap.md`). The stat rules are our own reading of the
game's data, and their current form lives only in code, with the reasoning spread over write-once
ADRs, plan Review logs and the roadmap. Two WP4b rules exist only in its Review log (the last-touch
comparison "only when both sides are known", rounds 7–9; `resolveRef`'s attribution, rounds 9–10).
WP5a–WP7 add a dozen more rules, so a single current source and a way to see a rule change's effect
come first.

**Split (user's choice, 2026-10-20)**: WP4c is ~1,200 lines with tests, so it splits:
- **WP4c-a (this plan)**: the registry, `docs/definitions.md` generated from it, a per-match rule
  version map, `bun run rules-diff`.
- **WP4c-b (next)**: the retention split. It must ship before the first captured matches leave the
  90-day window (mid-January 2027). Its decisions are already made (below) and go into the roadmap
  at step 1, so b's plan starts from them.

## User decisions (2026-10-20)
1. Split a/b as above.
2. **WP4c-b thinning: change-only.** After 90 days, an `UpdateState` is dropped only when it changes
   nothing the scoreboard rules read: players' Name/PrimaryId/Shortcut/TeamNum and scoreboard
   stats, the teams' scores (or that the scoreboard is missing), PlaylistId, Arena, bOvertime, and
   a clock reading not already the running clock (from any event). The first and last states stay.
   Kept states stay byte-for-byte. Measured on the live raw.db (13 matches): 1,807 of 13,080 states
   kept, ~1,470 → ~247 KB per match.
3. **WP4c-b dense outputs: snapshot in raw.db.** Thinning runs `readMatch` on the full raw first
   and stores the outputs thinned raw can't support (the four car stats, the camera key) in a raw.db
   table; recompute of a thinned match substitutes them before the checks. Recompute and rules-diff
   keep needing only raw.db. Flag exemption is decided by that same `readMatch` (flagged under
   current rules → not thinned), so retention doesn't read tracker.db either.
4. **Per-match rule versions: a JSON map** `{ruleId: version}` of the record-time rules, not one
   ruleset integer.

## Rules and constraints that bind this plan
- Project `CLAUDE.md` "Data shapes we haven't seen": flag-and-wait, no invented handling.
- Global §1 comments: no doc paths in code comments. The registry's `refs` are data, rendered into
  the doc and checked by a test, so they can't go stale silently.
- Roadmap cross-cutting: dev tooling (registry doc, rules-diff) stays out of the app; strict TS and
  ESLint; migrations append-only (`src/server/db/migrations.ts`).

## Approach

### 1. Registry: `src/server/rules/registry.ts` (new, data + types)
```ts
type Applied = "stored" | "recorded" | "read"; // fixed at write; at match end (recompute reaches it); at read time
interface Rule {
  id: string;            // snake_case, stable, unique
  area: "recording" | "match" | "attribution" | "extras" | "goals" | "identity";
  rule: string;          // one line
  constants?: Record<string, number>; // the real exported values, not copies
  checks: readonly string[];          // CHECK_IDS that guard it
  evidence: string;      // what it rests on, with figures
  version: number;       // starts at 1
  applied: Applied;
  outputs?: readonly string[]; // stored columns it writes, "table.column"
  refs: readonly string[];     // ADR / plan paths where it was decided (history)
}
export const RULES: readonly Rule[]
export const RECORDED_RULE_VERSIONS: Record<string, number> // applied === "recorded" only
```
- `applied` keeps "stored" rules (sampling, loadout-once, menu states, match attribution) and "read"
  rules (playlist map, `resultFor`, `goalRange`) out of the per-match map: recompute can't change
  the former, and the latter always use the current version.
- Constants: export the module-private ones the registry names (`AERIAL_MIN_Z`, `WALL_MARGIN`,
  `CORNER_MAX_XY_SUM`, `HARDEST_SHOT_MAX_KMH` in `extras.ts`; `TOUCH_MERGE_MS`,
  `WOODWORK_WINDOW_MS` in `play.ts`; `CAMERA_SHARE` in `summary.ts`; the sampler interval; the
  goal-range thresholds). `checks.ts` exports `CHECK_IDS`.
- **Backfill** (~40 entries), from the code and these sources:
  - WP3a (`2026-10-19-recorder-websocket-raw-store.md`, WP3a plan): UpdateState sampling, loadout
    once, menu states dropped (stored); the lifecycle and close rules (stored): the open match owns
    every event until a `MatchDestroyed`, whatever guid it carries; a `MatchCreated` with another
    guid supersedes it; the orphan timeout (`ORPHAN_TIMEOUT_MS`); the close causes destroyed /
    timeout / restart / superseded that set `closed_via` and feed left vs orphaned; recompute's
    "only the latest match can still be open" (recorded); lobby gets no record; the three dedup
    rules (`replay_goal`, `repeat_crossbar`, `repeat_ballhit`).
  - WP4a (`2026-10-20-match-records-per-player.md`, WP4a plan + Review log): player key, real teams
    only, roster / teams_seen / present_at_end, score (last full scoreboard), end kind (clock rule),
    joined in progress, winner (MatchEnded, else decided), your result (read), MVP (statfeed, else
    inferred, tie none), final player stats (max after MatchEnded), target resolution
    (`resolveTarget`), camera identity (95% share), pending guess, playlist map (read).
  - WP4b (`2026-10-20-match-extras-play-view.md`, WP4b plan + Review log): live-play window,
    every `Players` entry a hitter, touch merge, hardest shot, aerial touch, woodwork, car sampling
    and the four car stats, goal origin, deflected, own goal (needs a seen kickoff), aerial goal
    (pending `AerialGoal`, cleared at kickoff), goal distance, goal speed, unresolved scorer
    dropped, **last-touch comparison** (rounds 7–9: compare only when the last touch and every last
    hitter resolve, or no hit since a seen kickoff; the last hit names ≥ 1 hitter), **reference
    resolution** (`resolveRef`, rounds 9–10: a non-object reference is missing and uncounted; an
    off-roster player object counts under its kind; a hit's non-object entry counts as an
    unidentified hitter), goal range (read).

### 2. Generated doc: `src/server/rules/definitions.ts` + `scripts/definitions.ts`
- `renderDefinitions(rules): string` (pure): a header ("generated, don't edit; the current source;
  plans, ADRs and reviews are dated history"), the rule-change flow (edit entry + bump version →
  `bun run rules-diff` → ADR if past the gate → `bun run definitions` → `bun run deploy`), then one
  section per area, one block per rule (id, version, when applied, rule, constants, checks, outputs,
  evidence, refs).
- `bun run definitions` writes `docs/definitions.md`.
- `src/server/rules/registry.test.ts`:
  - the file equals `renderDefinitions(RULES)` (CRLF-normalised), else "run `bun run definitions`";
  - ids unique and snake_case; versions ≥ 1;
  - every `checks` id is in `CHECK_IDS`, and every `CHECK_IDS` entry guards at least one rule
    (a new check must say what it guards);
  - every `PLAYER_EXTRAS` column is in some rule's `outputs` (a new stat needs a rule);
  - every `refs` path exists.

### 3. Per-match rule versions: tracker migration 4
- `ALTER TABLE matches ADD COLUMN rule_versions TEXT; -- JSON {ruleId: version} of the rules it was computed under; null before WP4c`.
  (Roadmap called it `rules_version`; the map was the user's choice.)
- `MatchRow.ruleVersions` set by `toRecord` from `RECORDED_RULE_VERSIONS` (so WP4c-b can override it
  for a thinned match's frozen car rules); `save.ts`'s upsert writes it. `recompute` refreshes it.

### 4. `bun run rules-diff`: `src/server/records/rules-diff.ts` + `scripts/rules-diff.ts`
- `openDb` gains `readonly: true`: `new Database(path, { readonly: true, strict: true })` with no
  `create`, then busy timeout only (no WAL switch, `foreign_keys`, `auto_vacuum` or `synchronous`).
  The script opens the data dir's `raw.db` and `tracker.db` that way and never goes through
  `openStorage`, so there's no backup, migration or write on the deployed DBs.
- A scratch dir from `mkdtemp(os.tmpdir())` holds a `tracker.db` migrated to the working tree's
  schema, filled by the existing `recomputeAll({ raw, tracker: scratch, logger: scratchLogger })`.
  `my_ids` isn't seeded or diffed: it only changes the pending-guess side effect.
- **Logs**: recompute, the writer and the scratch migration log through `createLogger({ dir:
  scratch })`, so no line about the scratch DB lands in the deployed `tracker.log`. Only
  `rules/diff_*` go to the normal log. On a failed recompute the scratch dir is kept and its path
  printed and logged; otherwise the DBs are closed first, then the dir removed (a failed removal is
  a warning, not a failed run).
- Seam: `runRulesDiff({ dir, logger }): Report` in `rules-diff.ts`; the script only prints it.
- `diffRecords(base, next): RecordsDiff` (pure over two Dbs):
  - keyed rows of `matches` (guid), `match_players` (guid, player_key), `match_goals` (guid, idx),
    `match_player_statfeed` (guid, player_key, event_name), over the columns both schemas have;
  - per column: rows moved; for numbers also max |Δ| and mean Δ; rows only in one side;
  - `check_flags`: per flag id, matches gaining and losing it;
  - `rule_versions`: which rules' versions differ (expected, reported apart from "moved");
  - **bump guard**: several rules can feed one column (`aerial_touches` reads the play window,
    hitters, touch merge, `resolveRef` and the aerial rule), so `outputs` lists the rules that
    *write* it, and a moved column warns only when **none** of its writing rules has a version
    different from the base row's map. A moved column no rule writes is reported apart ("moved,
    no owning rule"). A base row with a null map (before migration 4) has unknown versions: no
    warning;
  - matches in base that recompute skipped (open / lobby / trimmed), and base guids with no raw
    rows at all (WP4c-b and later), are listed as kept, not as missing.
- The script prints a table and exits 1 on a failed recompute; "no change" when nothing moved.

### Logging (what each log answers)
- `rules/diff_started {dir, matches}`: which data dir and how many matches it ran against.
- `rules/diff_done {recomputed, skipped, failed, moved: {column: n}, warnings, scratchLog, ms}`:
  what moved, whether any rule needs a bump, and where the per-match `recompute_failed` lines are
  (the kept scratch dir's log).
- Read-only open failure (no raw.db): logged `rules/diff_failed {dir, err}`, message, exit 1.

## Files
- New: `src/server/rules/{registry,definitions}.ts`, `src/server/rules/registry.test.ts`,
  `src/server/records/rules-diff.ts` (+ test), `scripts/{definitions,rules-diff}.ts`,
  `docs/definitions.md` (generated).
- Changed: `src/server/recorder/{checks,extras,play,summary,sampler}.ts` (exports only),
  `src/shared/goal-range.ts` (exports), `src/server/db/{sqlite,migrations}.ts`,
  `src/server/records/{record,save}.ts`, `package.json` (two scripts), roadmap, PROJECT_INDEX,
  BACKLOG.

## Steps
1. Save this plan to `docs/plans/2026-10-20-wp4c-a-rule-registry.md`; split the roadmap's WP4c into
   WP4c-a / WP4c-b, assigning every bullet:
   - **WP4c-a**: registry + backfill, generated doc and its sync test, rule-change flow, per-match
     rule versions, rules-diff and its test, "no change against the deployed DB".
   - **WP4c-b**: retention split (decisions 2–3 and the measurement), flagged matches exempt and
     kept as the rule corpus, the thinning test on a seeded raw DB, "thinned recompute equals full
     except dense outputs", the 46-match identical-from-thinned check. Plus the review's notes:
     "changes nothing" compares with the previous *original* state; `Teams` absent vs incomplete
     are told apart; `rejectedScoreboards` and `cameraTargets` counts change but no flag can,
     since a positive count means the match is flagged and so not thinned.
2. Exports (constants, `CHECK_IDS`); `bun run check` green.
3. TDD the registry tests (red on an empty `RULES`), then the backfill until green.
4. TDD `renderDefinitions`; `bun run definitions`; the sync test green.
5. Migration 4 + `ruleVersions` in record/save: tests first (record carries the map; save writes
   it; recompute refreshes it; migrate test sees the column).
6. `openDb({ readonly })`: a WAL DB written and closed (no `-shm` left) opens read-only, `get`
   works, `run` throws.
7. TDD `diffRecords` on two seeded temp trackers: identical → no change; one moved extra →
   column, count, Δ; a flag gained; a row only in one side; bump guard: warns with no writing rule
   bumped, silent when one of several writers is bumped, silent on a null base map; a moved
   unowned column reported apart; a column missing from the base schema is skipped.
8. `runRulesDiff` end-to-end test: fixtures imported into a temp data dir → no change and nothing
   written to that dir's log but `rules/diff_*`; then a record value edited in its tracker.db →
   reported. (A real rule change moving a stat is checked by hand in Verification: the tests seed
   stored values instead of swapping rule code.)
9. Real data (Verification). Midpoint `/compact` line offered after step 5.
10. `bun run check` green → stop for `/compact` → `independent-review-pass`.
11. Docs after review: roadmap status, PROJECT_INDEX (rules/, definitions, rules-diff, flow),
    BACKLOG next item → WP4c-b; commit when asked.

## Verification
- `bun run check` green.
- 46-match import into a scratch data dir (`RLTRACKER_DATA_DIR`), `bun run rules-diff` there: no
  change. Then a throwaway edit (`AERIAL_MIN_Z` 550 → 500, not committed): rules-diff reports
  `match_players.aerial_touches` moved, with the bump warning for the aerial rule; with its
  version bumped, the warning goes and `rule_versions` shows the change. Revert.
- `bun run rules-diff` against the deployed data dir before deploy: no change on the shared
  columns (the deployed schema has no `rule_versions` yet, so it's skipped). After
  `bun run deploy`: no change (done criterion).
- `docs/definitions.md` read through once for every current rule.

## Plan review
plan-reviewer (opus), 2026-10-20. Verdict: fits; fix four items before building. WP4c-b's
decisions hold against `summary.ts` / `play.ts`; the dense set (four car columns + camera key) is
complete.

| # | Finding | Disposition |
|---|---|---|
| 1 | rules-diff's recompute would log scratch writes into the deployed `tracker.log` | Fixed: scratch logger in the scratch dir; only `rules/diff_*` in the normal log (§4) |
| 2 | Bump guard undefined when several rules feed a column; unowned columns; null maps | Fixed: warn only when no writing rule was bumped; unowned reported apart; null map = unknown; tests in step 7 |
| 3 | Lifecycle and close rules missing from the backfill | Fixed: added to §1's WP3a list |
| 4 | `openDb({ readonly })` underspecified (`create`, pragmas) | Fixed: spelled out in §4; step 6 test on a closed WAL DB |
| 5 | A base match with no raw rows would show as missing | Fixed: listed as kept |
| 6 | Seeding `my_ids` is unneeded | Fixed: dropped |
| 7 | The roadmap's "two rule versions" test is manual only; e2e seam unnamed | Fixed: `runRulesDiff` seam; stated in step 8 |
| 8 | Roadmap split doesn't assign WP4c's tests and done-when | Fixed: step 1 assigns every bullet, plus the review's WP4c-b notes |
| 9 | Windows: close DBs before removing the scratch dir | Fixed: in §4 |

## Implementation notes (2026-10-20)

### Choices made while building
- 47 registry entries (12 recording, 13 match, 4 identity, 5 attribution, 5 extras, 8 goals).
  `outputs` only on `recorded` rules (a test enforces it, and that each names a real column),
  since only those versions are in the per-match map the bump guard reads.
- Extra registry tests beyond the plan: rule/evidence non-empty, every rule has a ref,
  `RECORDED_RULE_VERSIONS` equals the recorded rules. `definitions.test.ts` covers the renderer.
- `diffRecords(base, next, rules = RULES)` takes the rules so tests control the owners.
  `hasChanges` ignores rule versions alone. Columns no rule writes (`started_at`, `ended_at`,
  `closed_via`) are reported as "moved, no owning rule" if they ever move.
- `runRulesDiff` logs `rules/diff_failed {dir, scratchDir, err}` on an exception after the open
  too (scratch dir kept), and `rules/diff_cleanup_failed` (warn) when the removal fails.
- The scratch logger has `echo: false`, so recompute lines don't reach the terminal.

### Verification results
- `bun run check`: 459 tests green.
- 4 captures imported into a scratch data dir (46 matches, 1 lobby): `bun run rules-diff` →
  "no change"; no `recompute_*` line in that dir's `tracker.log`, only `rules/diff_*`.
- `AERIAL_MIN_Z` 550 → 500: `match_players.aerial_touches` moved in 48 rows (max |Δ| 3,
  mean Δ 1.21) with the bump warning naming its five writers; with `aerial_touch` at v2 the
  warning went and "rule versions changed: aerial_touch (46 matches)". Both reverted.
- Deployed data dir, before deploy: recomputed 13, "no change", 13 unversioned (schema 3). The
  DB files' sizes and mtimes were unchanged; `tracker.log` got only the two `rules/diff_*` lines.
- Pending: `bun run deploy`, then rules-diff on the deployed dir again (done criterion), after
  review.

## Review log

Diff re-classified at review: 22 files, ~1,370 lines, design tier Substantial → `/code-review
high`, `arch-reviewer` (sonnet), `security-reviewer`, `/simplify`. No project high-risk paths
(no `.claude/rules/`). Round-1 snapshot: `ed55a0a` (`git stash create`).

### Round 1
- **security-reviewer**: no findings (SQL identifiers are constants, writes only to the mkdtemp
  scratch dir, cleanup can't reach the data dir).
- **code-review high**:
  1. Recorded rules without `outputs` (the three dedup rules) can never clear the bump warning on
     the columns they move. [Fixed] dedup rules list their columns (`GOAL_ROW` for the replay
     goal); a test pins the recorded rules that legitimately have none (they decide which records
     exist, or only a flag).
  2. `goal_origin`, `own_goal`, `unresolved_scorer_dropped` omit columns they move. [Fixed]
     goal_origin adds distance/deflected; own_goal → `GOAL_POINT`; a dropped goal shifts later
     goals' idx → `GOAL_ROW`, and its rule text now says it gets no goal row.
  3. An exception left the scratch dir behind and the script blamed reading the data dir. [Fixed]
     The scratch dir is removed unless a match failed; the script says "failed against".
  4. A base schema missing a compared table threw. [Fixed] Its recomputed rows count as only in
     the recompute; test.
  5. A read-only open of a closed WAL DB leaves empty `-shm`/`-wal`. [Verified, no fix needed]
     Confirmed empirically; harmless (the tracker's own open makes them), and `immutable` would
     read torn pages while the tracker writes. Docs and the sqlite test now say so and assert the
     DB file is byte-identical and the WAL empty.
  6. `Math.max(...spread)` over every moved row. [Fixed] running max.
  7. A row with no `matches` row counted as unbumped. [Fixed] unknown, like a null map; test.
  8. Redundant I/O (raw guid scan, matches keyed twice). [Fixed] in `/simplify` (raw store's
     `matches()`, matches read once).
  9. Hard-coded `TABLES` can miss a new per-match table. [Fixed] test: every tracker table with a
     `match_guid` column (plus `matches`) is in `TABLES`.
  10. Doc paths in comments (registry header, definitions script). [Fixed]
- **arch-reviewer** (sonnet): 0 bugs, 3 risks, 4 nits, 1 q.
  - Doc paths in comments: same as code-review 10. [Fixed]
  - `reference_resolution` / `last_touch_comparison` evidence only pointed at review rounds.
    [Fixed] one sentence of why each.
  - `your_result` omitted "any other end has no result". [Fixed]
  - `diff_started` logged after the scratch setup. [Fixed] logged first.
  - Registry pulls `recorder/recorder.ts` into `record.ts`'s graph for one constant (q).
    [Verified, no fix needed] no cycle; the live tracker loads it anyway.
  - `rules-diff.ts` holds diff, orchestration and formatting (nit). [Verified, no fix needed]
    one dev tool, ~270 lines.
  - Row-level changes (a goal row appearing) aren't bump-checked. [Verified, no fix needed]
    reported as "only in …" and counted by `hasChanges`.
  - Non-extras columns aren't forced to have an owning rule. [Deferred → BACKLOG] (same as
    simplify-altitude below).
- **/simplify** (reuse, simplification, efficiency, altitude). Applied: `createRawStore().matches()`
  for the raw guids; scratch DB `synchronous: "normal"`; `diffRecords` keyed by plain guid (no
  JSON round-trip), per-column loop extracted to `moveOf` with running max/sum; one `diff_failed`
  site (open folded into the main try), `keepScratch` flag instead of a late `report`;
  `Area` derived from `AREAS as const`; goal_origin outputs derived from `GOAL_POINT`; one
  `new Database` call. Skipped: refs constants per WP (readability), `checks` optional (explicit
  empty = reviewed), car_sampling/car_stats merge (two real rules), area titles in the registry,
  copying the base DB to migrate it (copying a live WAL DB isn't safe), required `outputs` via a
  discriminated union (the pinned list does the job), SQL-side diffing (not needed at this
  scale). Deferred → BACKLOG: a test that every non-key column of the compared tables has an
  owning rule (needs owners for match metadata such as `started_at`, `closed_via`).
- `bun run check`: 40 files, 463 tests passed.

### Round 2 (delta vs `ed55a0a`)
- security-reviewer: no findings. arch-reviewer (sonnet): 0 bugs, 3 nits.
- code-review high: 8 findings.
  1. Goal rows were diffed per column keyed by idx, so any rule that adds or drops a goal
     (`target_resolution`, `real_teams_only`, `live_play_window`) shifted later goals and raised
     false bump warnings. Same issue as round-1 #1/#2, the second time: escalated, and the user
     asked for a decision. [Fixed] Chose the deeper fix: a match with a row on one side only of
     a child table is a row-level change (`reshaped`, printed as "rows added or dropped, values
     not compared"), and its rows there aren't compared or bump-checked. `GOAL_ROW` is gone; the
     rules that only drop goals list just `hardest_shot_kmh` (a dropped goal skips its shot).
     Test.
  2. `goal_origin` also moves `hardest_shot_kmh` and `own_goal`; a dropped goal moves
     `hardest_shot_kmh` (arch nit too). [Fixed]
  3. The scratch dir was kept, unprinted, after an exception that came after a failed match.
     [Fixed] kept only when the report is returned (which prints the path); removed on any
     exception.
  4. No test for the cleanup paths. [Fixed] a failed match keeps the dir with its
     `recompute_failed` line; an error after mkdtemp removes it.
  5. Script header stale. [Fixed]
  6. matches read twice per DB. [Fixed] keyed once, reused in the table loop.
  7. `moveOf` re-parsed `column` and took 6 args (arch nit too). [Fixed] takes the table's rows
     as one object, builds the column name, the warning uses `move.owners`.
- arch nit: "Settled in WP4b review rounds" remnants in two evidence strings. [Fixed] dropped.
- `bun run check`: 40 files, 466 tests passed. rules-diff on the 46-match scratch dir: no change.

### Round 3 (delta vs round-2 state; snapshot after it `bc64fcf`)
- security-reviewer: no findings. arch-reviewer (sonnet): 0 bugs, 3 nits. code-review high: 8.
  1. `reshaped` covered every child table, though only `match_goals` has a positional key; a
     player or statfeed row added skipped the whole match's values there. [Fixed] a
     `positional` flag on `TABLES` (match_goals only); test that a player row added keeps the
     others compared.
  2. `target_resolution` and `real_teams_only` also add/drop goals and pick the origin, yet
     didn't own `hardest_shot_kmh` or the goal point. [Fixed] both list `GOAL_POINT` and
     `hardest_shot_kmh`. Ownership is kept generous: an over-claim can only hide a warning for a
     rule that *was* bumped, an under-claim gives a false one.
  3. A rule change that drops one goal and adds another in the same match keeps the count and
     the keys, so later goals are compared shifted. [Deferred → BACKLOG Watch list] not seen;
     it shows as moved goal values with warnings in a dev tool's output, never in stored data.
  4. Test cleanup ran `rmSync("")` when `scratchDir` was null. [Fixed] guarded.
  5. A failed match is in `kept` and was labelled "skipped by recompute". [Fixed] "not
     recomputed (skipped or failed)".
  6. A match new in the recompute counted as reshaped. [Fixed] only matches on both sides (arch
     nit too); same test as 1.
  7. `runRulesDiff` doc said it throws only on open. [Fixed]
  8. Script header vs module header on the WAL side files. [Fixed] (arch nit: line length too.)
- arch nit: `unresolved_scorer_dropped` evidence still pointed at review rounds. [Fixed] reason
  in its own words.
- `bun run check`: 40 files, 467 tests passed. Snapshot after round 3: `0fa06ab44af20d95359469d311d4bf65a1e310ba`.

### Round 4 (delta vs `bc64fcf`)
- security-reviewer: no findings. arch-reviewer (sonnet): no findings. code-review high: 5.
  1. `real_teams_only` also moves `winner_source`, `mvp_key`, `mvp_source`; `winner` also moves
     the MVP. [Fixed]
  2. `target_resolution` also moves `match_goals.aerial`. [Fixed]
  3. `TableRows.reshaped` doc stale. [Fixed]
  4. `positional` set by hand. [Fixed] derived from an `idx` key column.
  5. No test for a dropped goal. [Fixed]
- `bun run check`: 40 files, 468 tests passed.
- **Escalated to the user**: rule-ownership gaps were found in rounds 1, 2, 3 and 4 (the same
  class each time; every rule feeds others, so a hand-listed `outputs` is never complete and
  each gap is a false bump warning).
- **User's decision (2026-10-20)**, after a look at how Dagster (code versions propagated through
  the asset graph) and dbt CI tools (Datafold, Recce: the data diff is the review artefact; column
  lineage only narrows it) handle this: **two levels**. A WARNING when a match's stored values
  changed while no rule's version did (a missing bump; it can't false-alarm). A moved column none
  of whose listed rules was bumped is a `check:` line, not a warning. `outputs` are
  best-effort from here on; a gap is no longer a review finding. Plan §4's bump guard is
  superseded by this.
- Built: `RecordsDiff.checks`, `warnings` per match ("N match(es) changed with no rule
  version bumped"), a flag change or a row added/dropped counts as a change; the definitions
  header explains both. `bun run check`: 40 files, 470 tests passed. Real data, AERIAL_MIN_Z
  550 → 500 (reverted): unbumped → the check line plus "WARNING: 31 match(es) changed…"; with
  `aerial_touch` v2 → neither, "rule versions changed: aerial_touch (46 matches)". 46-match dir
  unchanged: no change. Snapshot: `8bdbac8dbeed1f3bd69b2a0438e49bfc795257ea`.

### Round 5 (delta vs `0fa06ab`)
- security-reviewer: no findings. arch-reviewer (sonnet): 3 nits, 1 q. code-review high: 9.
  1. The WARNING and `diff_done` kept only 5 unbumped guids. [Fixed] `RecordsDiff.unbumped` is
     the full guid list (logged whole); only the terminal line cuts at 5 and says where the rest is.
  2. `reshaped` doc and a test name said "not bump-checked"; such a match does count as changed.
     [Fixed]
  3. A rule id added to (or removed from) the map counted as a bump, silencing the WARNING.
     [Fixed] only rules in both maps with different versions count; `ruleVersions` still lists
     added ones. Test.
  4. The WARNING prescribed a bump even when what moved has no rule. [Fixed] "bump the rule that
     changed, or add a rule for what moved if none covers it" (report and definitions header).
  5. Missing tests: unowned column warns, flag lost, the 5-guid cut. [Fixed] (arch nit too.)
  6. Flag change re-derived after the gained/lost loops. [Fixed] marked inside them.
  7. Rows-changed list built twice. [Fixed]
  8. `moveOf` wrote a shared set (arch nit too). [Fixed] returns its guids.
  9. "check:" clashed with check ids. [Fixed] `toReview`, printed "review:".
- arch nit: `idx` derivation unstated. [Fixed] said in the `TABLES` doc. arch q: an unversioned
  base stays silent on a flag change. [Verified, no fix needed] intended (unknown versions).
- `bun run check`: 40 files, 473 tests passed. Snapshot: `38423ded34ca9a6496c1b98656d25b8c2f230bb2`.

### Round 6 (delta vs `8bdbac8`)
- security-reviewer: no findings. arch-reviewer (sonnet): 3 nits (two test names still said
  "check" [Fixed]; `reshaped` doc fine [Verified, no fix needed]; `ColumnMove.unbumped` count vs
  `RecordsDiff.unbumped` guids [Fixed] renamed `rowsUnbumped`). code-review high: 8.
  1–4, 7. Round 5 #3 (an added or removed rule isn't a bump) was wrong: it made a WARNING nothing
  could clear, and "add a rule for what moved" couldn't clear it either. Under the user's two-level
  decision any version change in a match clears its WARNING (every match shares the registry, so a
  bump of any rule already does). [Fixed] reverted `bumpedOf`: a rule added or removed counts as
  a version change; docs back to "changed version"; test covers both added and removed.
  5. registry.test.ts comment said outputs clear warnings. [Fixed]
  6. `unbumped` order followed SQLite scan order. [Fixed] sorted; test seeds in reverse.
  8. Test name "to check". [Fixed] (same as arch).
- `bun run check`: 40 files, 473 tests passed. Snapshot: `ab7652d8f649407bf7c7c5d3a4832afd42666217`.

### Round 7 (delta vs `38423de`)
- security-reviewer: no findings. arch-reviewer (sonnet): no findings. code-review high: 3.
  1. `rowsUnbumped` doc left out "removed". [Fixed]
  2. Flag gained/lost and kept lists followed SQLite scan order. [Fixed] common matches walked in
     guid order; test.
  3. "add a rule for what moved" clears the WARNING only if the rule is recorded (only those are in
     `rule_versions`). [Fixed] "add a recorded rule" in the report and the definitions header.
- `bun run check`: 40 files, 474 tests passed. Snapshot: `c9215ecd00e1fa31830678fa44c984fd63b25fa3`.

### Round 8 (delta vs `ab7652d`)
- security-reviewer: no findings. code-review high: 5, all low.
  1. Order fixed per list (round 6 #6, round 7 #2): the same issue a second time. [Fixed] at the
     source: `keyed()` reads with `ORDER BY` its key columns, so every map and list follows key
     order; the loop's inline sort is gone (`unbumped` keeps its `.sort()`: it merges tables).
  2. `localeCompare` vs `.sort()`. [Fixed] by 1 (SQLite BINARY and code-unit order agree on guids).
  3. Order test covered only gained. [Fixed] lost and kept too; it fails without the ORDER BY.
  4. Long inline comparator. [Fixed] by 1.
  5. Flag and rule-id key order follows the data. [Verified, no fix needed] deterministic for the
     same data; the comment claiming more is gone.
- `bun run check`: 40 files, 474 tests passed. Snapshot: `75827e47241dca7e3943ed87e96ba0675aa41c7a`.

### Round 9 (delta vs `c9215ec`)
- security-reviewer: no findings. code-review high: 3, all low.
  1. Loop comment said "per common match" but it also fills `kept`. [Fixed] (comment only)
  2. `keyed()` doc claimed every list; `unbumped` relies on its own sort. [Fixed] names flags and
     kept (comment only).
  3. ORDER BY on every table walks the PK index for lists that are only counted. [Verified, no fix
     needed] a dev tool over tens of matches; one uniform order is simpler than per-table rules.
- Nit fixes only, so the round closes: **review done** (9 rounds).

### Follow-up: guards for a bump hiding another change (user approved, 2026-10-20)
A side note pointed out that under the two-level check one bump clears every match's WARNING, so
an unbumped change made with it shows only as a `review:` line, which needs best-effort owners.
A dependency graph (Dagster-style) was weighed and not taken: it narrows what a bump should move,
but most rules feed shared steps, so the hidden change would mostly stay hidden, at the cost of a
larger hand-kept input list. Built instead:
1. `constant-pins.json` pins each rule's constants to its version; a changed constant without a
   bump fails `bun run check` and `bun run definitions` refuses. Live-checked with AERIAL_MIN_Z.
2. A moved column no rule lists gets a `review:` line too, whatever else was bumped.
3. The flow says one rule per rules-diff run, and to read every moved column.
Review: delta vs tree `b63d5a9964d7dd6f78b49f0644e0d64121d83589`.
- Round 1: security-reviewer: no findings. arch-reviewer (sonnet): 3 nits [Fixed] (two re-wraps;
  key order). code-review medium: 8.
  1. `aerial_touch` reads `SIDE_WALL_X` and `GOAL_LINE_Y` but didn't pin them. [Fixed] listed
     (SIDE_WALL_X exported). A constant newly listed or unlisted isn't a change; only a value is.
  2. Key order made a false "unbumped". [Fixed] compared by key.
  3. A version going down passes. [Verified, no fix needed] reverting a bump reverts its pin in
     the same commit; rules-diff shows the lowered version as a version change.
  4. A renamed rule loses its pin. [Verified, no fix needed] rare; rules-diff shows it as a rule
     added and removed.
  5. A missing pins file silently made a fresh baseline. [Fixed] the script refuses; checked live.
  6. Unversioned matches get no review line. [Verified, no fix needed] none remain after deploy,
     and the report prints a line for any it finds.
  7. A WARNING and a review line for the same unlisted column. [Verified, no fix needed] a listed
     column already gets both; consistent.
  8. Long step-2 line. [Fixed] (same as arch).
- Round 2: delta vs tree `44b1ec1e3b1aa9792ad2c00266150171806d86fa`.
  security-reviewer: no findings. code-review medium: 6.
  1–3. Round 1 #1's "unlisted isn't a change" let an unlisting or a rename carry a new value
     past the pin, and a test specified that. [Fixed] a pinned constant no longer listed, or
     with another value, needs a bump; only a newly listed one is free. Tests for both.
  4. aerial_touch's text didn't name the wall bounds. [Fixed]
  5. `BACK_WALL_Y` aliased the pinned `GOAL_LINE_Y`. [Fixed] inlined; 46 matches no change.
  6. A corrupt or `{}` pins file. [Verified, no fix needed] a parse error stops the script; a
     `{}` file is a deliberate edit that the registry test flags until regenerated.
  `bun run check`: 480 tests passed.
- Round 3: delta vs tree `a70c4c15453a2dbb9579e361c5d36c634b468e5b`.
  security-reviewer: no findings. code-review medium: 3, no bugs.
  1. No test for a rename keeping its value. [Fixed] test: it needs a bump (intended).
  2. A pure rename forces a bump that moves nothing. [Verified, no fix needed] the accepted cost
     of round 2's fix; renames of rule constants are rare.
  3. The refusal message is repeated in the registry test. [Verified, no fix needed] one is the
     script's output, the other an assertion label; they needn't match.
  Test-only change, so the review is done (3 rounds).
