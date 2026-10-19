# WP3a: Recorder — plan

Tier: **Substantial** (a new module, design forks). Roadmap: `docs/plans/2026-10-16-v1-roadmap.md` § WP3a.
Inputs: `docs/research/2026-10-19-weekend-captures.md` (findings + the user's WP3a requirements),
`docs/research/2026-10-15-live-capture-findings.md`, captures in `captures/` (gitignored).

## Context
WP2 built storage (`raw.db` `events(match_guid, seq, ts, name, data)`, retention that takes an
`isRecording()` predicate). WP3a is the piece that turns the game's Stats API stream into stored raw
events grouped into matches, and tells WP4 when a match is finished. The weekend captures showed
the stream can't be read literally:
- every goal is sent twice;
- after a private game, the old match's teardown carries the *next* match's guid;
- a lobby can come and go without a game;
- the final `Players` list isn't the roster;
- the winner comes only from `MatchEnded`.

The user asked for these to be handled by design rather than patched per stat:
- built-in dedup;
- one source of truth each for winner and MVP;
- a sanity check on every stat a record carries;
- declarative structure (a state machine, handler tables, rules as data);
- bots flagged.

### User decisions (2026-10-19)
1. **Transport: WebSocket** (`ws://127.0.0.1:49124`), not TCP. *Revisits the roadmap's TCP line:*
   - every capture used the WebSocket port;
   - each WebSocket frame holds exactly one envelope, so the framing parser and its split/merged-chunk tests go;
   - `Data` is still a JSON string and is parsed twice.
2. **Store raw, dedup on read.**
   - `raw.db` keeps what arrived (minus `UpdateState` downsampling and repeated `Loadout`), filed under the match the lifecycle assigns it to.
   - One pure dedup stage (a rule table) runs before anything reads a match, both live and in WP4's `recompute`, so a fixed rule reaches old matches through recompute.
3. **Scope split.** WP3a builds a `MatchSummary` plus the check table and passes both to the finished hook:
   - the summary holds the end kind, score, winner, MVP and the roster built across the match, with leavers and bots flagged;
   - nothing is persisted as a record;
   - WP4 adds its stats and results as more rows in the same handler and check tables.
4. **Orphan timeout: 10 min** with no events for the open match.
   - Also orphan at startup, and when a new `MatchCreated` with another guid supersedes the open match.
   - If a closed guid comes back (Reconnect), it reopens: seq continues and the hook fires again, so WP4 must upsert.

## Observed lifecycle the design rests on (from the 4 captures)
- A normal online match: `UpdateState`/`MatchCreated` (new guid) → `MatchInitialized` (0–16 s later) →
  … → `MatchEnded{WinnerTeamNum}` → `PodiumStart` (sometimes absent) → `MatchDestroyed` (same guid).
- **Private teardown:**
  - After `PodiumStart`, `UpdateState` arrives under the *next* guid while still showing the old game (old arena, final score, `Winner`, `bReplay`).
  - Then `MatchDestroyed` (next guid), `PlayerLeft`s (guid `''`), then `MatchCreated` (next guid).
  - Seen at every private transition on Oct 18: AB08928E, D900F932, E3A3166C, D7B2C270.
- **Lobby with no game:** D900F932 had `MatchCreated` → `PlayerJoined`/`PlayerLeft` → `MatchDestroyed`, and no `MatchInitialized`, `CountdownBegin` or `RoundStarted`.
- **Joined in progress:** no `MatchInitialized` (Oct 15 B58BBD70, which has `MatchCreated`; Oct 18 C8B8E12E, whose recording started mid-match).
  - A match whose `MatchCreated` arrived with guid `''` but which has `MatchInitialized` is a normal start (Oct 17 7F4CF85A).
- **Left during the countdown:** `MatchInitialized` then `MatchDestroyed` (Oct 15 C6C0A6B4; leading `PlaylistId: 0`).
- **Left mid-match:** `MatchDestroyed` with no `MatchEnded` (Oct 15 5ABAFA02).
- Freeplay and training, plus the post-match background scene: guid `''` throughout, so ignored.

**Attribution rule that follows:**
- The recorder serves **one open match at a time**, and **`MatchDestroyed` always closes the open match**, whatever guid it carries.
- Any event with a non-empty guid while a match is open is filed under the open match.
- A `MatchCreated` with a *different* guid supersedes the open match in **any** open state (orphaning it). It never happens on the captures (checked by the plan reviewer), so this is a safety net against a lost `MatchDestroyed`.
- Any other event with a different guid is:
  - expected in the `ended` state (logged once as `teardown_retagged`);
  - a warning in `live` or `pending` (`guid_mismatch`).
- Guid `''` is ignored everywhere.
- Attribution is fixed at write time (`match_guid` column), so `recompute` can't repair a wrong one. Only the dedup rules reach old matches. The ADR says so.

## Design

All in `src/server/recorder/`, in plain functions plus data tables, matching WP1/WP2's idiom.

| File | Responsibility |
|---|---|
| `envelope.ts` | `parseFrame(raw)` → `{name, guid, data}` or a typed parse error (outer JSON, string `Event`, `Data` JSON string or object). |
| `sampler.ts` | **Moved** from `scripts/capture.ts` (`createUpdateStateSampler`, ~1 state/500 ms plus the latest state held before each event). `capture.ts` imports it; its tests move with it. |
| `lifecycle.ts` | Pure state machine. States `none → pending → live → ended → (closed)`. **Transition table** keyed `[state][eventName]` with a per-state default. `step(state, ev)` returns `{state, fileUnder: guid \| null, effects[]}`. Effects: `opened`, `live{joinedInProgress}`, `ended`, `closed{reason}`, `superseded`, `retagged`. Live triggers: `MatchInitialized`, `CountdownBegin`, `RoundStarted`, `GoalScored`. `MatchEnded` goes from `pending` or `live` to `ended`. A close from `pending` is a **lobby** (no hook). |
| `store.ts` | Raw writes and reads on `Db`: `nextSeq(guid)` (`MAX(seq)+1`, so a reopened guid continues), `insert`, `lastEvent()`, `matchEvents(guid)`. Strips `Players[].Loadout` after a player's first stored copy in that match. Skips leading `PlaylistId: 0` states. |
| `dedup.ts` | **Rule table** `{id, isDuplicate(ev, prevSameName, ctx)}`. `dedupe(events)` → `{kept, dropped: {ruleId: n}}`. Rules: `replay_goal` (a `GoalScored` with empty `Scorer.Name` AND `GoalSpeed` 0 AND `GoalTime` 0), `repeat_crossbar` (identical to the previous `CrossbarHit`), `repeat_ballhit` (identical to the previous `BallHit`). |
| `summary.ts` | **Per-event handler table** folding deduped events into a `MatchSummary` (fields below). WP4 adds handlers here. |
| `checks.ts` | **Check table** `{id, appliesTo(summary), run(summary, events) → null \| detail}`. `runChecks` → failures. A failure is logged and its id is added to `summary.flags`; the record isn't dropped. |
| `known-fields.ts` | Data: known event names and keys per event, plus `Game` and `Player` keys, built from every key seen in the 4 captures. Unknown names and fields are logged once per run. |
| `recorder.ts` | `createRecorder({raw, logger, now, onMatchFinished, orphanTimeoutMs})`. Methods: `handleFrame(raw, t)`, `recoverAtStartup()`, `checkIdle(t)`, `isRecording()`, `status()`, `flush()`. Glue only: envelope → unknown-field log → sampler → lifecycle → store → on close: `matchEvents` → `dedupe` → summary → checks → hook. Contracts: `isRecording()` is true in `pending`, `live` and `ended`. `onMatchFinished(summary, failures)` is **synchronous** (`=> void`; bun:sqlite is sync), so the try/catch around it sees every failure. The sampler's held state is **flushed before any close** (`checkIdle` orphaning, a supersede, the socket closing, shutdown), so a crash keeps the last scoreboard, as `capture.ts` does on disconnect. |
| `client.ts` | WebSocket client (Bun's global `WebSocket`, like `capture.ts`). URL from `STATS_API_URL`, defaulting to `ws://127.0.0.1:${STATS_API_PORT}`, so `bun run start` can point at `replay.ts`. Reconnect after 5 s, doubling to 30 s (pure `nextDelay`), reset on open. On close it calls `recorder.flush()`. Connection status `waiting \| connected \| recording`; "Stats API off" needs process detection and is WP3b's. |

**Close reasons and end kind:**
- `MatchDestroyed` after `ended`: `completed`, or `early_end` when the match had no overtime and the clock showed time left. *(Changed in step 7: every match gets a `TimeSeconds: 0` reading just before `MatchEnded`, so the rule reads the reading before that 0. It is an early end if that reading was above 1.)*
- `MatchDestroyed` while `live`: `left`.
- `MatchDestroyed` while `pending`: lobby, discarded with no hook.
- Orphaned closes record their cause: `timeout`, `restart` or `superseded`.
  - A synthetic **`RecorderClosed{reason}`** event is appended for these.
  - The stream's own `MatchDestroyed` is the marker otherwise.
- At startup, `recoverAtStartup()` reads `lastEvent()`. Matches are serial, so only the last match can be unclosed. If that event isn't `MatchDestroyed` or `RecorderClosed`, the recorder folds that guid's stored events through `step` to get its state, then orphans it with cause `restart`.
- **Orphaning a `pending` match** (timeout, restart or supersede) discards it as a lobby: no hook, logged `lobby_discarded{cause}`. It never reached a live trigger.
- **Reopen**: when a guid with stored rows arrives again, its state is rebuilt by folding its stored events through `step`, so it resumes as `live` or `ended`, not `pending`. A reconnect followed by a quick leave therefore still fires the hook. Seq continues from `MAX(seq)+1`.

**`MatchSummary`** (the one source for each fact):
- `guid`, `playlistId` (the last non-zero), `arena`, `startedAt`, `endedAt`.
- `endKind`: completed / early_end / left / orphaned.
- `joinedInProgress` (live with no `MatchInitialized`), `overtime`.
- `score[team]`: the last `UpdateState` at or before `MatchEnded`, else the last one.
- `winnerTeamNum`: **only from `MatchEnded.WinnerTeamNum`**, else null.
- `mvp`: **only from `StatfeedEvent` `EventName: "MVP"`** `MainTarget`, else null. It is resolved to a `PrimaryId` through the `Shortcut` map of the **latest `UpdateState` before that event**, because `Shortcut` changes during a match. The lookup is cross-checked on Name and TeamNum, and unresolved if they disagree.
- `roster`: built across every `UpdateState`, keyed by `PrimaryId`, or `bot:<Name>` for bots since they share `Unknown|0|0`.
  - Each player has name, last team that isn't 255, `isBot`, `presentAtEnd`, and their last scoreboard line (Score, Goals, Shots, Assists, Saves, Touches, Demos).
- `dedupDropped`, `flags[]`.

**Checks (v1 rows):**
- `winner_valid`: when `MatchEnded` came, `WinnerTeamNum` is 0 or 1 and matches a team in the score. The "winner only from `MatchEnded`" half holds by construction in `summary.ts` and is unit-tested there, not checked at runtime.
- `mvp_count`: at most one MVP; exactly one when `PodiumStart` came. F6FE4498 (Oct 17) has `MatchEnded` with no podium and no MVP, so "MVP iff `MatchEnded`" would misfire.
- `mvp_on_roster`.
- `goal_events_equal_score`: deduped live `GoalScored` count equals the score total. This validates dedup itself. Skipped when joined in progress.
- `player_goals_equal_score`: the roster's goals per team equal that team's score. Own goals are the known false positive; the capture sweep in step 9 measures it.
- `clock_non_negative`: every `TimeSeconds` ≥ 0.

**Errors and logging** (categories `stats_api` and `recorder`, via `log.ts`):
- `stats_api/connected`, `disconnected{code, events}`.
- `connect_failed` once per streak, then `still_waiting` every 5 min.
- `bad_frame` once per connection, with the reason.
- `recorder/status{from,to}`.
- `match_opened{guid, playlist}`, `match_live{joinedInProgress}`, `match_ended{winner}`.
- `match_closed{guid, reason, events, dedupDropped}`, `lobby_discarded`, `reopened{guid, fromSeq}`.
- `teardown_retagged{from,to}` once per match; `guid_mismatch` (warn).
- `unknown_event`, `unknown_field` (once per run).
- `check_failed{guid, check, detail}` (warn); `summary{guid, endKind, score, winner, mvp, flags}`.
- `store_failed` (error): the first per match, plus a count at close. The event is dropped, and recording continues.
- `hook_failed` and `summary_failed` (error): deliberate broad catches at the hook boundary, so a WP4 bug can't stop recording.

The questions these logs answer:
- Why was a match split, merged or discarded?
- Why is there no recap?
- Is the stream healthy?
- Which checks fail, and how often?

**`main.ts`**: opens storage, `recoverAtStartup()`, starts the client and a 30 s `checkIdle` timer, and stops cleanly on SIGINT, SIGTERM or SIGHUP by flushing the sampler and closing storage. `isRecording` is exposed for WP3b, which wires maintenance and the HTTP host (per the roadmap's WP2 notes).

**Scripts:**
- `scripts/make-fixture.ts <capture> --from <ISO> --to <ISO> --out <name>`:
  - Slices a time window and resamples `UpdateState` to about 0.5/s, keeping the held-before-event state. It strips repeated `Loadout`.
  - **Anonymises by field, not by text**: parses `raw` → `Data` and replaces values only in the name and ID fields (`Players[].Name/PrimaryId`, `PlayerName`, `PrimaryId`, `MainTarget`/`SecondaryTarget`/`Game.Target`/`Scorer`/`Assister`/`BallLastTouch.Player` `.Name`, `Teams[].Name`, `Game.Winner`), then re-serialises with the same double encoding.
  - Bots and Blue/Orange stay. Fake IDs are stable and keep their platform prefix.
  - The anonymiser is a pure function with its own unit test.
  - The leak check runs on the **decoded** text: no mapped real value remains.
  - It asserts the total `test/fixtures/` size stays under 5 MB. The reviewer measured about 6 MB at 1/s.
- `scripts/replay.ts <file> [--speed N] [--port P]`: a fake Stats API (a `Bun.serve` WebSocket) streaming `raw` lines with their `t` gaps ÷ speed.
- `scripts/import-capture.ts <file>`: feeds a capture or fixture through `createRecorder` using **the file's `t`** (BACKLOG note), calling `checkIdle(t)` before each frame so in-file gaps orphan matches just as live play does. It writes into the data dir (or `RLTRACKER_DATA_DIR`), so WP4 can work on real weekend data. Tests use the same feed helper.

**Fixtures** (`test/fixtures/*.ndjson`, total target < 5 MB; windows picked from the timelines):

| Fixture | Source | Exercises |
|---|---|---|
| `completed` | Oct 17 CB59BD4E | normal end, podium |
| `early-end` | Oct 17 0116A7EE | winner 0 at a 2–3 score (forfeit) |
| `overtime-leavers` | Oct 18 15676E50 | overtime, roster with only 2 of 6 present at the end |
| `joined-in-progress` | Oct 18 start, C8B8E12E | no `MatchCreated` or `MatchInitialized` |
| `left-early` | Oct 15 5ABAFA02 | `MatchDestroyed` without `MatchEnded` |
| `left-countdown` | Oct 15 C6C0A6B4 | leading `PlaylistId 0`, left before kickoff |
| `private-series` | Oct 18 22:45:55–22:49:10 | AB08928E end + retagged teardown, D900F932 lobby + second destroy, E5DD9F7A left open |
| `freeplay` | Oct 17 21:44:35–21:45:30 | guid `''`, nothing stored |

Orphan cases come from truncating `completed` in tests.

## Steps
1. Save this plan to `docs/plans/2026-10-19-wp3a-recorder.md`. Mark WP3a as in progress in the roadmap. Fix the roadmap's WP3a transport and test lines (WebSocket; why), and note in WP4 that the hook can fire twice per guid (upsert). Correct the research note's MVP count: "41 of 41" becomes 41 MVPs across 42 `MatchEnded`, with F6FE4498 having no podium and no MVP.
2. `make-fixture.ts`: TDD the anonymiser, generate the 8 fixtures, and confirm the leak and size assertions pass.
3. Move the sampler to `src/server/recorder/sampler.ts` (tests move too) and repoint `capture.ts`.
4. TDD `envelope.ts` and `lifecycle.ts`: table-driven transition tests, including:
   - the retag;
   - the lobby;
   - supersede from `pending`, `live` and `ended`;
   - `MatchEnded` from `pending`;
   - orphaning a `pending` match (discarded);
   - rebuilding state by folding stored events.
5. TDD `store.ts` (temp DB): seq continuation, `Loadout` stripping, `PlaylistId 0` skip, `lastEvent`.
6. TDD `dedup.ts`, `summary.ts` and `checks.ts`:
   - an expected summary per fixture;
   - each check row fails on a synthetic summary built to break it;
   - the MVP lookup uses the `Shortcut` map from the time of the MVP event.
   - Midpoint: offer `/compact` with a resume prompt.
7. `recorder.ts` + `known-fields.ts` (integration on temp storage, each fixture fed with the file's `t`):
   - stored counts by event name;
   - hook calls (guid, endKind) and `isRecording` over time;
   - orphan at startup, on timeout (injected clock) and when superseded;
   - reopen, including reconnect then quick leave, which still fires the hook;
   - the held state is flushed before an idle orphan, so the last scoreboard is stored;
   - unknown fields logged once;
   - `store_failed` fired once for real (closed `Db`), and a throwing hook.
8. `client.ts` + `replay.ts` + `main.ts` (live code, `tdd-live-code-carveout`'s repro-first path):
   - `nextDelay` unit test;
   - status goes `waiting → connected → recording → connected → waiting` across a replayed fixture and a server stop;
   - one test streaming a fixture through `replay.ts` on a random port at fast speed: every non-`UpdateState` event is stored and the hook calls match the import path (exact `UpdateState` counts are only asserted on the import path, because fast replay compresses time);
   - connect-failed run once for real with the port closed.
9. `import-capture.ts`: import all 4 real captures into a scratch data dir. Read the `summary` and `check_failed` lines; every match from the research note should appear with the expected end kind. Fix rules that misfire, or record the known false positives.
10. `bun run check` green → `/compact` line → `independent-review-pass` → `documentation-backlog-hygiene`: `PROJECT_INDEX`, BACKLOG "Next:" → WP3b, the roadmap status, and an ADR if the gate says so (transport switch; store-raw/dedup-on-read).

## Verification
- `bun run check` (typecheck, lint, Vitest) passes.
- Every fixture is replayed through `scripts/replay.ts` with `bun run start` pointed at it (port override env var), and the log shows the expected `match_closed` and `summary` lines. This is the roadmap's done-criterion.
- Step 9's real-capture import:
  - all 42 matches with `MatchEnded` have `endKind` completed or early_end and a winner;
  - 41 have one MVP, and F6FE4498 has none, without a `mvp_count` failure;
  - the Oct 15 leaves are `left`;
  - D900F932 is logged as a lobby;
  - no duplicate `match_closed` appears for D900F932 or D7B2C270.

## Verification results (2026-10-19)
- `bun run check`: 202 tests pass, with tsc and eslint clean.
- **Live replay**, `scripts/replay.ts` at 20–100× into `bun run start` (`STATS_API_URL`), each fixture in its own data dir:
  - each fixture's `summary` line matched its integration test;
  - private-series logged `teardown_retagged` AB08→D900 and `lobby_discarded` D900, and left E5DD open;
  - a restart on that data dir logged `recovered` and closed E5DD via `restart` as `orphaned`, at 1–0;
  - freeplay stored nothing.
  - A run left reconnecting to a replay that was still serving got the same stream again: AB08 reopened, its hook fired again, and the doubled MVP count was flagged by `mvp_count`.
- **Connect failed**, with nothing listening: `stats_api/connect_failed` logged once, `retryMs: 5000`.
- **Import of all 4 captures** (`scripts/import-capture.ts`, scratch data dir): 46 matches finished.
  - 42 with `MatchEnded`: 33 completed, 9 early_end, each with a winner. 41 have a resolved MVP; F6FE4498 has none and isn't flagged.
  - Oct 15: 4 leaves, all `left` (B58BBD70, 5ABAFA02, C6C0A6B4, E738BA80).
  - The D900F932 lobby was discarded; 47 `match_closed` lines, none for the same guid twice.
  - 5 retagged teardowns; 0 `guid_mismatch`, `unknown_event`, `unknown_field`, `bad_frame` or `store_failed`.
- Two rules changed because of what the tests found:
  - **Early end**: every match gets a `TimeSeconds: 0` reading just before `MatchEnded`, so the rule reads the reading before that 0. The 0116A7EE fixture caught it.
  - **`player_goals_equal_score`**: for a joined-in-progress match it allows the roster to fall short of the score, because a scorer who left before the recording is on no roster (B58BBD70). It was the only check failure in the import.
- **Not exercised**: the SIGINT/SIGTERM/SIGHUP shutdown. Git Bash `kill -INT` doesn't deliver a console Ctrl+C to a native Windows process, so it needs a manual Ctrl+C on `bun run start` during a match.

## Plan review
One round by `plan-reviewer` (opus). The reviewer simulated the attribution rule on all 4 captures: 41 matches plus the lobby came out as expected, with no gap over 10 minutes inside a match, no `guid_mismatch` while live, and 0 `bad_frame` lines.

| # | Finding | Disposition |
|---|---|---|
| 1 | 42 `MatchEnded` but 41 MVPs (F6FE4498: no podium, no MVP), so `mvp_count` and the "41" target were wrong | Fixed: `mvp_count` keyed on `PodiumStart`; Verification and step 1 corrected |
| 2 | Supersede defined only for `live` | Fixed: in any open state; test row added |
| 3 | Closing `pending` on timeout or restart, and the state on reopen, were undefined | Fixed: orphaned `pending` = lobby discard; state rebuilt by folding stored events; tests added |
| 4 | Text-replacement anonymising is fragile (escapes, common names) | Fixed: field-level replace, decoded leak check, unit-tested anonymiser |
| 5 | Held sampler state not flushed on idle close or disconnect | Fixed: flushed before every close; test added |
| 6 | Fixtures about 6 MB at 1/s | Fixed: 0.5/s and a size assertion |
| 7 | MVP `Shortcut` changes during a match | Fixed: the map from the latest state before the MVP event, cross-checked |
| 8 | The import path never fires the timeout | Fixed: `checkIdle(t)` per frame |
| 9 | `isRecording` states, hook sync/async and attribution irreversibility unstated | Fixed: contracts stated; ADR note |
| 10 | Thin seams: check rows, client status; winner half untestable | Fixed: per-row failing tests, status test, check narrowed to `winner_valid` |

The replay-goal rule uses AND across empty scorer, `GoalSpeed` 0 and `GoalTime` 0 (always seen together).

## Deviations from the plan (recorded at review)
- **Three more check rows:** `assists_within_goals`, `player_stats_non_negative` and `playlist_present`. In the step-9 import of all 4 captures, none of them failed.
- **Check inputs:**
  - `run(summary)` reads `summary.facts` (`sawMatchEnded`, `sawPodium`, `mvpCount`, `liveGoals`, `minClock`) instead of taking the events, so checks stay pure over one value.
  - `facts` is part of the hook's `MatchSummary`. WP4 may read it but shouldn't persist it as stats.
- **Where the idle check runs:** the 30 s `checkIdle` timer lives in `client.ts`, next to the socket it watches, not in `main.ts`.
- **Log fields:**
  - `disconnected` logs `frames`, not `events`, because it counts WebSocket frames, before sampling.
  - `bad_frame` is logged once per run per reason, not once per connection. All 4 captures had 0 bad frames, and `disconnected{frames}` shows per-connection traffic.
- **Exposing `isRecording`:** `main.ts` doesn't expose it yet. WP3b wires it into retention when it builds the HTTP host.
- **Leading `PlaylistId 0`:** only the states before the match's first non-zero playlist are skipped. A later 0 is stored, because raw.db is the record and recompute can't recover a dropped state.

## Review log

### Round 1 (snapshot `72bd084`; Substantial: about 2,800 non-fixture lines)
Passes run:
- `/code-review high`: 10 findings.
- `arch-reviewer` (sonnet): 3 risks, 8 nits, 1 question.
- `security-reviewer`: none. It noted, below its threshold, that the MVP name appears in a `check_failed` detail, in the local log only.
- `/simplify`: 4 agents.

| Source | Finding | Disposition |
|---|---|---|
| CR | `trimForStorage` threw on a non-object `Players` entry, outside every catch, so it could crash the process | [Fixed] guarded in `stripRepeatLoadouts`; test |
| CR | A failed `nextSeq` fell back to seq 0, colliding with a reopened match's rows | [Fixed] seq stays null and is retried at each write; test with a flaky `get` |
| CR | Dedup rules were in a Map keyed by event, so a second rule for one event silently replaced the first | [Fixed] the rule table is scanned. No regression test: no event has two rules yet |
| CR | Every `PlaylistId 0` state was skipped, not only the leading ones | [Fixed] per-match `sawPlaylist`; test |
| CR | Retagged states after `MatchEnded` overwrote playlist and arena | [Fixed] both frozen with the scoreboard; test |
| CR | `make-fixture` crashed on a torn last line | [Fixed] shares `parseCaptureLine` with `readCapture` |
| CR + arch | `bad_frame` is once per run, not once per connection | [Verified, no fix needed] recorded above |
| CR | The `main.ts` catch comment was wrong once `statsApiUrl` joined the try | [Fixed] |
| CR | `make-fixture` re-implemented Loadout stripping, keyed by PrimaryId (so only one bot's loadout was kept) | [Fixed] uses `stripRepeatLoadouts`. Existing fixtures not regenerated: nothing reads bot loadouts, and the freeplay fixture regenerates byte-identical |
| CR | `unknownFields` runs on every frame before sampling | [Disputed] about 1 ms/s at 30 frames/s, per the efficiency agent. Checking every frame is what catches a field that only appears in dropped states |
| arch | A throw inside frame handling escaped into the socket handler | [Fixed] broad catch in `handleFrame`, logging `frame_failed` once per event name; test |
| arch | `closeOrphan` in `recoverAtStartup` sits outside the try | [Verified, no fix needed] `finish` and `storeEvent` catch their own failures, and `current()` can't miss right after `open` |
| arch | Extra checks, `facts`, timer location, `frames`, `isRecording` not recorded | [Fixed] "Deviations" above |
| arch | The `checks.ts` MVP comment retold an incident | [Fixed] |
| arch | `joinedInProgress` is derived in both lifecycle and summary | [Fixed] comment: the summary re-derives it from stored events so recompute needs only raw.db |
| arch | PROJECT_INDEX, BACKLOG and the ADR are missing | [Verified, no fix needed] step 10, done after the review |
| arch | The research note narrates its own correction | [Fixed] |
| simplify | Three duplicate signal handlers; a duplicate `isObject`; nested key loops in `known-fields`; the `presentAtEnd` Set plus remap | [Fixed] |
| simplify | Make `step` emit ordered store effects instead of `fileUnder` plus the destroy ordering in `process` | [Disputed] it reshapes every lifecycle table test for one ordering, which a comment documents in one place. Revisit if WP4 adds a second ordering constraint |
| simplify | Fixtures should use `trimForStorage` too | [Disputed] fixtures keep the leading `PlaylistId 0` states, so the recorder's skip is tested on them |
| simplify | Sampler option instead of `make-fixture`'s `NO_HELD_STATE` | [Disputed] the divergence is fixture-only and documented; a live option would have no live caller |
| simplify | `capture.ts` reimplements the envelope parse, URL and reconnect | [Deferred → BACKLOG] pre-existing code that this diff only repointed at the shared sampler |
| simplify | `onStatus`/`status()` have no caller yet | [Disputed] WP3b's connection display is the next package; the test uses them |
| simplify | One `Record` instead of a dedup scan; `score ?? []` repeats in checks; `Frame.event` copy; `Sampler` type export; shared test fixture loader | [Disputed] minor, or conflicts with the CR dedup fix |
| efficiency | Prepared statements in `Db.run`; `PRAGMA synchronous = NORMAL` on raw.db | [Deferred → BACKLOG] WP2 code outside this diff |

`bun run check` after the fixes: 207 tests pass. `make-fixture` was re-run live on the Oct 17 freeplay window and gave a byte-identical fixture.

### Round 2 (delta from `72bd084`)
Passes run: `/code-review low`, `arch-reviewer` (sonnet) and `security-reviewer`, on the delta. No new findings. Two nits were fixed without reopening the round:
- the `nextSeq` comment now says a failed retry is logged as the insert's;
- the import order in `make-fixture.ts`.

Review closed.

Review: code-review high, arch (sonnet), security, simplify; 2 rounds; 14 fixed, 2 deferred to BACKLOG, 9 disputed or no fix needed (counted by review-log row).
