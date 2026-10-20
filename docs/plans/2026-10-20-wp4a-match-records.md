# WP4a: Match records (core)

## Context
WP4 of `docs/plans/2026-10-16-v1-roadmap.md` turns each finished match into a stored match record.
Pages read only these records, never `raw.db`. WP3a's recorder already folds a closed match into a
`MatchSummary` (roster, score, winner, MVP, checks) and calls `onMatchFinished`, which is a no-op
in `src/server/main.ts:87`. Nothing is persisted to `tracker.db` yet.

**User decisions (2026-10-20):**
1. **Split.** WP4a is the core: schema, write path (hook plus `bun run recompute`), result, flags,
   MVP (actual or inferred), identifying you, the playlist map, scoreboard and statfeed counts.
   WP4b is the extras (hardest shot, fastest goal, crossbar hits, boost, supersonic %, time on
   empty, aerial touches) and the goal-map points, through a stat registry over events.
2. **Records cover every player, and "you" is resolved when a page reads them.** Nothing in a
   record depends on `my_ids`. Each player gets a full row, and the match stores the winner and the
   camera target. Pages find "you" by joining with `my_ids`. Confirming or rejecting an ID (WP8)
   then corrects every match, including matches past the 90-day raw retention, without a
   recompute. This replaces the roadmap's per-player column "on your team at any point" with
   `teams_seen` (a bitmask). "With you" becomes `me.teams_seen & p.teams_seen != 0` at query time.

3. **Orphaned matches with no decidable winner** (user, 2026-10-20, recommended option):
   - superseded or timeout → loss, like a leave;
   - restart (the tracker was down, and you may have played on) → unknown, so no W/L and the
     match is flagged (by its `closed_via` restart column; see Review log round 1 item 3).

   The decided rule always runs first, so a decided win stays a win.

Tier: Substantial. TDD (`tdd-live-code-carveout`): pure logic red-green first; DB writes and
recompute tested on temp dirs.

## Approach

### 1. Summary additions: `src/server/recorder/summary.ts`
These extend the existing per-event handler table, as WP3a intended. Each fact keeps one source.
- `RosterEntry.teamsSeen`: a bitmask, bit `1 << TeamNum`, ignoring 255. `updateRoster` ORs it in.
- `statfeed: Record<rosterKey, Record<EventName, count>>`. The `StatfeedEvent` handler resolves
  every event's `MainTarget` through the existing `resolveTarget`, not only MVP.
  `facts.unresolvedStatfeed` counts the targets it couldn't resolve.
- `cameraKey`: the most frequent roster key of `Game.Target`, counted over states with
  `bHasTarget && !bReplay` before `MatchEnded`. The target is resolved through `Shortcut` in the
  same state's `Players`, checking that name and team agree (the same rule as `resolveTarget`).
  It is null when the camera never targeted anyone.
- **Winner and MVP have one home, here** (plan review #2). `summarise` computes:
  - `winner: { teamNum, source: "match_ended" | "decided" } | null`. The decided rule applies only
    with no `MatchEnded`: the scores differ, and either overtime or the last clock reading is 0.
    The winner is the higher score. (At 0 s a 1-goal lead could in theory still be tied while the
    ball is in play; the map settles the rule, and the ADR notes it.)
  - `mvp: { name, teamNum, key, source: "statfeed" | "inferred" } | null`:
    - if an MVP statfeed fired, it is the MVP even when unresolved (`key` null, flagged by
      `mvp_on_roster`): the game awarded one, so it is never replaced by a guess (review #1);
    - otherwise, with a winner, the top scorer on the winning team in the snapshot roster. A tie
      for top means no MVP.

  These replace today's `winnerTeamNum` / `mvp` fields; their existing callers (`checks.ts`,
  `recorder.ts` logging, `import-capture.ts`, tests) are updated.

### 2. Checks: `src/server/recorder/checks.ts` (new rows)
- `statfeed_resolved`: `unresolvedStatfeed === 0`.
- `statfeed_matches_scoreboard` (not when joined in progress): one row driven by a table, so each
  stored statfeed stat has a check (review #4):
  - goals ← `Goal`;
  - assists ← `Assist`;
  - shots ← `Shot`;
  - demos ← `Demolish`;
  - saves ← `Save` + `EpicSave`.

  The reviewer found saves = `Save` + `EpicSave` on the fixtures. Verify the whole table on every
  fixture in red-green first, and drop any row the fixtures contradict.
- `winner_valid` is extended: a decided winner must also be a team in `score`.
- `mvp_inferred_on_winner`: an inferred MVP is on the winning team.
- `camera_on_roster`: a target was seen, but `cameraKey` is null. A spectated match also fails
  this, which is a useful flag.

### 3. Reading a closed match: `src/server/recorder/read-match.ts` (new)
Extract `recorder.finish`'s read step (`matchEvents` → filter out the close marker → `dedupe` →
`summarise` → `runChecks` → `flags`) into `readMatch(store, guid, via)`. `finish` and recompute
then share it. Behaviour stays the same; the existing recorder tests cover it.

### 4. Record building: `src/server/records/record.ts` (new, pure)
`toRecord(summary): MatchRecord` → `{ match, players[], statfeed[] }`. A plain mapping: the winner
and MVP rules live in `summarise`.
- **Your result: `src/shared/result.ts`** (new, pure, tested now, used by WP5a). It is
  `resultFor({ winnerTeamNum, endKind, closedVia }, myTeamNum) → "win" | "loss" | null`:
  - with a winner: win if `myTeamNum` is the winner, else loss;
  - with no winner, after a leave, a superseded close or a timeout: loss;
  - after a restart (decision 3), or otherwise: null, so it's hidden and never shown as a zero.
- **Flags** come from the columns, not stored twice:
  - left early = `end_kind` in (left, orphaned);
  - joined in progress, inferred result and inferred MVP each have their own column;
  - check failures go to `check_flags` (JSON).
- `camera_primary_id` is `cameraKey`'s PrimaryId, or null for a bot, none or `""` (review #7).

### 5. Schema: tracker migration 2 in `src/server/db/migrations.ts` (append only)
- **`matches`**:
  - `guid` PK;
  - `started_at`, `ended_at`, `playlist_id` (raw), `arena`;
  - `end_kind` CHECK, `closed_via`, `joined_in_progress`, `overtime`;
  - `score_team0`, `score_team1`;
  - `winner_team_num`, `winner_source` CHECK (`match_ended`|`decided`);
  - `mvp_key`, `mvp_source` CHECK (`statfeed`|`inferred`);
  - `camera_primary_id`, `check_flags`;
  - index on `started_at`.
- **`match_players`**:
  - PK (`match_guid`, `player_key`);
  - `primary_id`, `name`, `is_bot`, `team_num`, `teams_seen`, `present_at_end`;
  - `score`, `goals`, `shots`, `assists`, `saves`, `touches`, `demos`;
  - index on `primary_id` (for friends and you).
- **`match_player_statfeed`**: PK (`match_guid`, `player_key`, `event_name`), `count`. A child
  table, so a new statfeed name needs no migration.

There are no foreign keys. The write deletes child rows explicitly.

### 6. Write: `src/server/records/save.ts` (new)
`createRecordWriter({ tracker, logger })` holds the once-per-run set of unknown playlist IDs
(review #5). main, import-capture and recompute each create one. Its `save(record)` runs in one
transaction:
1. Upsert `matches` (`INSERT … ON CONFLICT(guid) DO UPDATE`). The hook can fire twice for one guid
   after a Reconnect.
2. Delete, then insert, that guid's `match_players` and `match_player_statfeed` rows.
3. Add the **pending guess**: `INSERT OR IGNORE` the camera PrimaryId into `my_ids` as `pending`
   when it isn't a bot, isn't already in `my_ids` (any status), and no confirmed ID is among the
   match's players.

Logs:
- `records/written`: guid, players, winner_source, mvp_source, check_flags, ms;
- `records/pending_guess`: primaryId, name;
- `records/unknown_playlist`: once per id per run, with arena and team sizes, per the playlist
  research note.

A write error is not caught here. Live, the recorder's `hook_failed` handler catches it and the raw
events stay for recompute. In recompute, it's caught per match.

### 7. Playlist map: `src/shared/playlists.ts` (new, data)
- `PLAYLISTS: Record<number, { name, group, ranked: boolean }>` (the unknown fallback types
  `ranked` as `boolean | null`), seeded from
  `docs/research/2026-10-15-rl-playlist-ids.md`. Groups: ranked, casual, extra, ltm, private,
  tournament, offline. ID 4 is Casual Quads.
- `playlistInfo(id)` returns the entry, or `{ name: "Unknown playlist (id)", group: null,
  ranked: null }`.
- Records store the raw ID only, so a corrected map applies to past matches without a recompute.
  `saveRecord` uses `playlistInfo` only to log unknown IDs.

### 8. Recompute: `src/server/records/recompute.ts` + `scripts/recompute.ts` + `"recompute"` script
`recomputeAll({ raw, tracker, logger })` goes through raw.db's guids in first-seen order. It
skips:
- **still open**: the last event isn't a close marker;
- **lobby**: `rebuild(guid, names).phase === "pending"`, the same rule the recorder uses;
- **trimmed**: `MIN(seq) > 0`. Retention deletes by `ts`, so a match straddling the cutoff can be
  half-deleted, and it must not overwrite its good record.

`via` comes from the close marker: `MatchDestroyed` → destroyed, `RecorderClosed.Reason` → that
cause. Then `readMatch` → `toRecord` → `saveRecord`. Each match is wrapped in a deliberate broad
try/catch: one bad match must not stop the rest (`records/recompute_failed`). It ends with
`records/recompute_done` (written, skipped by reason, failed, ms) and a console table.

Recompute never deletes records. Matches outside raw.db keep theirs. A guid that now skips as a
lobby but already has a record is logged (`recompute_skipped`, reason `lobby_has_record`), not
deleted.

**Running alongside the background tracker is supported** (review #6). Each match is its own
transaction, under WAL with the 5 s busy timeout (`src/server/db/sqlite.ts`). The open live match
is skipped, since its last event isn't a close marker. The worst case is a live hook waiting a few
ms for the lock.

### 9. Wiring
- `src/server/main.ts`: `onMatchFinished: (s) => saveRecord(storage.tracker, toRecord(s), log)`.
- `scripts/import-capture.ts`: the same hook, so an imported capture fills `tracker.db` as seed
  data for WP5.

### Logging: what each log answers
- Was this match recorded, and with which result and MVP source? (`written`)
- Why was this match not rebuilt? (`recompute_skipped` with a reason)
- Which IDs became guesses, and which playlist IDs are unmapped?
- Did the write fail? (`hook_failed` / `recompute_failed` with `err`)

Fire once for real: a write against a closed tracker db, which should log `hook_failed`.

## Files
- **Modified**: `src/server/recorder/{summary,checks,recorder}.ts`, `src/server/db/migrations.ts`,
  `src/server/main.ts`, `scripts/import-capture.ts`, `package.json`.
- **New**: `src/server/recorder/read-match.ts`, `src/server/records/{record,save,recompute}.ts`
  (+ tests), `src/shared/{playlists,result}.ts` (+ tests), `scripts/recompute.ts`.
- **Docs**:
  - this plan saved as `docs/plans/2026-10-20-wp4a-match-records.md` (step 1);
  - roadmap: split WP4 into 4a/4b with status lines; a WP5a note on the "you" join and result
    rule; the autostart milestone moves to after WP4a, since recompute backfills 4b's extras
    within 90 days;
  - ADR `docs/decisions/2026-10-20-match-records-per-player.md` (decision 2 and its alternative);
  - `PROJECT_INDEX.md`, `BACKLOG.md` next step.

## Steps
1. Save this plan to the repo.
2. TDD the summary additions and the new checks with synthetic events (as in
   `summary.test.ts`):
   - the decided rule: overtime, 0 s, and a tie that stays undecided;
   - left with no winner;
   - an inferred MVP, and a tie meaning no MVP;
   - an unresolved statfeed MVP, which stays `statfeed` with `key` null and is never inferred;
   - teams_seen, the statfeed tally, and cameraKey.
3. TDD `src/shared/result.ts` for each end kind and close cause.
4. Extract `readMatch`; the recorder tests stay green.
5. TDD `toRecord` on the fixtures: completed, early-end, overtime-leavers, joined-in-progress,
   left-early, left-countdown and private-series, each with its expected record.
6. Migration 2, then the record writer on a temp dir: upsert twice for one guid gives one row set; the
   pending-guess rules; unknown playlist logged once.
7. `playlists.ts` and its test.
8. `recomputeAll` and the script:
   - the skip reasons: open, lobby, `lobby_has_record`, trimmed;
   - **live replay equals recompute**: feed each fixture through a recorder whose hook saves, then
     snapshot the three tables and `my_ids`. Clear them, recompute, and compare.
9. Wire `main.ts` and `import-capture.ts`, then fire the closed-db failure once for real.
10. `bun run check` green → offer `/compact` → `independent-review-pass`.
11. Docs: roadmap, ADR, index, backlog. Commit only when asked.

## Verification
- `bun run check` (tsc, eslint, vitest) passes.
- Manual: `RLTRACKER_DATA_DIR=<scratch> bun run scripts/import-capture.ts captures/*.ndjson`, then
  `bun run recompute`, then `sqlite3` a sample. Every real match has a record. `check_flags` is
  empty, or each flag is explained. Exactly one pending guess (the user's ID). Recompute's row
  counts match the import's.
- `bun run dev`, then replay a fixture with `scripts/replay.ts`; `.dev-data/tracker.db` gains the
  match.

## WP4b (outline, its own plan later)
- A stat registry over the deduped events: `{ column, scope: player|match, compute(events, summary) }`
  plus a migration per stat. The writer builds columns from the registry.
- The extras listed above, plus a `match_goals` table for the goal-map points.

## Plan review
plan-reviewer (opus), 2026-10-20. Verdict: sound, and it fits the codebase.

| # | Finding | Disposition |
|---|---|---|
| 1 | An unresolved statfeed MVP was replaced by an inferred one | Fixed: a statfeed MVP always wins, `key` null is flagged |
| 2 | The winner and MVP rules were split across `summary` and `record`, with no checks on derived values | Fixed: both are computed in `summarise`; `winner_valid` extended; `mvp_inferred_on_winner` added |
| 3 | The result rule had no code home or test, and "orphaned → loss" was unsettled | Fixed: `src/shared/result.ts` is tested now; the user chose "by cause" (decision 3) |
| 4 | Only Goal statfeed counts were checked | Fixed: a table-driven `statfeed_matches_scoreboard` (saves = Save + EpicSave, to be verified on the fixtures) |
| 5 | The once-per-run log needed state | Fixed: `createRecordWriter` holds it |
| 6 | Whether recompute can run with the tracker up was unstated | Fixed: supported and documented |
| 7 | `""` camera id; `ranked` typing; `my_ids` in the equality test; stale lobby records | Fixed, all four |
| 8 | A 1-goal lead at 0 s could still be tied | Noted for the ADR; the map settles the rule |

## Implementation notes (2026-10-20)
Steps 1–9 are done and `bun run check` is green (355 tests).

Two changes came from the real captures (46 matches imported):
- **Final player stats** (user's choice, 2026-10-20, recommended option). This revisits WP3a's
  rule "the scoreboard is frozen at MatchEnded". In D99A293C and 11337796, a shot in the last
  ~0.5 s reached the game's scoreboard only in the first state after MatchEnded, so
  `statfeed_matches_scoreboard` failed. Now player stats catch up in the post-end states, for
  players still in them (first post-end state only at first; the highest value over all of them
  since Review log round 1 item 2). Roster, presence, score and playlist still come from before
  MatchEnded.
  Result: 0 check failures on the 46 matches.
- **Camera share rule.** The plan's claim that "a spectated match fails `camera_on_roster`" was
  wrong. In C138256C (a private 1v1 the user spectated), the camera switches between the roster's
  players, which produced a false pending guess. `cameraKey` now needs ≥ 95% of the resolved
  play-time targets. On the captures, the user's own matches were at 100% and the spectated one
  at 71%. Unresolved targets don't count toward the share: in C6C0A6B4 the user was at team 255
  and not yet on the scoreboard.

Verification run:
- import of `captures/*.ndjson` into a scratch dir: 46 records, each with `check_flags` `[]`,
  except C138256C, which has `camera_on_roster` (spectated, explained above). There is exactly
  one pending guess: the user's ID.
- `bun run recompute`: written 46, lobby 1, failed 0. The hashes of all four tables equal the
  import's.
- A hook writing to a closed tracker.db logs `recorder/hook_failed` with
  `RangeError: Cannot use a closed database`.
- `main.ts` against `scripts/replay.ts test/fixtures/completed.ndjson`: logged `records/written`
  and `records/pending_guess` for CB59BD4E.

Next: step 10 `independent-review-pass`, then step 11 docs.

## Review log
Classified Substantial (1668 changed lines; design tier Substantial). Round 1 snapshot:
`git stash create` → `afdfda36`.

### Round 1: `/code-review high`, arch-reviewer (sonnet), security-reviewer, `/simplify`
- **security**: no findings.
- **code-review high**:
  1. `statfeed_matches_scoreboard` will flag reconnected or left matches whose stats changed
     while unseen. [Verified, no fix needed] The flag reports a real disagreement between the
     stored statfeed and scoreboard counts; that is what it's for.
  2. Final stats taken from one state only: the sampler can store the first post-end state
     milliseconds after `MatchEnded`, before a lagging stat lands. [Fixed] Each stat now keeps its
     highest value over all post-end states (nothing is played after the end; teardown may reset
     counters). Test first. The 46 real matches give identical tables.
  3. Decision 3 says a restart is "flagged", but there's no flag. [Verified, no fix needed] Per the
     plan, flags come from the columns: `end_kind` orphaned and `closed_via` restart are stored.
  4. A `WinnerTeamNum` that names no team (the Stats API sends -1 for a no contest) was stored as
     the winner, so every player would get a loss. [Fixed] `winner()` keeps it only when it's a
     team in the score; `facts.endedWinnerTeamNum` keeps the raw value; `winner_valid` passes a no
     contest and flags any other non-team. Tests first.
  5. An older match whose close marker failed to store is skipped as "open" forever, at info.
     [Fixed] Recompute warns when an open match isn't the one with the latest event. Test first.
  6. A Reconnect reopening a guid between recompute's reads. [Verified, no fix needed] The live
     hook rewrites the record (upsert) when the reopened match closes again.
  7. `ORPHAN_CAUSES` re-listed in recompute (also arch risk). [Fixed] `ORPHAN_CAUSES`,
     `recorderClosedData` and `closeViaOf` live in `lifecycle.ts`; `OrphanCause` derives from
     the list.
  8. Recompute reads each match up to three times. [Verified, no fix needed] 46 matches take
     0.8 s; a manual command.
  9. `mvp_inferred_on_winner` can't fail (`mvp()` filters by the winning team). [Fixed] Removed,
     along with the decided-winner half of `winner_valid`, which was true by construction too.
- **arch-reviewer**:
  - `camera_on_roster` id/comment. [Fixed] Comment reworded; id kept (stored in `check_flags`).
  - `CAMERA_SHARE` comment cited measured percentages. [Fixed] Reasoning only; figures are in
    the ADR.
  - Summary header and `RosterEntry.stats` didn't mention the post-end stats. [Fixed]
  - Stale "the hook is WP4's code" comment. [Fixed]
  - `winnerSource`/`mvpSource` hand-written in `record.ts`. [Fixed] Derived from `MatchSummary`;
    `result.ts` says why it spells its unions out.
  - Double blank line in `client.test.ts`. [Fixed]
  - Unknown playlist not reported when the write fails. [Verified, no fix needed] Intended: the
    failure is logged, and the retry reports it.
- **`/simplify`** (4 agents):
  - [Fixed] recompute's raw-db SQL moved into the store (`matches`, `lastOf`; reuses `lastEvent`);
    `skip` takes a log level; `uniqueTop` shared by `winner()` and `mvp()`; `teamsIn` shared with
    `checks.ts`; booleans bound directly (stored as integer 0/1, verified on the captures).
  - Skipped: a `recordHook` shared by main and import-capture (one-line composition); deriving
    the schema CHECKs and `ResultInput` from shared const arrays (the CHECKs are frozen once
    shipped, and `src/shared` stays free of server code); folding the lobby rule into `readMatch`
    (the live recorder decides it before reading); `Map`→`Record` for the statfeed tally (keys
    come from game data); generated column lists in the upsert; `ranked` derived from `group`
    (34 is the exception); a `tempStorage()` test helper (the pattern predates this change);
    caching the camera name lookup.
- After fixes: `bun run check` green, 356 tests. Re-import of the 46 captures and recompute give
  the same table hashes as before the review (matches `50ec5f05a1ef`, match_players
  `cb255f8f0d7f`, statfeed `2a1a4d21df57`).

### Round 2 (delta `afdfda36..75d8b955`, full table minus `/simplify`: the fixes touched `lifecycle.ts` and `store.ts`, outside round 1's diff)
- **security**: no findings (booleans stored as 0/1 was already verified on the captures).
- **arch-reviewer**:
  - ADR decision 6, the roadmap and the Implementation notes still described the first-state
    rule. [Fixed] All three now describe the highest value over post-end states.
  - The ADR lacked the no-contest rule. [Fixed] Added to decision 4.
  - ADR verification not tied to the post-fix state. [Fixed] It says the figures held.
  - `NO_CONTEST` defined in `checks.ts` while `summary.ts` documents -1. [Fixed] Exported once
    from `summary.ts`.
  - `closeViaOf` has no catch. [Verified, no fix needed] Its only caller catches per match.
- **code-review high**:
  1. The max rule let states retagged from the next match (filed under the ended match until a
     MatchCreated or MatchDestroyed) raise final stats. On the captures, 5 private-series matches
     had 6–8 such states each, though none changed a value. [Fixed] Only post-end states whose
     own `MatchGuid` is the match's (or which carry none) are caught up. The test now includes a
     retagged state with higher counters.
  2. With no score seen, a valid `MatchEnded` winner was dropped (round 1's fix 4). [Fixed]
     Without a score, any team but `NO_CONTEST` is kept. Test first.
  3. The recompute comment said a stale open match stays unrebuilt "until it is closed", but
     nothing closes it. [Fixed] The comment says so; the remedy is a BACKLOG watch item.
  4. The skip log level is chosen at each call site. [Verified, no fix needed] Two call sites,
     each reading plainly.
- After fixes: `bun run check` green, 357 tests; re-import and recompute of the 46 captures give
  the same table hashes.

### Round 3 (delta `75d8b955..2de6ee69`: code-review high, arch-reviewer, security)
- **security**: no findings.
- **arch-reviewer**: plan decision 3 still said a restart is "flagged". [Fixed] It names the
  `closed_via` column (nit; no re-round).
- **code-review high**:
  1. Round 2's guard rested on a wrong premise: the retagged post-end states are this game's own
     teardown (lifecycle header; the weekend-captures research). On the captures, every retagged
     state in the 5 matches repeats the pre-end arena, score and player stats exactly, so a stat
     lagging into them would have been dropped. [Fixed] Guard reverted to round 1's rule. A real
     next-match state would start with reset counters, which the max already ignores. The test now
     has the lagging goal arrive only in a retagged state. This was the same issue twice (round 2
     item 1); the captures settled it, so no escalation.
  2. The guard is read-time attribution, which the recorder ADR rejected. [Fixed] Gone with 1.
  3. The guard was partial (clock, latestPlayers). [Fixed] Gone with 1.
  4. With no score, any `WinnerTeamNum` but -1 became the winner (255 or 2 would give everyone a
     loss). [Fixed] Without a score only team 0 or 1 is kept. The test covers 1, -1, 255 and 2.
  5. The `winner_valid` comment was stale. [Fixed]
  6. The recompute comment ignored a Reconnect resuming the match. [Fixed]
  7. No-score branches untested. [Fixed] With 4.
  8. No test with an explicit own `MatchGuid`. [Verified, no fix needed] Gone with 1: nothing
     compares guids now.
- After fixes: `bun run check` green, 357 tests; re-import and recompute of the 46 captures give
  the same table hashes.

### Round 4 (delta `2de6ee69..f83c5b63`: code-review high, security)
- **security**: no findings.
- **code-review high**:
  1. With no score, a dropped `MatchEnded` winner went unflagged (`winner_valid` required a
     score). [Fixed] `winner_valid` applies whenever `MatchEnded` came, a no contest excepted.
     Test first.
  2. Three definitions of a real team. [Fixed] One `isTeamNum` (not -1, not 255) for the roster
     and `winner()`; with a score, the team must also be in it.
  3. A non-newest open match that a Reconnect could still resume warns. [Verified, no fix needed]
     A later match's `MatchCreated` supersedes the open one and stores its close marker first, so a
     non-newest open match has lost its marker.
- After fixes: `bun run check` green, 358 tests; re-import and recompute give the same hashes.

### Round 5 (delta `f83c5b63..89868f00`: code-review high, security)
- **security**: no findings.
- **code-review high** (one root cause, the same issue as round 4 item 2): round 4's `isTeamNum`
  banned -1 and 255 instead of naming the two teams, so with no score a `WinnerTeamNum` of 2 was a
  winner again (round 3's fix undone, and its test case deleted), `1 << 32` set the wrong
  `teamsSeen` bit, and the `teamNum` doc was stale. [Fixed] `isTeamNum` is `0 | 1`; the
  out-of-range winner test is back (with 2 and 0.5), plus a roster test for team 32. Round 3's
  line "the test covers 1, -1, 255 and 2" holds again.
- After fixes: `bun run check` green, 358 tests; re-import and recompute give the same hashes.

### Round 6 (delta `89868f00..2ba3e1a1`: code-review high, security)
- **security**: no findings.
- **code-review high**: the scoreboard and the statfeed MVP still read `TeamNum` unchecked, so a
  scoreboard side 255 could be decided the winner (and a huge number could blow up `teamsIn`);
  the types didn't carry 0|1; Knockout may number teams above 1. This was the team rule a fourth
  time (rounds 3–6), so per the stop rule it went to the user, who chose "only 0 and 1"
  (2026-10-20, recommended option). [Fixed] One `teamOf` read (`TeamNum = 0 | 1`) at every team
  read: roster, scoreboard, `MatchEnded` winner, statfeed MVP; `RosterEntry.teamNum`, `winner` and
  `mvp` are typed `TeamNum`. Two reads stay raw on purpose: `resolveTarget` only compares two raw
  values for agreement, and `facts.endedWinnerTeamNum` keeps what was sent so a no contest is
  recognised. Tests first for the scoreboard side and the MVP team. Knockout:
  [Deferred → BACKLOG] watch item until a Knockout match is captured.
- After fixes: `bun run check` green, 360 tests; re-import and recompute give the same hashes.

### Round 7 (delta `2ba3e1a1..c0d55bc5`: code-review high, security)
- **security**: no findings.
- **code-review high**:
  1. A scoreboard with one real team decided that team the winner with no opponent. [Fixed]
  2. A scoreboard missing a team replaced an earlier good score. [Fixed] The score is replaced
     only by a state with both teams; with 1, the test covers both cases.
  3. The `teamOf` comment said "every team read" though two reads stay raw. [Fixed] It says every
     team number the summary stores as a team.
  4. `TeamNum` stopped at `MatchSummary`. [Fixed] `MatchRow.winnerTeamNum` and
     `PlayerRow.teamNum` are `TeamNum`; `result.ts` keeps `number` (src/shared takes no server
     types, and pages read plain integers from the database).
  5. A runtime `teamOf` only to narrow a type. [Fixed] `teamsIn` returns `TeamNum[]`, and the
     checks' `teamSum` takes a `TeamNum`.
  6. The MVP test pinned only two fields. [Fixed]
- After fixes: `bun run check` green, 360 tests; re-import and recompute give the same hashes.

### Round 8 (delta `c0d55bc5..0bab1aeb`: code-review high, security)
- **security**: no findings.
- **code-review high**:
  1. A side with no numeric `Score` counted as present (as 0), so it could still replace a good
     score. [Fixed] Only a side with a number counts; test added.
  2. `winner()`'s "MatchEnded team is in the score" test could no longer fail. [Fixed] Removed.
  3. The `winner_valid` comment still named the score. [Fixed]
  4. `MatchSummary.score`'s doc said null only with no state. [Fixed]
  5. Altitude: the "both teams or null" rule lived only in a runtime guard. [Fixed] `score` is
     typed `[number, number] | null`; `teamsIn` is gone (`TEAMS` is iterated instead), along with
     the `?? 0` fallbacks.
  6. A partial scoreboard is dropped whole, including a fresher value for the side it reports.
     [Disputed] No capture has had a partial scoreboard (the 46-match hashes are the same either
     way). Merging would mix one side from this moment with the other from an earlier one; with
     the rule as it is, a doubtful match gets no W/L rather than a possibly wrong one.
  7. A per-state array allocation for the full-scoreboard test. [Fixed] by 5.
  8. No test of a full scoreboard with an extra 255 side. [Fixed] Test added.
- After fixes: `bun run check` green, 361 tests; re-import and recompute give the same hashes.

### Round 9 (delta `0bab1aeb..46a3acab`: code-review high, security)
- **security**: no findings.
- **code-review high**:
  1. `goal_events_equal_score` kept `?? []` fallbacks. [Fixed]
  2. The `perTeam` doc named a missing `actual` and said "differs". [Fixed]
  3. The no-score guard lived both in `appliesTo` and inside `perTeam`. [Fixed] One `withScore`
     wrapper per score check; `hasScore` is gone (a skip and a pass both add no failure).
  4. The winner_valid test case still nulled the score. [Fixed]
  5. Negative or fractional goals passed into the score. [Fixed] Only whole numbers of 0 or more
     count; test added.
  6. The no-numeric-score test didn't pin the winner. [Fixed]
- After fixes: `bun run check` green, 361 tests; re-import and recompute give the same hashes.

### Round 10 (delta `46a3acab..e5d01b66`: code-review high, security)
- **security**: no findings.
- **code-review high**:
  1. Round 9's rejected goal values vanished without a log, flag or failed check. [Fixed]
     `facts.rejectedScoreboards` counts every scoreboard before `MatchEnded` without both teams'
     goals (partial ones included), and a new `scoreboards_complete` check flags the match. The
     scoreboard is still not used. None of the 46 real matches trips it (hashes unchanged).
  2. Rejected team goals and bad player stats were handled in opposite ways. [Fixed] by 1: both
     are now visible as a flag.
  3. The bad-goals test made both sides bad at once. [Fixed] A one-bad, one-good case is added.
  4. The `score` and `withScore` docs didn't cover rejected scoreboards. [Fixed]
  5. `perTeam` summed each failing team twice. [Fixed]
- TDD note: the new fact's tests were written first but not run red before the implementation.
- After fixes: `bun run check` green, 363 tests; re-import and recompute give the same hashes; no
  `scoreboards_complete` failures in the log.

### Round 11 (delta `e5d01b66..80859956`: code-review high, security)
- **security**: no findings. **code-review high**: no correctness bug; five low items.
  1. No test that bad goal values are counted as a rejected scoreboard. [Fixed]
  2. No test that a partial scoreboard after `MatchEnded` isn't counted. [Fixed]
  3. An empty `Teams: []` would be counted. [Verified, no fix needed] No real state sends one (0
     rejections over 46 matches, loading and countdown included), and if one did, a visible flag
     is the intended outcome, not a wrong result.
  4. A previous match's retagged teardown could be counted against the next. [Verified, no fix
     needed] The real retagged teardowns (round 3) carry full scoreboards; 0 rejections.
  5. A bad value next to a valid entry for the same team, or on a 255 side, isn't counted.
     [Verified, no fix needed] A 255 side isn't a team by the user's rule; duplicate team
     entries have never been seen, and the scoreboard used is still full and valid.
- After fixes (test-only): `bun run check` green, 363 tests.

### Round 12 (delta `80859956..7b1a7b81`, test-only: code-review low)
- No findings. Review closed.
