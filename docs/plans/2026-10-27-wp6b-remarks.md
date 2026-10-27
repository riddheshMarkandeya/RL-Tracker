# WP6b: Recap remarks

Repo copy (step 1): `docs/plans/2026-10-27-wp6b-remarks.md`. Tier: Substantial.

## Context

The recap headline (Overview section 2) has had a placeholder since WP6a. It should show a mood
line plus at most one quip. The roadmap's "WP6b: Remarks" section, the map's "Recap remarks"
decisions and the copy file `docs/plans/2026-10-16-recap-remarks-copy.md` set the rules: z-score
mood bands, a "short" set under 4 matches, tiered quips where the rarest tier wins, picks stored
per session + filter, ~10-session repeat avoidance, and ↻ to re-roll.
**Done when:** revisiting a session shows the same lines, and ↻ picks a different one.
**Never quote the copy's jokes in chat, commits or review prompts** (the user wants them to stay
a surprise). Point at the file instead.

## User decisions (this session)
- **Bicycle goal** and **demoed a lot** ship inert, like the friend triggers, each with a BACKLOG
  Watch item. Real data (76 matches) has only a `BicycleHit` statfeed and no bicycle-goal event.
  The Demolish statfeed's victim (`SecondaryTarget`) is in raw events but isn't recorded.
- **Live session:** a stored pick stays while it still fits. Only the part that stops fitting is
  re-picked (mood band changed, or the stored quip's trigger no longer fires or is no longer in
  the winning tier). Picks for finished sessions never change except through ↻.

## Facts checked against the real DB (read-only)
Statfeed names present: HatTrick, Savior, EpicSave, AerialGoal, LongGoal, OvertimeGoal, Demolish,
MVP, BicycleHit (and others). No `BicycleGoal` or "demolished" event. Schema is at user_version 4.

## Approach

The server picks and stores; the web only renders. Everything the picker needs is in what
`pages.sessionDetail(key, filter)` already builds (matches with your statfeed, `me`, result,
overtime and scores; the aggregate; the baseline). The new endpoint reuses it.

### Data (migration 5, appended to `trackerMigrations` in `src/server/db/migrations.ts`)
```sql
-- The remark headline shown for a session under a filter; lines are ids into the copy pool.
CREATE TABLE remark_picks (
  session_key  TEXT NOT NULL,
  filter       TEXT NOT NULL,   -- the filter's query value: everything | ranked | … | <playlist id>
  mood_band    TEXT NOT NULL,   -- short | disaster | rough | usual | good | great
  mood_line    TEXT NOT NULL,
  quip_trigger TEXT,            -- null: no trigger fired
  quip_line    TEXT,
  picked_at    INTEGER NOT NULL,
  PRIMARY KEY (session_key, filter)
);
-- Every line ever shown, for repeat avoidance across sessions.
CREATE TABLE remark_shown (
  line_id     TEXT NOT NULL,
  session_key TEXT NOT NULL,
  shown_at    INTEGER NOT NULL
);
CREATE INDEX remark_shown_at ON remark_shown (shown_at);
```
A re-cut session gets a new key and so fresh picks, as the map already decided.

### Modules (new folder `src/server/remarks/`)
- `copy.ts`: the pool as data. Mood lines go by band. Quip lines go by trigger, each trigger
  carrying a `tier` and each line an explicit stable id (`great-1`, `hat-trick-2`, …). Ids are
  never reused, so cutting a line later only invalidates picks that used it. The aerial/long
  trigger's lines carry `kind: "aerial" | "long"`. The text is copied verbatim from the copy file.
  Inert triggers (`bicycle_goal`, `demoed_a_lot`, `duo_good`, `duo_bad`, `soloqueue`) stay in the
  pool with `inert: true` and a comment saying what each waits for.
  The hard-shot templates drop their literal unit after `{speed}`, and `fillRemark` adds it
  (km/h now; WP8's mph setting changes it in one place). This is the only edit to the copy text,
  noted in a comment.
- `triggers.ts` (pure): `moodOf(session, baseline)` and `triggersFor(detail)`.
  - Mood: n = decided matches. If n < 4 the band is `short`. Otherwise
    z = (winPct − baseWinPct)·100 / (50/√n), using 50 % when the baseline has no decided matches.
    n is the number of decided matches, a deliberate reading of the spec's "under 4 matches": z
    needs decided ones, so 4 matches with one no-result is short. A test covers that edge.
    Bands: |z| < 0.5 usual; 0.5 ≤ |z| < 1.5 good/rough; |z| ≥ 1.5 great/disaster.
  - Triggers return `{ id, values }` (values feed the placeholders):
    hat_trick / savior (statfeed ≥ 1); aerial_or_long (AerialGoal or LongGoal ≥ 1, values.kind
    lists which kinds fired); epic_saves (EpicSave ≥ 2); ot_wins / ot_losses (overtime && result,
    ≥ 1); mvp_haul (mvps ≥ 3 and ≥ 40 % of matches); hard_shot (hardestShotKmh ≥ 130, {speed}
    rounded); shut_out (your team's score 0, count); win_streak / loss_streak (best ≥ 3);
    ended_win (last decided match a win and some earlier loss); ended_loss (last decided a loss
    and `endedOn.length < 3`, so it doesn't repeat what the loss-streak line already says);
    demos_given (totals.demos ≥ 5); crossbar (woodworkHits ≥ 2); marathon (session end − start
    ≥ 3 h, {hours} rounded); late_night (the session's local end time is at or after 01:00 and
    before 06:00, {time} = endedAt; the 06:00 upper bound is our choice, since the spec only says
    "1am or later"). Marathon and late night use the whole session's start and end, not just
    the filtered matches: a session is time at the PC.
    shut_out skips a match with a null `me.teamNum` or a null score (tested).
    Every threshold, the 06:00 bound included, goes in one `THRESHOLDS` const in this file (they
    aren't settings, per the map).
- `pick.ts` (pure, injected `rng` and history): `pick({ mood, triggers, stored, recent, reroll, rng })`
  → `{ moodBand, moodLine, quipTrigger, quipLine }`.
  - Winning tier = the rarest tier among the active (non-inert) triggers that fired.
  - `refit` is true only for the session still going on (`detail.current`). With `refit`, the
    stored mood is kept if its band is unchanged and its line id still exists, and the stored
    quip is kept if its trigger fired, is in the winning tier, and its line still exists and fits
    the fired kind. Otherwise that part is re-picked. For a finished session, the stored parts
    are kept as they are, even after a recompute, a later import into its baseline window or a
    retuned threshold. A part is re-picked only when its line id no longer exists in the pool.
    Both parts are re-picked on `reroll`.
  - Line choice: the pool is every line of the fired triggers in the winning tier (filtered by
    kind), minus the current line on reroll. Lines in `recent` are avoided; if every line is
    recent, the least recently shown is used. A pool of one gives that one line.
- `store.ts`: `createRemarks({ tracker, pages, logger, now, rng })` with `get(key, filter)` and
  `reroll(key, filter)`. Both build the detail, read the stored row and the recent history in one
  transaction, pick, then write the pick and append `remark_shown` rows only for the lines
  that changed. The transaction is there to make the pick and its history write atomic (reads
  share the same synchronous Db). `recent` = a line id → last shown_at map over the 10 most recently shown distinct
  session keys (the current one included). Returns null when the session is unknown or has no
  matches under the filter.

### API (`src/server/api/index.ts`, schemas in `src/shared/schemas/responses.ts`)
- `GET /api/sessions/:key/remarks?filter=` → `remarksResponse`, 404 when null. On the first
  view, and when the stored pick no longer fits, it writes the pick, as the map decided ("stored
  on first view").
- `POST /api/sessions/:key/remarks/reroll?filter=` (needs the `REQUEST_HEADER`, like the break)
  → the same shape.
- Response: `{ mood: { band, text }, quip: { trigger, tier, text, values } | null }`. `text` is
  the raw template; `values` holds raw numbers and ms (n, w, l, speed in km/h, hours, time).

### Web
- `src/web/logic/remarks.ts` (pure, Vitest): `fillRemark(text, values, locale?)` replaces the
  placeholders, `{time}` via `clock()` from `format.ts`, and turns `(s)`/`(es)` into the right
  plural for `{n}`.
- `src/web/queries.ts`: `useRemarks(key, filter)` with key `["remarks", key, f]`. It isn't under
  "session", so `staleAfter` refetches it after every match, which the live-session rule needs.
  An old session's refetch returns the same stored lines.
- `Overview.tsx` `Headline`: mood line, then quip, then a ↻ icon button (`aria-label="Another
  remark"`, disabled while pending). It calls the reroll POST and parses the body with
  `remarksResponse`, through a small `postJson` beside `getJson` in `src/web/api.ts` that
  reuses its bad-shape warning. It then runs `cancelQueries(["remarks", key, f])` before
  `setQueryData`, so a GET still in flight from a match refetch can't overwrite the new line.
  A failed reroll keeps the old lines and shows "Couldn't re-roll · Retry" beside the button,
  the same pattern as the Settings save error. While loading or on error the remark block is just absent; the rest of the
  headline doesn't wait on it. Styles go in `Overview.module.css` with the existing tokens.
  `ui-implementation-guidelines` gets invoked before the UI step.

### Logging (category `remarks`)
- `remark_picked { sessionKey, filter, reason: first|refit|reroll, band, z, n, fired[], tier,
  trigger, moodLine, quipLine, recentCount, poolExhausted }`. It answers: why this line, why it
  changed on a revisit, and whether repeat avoidance ran dry.
- Nothing is logged when a stored pick is kept: the logger has no debug level, and GETs repeat
  after every match. The request log already shows those GETs.
- Failures go through the API's existing catch, which logs `failed` with the route.

## Steps (TDD per `tdd-live-code-carveout`)
1. Copy this plan to `docs/plans/2026-10-27-wp6b-remarks.md`.
2. `copy.ts` + a test that every id is unique and every placeholder is known.
3. `triggers.ts`, test first: band edges at |z| = 0.5 and 1.5 (both signs), n < 4 → short, no
   baseline → 50 %, 4 matches with 1 no-result → short, shut_out with null team/score, inert
   triggers never fire, and each trigger's threshold at, just above and just below.
4. `pick.ts`, test first, with a seeded RNG: tier precedence, kept-when-fits, re-pick on band
   change or on a rarer tier, reroll never returns the same line when ≥ 2 exist, repeat
   avoidance, pool runs out → least recent, the kind filter, no triggers → null quip.
5. Migration 5 + `store.ts`. Integration tests against an in-memory DB with `record()` from
   `testing.ts`: the same lines on a revisit, reroll changes and persists, history window of 10,
   unknown key → null. Live session: when the band changes, only the mood is re-picked and no
   `remark_shown` row is added for the kept quip. A finished session's stored pick survives a
   band change. `remark_picked` logs `reason: refit` and `reroll` (read the real lines from
   `memoryLogger`). Migration test as in the existing `migrate.test.ts` pattern.
6. API routes + response schema + contract tests in `api.test.ts` (GET twice is stable; POST
   without the header is 403; 404s).
7. Web: `fillRemark` tests, `useRemarks`, Headline UI, CSS. Playwright on the rich seed: the
   remark shows; a reload shows the same text; ↻ changes it; it persists after reload.
8. BACKLOG: Watch items for the bicycle goal (trigger: a BicycleHit seen as a goal's origin
   touch) and for demos taken (trigger: decide to record SecondaryTarget). Note that WP8 adds the
   per-trigger switches (the picker's active set) and that the speed unit/clock settings flow
   into `fillRemark`. PROJECT_INDEX and roadmap status updates.

## Verification
- `bun run check` (typecheck, lint, Vitest), then `bun run e2e`. Long output goes to the
  scratchpad, and only its tail is read.
- Manual check on the dev data dir (`bun run dev`): open the latest session; reload (same
  lines); ↻ (different); switch the filter (its own pick); open an older session.
- Done criterion: confirmed in the browser on real data after deploy.

## Implementation notes
- **Finished-session quip, narrowed.** A kept quip's numbers come from its trigger, so a finished
  session keeps its quip only while that trigger still fires (whatever the tier now). One that
  stopped firing (after a recompute) is re-picked, since its line would show `{n}` with no value.
  The mood line is kept whatever the band. The numbers in a kept quip follow the current data
  (store test: a late import turns an MVP count of 3 into 4 on the same line).
- **A pick made mid-session is still live.** Refit also runs when the stored `picked_at` is
  before the session's last match ended: the pick saw only part of the session (the recap was
  closed while more matches landed). A refit that keeps everything moves `picked_at` up, so the
  pick is final from then on (`remark_final` logs it). A late import of a match that ended before
  the pick doesn't qualify, so the finished-session rule above still holds.
- ↻ and its error sit inline after the mood line, before the quip (the plan listed ↻ last): it
  follows the prototype's variant D layout, and ↻ re-rolls both lines.
- Stored ids are checked against the pool (`MOOD_BAND_OF`/`QUIP_OF` in `pick.ts`), so a renamed
  band or trigger in an old row is re-picked rather than crashing.
- `filterValue` moved to `src/shared/playlist-filter.ts` (server and web store under the same key);
  `filter-options.ts` re-exports it.
- `getJson`'s body parsing became `parseBody`, shared with the new `postJson`.
- ↻ uses `aria-disabled` while pending, not `disabled`, so keyboard focus stays on it (e2e checks
  focus). The remark block is `aria-live="polite"`.
- Migration 5 has no test of its own: `migrate.test.ts` uses toy migrations, and every store and
  API test opens a fresh DB through all migrations.
- All 129 lines checked verbatim against the copy file by a scratch script (only the four
  hard-shot lines differ, by design).

## Verification log
- `bun run typecheck`, `eslint . --max-warnings 0`: clean.
- Vitest: `src/server/remarks` 53 tests; `api.test.ts` 15; web `api.test.ts`, `remarks.test.ts`,
  `filter-options.test.ts` 23. `bun run check`: 73 files, 882 tests passed.
- `bun run e2e`: 20 passed, including the remarks test (revisit stable, ↻ changes it and keeps
  focus, survives reload; a faked 500 shows "Couldn't re-roll", and Retry works), axe in every
  theme, and 320px.

- Real browser (Chrome, `bun run dev` on `.dev-data`, built web): the recap shows the remark
  block; a reload shows the same lines; ↻ changes them, keeps focus, and the new lines survive a
  reload; a keyboard-only Tab + Enter re-rolls with a visible focus ring; the ranked filter gets
  its own stable pick and casual (no matches) 404s; no console errors. Dev data has one 1-match
  session, so only the short band was seen; the real-data check comes after deploy.

## Review log
Round 1 (snapshot `96aea5d`; diff re-classified Substantial, ~740 non-test lines): code-review
high, arch-reviewer (opus), security-reviewer, simplify.
- security: no findings.
- code-review 1, a pick stored while live froze once the session ended, even with matches after
  it. [Fixed] refit also when `picked_at` < session end; store test.
- code-review 2, ↻'s pending/error state followed you to another session or filter. [Fixed]
  `Remarks` keyed by session and filter.
- code-review 3, each remarks request builds the full `sessionDetail`. [Deferred → BACKLOG]
- code-review 4, every cached remarks query refetched after each match. [Verified, no fix
  needed] `invalidateQueries` refetches only mounted queries; the rest just go stale.
- code-review 5, a reroll response could overwrite a newer refit from a match that landed during
  it. [Fixed] invalidate after `setQueryData`, so the stored pick wins.
- code-review 6, the 10-session window ranks by when lines were shown, so browsing old sessions
  evicts recent ones. [Disputed] by design: repeat avoidance is about what you've recently seen.
  The index part is fixed with arch 1.
- code-review 7, the GET writes and isn't header-guarded (cross-site writes). [Deferred →
  BACKLOG] low impact on a localhost app; the security pass found the guards adequate.
- code-review 8, `filterValue` re-export shim. [Fixed] importers point at shared.
- arch 1, the `shown_at` index didn't serve `recent()`. [Fixed] `(session_key, shown_at)`.
- arch 2, the log's `band` was the computed band, not the kept one. [Fixed] `band` is the pick's,
  plus `computedBand`.
- arch 3, `tier` was a hand-copied enum while `band` was a string. [Fixed] both `z.string()`
  (the web doesn't branch on either).
- arch 4, 6, line wraps in Overview.tsx and BACKLOG.md. [Fixed]
- arch 5, ↻ placement not recorded. [Fixed] Implementation notes.
- simplify (reuse, simplification, efficiency, altitude): applied a `remarksKey` helper in
  `queries.ts`, merged its duplicate `playlist-filter` import, dropped a stray blank line. Skipped:
  - picking at match close so GET is a pure read: it reverses the map's "stored on first view";
  - deriving recents from `remark_picks`: it would forget lines a reroll replaced;
  - dropping the post-reroll invalidate: code-review 5's fix;
  - `band`/`tier` as shared enums: it undoes arch 3, and the web doesn't branch on either;
  - folding Retry into ↻: the plan's failure state;
  - a shared us/them score split with recap.ts: different null semantics;
  - `Pick.tier`, row aliasing, a lazy `recent()`, a `post` hop: small style changes on tiny inputs.
  Check 883 tests, e2e 20 passed after.

Round 2 (delta `git diff 96aea5d`; it touched files outside round 1, import paths only, so the
full table minus simplify): code-review high, arch-reviewer (sonnet), security-reviewer.
- security: no findings.
- arch 1 (risk), a mid-session pick that still fit kept refitting on every later view, since
  `picked_at` moved only on a change, so a later baseline shift could swap its lines. [Fixed] a
  no-change refit of a finished session moves `picked_at` up; store test with a baseline shift.
- arch 2, the "still holds" note was premature. [Fixed] reworded with the fix.
- arch 3 (q), the remarks migration was edited in place. [Verified, no fix needed] the dev and
  installed DBs are at user_version 4, so it has never run.
- arch 4, duplicate `playlist-filter` imports in PlaylistFilter.tsx and RecapPage.tsx. [Fixed]
- code-review 1, liveness compares `picked_at` with the session's end, not what the pick saw.
  [Verified, no fix needed] a seen-match count would also re-fit after a late import, which the
  user's "finished sessions don't change" rule forbids; `picked_at` is what tells "picked during
  the session" from "imported after". The cross-filter case is a no-op refit. Both times come
  from this PC's clock.
- code-review 2, the finalize write had no log line. [Fixed] `remark_final`, asserted in a test.
- code-review 3, the cancel before the invalidate was redundant (`cancelRefetch`). [Fixed]
- code-review 4, `tier` was unvalidated and unused by the web. [Fixed] dropped from the response
  (the log keeps it); this settles arch 3 of round 1.
  Check 884 tests, e2e 20 passed after.

Round 3 (the round-2 fixes, snapshot `d6610bc`): code-review low, arch-reviewer (sonnet),
security-reviewer. No bugs or risks.
- arch 1 (nit), `row?.picked_at` in the `remark_final` log could drop the `?.`. [Verified, no fix
  needed] TypeScript doesn't narrow `row` through the separate `refit` boolean.
Review done: round 3 had no new finding.

## Plan review
plan-reviewer (opus), round 1. Findings and what was done with each:
1. Refit would re-pick finished sessions after a recompute or baseline change. **Folded:** refit
   only when `detail.current`; finished sessions re-pick a part only when its line id is gone;
   store test added.
2. The bicycle-goal Watch item has no flagging check (§2). **Not applied, with a reason:** this is
   not an unseen shape. `BicycleHit` is in the raw data (34 of 76 matches); what's missing is a
   rule that links a hit to a goal's origin touch, the same kind of not-yet-built recording as
   demos taken. A Watch item with that trigger is enough. Flagging unknown statfeed names would
   put amber dots on matches for harmless events.
3. A reroll result could be overwritten by an in-flight GET. **Folded:** `cancelQueries` before
   `setQueryData`; the failure state is defined.
4. The POST body wasn't parsed. **Folded:** `postJson` with the schema.
5. Short counts decided matches. **Folded:** recorded as a deliberate reading, with an edge test.
6. The late-night 06:00 bound was invented. **Folded:** it moves into `THRESHOLDS` and is noted as
   our choice; whole-session times are stated.
7. shut_out with a null team or score. **Folded:** skipped, with a test.
8. A km/h unit hardcoded in the templates. **Folded:** the unit is stripped from the templates
   and added by `fillRemark`.
9. Test seams. **Folded:** a store partial-refit test, a log reason test, and the inert test
   moved to triggers.
10. The transaction only adds atomicity. **Noted** in `store.ts`'s description.
