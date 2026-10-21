# WP4c-b: Retention split (thin old UpdateStates, keep everything else)

## Context
Roadmap `docs/plans/2026-10-16-v1-roadmap.md` §WP4c. Today `runRetention`
(`src/server/db/retention.ts`) deletes **every** raw event older than 90 days, so a rule fix can
only reach the last 90 days of matches. `UpdateState` is 94% of raw.db. WP4c-b keeps every
non-`UpdateState` event forever and, after 90 days, thins `UpdateState` to the states the
scoreboard rules need. The few outputs that thinned raw can't support (the car stats and the
camera key) are snapshotted first. Flagged matches stay whole as the rule corpus. This has to ship
before mid-January 2027, when the first captured matches turn 90 days old.

Tier: **Substantial** (it changes a data-retention policy, which is hard to reverse, and adds a
raw.db table). Size: about 500 lines with tests, which fits in one session.

## Decisions that bind this plan (user, 2026-10-20; roadmap §WP4c and WP4c-a plan)
1. **Thinning is change-only.** After 90 days an `UpdateState` is dropped only when it changes
   nothing the scoreboard rules read:
   - each player's Name, PrimaryId, Shortcut, TeamNum and scoreboard stats (Score, Goals, Shots,
     Assists, Saves, Touches, Demos);
   - the teams' scores, or whether the scoreboard is missing;
   - PlaylistId, Arena and bOvertime;
   - a clock reading that isn't already the running clock (taken from any event).

   The first and last states always stay, and kept states stay byte-for-byte. "Changes nothing"
   compares with the previous *original* state, not the previous kept one. A missing `Teams` and
   an incomplete `Teams` count as different.
2. **Dense outputs are snapshotted in raw.db.** Thinning runs `readMatch` on the full raw first
   and stores what thinned raw can't support (the four car stats and the camera key). Recompute of
   a thinned match substitutes them before the checks. Recompute and rules-diff keep needing only
   raw.db.
3. **Flag exemption comes from that same `readMatch`.** A match flagged under current rules is not
   thinned, so retention never reads tracker.db.
4. A thinned match keeps the snapshot-time versions of its frozen rules in `rule_versions`, a JSON
   map (WP4c-a's ADR `docs/decisions/2026-10-20-rule-registry-versions.md`).
5. Counts that change under thinning (`rejectedScoreboards`, `cameraTargets`) need no handling. A
   positive `rejectedScoreboards` flags the match, so it is never thinned. `camera_on_roster`
   reads the substituted camera key.

Other rules that apply:
- The project rule on unseen data shapes: flag and wait, and don't invent handling.
- Global §2: log every decision point.
- Migrations are append-only.
- No doc paths in code comments.

## Calls made in this plan (conventional defaults; say if you disagree)
- **Whole matches, not event times.** A match is thinned once its *last* event is past the cutoff,
  so retention never splits a match. Today's split-at-cutoff caveat and recompute's `trimmed` skip
  can then only apply to matches that already lost their start, and there are none. The skip
  stays.
- **The exempt decision is stored with the rule versions it was made under.** It is re-checked
  only when `RECORDED_RULE_VERSIONS` changes. Without this, every run would re-read every old
  flagged match forever. If a rule fix unflags a match, the match is thinned on the next run.
- **A match that isn't a record stays whole and is logged.** That covers lobbies, a match with
  no close marker, and an already-trimmed match (the same tests recompute uses). Lobbies are
  small. The other two cases are flag-and-wait cases.
- **`readMatch` throws → stays whole.** The match is logged as `retention/thin_failed` and the
  run continues. It is retried on the next run.
- **Frozen rules are marked in the registry** with `dense: true` on `car_sampling`, `car_stats`
  and `camera_identity`. The marker is rendered in `docs/definitions.md`. A test ties the dense
  rules' `outputs` to exactly what the snapshot stores, so a future rule that reads dense state
  can't silently compute garbage on thinned matches.
- **An ADR** `docs/decisions/2026-10-2x-raw-thinning.md`. It passes the gate because it revisits
  WP2's 90-day rule and the deletion can't be undone.

## Design

### 1. Pure thinning rule: `src/server/recorder/thin.ts` (new)
`statesToDrop(events: readonly StoredEvent[]): number[]` returns the seqs to delete, from one
match's events in seq order.
- Projection per `UpdateState`:
  - `players(data)` mapped, in order (`players` from `summary.ts`), to these 11 fields: Name,
    PrimaryId, Shortcut and TeamNum, then Score, Goals, Shots, Assists, Saves, Touches and Demos;
  - `Game.Teams` as `null` when it isn't an array, else `objects(Teams).map(t => [t.TeamNum,
    t.Score])`;
  - `PlaylistId`, `Arena` and `bOvertime`.

  It is serialized with `JSON.stringify`. A missing field and an undefined field compare equal,
  and both are read as `null` downstream.
- **Running clock:** the last *finite numeric* `TimeSeconds` (`num()`, as `readClock` reads it)
  from any event (`ClockUpdatedSeconds` or `UpdateState`) in the original stream. A non-numeric
  reading leaves it unchanged.
- **Keep a state when:**
  - it is the first or the last `UpdateState`; or
  - its projection differs from the previous original state's; or
  - its `TimeSeconds` is a number different from the running clock.
- **Why this is safe** (to state in a module comment): the summary's identity resolution
  (`latestPlayers` for Shortcuts), its roster and presence, its score, clock and playlist, and
  the play view's `resolveRef` read only projected fields. Anything else they read from
  `UpdateState` (car samples, camera target) is a snapshotted output.
- Export the projected field lists, and export `GAME` and `PLAYER` from `known-fields.ts`. A test
  checks that every known `Game.*` and `Players[].*` field is either projected or on an explicit
  "dense or unread" list in `thin.ts`. A field newly recognised in `known-fields.ts` then forces a
  decision.

### 2. raw.db migration 2 (`src/server/db/migrations.ts`, appended)
```sql
CREATE TABLE retention_matches (
  match_guid    TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('thinned', 'exempt')),
  decided_at    INTEGER NOT NULL,
  rule_versions TEXT NOT NULL, -- JSON RECORDED_RULE_VERSIONS when decided
  flags         TEXT,          -- exempt: JSON check ids that kept it whole
  outputs       TEXT,          -- thinned: JSON {cameraKey, players: {key: {column: value}}}
  states_before INTEGER, states_after INTEGER
);
```

### 3. Store (`src/server/recorder/store.ts`)
- Add `thinnedOutputs(guid)` to `RawStore`. It returns `{ outputs, ruleVersions } | undefined` for
  a `thinned` row, else undefined.
- Add the helpers retention needs: `retentionRow(guid)`, `matchesEndedBefore(ts)` (guid with
  `MAX(ts)`), and `updateStateCount`. Or keep these SQL calls inside `retention.ts` if only it uses
  them; decide when building, with the less code winning.
- rules-diff opens raw.db read-only, so it can't migrate an old file. `thinnedOutputs` returns
  undefined when the table doesn't exist yet, checked once per store. This is a real case: running
  rules-diff before the deploy that adds the table.

### 4. Substitution in `readMatch` (`src/server/recorder/read-match.ts`)
`readMatch`'s store parameter becomes `Pick<RawStore, "matchEvents"> & Partial<Pick<RawStore,
"thinnedOutputs">>`, so existing fake stores keep working. The events are read **before**
`thinnedOutputs`, with a comment saying why. A concurrent `bun run recompute` (deploy runs one)
reads outside one transaction. In the worst case, events-then-snapshot pairs full events with a
snapshot of the same values, which is harmless. Snapshot-then-events could pair thinned events
with no snapshot, which gives wrong car stats and no flag.

After `computeExtras` and before `runChecks`, if a snapshot is returned:
- set `summary.cameraKey` to the snapshot's key;
- for every column in `DENSE_PLAYER_COLUMNS` and every roster key with extras, set the value to
  the snapshot's, or to `null` when the snapshot has none for that key;
- set `summary.thinned = { ruleVersions, offRoster }`:
  - `ruleVersions` holds the snapshot's versions of the dense rules;
  - `offRoster` lists the snapshot keys (the camera key, and each player key with a non-null
    value) that aren't on the current roster.
- A new check, **`thinned_snapshot_on_roster`**, fails when `offRoster` isn't empty. It applies
  only to thinned matches. Without it, a later change to `player_key` or the roster would silently
  null a thinned match's car stats and camera. It goes in the checks of `car_sampling` and
  `camera_identity`.

The live recorder's store returns undefined, so a new match is unaffected. Add
`thinned: {...} | null` to `MatchSummary`. `toRecord` writes
`{ ...RECORDED_RULE_VERSIONS, ...s.thinned?.ruleVersions }`.

### 5. Registry (`src/server/rules/registry.ts` and `definitions.ts`)
- Add `dense?: true` to `Rule` ("reads every UpdateState; a thinned match keeps the value
  snapshotted when it was thinned, and this rule's version with it").
- Mark `car_sampling`, `car_stats` and `camera_identity`.
- Export `DENSE_RULE_IDS` and `DENSE_PLAYER_COLUMNS`, both derived from the dense rules' `outputs`.
- **Mixed rules**: `live_play_window`, `target_resolution` and `player_key` also feed the
  snapshotted columns, but they feed other columns too, which do recompute. They are not frozen,
  and an explicit `MIXED_WITH_DENSE` list in the registry names them. A thinned match records
  their current version even though its frozen columns came from the snapshot. The `dense` field's
  doc and the ADR say this. A test checks both directions:
  - every dense rule's outputs are inside the snapshot (the snapshotted columns plus
    `matches.camera_primary_id`);
  - every non-dense rule whose outputs overlap the snapshot is on `MIXED_WITH_DENSE`.

  The `player_key` rule has no outputs that overlap, so it goes on the list by hand. The
  `thinned_snapshot_on_roster` check covers it.
- The fixture-equivalence test is what catches a *future* rule that reads dense state without
  being marked. The registry test can't, so the ADR says so and doesn't overclaim.
- Add two `stored` rules:
  - `update_state_thinning`: the projection rule, with `RETENTION_DAYS` and the measured figures
    as evidence;
  - `retention_flag_exempt`: flagged under current rules → kept whole, re-checked when the rule
    versions change.
- Render the dense marker, then regenerate `docs/definitions.md` (`bun run definitions`).

### 6. Retention (`src/server/db/retention.ts`, rewritten in place)
`runRetention(raw, opts)` keeps its options, its give-way and stop behaviour, and its vacuum loop
unchanged. The delete loop becomes a per-match loop over the matches whose last event is older
than the cutoff. It skips `thinned` rows, and `exempt` rows whose `rule_versions` equal the
current versions, compared key by key rather than as JSON text, so reordering the registry doesn't
trigger a re-check. Lobbies, open matches and trimmed matches get no row, so each run re-scans them
cheaply, and the candidate query is a daily `GROUP BY` over `events`. That is acceptable at this
scale, and the ADR notes it. For each match:
1. If it isn't a record (`closeViaOf(lastOf)` is null, `minSeq > 0`, or `rebuild(...).phase ===
   "pending"`), log `retention/kept_whole {guid, reason}` (warn for `open`) and continue.
2. `readMatch(fullStore, guid, via)`. If it throws, log `retention/thin_failed {guid, err}` and
   continue. The catch is broad on purpose, with a comment saying so.
3. If there are flags, upsert an `exempt` row and log `retention/exempt {guid, flags}`.
4. Otherwise, in one `raw.transaction`: delete the `statesToDrop` seqs and insert the `thinned`
   row with the snapshot (from `summary.cameraKey` and `summary.extras.players`, using the dense
   columns). Log `retention/thinned {guid, before, after, kb, ms}`.
5. `pause()` between matches, as between batches today.

`RetentionResult` becomes `{status, thinned, exempt, keptWhole, failed, states}`. Check
`maintenance.ts` and its test for any field use. They only read `status`; to be confirmed when
building.

The logs answer:
- what was thinned and how much it saved;
- why an old match is still whole;
- whether the run finished or gave way;
- how long it took.

Update the header comments in `retention.ts` and `recompute.ts`: "matches past retention keep
theirs" is no longer the general case.

### 7. rules-diff report (`src/server/records/rules-diff.ts`)
Add one line, "thinned: N matches (car stats and camera frozen at thinning)", when N > 0. A bump
to a dense rule then explains why only the full matches moved. Leave the rest of the diff
unchanged.

## TDD order
0. On approval, copy this plan to `docs/plans/2026-10-20-wp4c-b-retention-split.md`.
1. `thin.test.ts` (red first), with the pure rule on synthetic events:
   - each projected field's change keeps the state;
   - an unprojected change (Boost, Target, Ball) is dropped;
   - the clock rule, including a clock reading from a `ClockUpdatedSeconds`;
   - first and last are kept;
   - a missing `Teams` and an incomplete `Teams` are kept apart;
   - the comparison is with the previous original state (A,A',A'' with only dense changes → only
     the first and last kept);
   - the fields test against `known-fields.ts`.
2. `read-match.test.ts`:
   - substitution sets the car columns, the camera key and the frozen versions (null for a key
     missing from the snapshot);
   - a snapshot key that isn't on the roster flags `thinned_snapshot_on_roster`;
   - without a row, nothing changes.

   `record.test.ts`: the rule-version merge. `store.test.ts`: `thinnedOutputs` returns undefined
   on a raw DB that has only migration 1 (the read-only rules-diff case).
3. **Fixture equivalence** in `src/server/recorder/thin-equivalence.test.ts` (the roadmap's
   "thinned recompute equals full recompute"): for every `test/fixtures/*.ndjson`, import into a
   temp raw DB and take `toRecord(readMatch)` on the full events; then thin and snapshot, and take
   `toRecord(readMatch)` again. Expect them deep-equal. Also assert that on `completed` the car
   stats *without* substitution differ, which shows the snapshot is load-bearing. The fixtures keep
   only one state per 3 s, so this is a weak test of thinning. The 46-match run (Verification 2) is
   what proves the done-when.
4. `retention.test.ts`, rewritten on a seeded raw DB:
   - an old unflagged match is thinned: non-`UpdateState` rows are untouched and kept rows are
     byte-equal;
   - an old flagged match stays whole with an `exempt` row;
   - an exempt row is re-checked after a version change and skipped otherwise;
   - a recent match and a match straddling the cutoff are untouched;
   - lobby, open and trimmed matches stay whole, each logged;
   - `readMatch` throwing → `thin_failed` and the run continues;
   - a second run is a no-op;
   - give-way and shutdown stop between matches;
   - the vacuum tests are kept.
5. Registry tests: dense outputs ⊆ the snapshot's columns plus `matches.camera_primary_id`; the
   new entries; the definitions sync.
6. A rules-diff test for the thinned line.

## Files
- New: `src/server/recorder/thin.ts`, `src/server/recorder/thin.test.ts`, and the ADR.
- Changed:
  - `src/server/db/retention.ts` and its test;
  - `db/migrations.ts`;
  - `recorder/store.ts`, `recorder/read-match.ts` (and its test), and `recorder/summary.ts` (the
    type field);
  - `records/record.ts`, `records/recompute.ts` (comment), and `records/rules-diff.ts` (and its
    test);
  - `rules/registry.ts`, `rules/definitions.ts`, and `docs/definitions.md` (generated);
  - `PROJECT_INDEX.md`, the roadmap WP4c status, and `BACKLOG.md`.

## Verification
1. `bun run check` (tsc, eslint and vitest all green).
2. **The 46-match check**, run from a scratch script in the session scratchpad that isn't
   committed:
   - import the 4 captures into a scratch `RLTRACKER_DATA_DIR`, and record the raw.db size and
     `UpdateState` count;
   - run `runRetention` with `now` set to 2027-06-01 and a no-op yield;
   - expect: every unflagged match `thinned` and every flagged one `exempt`, with the 1 lobby
     whole;
   - compare the kept-state ratio and KB per match with the measured 1,807 of 13,080 and
     ~247 KB;
   - run `bun run rules-diff` against that dir: expect **no change** (car and camera through the
     snapshot) and the thinned line;
   - temporarily change `CAR_SAMPLE_CAP_MS` and bump `car_sampling` together. Expect rules-diff
     to show only the exempt (full) matches moving, e.g. C138256C, the spectated match, and the
     thinned matches keeping `car_sampling: 1`. Then revert.
3. Live: `bun run deploy` (the migration runs at start; nothing is older than 90 days, so the
   first run thins nothing and logs `retention/done`). `bun run rules-diff` → no change.
4. `independent-review-pass` on the diff, then record a Review log in the repo plan copy.

## Plan review
plan-reviewer (opus), 2026-10-20. Verdict: the approach is sound and the projection is complete,
having checked every `UpdateState` read in summary.ts, play.ts and players.ts. Fix #1 before
approval.

| # | Finding | Disposition |
|---|---|---|
| 1 | A snapshot key that falls off the roster (after a `player_key` change) silently nulls the car stats and camera, with no flag | Fixed: the `thinned_snapshot_on_roster` check (§4) and its test |
| 2 | Mixed rules (`live_play_window`, `target_resolution`, `player_key`) also feed the frozen columns; the registry test only checked one direction | Fixed: `MIXED_WITH_DENSE`, a two-way test, the documented semantics, and the overclaim removed (§5) |
| 3 | A version-only bump moves nothing, so that verification proves nothing | Fixed: change `CAR_SAMPLE_CAP_MS` as well; expect only the exempt matches to move |
| 4 | "Eight fields" is really 11; `GAME` and `PLAYER` aren't exported | Fixed: the 11 fields named; exports added (§1) |
| 5 | The running clock should take finite numbers only, as `readClock` does | Fixed (§1) |
| 6 | Test seams missing: the record merge, the missing-table path, the equivalence test's file; the fixtures are coarse | Fixed: tests named (TDD 2–3); the coarseness noted |
| 7 | `readMatch`'s store type; the read order when a recompute runs concurrently | Fixed: the method is optional; events are read first, with the reason in a comment (§4) |
| 8 | JSON-string version comparison re-checks after a reorder | Fixed: compare key by key (§6) |
| 9 | Non-record matches are re-scanned daily; the candidate query is a daily `GROUP BY` | Accepted at this scale; noted in the ADR (§6) |

## Verification results (2026-10-20)
1. `bun run check`: tsc, eslint (0 warnings) and vitest green, 522 tests in 42 files.
2. The 46-match check (scratch data dir, the 4 captures imported, `runRetention` at 2027-06-01):
   - before: raw.db 98.1 MB, 44,246 UpdateStates, 69,984 events;
   - result: 45 thinned, 1 exempt (`C138256C`, the spectated match, `camera_on_roster`), 1 lobby
     kept whole, 0 failed; 36,402 states deleted;
   - after: raw.db 28.3 MB (69.7 MB vacuumed), 7,844 UpdateStates, 33,582 events;
   - the thinned matches kept 6,572 of 42,974 states (15%; the planning sample on the live 13
     matches was 1,807 of 13,080), ~1.2 MB of state JSON dropped per match, at most 98 ms a match,
     2.7 s for the run;
   - `bun run rules-diff` on that dir: "thinned: 45 matches (car stats and camera frozen at
     thinning)", "no change";
   - `CAR_SAMPLE_CAP_MS` 1000 → 500 with `car_sampling` v2, then reverted: only the exempt
     match's 2 player rows moved (the four car columns), "rule versions changed: car_sampling (1
     matches)"; the 45 thinned matches kept `car_sampling: 1`.
3. Live deploy: pending, after review.

Re-run after review (2026-10-21), on a fresh copy reset to raw migration 1 so the final
migration 2 runs: the same 45 thinned, 1 exempt, 1 lobby, 0 failed; 6,572 of 42,974 states kept;
raw.db 98.1 → 27.3 MB (the dropped `events_ts` index); at most 97 ms per match; snapshots carry
`denseRules`; `rules-diff` printed the thinned line and "no change".

Verification 3 (2026-10-21): `bun run deploy` passed 523 tests and restarted the tracker;
recompute wrote 13, failed 0. Live raw.db migrated 1 → 2 (`retention_matches` present,
`events_ts` gone). `bun run rules-diff`: 13 recomputed, "no change". The first `retention/done`
from the new code was still pending at the next scheduled maintenance run.

### Changes from the plan made while building
- `ORPHAN_TIMEOUT_MS` moved from `recorder.ts` to `lifecycle.ts`: `readMatch` now imports the
  registry, which imported it from `recorder.ts`, and that cycle (`recorder.ts` → `read-match` →
  `registry` → `recorder.ts`) fails at load time.
- `readableAs` (in `read-match.ts`) is the one "is this stored match a record" test, shared by
  recompute and retention.
- The retention SQL lives in `retention.ts` (only it uses it); `RawStore` gained only
  `thinnedOutputs`.
- The snapshot stores only player keys with a non-null dense value.
- `retention_flag_exempt` is a `stored` rule with no checks. `thinned_snapshot_on_roster` is on
  the three dense rules; `thinned_snapshot_covers_dense` (added in review) is on
  `update_state_thinning`.

## Review log

### Round 1 (2026-10-21): Substantial (972 code lines, Substantial design tier)
Passes: `/code-review high`, `arch-reviewer` (sonnet), `security-reviewer`, `/simplify`.
Snapshot of the reviewed state: tree `d515b39`.

`security-reviewer`: no findings (bound SQL, no IN lists; the snapshot and the deletes share one
transaction; flagged matches, `extras_computed` among them, are never thinned).

| # | Pass | Finding | Disposition |
|---|---|---|---|
| 1 | code-review, arch | A rule marked dense after a match was thinned reads null there with no flag, and the record stamps its current version | [Fixed] the snapshot stores `denseRules`; `readMatch` sets `thinned.unsnapshotted`; new check `thinned_snapshot_covers_dense` (on `update_state_thinning`); test in `read-match.test.ts`; ADR updated |
| 2 | code-review | Every flagged match stays whole forever, including expected flags such as `camera_on_roster` on a spectated match | [Deferred → BACKLOG] binding decision 3 (flagged → whole, the user's call); 1 of 46 so far. Watch item with a size trigger; ADR consequence added |
| 3 | code-review | An exempt match is re-checked only on a recorded rule version change, so a check fixed without a bump leaves it whole | [Verified, no fix needed] fails safe (kept, not lost); ADR consequence added |
| 4 | code-review | The candidate query returns every thinned match, only for JS to skip it | [Fixed] `WHERE r.status IS NOT 'thinned'` in SQL; the scan itself stays linear, accepted per plan-review #9 |
| 5 | code-review | Kept-whole and thin_failed matches re-log every run | [Verified, no fix needed] deliberate: the repeat is the signal the BACKLOG watch item names (plan-review #9) |
| 6 | code-review | `events_ts` index no longer used by any query, yet every insert maintains it | [Fixed] `DROP INDEX events_ts` in migration 2 (not yet deployed, so still editable); grep shows no other `ts` filter |
| 7 | code-review, arch | rules-diff counts thinned matches with one `thinnedOutputs` per guid | [Verified, no fix needed] rules-diff already runs `readMatch`, which makes the same call, on every match; the count adds nothing material |
| 8 | code-review | The log-only `kb` re-serialises every dropped state | [Verified, no fix needed] measured at most 98 ms per match including it, between matches with a yield |
| 9 | code-review | `sameVersions` duplicates rules-diff's `changedRules` | [Verified, no fix needed] different jobs: a boolean vs the changed ids with a null-base case; one line each, and a shared helper would make `db/` import `records/` |
| 10 | code-review, arch | `applySnapshot` re-filters snapshot keys for non-null values, duplicating `snapshotOf` | [Fixed] reads `Object.keys(outputs.players)`; the all-null test entry removed |
| 11 | arch | `db/retention.ts` now imports `recorder/` and `rules/` | [Verified, no fix needed] `maintenance.ts` runs it beside the backup; moving the file is churn with no behaviour change, and there's no cycle |
| 12 | arch | `JSON.parse(c.versions ?? "{}")` is outside the per-match guard | [Verified, no fix needed] the column is NOT NULL and only retention writes it; a corrupt row fails the run loudly, as any SQLite failure does |
| 13 | arch | Comment that `events` is read outside the deleting transaction | [Fixed] comment added |
| 14 | arch | `MIXED_WITH_DENSE` is exported, used only by a test, and not rendered | [Verified, no fix needed] the plan asked for it; its doc comment explains it, and the ADR names it |
| 15 | arch | `ORPHAN_TIMEOUT_MS` splits `ORPHAN_CAUSES` from `CloseVia` | [Fixed] moved below `OrphanCause` |
| 16 | arch | `PROJECT_INDEX.md` raw.db bullet runs long | [Fixed] rewrapped |

`bun run check` after the fixes: 523 tests, exit 0.

`/simplify` (4 agents: reuse, simplification, efficiency, altitude). Applied:
- `DENSE_PLAYER_COLUMNS` strips the column prefix with the registry's `p()` rather than a second
  spelling of `match_players.`.
- `applySnapshot` builds the off-roster keys from one Set (no nested ternary).
- `statesToDrop` reads `Game` once per state and passes it to `projection`.

Skipped, each with its reason:
- Share `parseVersions` with rules-diff: three one-line parses, and sharing it would make `db/`
  import `records/`.
- Have `statesToDrop` return the state count; drop the `kb` sum: the log field answers "how much
  was saved", and the run is measured (98 ms max per match).
- Compare `rule_versions` as JSON text: key-by-key is deliberate (plan-review #8).
- Make `thinnedOutputs` required, or drop the `sqlite_master` probe: the optional method lets
  fake stores and retention's in-memory shim work (plan §4). The probe is the read-only
  rules-diff path (plan §3); a store opened before the migration is only the live recorder's,
  and that one runs after the migration.
- Derive or drop `MIXED_WITH_DENSE`; replace `DENSE_PLAYER_COLUMNS` with `CAR_STATS`: the plan's
  two-way test is what ties them together (plan-review #2).
- Write a row for kept-whole matches: the repeated log is the watch item's signal (plan-review #9).
- Batch the per-seq DELETE; split `decide` so it can yield; skip `names` in `readableAs`;
  push the exempt version test into SQL: covered by the measured 98 ms per match, and no
  material change at this scale.
- Move the dense constants out of the registry to avoid a load-order cycle: the cycle was broken
  while building (`ORPHAN_TIMEOUT_MS` moved from `recorder.ts` to `lifecycle.ts`), and `read-match` can't import the
  registry any other way without duplicating it.
- Recompute's unreadable-to-log-level mapping duplicates retention's: two call sites, different
  wording.
- **Raised to the user, then deferred → BACKLOG** (altitude #1): before deleting, read the match again from
  the kept events plus the snapshot, compare its record with the full one, and keep the match
  whole on any difference. That checks the real invariant on every match rather than relying on
  the field lists. It adds a new outcome, so it's the user's call.

`bun run check` after `/simplify`: 523 tests, exit 0.

### Round 2 (2026-10-21): delta since `d515b39`
Passes: `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`. Security: no findings.

| # | Pass | Finding | Disposition |
|---|---|---|---|
| 1 | code-review | A snapshot without `denseRules` would throw in `applySnapshot` | [Verified, no fix needed] migration 2 has never been deployed, so every stored snapshot is written by this code; only the scratch 46-match copy holds the older shape |
| 2 | arch | The migration comment narrates history | [Fixed] nit: reworded to the standing reason |
| 3 | arch | The `/simplify` skip note on the cycle reads as if round 1 moved the constant | [Fixed] nit: says the constant moved from `recorder.ts` while building |

No new finding beyond nits: review done. `/simplify` altitude #1 (verify the thinned read
before deleting) deferred to BACKLOG by the user.
