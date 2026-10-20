# WP4b: Match-record extras and goal map

## Context
WP4a (`docs/plans/2026-10-20-wp4a-match-records.md`, ADR
`docs/decisions/2026-10-20-match-records-per-player.md`) stores neutral per-player match records:
every player's row, with "you" resolved at read time. WP4b adds what the Recap page's extras cards
and goal map need (roadmap `docs/plans/2026-10-16-v1-roadmap.md`, WP4 scope; feature map "Recap
layout"):
- the extras: hardest shot, crossbar hits, aerial touches, average boost, supersonic %, time on
  empty boost;
- one goal-map point per goal: location, deflected, aerial, speed, distance and height, plus the
  scorer for "your share", and pure own goals as a count.

The backlog's order is the post-WP4a milestone (autostart, play normally), then WP4b. Planning now
doesn't clash with that: `recompute` backfills the extras for any match still in the 90-day raw
retention.

**Done when**: each fixture match yields its expected extras and goals, a live replay writes the
same rows as `recompute`, and the 46 real captured matches import without unexplained flags.

## Facts this plan rests on (measured 2026-10-20 on the 4 captures: 214 live goals, 9,196 touches)
- **Field orientation**: team 0 attacks +Y (goal line Y = 5120) and team 1 attacks −Y. Side walls
  are at |X| 4096.
- **Live play** runs from `RoundStarted` to the live `GoalScored` or `MatchEnded`. `CountdownBegin`
  starts each kickoff countdown. No `BallHit` came during replays (fixture `completed`: 212 of 212
  in live play), but `CrossbarHit` does fire in replays and on the podium. `MatchPaused` and
  `MatchUnpaused` exist.
- **Goal origin**: taking the scoring team's last touch since `RoundStarted` worked. The
  measurement credited only `Players[0]` and gave 40 deflected goals and 1 "own goal" (5ABAFA).
  Plan review showed that one is a kickoff 50/50, a single `BallHit` listing both players, with
  the scorer second. So **every `Players` entry is a hitter**: 100 of 1,164 fixture hits list
  two. The real counts are re-measured at step 10, and 0 own goals are expected.
- **Aerial**: every `AerialGoal` statfeed (23) had its scoring touch at ball Z 558–1066. All but
  5 non-aerial goals were at Z ≤ 430, and those 5 were at 441–1109, likely off walls. Of all
  touches at Z ≥ 550, 334 of 768 (43%) were within 300 uu of a wall.
- **Speeds** are km/h. `BallHit.Ball.PostHitSpeed` peaked at 177 (p99 131), and live
  `GoalScored.GoalSpeed` gives the goal's speed. The game's `LongGoal` doesn't follow one simple
  distance rule, so the range classes below are ours.
- **The Shot statfeed arrives late**, often at the save (0.1–1.7 s after the touch). So a shot's
  speed is the shooter's last live touch before their `Shot` event.
- **Car state** (`bHasCar`, `Boost`, `bSupersonic`; a falsy field is left out) comes only for
  your own team, from `UpdateState` stored at about 2/s (`UPDATE_STATE_INTERVAL_MS` 500).
- **Attribution**: `BallHit.Players[0]`, `CrossbarHit.BallLastTouch.Player`, `GoalScored.Scorer`
  and `Assister` carry only Name, Shortcut and TeamNum. They're resolved like a statfeed target,
  with summary.ts's `resolveTarget`.

## User decisions (2026-10-20)
1. **Hardest shot counts shots, not every hit**: the speed of the shooter's last live hit before
   each of their `Shot` statfeeds, plus each goal's origin hit (5 of 28 fixture goals had no
   `Shot` statfeed, e.g. one off the bar). Null when the player had neither.
2. **Aerial touch**: ball Z ≥ 550 at the touch, and away from every wall: |X| ≤ 3796,
   |Y| ≤ 4820 and |X|+|Y| ≤ 7640, i.e. 300 uu off the side, back and corner walls. It misses some
   real aerials off the backboard, but wall rides don't count.
3. **Touch merge**: the game sends a `BallHit` for every contact, and unique hits run 1.2–1.8×
   the scoreboard's `Touches`. So a player's hit counts as a new *touch* only when another player
   has touched the ball since, or 1 s has passed since that player's last counted touch. Speeds
   and goal origins still read the raw hits.
4. **Woodwork**: `CrossbarHit` also fires for the posts (the first one in `completed` is a post
   hit at Z 136), so the stat is `woodwork_hits`.

## Approach

### Refinements to the roadmap's registry (stated so they aren't silent)
- The roadmap planned stats as `compute(events, summary)`. Here every stat reads a shared **play
  view** built in one pass instead: live-only touches, shots, crossbars, goals and car samples,
  each already attributed. Otherwise every stat would re-implement the live-window rule and the
  Shortcut resolution.
- The roadmap planned `scope: player|match`, but there's no match-scope stat: own goals and goal
  speeds come from `match_goals` rows, and WP5a reads them from there. So the registry is
  player-scoped only. `scope` can come back when the first match stat does.
- One migration (3) holds this WP's columns. Later stats get one migration each, as planned.
- The goal **range class** (close / mid / long) is a read-time function in `src/shared/`, like the
  playlist map, so changing a threshold reaches every match, including those past retention.
  Distance is stored, since it's fixed geometry.

### 1. Shared target resolution: `src/server/recorder/players.ts`
Move `resolveTarget` out of `summary.ts` as
`resolveTarget(latestPlayers: Data[], roster: Iterable<{key, name, teamNum}>, target: Data)`. It
returns the Shortcut match if Name and TeamNum agree, else a unique name+team match on the roster.
Summary calls it with `acc.latestPlayers` and `acc.roster.values()`, and its behaviour doesn't
change (the summary tests stay green).

### 2. Play view: `src/server/recorder/play.ts` (new, pure)
`buildPlay(events, summary): Play` runs one fold, with a handler table like `summary.ts`, over the
deduped events and `summary.roster`.
- **Phase**: `countdown | play | replay | paused | ended`. A match joined in progress
  (`summary.joinedInProgress`) starts in `play`, any other match in `countdown`. The transitions
  are `CountdownBegin` → countdown, `RoundStarted` → play, live `GoalScored` → replay (dedup has
  already dropped the replay copy), `MatchPaused` → paused (and `MatchUnpaused` back to the phase
  before it), and `MatchEnded` → ended, which is final.
- `UpdateState`: always updates `latestPlayers` for resolution. In `play` with
  `Game.bReplay !== true`, it adds one car sample per player with `bHasCar` true:
  `{key, boost: num(Boost) ?? 0, supersonic: bSupersonic === true}`. Each sample is weighted by
  the gap to the next in-play `UpdateState`, capped at 1000 ms (`CAR_SAMPLE_CAP_MS`), and a
  stretch's last state weighs 0.
- `BallHit` in play: one hit event `{ts, hitters: [{key, team}], speedKmh, x, y, z}`, where
  **every entry of `Players` is a hitter** (a 50/50 lists both). It's added to `hits` and to
  `sinceKickoff`, which `RoundStarted` resets.
  - Per hitter, the touch merge (decision 3) decides whether it is a new counted touch in
    `touches[key]`. It is when another player hit since that player's last counted touch, or
    `TOUCH_MERGE_MS` (1000) has passed.
- `StatfeedEvent` `Shot` in play: the shooter's last hit in `sinceKickoff` adds a `shots[key]`
  speed; with no such hit, `facts.shotsWithoutTouch++`. An `AerialGoal` is held as pending for
  its target's key.
- `CrossbarHit` in play: counted as woodwork for the `BallLastTouch.Player` key unless it's
  within 1000 ms of the last counted one (`WOODWORK_WINDOW_MS`; a ball rolling along the bar).
- Live `GoalScored`, with scorer and assister resolved:
  - **Team**: `teamOf(Scorer.TeamNum)` when the scorer resolves. Otherwise (an empty or unknown
    scorer: a real own goal might send one, and none has been seen) the goal gets no point and
    counts in `facts.droppedGoals`. That is the user's choice after review round 4. Inferring
    the team from the scoreboard drew a new finding in each of four rounds, for a case never
    seen. The original "held until the score rises" design is in the Review log.
  - **Origin** = the last hit event in `sinceKickoff` with a hitter on the scoring team; the
    toucher is that hitter. `deflected` means a *later* hit event has an other-team hitter. The
    other team's player inside the origin event itself (a 50/50) is not a deflection.
  - No origin means an own goal: location, distance and toucher are null.
  - `facts.lastTouchDisagrees++` when the last hit event in `sinceKickoff` doesn't include
    `GoalScored.BallLastTouch.Player`, counted only when both sides are known (review round 7).
  - The origin hit also adds a `shots[toucher]` speed (decision 1).
  - `aerial` = a pending `AerialGoal` for the scorer, which this consumes.
  - `distance = hypot(x, goalY(team) − y)`, with goalY +5120 for team 0 and −5120 for team 1.
  - `speedKmh = GoalSpeed`.
- Each unresolved attribution counts in `facts.unresolved` (hit, woodwork, shot, goal last touch), through one resolver: a player object off the roster counts, a missing or non-object reference doesn't (round 9), except a hit's non-object `Players` entry, which counts as an unidentified hitter (round 10). An unresolved goal scorer is a dropped goal (round 4).
- The play view also keeps `facts.playMs`, the in-play wall time, used by the range check and
  the real-data ratio figure.

### 3. Stat registry: `src/server/recorder/extras.ts` (new, pure)
`PLAYER_EXTRAS: readonly { column: string; compute(play, key): number | null }[]`:

| column | rule | null when |
|---|---|---|
| `hardest_shot_kmh` | max of `shots[key]` (shots and goal origins) | neither |
| `woodwork_hits` | count for key | never (0) |
| `aerial_touches` | counted touches with z ≥ 550, \|x\| ≤ 3796, \|y\| ≤ 4820, \|x\|+\|y\| ≤ 7640 | never (0) |
| `car_ms` | Σ sample weight | no car samples (an opponent) |
| `boost_avg` | weight-averaged boost | no car samples |
| `supersonic_ms` | Σ weight where supersonic | no car samples |
| `empty_boost_ms` | Σ weight where boost = 0 | no car samples |

Each time stat stores ms plus `car_ms`, so WP5a can aggregate supersonic % and average boost
correctly across matches.

`computeExtras(events, summary)` returns `{ players: Record<key, Record<column, number | null>>,
goals: GoalPoint[], facts }`. `readMatch` calls it after `summarise` and before `runChecks`, and
attaches `summary.extras` and `summary.goals`. A new `MatchSummary` field holds them, so both
paths (live and recompute) get them through the one read.

### 4. Checks: new rows in `src/server/recorder/checks.ts`
- `goals_per_team_equal_score` (not joined in progress, with a score): for each team, the goal
  points equal `score[team]`.
- `goals_placed` (`facts.droppedGoals`, replacing the planned `goal_scorers_resolved`), plus
  `touches_resolved` from `facts.unresolved`.
- `shots_have_touch`: `facts.shotsWithoutTouch === 0`.
- `aerial_goals_match_statfeed`: the goals marked aerial equal the `AerialGoal` statfeed total.
- `goal_last_touch_agrees`: `facts.lastTouchDisagrees === 0`. The findings doc had 62 of 63
  agreeing, so one firing in the real-data run gets looked at, not ignored.
- `extras_in_range`: each registry entry carries an `inRange` (null where the stat can't leave
  its range by construction), so a new stat must state one. As built after review:
  - hardest shot between 0 and 250 km/h, and boost_avg between 0 and 100;
  - aerial_touches ≤ the scoreboard's `touches`.
  - Dropped in review (#7): supersonic and empty ≤ car_ms ≤ `facts.playMs` + one cap, and
    woodwork_hits ≤ the `CrossbarHit` count. All hold by construction.
- `extras_computed` (added in review, #4): computing the extras threw. `readMatch` keeps the base
  summary and record, and `MatchSummary.extrasError` holds the stack.

Checks only flag. The import step (Verification) confirms they stay quiet on real data, and any
that fire there get fixed in the rule or explained before review.

### 5. Schema: tracker migration 3 in `src/server/db/migrations.ts` (append only)
- `ALTER TABLE match_players ADD COLUMN …` for the seven columns above. All are nullable, and null
  on a pre-WP4b row means "not computed" until recompute.
- For WP5a (noted in the roadmap at the docs step): a pre-WP4b match and a 0–0 match both have no
  `match_goals` rows. Tell them apart by `woodwork_hits`, which is null only when not computed.
- The new table:
```sql
CREATE TABLE match_goals (
  match_guid  TEXT NOT NULL,
  idx         INTEGER NOT NULL, -- order in the match
  team_num    INTEGER NOT NULL, -- the scoring team
  scorer_key  TEXT NOT NULL,    -- NOT NULL since review round 4
  assister_key TEXT,
  toucher_key TEXT,             -- whose touch the dot sits at; null for an own goal
  x REAL, y REAL, z REAL,       -- ball at that touch, raw field coords; null for an own goal
  distance    REAL,             -- uu to the centre of the goal attacked
  speed_kmh   REAL,
  deflected   INTEGER NOT NULL,
  aerial      INTEGER NOT NULL,
  own_goal    INTEGER NOT NULL,
  PRIMARY KEY (match_guid, idx)
);
```

### 6. Record and writer: `src/server/records/record.ts`, `save.ts`
- `PlayerRow.extras: Record<string, number | null>`, and `MatchRecord.goals: GoalRow[]`.
- The writer builds `INSERT_PLAYER`'s column list from the base columns plus
  `PLAYER_EXTRAS.map(e => e.column)` (the writer builds columns from the registry, as planned).
- It deletes and reinserts `match_goals` in the same transaction as the other children.
- `records/written` gains `goals` and `ownGoals`.

### 7. Range class: `src/shared/goal-range.ts` (new)
`goalRange(distance)`: `close` under 2560 uu (a quarter of the pitch length), `long` at 5120 or
more (half the pitch or further), otherwise `mid`. WP5a uses it.

### Logging: what each log answers
- *Did the extras compute for this match, and how many goals and own goals?* The
  `records/written` fields.
- *Why is a match flagged?* `recorder/check_failed` with the check id and detail; the unresolved
  counts by kind are in the detail.
- *Did recompute backfill?* `records/recompute_done` (exists).

No new failure paths: the extras are pure and run inside the existing `summary_failed` and
`recompute_failed` catches. The closed-db write failure was fired for real in WP4a, and this WP
doesn't change that path.

## Files
- New: `src/server/recorder/play.ts`, `src/server/recorder/extras.ts` and `src/shared/goal-range.ts`,
  each with a test.
- Changed:
  - `src/server/recorder/{players,summary,read-match,checks}.ts`
  - `src/server/records/{record,save}.ts`
  - `src/server/db/migrations.ts`
  - tests: `summary`, `checks`, `record`, `save`, `recompute` and `migrate`
- Docs at the end: roadmap (WP4b status), `PROJECT_INDEX.md`, `BACKLOG.md`, the review summary,
  and an ADR only if `documentation-backlog-hygiene`'s gate says so (the candidates are the
  shot/aerial rules and the play-phase window).

## Steps
1. Save this plan to `docs/plans/2026-10-20-wp4b-match-extras.md`.
2. Extract `resolveTarget` into `players.ts`; the summary tests stay green.
3. TDD `buildPlay` with synthetic events:
   - phases: countdown, replay and pause samples excluded; joined in progress starts in play;
     nothing after `MatchEnded`;
   - sample weights with the cap;
   - a two-player hit credits both;
   - the touch merge: the 1 s window, and a reset by another player's hit;
   - a shot's speed from the shooter's last hit, a shot with no hit, and a goal's origin hit
     counted;
   - woodwork: the 1 s window, and replay hits ignored;
   - goals:
     - origin, deflected, and a 50/50 origin that isn't a deflection;
     - own goal, and the empty-scorer team taken from the next score change;
     - aerial attached and consumed;
     - distance for both teams;
     - last-touch disagreement;
   - unresolved counts.
4. TDD the registry stats and `computeExtras`, including the nulls (opponent, no shot) and the
   aerial wall and corner exclusion.
5. TDD the new checks.
6. Migration 3, and a test that every `PLAYER_EXTRAS` column exists in `match_players` (from
   `PRAGMA table_info`) after migrating, so a stat without a migration fails.
7. `toRecord` and the writer: the fixtures' expected extras and goals (completed,
   overtime-leavers, joined-in-progress, left-early); upserting twice still gives one goal set.
   The fixtures keep one `UpdateState` per 3 s (`scripts/make-fixture.ts`), so their car stats
   are regression values only. Their correctness is checked on the real-data run.
8. Add `match_goals` to `TABLES` in `recompute.test.ts`. Its "live replay equals recompute"
   snapshot (`SELECT *`) then covers the new table and columns.
9. `goal-range.ts` and its test.
10. A real-data run (see Verification). Fix or explain any flags, and record the figures in the
    plan's Implementation notes.
11. `bun run check` green → offer `/compact` → `independent-review-pass`.
12. Docs, then commit only when asked. After that, the user restarts the tracker
    (`bun run stop`, then sign in again or start it by hand) and runs `bun run recompute` to
    backfill.

## Verification
- `bun run check` (tsc, eslint, vitest) passes.
- Real data: `RLTRACKER_DATA_DIR=<scratch> bun run scripts/import-capture.ts captures/*.ndjson`,
  then `bun run recompute` into the same dir. Expected:
  - about 214 goal rows (the scratch count, before the match split), 0 own goals, and aerial
    goals = `AerialGoal` total. The deflected count is re-measured with every hitter credited
    and recorded.
  - hardest shots within 0–177 km/h;
  - aerial touches ≤ Touches for every player; the overall aerial share is recorded;
  - per match, the user's `car_ms` ÷ `facts.playMs` is near 1 (the samples cover play);
  - the user's boost_avg and supersonic share are plausible, and shown to the user;
  - no new check flags, or each one explained;
  - recompute's table hashes equal the import's.
- `bun run dev`, then replay a fixture with `scripts/replay.ts`: `.dev-data/tracker.db` gains the
  match with goal rows and extras.

## Plan review
plan-reviewer (opus), 2026-10-20. Verdict: the approach fits the codebase; revise before building.

| # | Finding | Disposition |
|---|---|---|
| 1 | Taking only `Players[0]` as the hitter drops 50/50 touches and invented the 5ABAFA "own goal" | Fixed: every entry is a hitter, a 50/50 origin isn't a deflection, `goal_last_touch_agrees` added, the expected figures revised |
| 2 | Raw `BallHit`s overcount touches (1.2–1.8× Touches) | Fixed: the touch merge (user decision 3) and `aerial_touches ≤ touches` |
| 3 | An empty-scorer own goal would be given to team 0 | Fixed: the team comes from the next score change; tested synthetically |
| 4 | Fixtures sample `UpdateState` at 3 s, so the expected car stats only lock in artifacts | Fixed: fixture car stats are regression-only; the real-data `car_ms`/`playMs` ratio added |
| 5 | The aerial wall box leaves out the corners | Fixed: \|x\|+\|y\| ≤ 7640 (user decision 2) |
| 6 | Two stats had no sanity check; `CrossbarHit` includes posts | Fixed: `extras_in_range` covers every stat; renamed to `woodwork_hits` (decision 4) |
| 7 | "Goals get a Shot statfeed too" was false (5 of 28) | Fixed: goal origin hits count toward hardest shot (decision 1) |
| 8 | A pre-WP4b match and a 0–0 match look alike in `match_goals` | Noted for WP5a: tell them apart by `woodwork_hits` null |

## Implementation notes (2026-10-20)

### Choices made while building
- `resolveTarget` takes the roster as `Iterable<{key, name, teamNum}>`; `summary.ts` exports
  `num`, `str` and `teamOf` for `play.ts`, rather than duplicating them.
- `MatchSummary.extras: MatchExtras | null` is one field (players, goals, facts). `summarise`
  leaves it null and `readMatch` fills it. The extras checks skip a summary without it.
- The empty-scorer baseline: a match seen from its start begins at 0–0, so a held goal before
  the first state still settles. Joined in progress has no baseline until the first scoreboard.
  A goal still held at the end is dropped, and `goal_scorers_resolved` flags it.
- Touch merge: another hitter in the *same* 50/50 event doesn't count as "touched since". Only
  earlier events reset the 1 s window.
- An `AerialGoal` pending is cleared at each `RoundStarted`, so a stale one can't mark a later
  goal. All 24 real `AerialGoal` statfeeds (and all 214 `Goal` ones) came before their
  `GoalScored`, so none was lost to the replay phase.
- `recorder.test.ts`'s synthetic "nobody credited" match now also flags `goal_scorers_resolved`
  and `goal_last_touch_agrees`, which is correct for it.

### Real-data run (4 captures, 46 matches, scratch dir)
- Import: the only flag is `camera_on_roster` on C138256C, which predates this WP (spectating).
  No new check fired.
- 214 goal rows, 0 own goals, 38 deflected (the Players[0]-only measurement gave 40), 24
  aerial = 24 `AerialGoal` statfeeds. The score total is 219; the 5 missing goals came before
  the join in the 2 joined-in-progress matches (B58BBD70 3, C8B8E12E 2).
- Range classes (`goalRange`): 110 close, 63 mid, 41 long. Goal speeds 10.8–129 km/h.
- Hardest shots 31.6–137.3 km/h (within 0–177). Null for 52 of 231 player rows.
- Aerial touches: 302 of 6,692 touches (4.5%), and no player over their scoreboard `touches`.
- Woodwork: 90 hits.
- The user's `car_ms` ÷ `playMs`: 0.982–0.997 for each match seen from its start. 0.946 and
  0.970 joined in progress, where play is assumed from the first event. C6C0A6B4 (left in
  countdown) has no play, so its car stats are null.
- The user over 45 matches (3.57 h with car state): boost 51.3 average (time-weighted), per
  match 30.4–64.1; supersonic 7.5%; empty boost 9.5%.
- `bun run recompute` into the same dir: written 46, failed 0. Every table's hash (matches,
  match_players, match_player_statfeed, match_goals, my_ids) is identical to the import's.
- Live: `scripts/replay.ts` of `completed` at 20×, with the tracker on a fresh data dir, wrote
  3 goal rows (the fixture test's values, aerial and deflected on the third) and no flags.
  `.dev-data` was not usable for this: its raw.db already held this guid from an earlier
  replay, so a second replay stores the events twice (6 goal events, 2 MVPs flagged). That is
  the import script's documented "empty data dir" rule, not a WP4b fault. `.dev-data` is now
  migrated to v3.

## Review log

Diff re-classified at review time: Substantial (~1,190 changed code lines in 20 files before the round-1 fixes, and a
Substantial design tier). Snapshot of the reviewed state: `4ce13e0`.

### Round 1: code-review high, arch-reviewer (sonnet), security-reviewer, simplify

| # | Pass | Finding | Disposition |
|---|---|---|---|
| 1 | code-review | A held (empty-scorer) goal took its baseline from the score at GoalScored, so a scoreboard that rose *before* GoalScored never settled it and the goal was dropped | [Fixed] the held goal now settles against a per-team tally (goals added, on 0–0 or the first scoreboard when joined in progress), and is checked at GoalScored too; regression test |
| 2 | code-review | UpdateState kept updating the score and settling held goals after MatchEnded, though teardown states may be retagged from the next match | [Fixed] UpdateState is ignored once ended, as in summary.ts; regression test |
| 3 | code-review | Joined in progress, a goal before the first RoundStarted with no scoring-team hit since the join was stored as an own goal | [Fixed] `ownGoal` needs a seen kickoff; such a goal has no point (pos null) and isn't an own goal; regression test |
| 4 | code-review | A throw in the extras lost the whole summary and record | [Fixed] readMatch catches around `computeExtras` (commented as deliberately broad), leaves `extras` null and adds an `extras_computed` failure, so it's flagged and logged by the existing check_failed path; test in `read-match.test.ts` |
| 5 | code-review | A clock stepping back gave negative sample weights and play time | [Fixed] both clamp at 0; regression test |
| 6 | code-review | play.ts's `readScore` was a looser copy of summary.ts's scoreboard parsing | [Fixed] summary.ts exports `readScore`, used by both |
| 7 | code-review | The woodwork ≤ CrossbarHit and car_ms ≤ playMs + cap checks hold by construction | [Fixed] dropped, together with supersonic/empty ≤ car_ms (subsets of the same weights); `facts.crossbarHits` removed with them. A revision of plan step 4: those ranges can't be broken by any input |
| 8 | code-review | play.ts's `players` duplicated summary.ts's | [Fixed] exported from summary.ts |
| 9 | code-review, arch | `Play.hits` had no reader outside tests | [Fixed] removed; the tests observe the same hits through touches, shots and goals |
| 10 | code-review, arch | `carStat` re-filters samples per stat | [Verified, no fix needed] about 86k iterations per 3v3 match, well under a millisecond |
| 11 | arch | `extras_in_range` named its stats by hand, so a new registry stat would get no range check | [Fixed] each registry entry carries an `inRange`, so the type requires one (final form from S3) |
| 12 | arch | `boost_avg` was 0 for a car with samples but no weighted time | [Fixed] null; regression test |
| 13 | arch | Docs (roadmap status, PROJECT_INDEX, BACKLOG, WP5a note) not updated | [Verified, no fix needed] plan step 12, after review |
| 14 | arch | A held goal pushed late could break `match_goals.idx` order | [Verified, no fix needed] with #1 a held goal settles at the next state (≤ 0.5 s), and a later goal needs a kickoff countdown first. Only a held goal still unsettled when the next goal's scoreboard rises could take that team, which needs a dropped run of states |
| 15 | arch | An unresolved scorer with a valid `Scorer.TeamNum` could take that team directly | [Disputed] for an own goal the named player's team need not be the scoring team, and the scoreboard is authoritative; `goal_scorers_resolved` still flags it |
| 16 | arch | `endStretch` is a one-line wrapper; `aerialPending` a counter where a set might do | [Disputed] the name says why `pending` is cleared at both sites; a counter keeps two back-to-back aerial goals right at no cost |
| 17 | arch | `PLAYER_COLUMNS` spread arrays only to split lines | [Fixed] a plain base list |
| 18 | arch | `goalRange` has no caller until WP5a | [Verified, no fix needed] plan step 9 |
| 19 | security | `HANDLERS[ev.name]` with a socket-supplied name could reach an `Object.prototype` function (below its reporting bar) | [Verified, no fix needed] the same lookup summary.ts has used since WP3a; the reachable functions are harmless with these arguments |

Every new regression test was run against the snapshot and failed there (5 of 5 in play/extras).
After the fixes: `bun run check` green (422 tests). The real-data run was repeated into a fresh
dir: same figures (214 goals, 0 own, 38 deflected, 24 aerial), the same single pre-existing
`camera_on_roster` flag, and recompute's table hashes equal the import's.

Round 1 `/simplify` (reuse, simplification, efficiency, altitude agents, all sonnet):

| # | Finding | Disposition |
|---|---|---|
| S1 | `Play.shots` kept every speed, though its one reader takes the max | [Fixed] `Play.hardestShot`, a running max |
| S2 | 5120 defined twice (play.ts, extras.ts), and goal-range.ts's thresholds derive from it | [Fixed] `GOAL_LINE_Y` in `src/shared/constants.ts`, used by all three |
| S3 | `EXTRA_RANGES` was a second registry parallel to `PLAYER_EXTRAS` | [Fixed] each registry entry has an `inRange` (null where it holds by construction), so the type makes a new stat state one; the keys test went with it |
| S4 | `extras_computed` bypassed the CHECKS table and kept only the message | [Fixed] `MatchSummary.extrasError` (the stack) and a CHECKS row; a break case added |
| S5 | `settleHeld` built an array on every state with nothing held; aerial derived twice | [Fixed] early return; one `aerial` const |
| S6 | `facts.playMs` has no production reader since #7 | [Skipped] it is the denominator of the car-coverage ratio (the real-data check that samples span play) and the phase tests' seam |
| S7 | `NO_EXTRAS` and the writer's `?? null` both default | [Skipped] the record keeps explicit nulls per column, which the record tests read |
| S8 | Move the shared readers out of summary.ts; one phase wrapper for the handlers; settle held goals once at the end | [Skipped] churn without a second consumer; the wrapper would change UpdateState's semantics; settling at the end needs a nullable `team_num` and loses per-goal order |
| S9 | `MatchExtras` re-wraps `Play` fields; `playerExtras` export; `goalRange` unused yet | [Skipped] cosmetic; the tests' seam; plan step 9 |

After simplify: `bun run check` green (422 tests); real-data import repeated into a fresh dir with
table hashes identical to the post-fix run (only `my_ids.added_at` differs) and recompute equal.

### Round 2: code-review high, arch-reviewer (sonnet), security-reviewer (full round: the delta touched `src/shared/constants.ts`)

Delta reviewed: `git diff 4ce13e0` (snapshot `55cc84f`).

| # | Pass | Finding | Disposition |
|---|---|---|---|
| R1 | code-review | Joined in progress, an empty-scorer goal before the first scoreboard was held against a tally seeded *after* it, never settled, and later took another held goal's team | [Fixed] with no tally yet the goal isn't held (it stays counted in `unresolved.goal`, so `goal_scorers_resolved` flags it); regression test asserts which goal is kept |
| R2 | code-review | An empty-scorer goal deciding the match (overtime), with MatchEnded before the next state, is dropped by the #2 guard | [Deferred → BACKLOG] no empty-scorer goal has been seen; `goals_per_team_equal_score` flags it on a match seen from its start |
| R3 | code-review | `players()` passed non-object entries through, so a `null` player still crashed summarise (outside the new catch) | [Fixed] `players()` keeps object entries only, for summary.ts and play.ts alike; regression tests in both |
| R4 | code-review | With the clock-step clamps, car_ms can exceed play time, and #7 had dropped that check | [Fixed] new evidence against #7: `car_ms` gets `inRange` ≤ `playMs` + one cap (`inRange` now takes the facts); break case added |
| R5 | code-review | The read-match test triggered its throw through the null-player crash that R3 fixes | [Fixed] it mocks `./extras` to throw |
| R6 | arch | Plan step 4 still listed the dropped checks and lacked `extras_computed` | [Fixed] step 4 rewritten to what shipped |
| R7 | arch | #11's disposition described `EXTRA_RANGES`, which S3 replaced; the size figure was unlabelled | [Fixed] reworded; labelled as the pre-fix size |
| R8 | arch | A held goal unsettled when a later goal's scoreboard rises could take that team | [Verified, no fix needed] noted under #14 |
| R9 | security | none | — |

Regression tests run against `55cc84f`: the JIP, both null-entry and the car_ms tests fail there and
pass now. `bun run check` green (426 tests); real data re-run into a fresh dir: same figures, the
same single `camera_on_roster` flag, recompute's hashes equal the import's.

### Round 3: code-review high, security-reviewer (delta `git diff 55cc84f`, snapshot `e8d1daf`)

| # | Pass | Finding | Disposition |
|---|---|---|---|
| T1 | code-review | Joined in progress, a scoreboard *lagging* a goal dropped by R1 left the tally one behind for good, so the next held goal took the wrong team. This is the third finding on the cumulative tally (#1, R1) | [Fixed] the tally is replaced by a per-kickoff baseline. A kickoff has at most one goal, so a held goal compares the scoreboard with the score at its own `RoundStarted` (0–0 for a match seen from its start), whichever side of GoalScored the scoreboard updates on. Nothing carries over between goals, so nothing can drift; regression test for this order |
| T2 | code-review | `readScore` threw on a non-object `Game.Teams` entry (R3's class, not covered) | [Fixed] one `objects()` helper over envelope's `isObject` serves both `players()` and `readScore`; regression test |
| T3 | code-review | `players()` let arrays through, unlike envelope's `isObject` | [Fixed] by T2 |
| T4 | code-review | A dropped goal left no trace of its own | [Fixed] `facts.droppedGoals` (no baseline, a new kickoff, MatchEnded or the match closing with the goal unsettled) and a `goals_placed` check |
| T5 | code-review | The read-match mock omitted the module's other exports | [Fixed] spreads `importOriginal()` |
| T6 | code-review | `sampleCars` re-filtered the state's players | [Fixed] reads `acc.latestPlayers` |
| T7 | code-review | No test pins that car_ms at playMs + cap passes | [Fixed] boundary test |
| T8 | code-review | car_ms ≤ playMs + one cap flags a clock-stepped match even when car_ms is the truer value | [Disputed] a match whose clock stepped back has unreliable time stats either way; flagging it is the intent. The comment now says so |
| T9 | security | none | — |

The new tests were run against `e8d1daf`: the null-entry, both JIP, the MatchEnded and the
`goals_placed` tests fail there (5) and pass now. `bun run check` green (429 tests); real data
re-run into a fresh dir: same hashes as round 2, the same single flag, recompute equal.

### Round 4: code-review high, security-reviewer (delta `git diff e8d1daf`, snapshot `da9edd6`)

code-review found 6 issues, all in or around the empty-scorer team inference:
- a JIP goal after a scoreboard but before the first kickoff was dropped;
- a second held goal overwrote the first, uncounted;
- a stale kickoff baseline after dropped states gave a silently wrong team;
- a dropped goal raised a second, misleading `goal_scorers_resolved` flag;
- two drop paths were untested;
- `sampleCars` cast `Game` a second time.

Security found nothing.

**Stop rule (escalate)**: this mechanism drew new findings in every round (#1, R1, T1, and now
U1–U4), and each fix opened a new edge case. Brought to the user with three options: keep the
kickoff baseline with these fixes; drop and flag; or store a team-less goal. **User's choice: drop
and flag.**

| # | Finding | Disposition |
|---|---|---|
| U1–U4 | The four inference findings above | [Fixed] by removing the inference. A goal whose scorer doesn't resolve to a roster player with a team gets no point and counts in `droppedGoals` (`goals_placed` flags it). `goal_scorers_resolved` and `unresolved.goal` are gone, so a drop no longer raises the misleading "not on the roster" flag (it still fails `goals_per_team_equal_score`, which is true; see round 5). `scorer_key` is NOT NULL (migration 3 is unshipped) |
| U5 | Untested drop paths | [Fixed] every drop path is now the one `GoalScored` branch, and a test covers both an empty and an off-roster scorer |
| U6 | `Game` cast twice | [Fixed] `sampleCars` takes `inReplay` |
| — | R2 deferral (an overtime empty-scorer goal after MatchEnded) | Superseded: no goal is held any more. The Watch-list item now says: if `goals_placed` fires, look at the real event order, then add inference fitted to it |

Test first: the drop test failed on the inference code, then passed. `bun run check` green
(423 tests; the held-goal tests went with the inference). Real data: 214 goal rows, the same
single flag, hashes unchanged from round 3, and recompute equal.

### Round 5: code-review high, security-reviewer (delta `git diff da9edd6`, snapshot `c835ab7`)

| # | Finding | Disposition |
|---|---|---|
| V1 | The R3 test "a hit's players entry that isn't an object is skipped" was deleted with the held-goal tests | [Fixed] restored |
| V2 | A drop still raises more than one flag: `goals_per_team_equal_score` and, for an aerial drop, `aerial_goals_match_statfeed`; this contradicts round 4's "one flag" | [Verified, no fix needed] both are true statements about the match (fewer points than goals, fewer aerial points than statfeeds); round 4's wording corrected |
| V3 | A dropped goal's origin hit no longer counts towards `hardestShot` | [Disputed] the origin is the *scoring team's* last hit, and a dropped goal has no known team, so no origin exists to count |
| V4 | A dropped goal skipped the last-touch comparison | [Fixed] the comparison runs before the drop; regression test |
| V5 | `GoalInput.hits` and `fromKickoff` were held-goal leftovers | [Fixed] `addGoal` reads `acc.sinceKickoff` and `acc.sawKickoff` |
| V6 | `readScore` export now unused | [Fixed] unexported |
| V7 | `droppedGoals` comment retold the removed design | [Fixed] states only the meaning |
| — | security | none |

`recorder.test.ts`'s synthetic dropped-goal match now also flags `goal_last_touch_agrees` (it has
no hits), as V4 intends. `bun run check` green (425 tests). Real data: hashes unchanged, and
recompute equal.

### Round 6: code-review high, security-reviewer (delta `git diff c835ab7`, snapshot `2acd0d4`)

| # | Finding | Disposition |
|---|---|---|
| W1 | With V4, a dropped goal's unresolvable `BallLastTouch` raises `goal_last_touch_agrees`, as if the hits disagreed | [Fixed] by W2 |
| W2 | A missing or unresolved `BallLastTouch` counted as a disagreement (the original rule, now with new evidence) | [Fixed] counted in `unresolved.lastTouch` (reported by `touches_resolved`, like the hit, shot and woodwork kinds), and only a resolved last touch is compared; regression test |
| W3 | The V4 test also passed if a drop always counted as a disagreement | [Fixed] an agreeing counterpart asserts 0 |
| W4 | The restored V1 test couldn't see a kept null hitter | [Fixed] also asserts `unresolved.hit` 0 |
| W5 | `addGoal` reads the kickoff's hits from `acc`, which the signature no longer shows | [Verified, no fix needed] its one caller is the synchronous `GoalScored` handler, and with no held goals nothing can call it after a reset; every other helper in play.ts reads `acc` the same way |
| — | security | none |

`recorder.test.ts`'s synthetic goal (no `BallLastTouch`) now flags `touches_resolved` instead
of `goal_last_touch_agrees`. `bun run check` green (427 tests). Real data: hashes unchanged
(flags included), and recompute equal.

### Round 7: code-review high, security-reviewer (delta `git diff 2acd0d4`, snapshot `6925507`)

The last-touch comparison drew findings for the second round running (W1/W2, then X1/X2). A clean
fix was available, so this wasn't escalated, but a third round on it would be.

| # | Finding | Disposition |
|---|---|---|
| X1 | Joined in progress with no hit seen yet, a resolved last touch counted as a disagreement | [Fixed] one rule: compare only when both sides are known, meaning the last touch and every last hitter resolve, or no hit came since a *seen* kickoff. Otherwise nothing is counted (the hit is already in `unresolved.hit`); test covering each case |
| X2 | An unresolved last hitter plus a resolved last touch double-flagged | [Fixed] by X1 |
| X3 | A missing `BallLastTouch` was reported as "not on the roster" | [Fixed] the `lastTouch` bucket is removed; a missing or unresolved last touch isn't comparable (none in 432 real `GoalScored`s) |
| X4 | Stale `lastTouchDisagrees` and `unresolved` docs | [Fixed] |
| X5 | No test of a resolved last touch with no hit since the kickoff | [Fixed] in X1's test |
| X6 | `touches_resolved` sums its kinds by hand | [Verified, no fix needed] back to three kinds with X3; the explicit message names each |
| — | security | none |

The spec lines on `unresolved` and `scorer_key` were updated too. `recorder.test.ts`'s synthetic goal now
raises only `player_goals_equal_score`, `goals_per_team_equal_score` and `goals_placed`. `bun run check`
green (426 tests). Real data: hashes unchanged, and recompute equal.

### Round 8: code-review high, security-reviewer (delta `git diff 6925507`, snapshot `fa59dac`)

The last-touch comparison drew findings for a third round, so it went to the user under the stop
rule, with three options: fix both and keep the check; remove the check; or fix Y1 only. **User's
choice: fix both and keep the check** (it's the only canary for the goal-origin rule).

| # | Finding | Disposition |
|---|---|---|
| Y1 | A last hit with no hitters (an empty or all-non-object `Players`) passed `every()`, so a correct goal was flagged | [Fixed] the last hit must name at least one hitter; test |
| Y2 | X3's removal of the `lastTouch` bucket also hid a last touch that's *present* but off the roster | [Fixed] `unresolved.lastTouch` is back, counting only a present player object that doesn't resolve; a missing one isn't counted; test |
| Y3 | No test for a joined-in-progress hit before the first kickoff | [Fixed] expects a disagreement |
| Y4 | No test for a hit naming nobody | [Fixed] in Y1's test |
| — | security | none |

`bun run check` green (428 tests). Real data: hashes unchanged, and recompute equal.

### Round 9: code-review high, security-reviewer (delta `git diff fa59dac`, snapshot `6c787fe`)

| # | Finding | Disposition |
|---|---|---|
| Z1 | The `unresolved` doc said "a missing reference isn't counted", but a missing woodwork or shot reference still was | [Fixed] by Z3 |
| Z2 | A last hit with one valid entry plus a malformed one counted as fully known | [Fixed] `Hit.known`: every raw `Players` entry is a roster player object, and there is at least one; the comparison uses it; test |
| Z3 | Each handler decided "missing vs unresolved" its own way (altitude) | [Fixed] one `resolveRef(acc, ref, kind)` for hit, shot, woodwork and last touch: a non-object returns null uncounted, an object off the roster counts under its kind; test covers all three reference kinds |
| Z4 | A non-object last touch (`Player: "Z"`) was silently ignored | [Verified, no fix needed] under Z3's single rule a non-object reference is missing, the same for every kind; documented on `unresolved` |
| Z5 | The spec's `unresolved` line lacked `lastTouch` | [Fixed] |
| Z6 | The off-roster test didn't assert it's left out of the comparison; no mixed-list test | [Fixed] asserts `lastTouchDisagrees` 0; mixed list in Z2's test |
| Z7 | The facts literal was copied in three places | [Fixed] exported `emptyFacts()` |
| — | security | none |

This was the second round on the attribution counting after round 8's escalation. Z3 fixes the root
cause rather than one more handler, so it wasn't escalated again. `bun run check` green (428 tests).
Real data: hashes unchanged, and recompute equal.

### Round 10: code-review high, security-reviewer (delta `git diff 6c787fe`, snapshot `0971ef9`)

| # | Finding | Disposition |
|---|---|---|
| AA1 | A malformed entry in a hit's `Players` made the hit unknown, but no counter recorded it | [Fixed] a hit's non-object entry counts in `unresolved.hit` (the entry is a hitter who couldn't be identified; other kinds still treat a non-object as missing); the V1 test now also asserts the entry is no phantom deflector |
| AA2 | AerialGoal's `MainTarget` uses bare `resolve`, so an off-roster target goes uncounted | [Verified, no fix needed] summary's `statfeed_resolved` already flags every off-roster statfeed target, AerialGoal included |
| AA3 | The by-kind test spaced crossbars exactly one woodwork window apart | [Fixed] kickoffs 5 s apart |
| AA4 | `RefKind` private while `Play` exports it; `touches_resolved` hand-summed the kinds | [Fixed] exported `REF_KINDS`, and the check iterates them through a `Record<RefKind, string>` label map, so a new kind won't compile without a label |
| AA5 | `known` inferred the filter's drops from lengths | [Fixed] by AA1: the malformed count is computed once and feeds both the counter and `known` |
| AA6 | The empty `Play` literal was still copied in the test | [Fixed] exported `emptyPlay()` |
| — | security | none |

`bun run check` green (428 tests). Real data: hashes unchanged, and recompute equal.

### Round 11: code-review high, security-reviewer (delta `git diff 0971ef9`, snapshot `4078867`)

| # | Finding | Disposition |
|---|---|---|
| BB1 | The phantom-deflector assertion couldn't fail (the null sat inside the origin hit) | [Fixed] a separate `Players: [null]` hit after the origin |
| BB2 | `touches_resolved` called a malformed entry "not on the roster" | [Fixed] the message reads "unidentified: …" |
| BB3 | No test on the check's detail text | [Fixed] mixed-kind detail test |
| BB4 | The spec's `unresolved` line lacked AA1's hit exception | [Fixed] |
| BB5 | BallHit filtered through `players()` and inferred drops from lengths | [Fixed] filters `entries` with `isObject` once |
| BB6 | `emptyFacts()` hand-wrote the kinds | [Fixed] in `REF_KINDS` order; round 12 kept it a literal, which `Record<RefKind, number>` checks for completeness |
| BB7 | The woodwork window isn't clamped when the clock steps back (an unchanged line) | [Deferred → BACKLOG] Watch list, latent: such a match already fails `extras_in_range` on car_ms (T8) |
| — | security | none |

`bun run check` green (429 tests). Real data: hashes unchanged, and recompute equal.

### Round 12 (final): code-review medium, security-reviewer (delta `git diff 4078867`, snapshot `d5598cb`)

The user chose medium for this closing round, after high kept finding test-precision and wording items on tiny deltas.

| # | Finding | Disposition |
|---|---|---|
| CC1 | `touches_resolved` says "unidentified" while `statfeed_resolved` says "not on the roster" | [Verified, no fix needed] `touches_resolved` also counts malformed hit entries, which aren't roster misses (BB2) |
| CC2 | `emptyFacts` used `Object.fromEntries` plus a cast, which loses the compiler's completeness check | [Fixed, nit] back to a literal |
| — | security | none |

Only a nit was fixed, so the review is closed. `bun run check` green (429 tests).
