# WP8b: Settings: You (IDs), Seasons, section list

Repo copy (step 1): `docs/plans/2026-10-28-wp8b-settings-tables.md`. Tier: Substantial (second
half of WP8; one session). WP8a (`docs/plans/2026-10-28-wp8a-settings.md`, commit `8db7207`) built
the page, the per-key settings store and the row/save patterns this plan reuses.

## Context
Roadmap § WP8 (`docs/plans/2026-10-16-v1-roadmap.md`) leaves WP8b: the You (IDs) table, the
Seasons table, and the sticky section list once those make the page long. Today:
- **IDs**: `my_ids (primary_id PK, name, status confirmed|pending|rejected, added_at)`
  (`src/server/db/migrations.ts:20-26`). A match's camera player is added as `pending`
  (`src/server/records/save.ts:40-48`, never re-adding an id in any status). Readers count every
  id that isn't `rejected` as you (`MINE`, `src/server/query/read.ts:21`), at query time. Nothing
  can confirm or reject a guess, so a wrong guess counts as you forever.
- **Seasons**: a `seasons (id, name UNIQUE, start_date UNIQUE)` table seeded S22/S23/S24
  (`migrations.ts:11-19`), read by `GET /api/seasons`; every reader looks a season up by numeric
  id and orders by start date (`src/shared/periods.ts:90,119-125`). There is no write path, so
  S25 (around December) would need a code edit.

User decisions (2026-10-28, simplest first, revisiting the features map's "Settings layout"
items where they differ):
- **IDs: confirm/reject only.** No manual "+ Add", so no per-platform ID-format validation
  (the roadmap's "non-17-digit Steam ID" and "duplicate ID" checks drop).
- **Seasons: add, edit, delete.** Delete is immediate (no Undo, as in WP8a).
- **Section list: plain anchor links**, no highlight of the section in view.
- User asked whether seasons must be set by hand: yes. The Stats API carries no season, so each
  new season (about every 3 months) is one "+ Add" row; the section's help text says so.

## Decisions
- **API** (handlers stay synchronous; values ride in the query string as in WP8a; the existing
  `X-RLTracker-Request` guard covers every POST; the router has GET/POST only):
  - `GET /api/ids` → `{ ids: [{ primaryId, name, platform, status }] }`, ordered by `added_at`.
    `platform` comes from a pure `platformOf` in `src/shared/platforms.ts`, keyed on the raw
    `primary_id` prefix before the first `|`. Captures show `Epic`, `Steam`, `PS4`, `XboxOne`
    (and bots' `Unknown|0|0`, never in `my_ids`). Map Epic → Epic, Steam → Steam, PS4/PS5 →
    PlayStation, XboxOne → Xbox, Switch → Switch. Any other prefix shows as itself, and the
    server logs `ids/unknown_platform {prefix}` once per list. `PS5` and `Switch` have not been
    seen yet, so a BACKLOG Watch item records the trigger.
  - `POST /api/ids?id=<primary_id>&status=confirmed|rejected` → the full list. Unknown id → 404.
    No `pending` target: a guess can't be un-answered.
  - `POST /api/seasons?name=&start=` (add), `POST /api/seasons/:id?name=&start=` (edit),
    `POST /api/seasons/:id/delete` → the full `{ seasons }` (the existing `seasonsResponse`).
    `:id` is parsed with `wholeId` (`params.ts`); a non-number is a 400. An unknown id is a 404.
    A clash gives 409 `{ error: "duplicate_name" | "duplicate_start" }`. The store checks before
    writing, and compares names case-insensitively (`COLLATE NOCASE`), so `s25` clashes with
    `S25`. The UNIQUE constraints stay as the backstop.
  - Zod (`src/shared/schemas/tables.ts`, shared with the web form): `seasonInput` = name trimmed,
    1–20 chars; start = `dayParam` (`params.ts:17`). `idStatus` = the two targets.
- **Stores** (`src/server/ids.ts`, `src/server/seasons.ts`, same shape as `createSettings`):
  - `ids.list()`, `ids.setStatus(id, status)`; logs `ids/status {id, from, to}`.
  - `seasons.add/edit/remove`, each one transaction, returning the list from `reader.readSeasons`;
    logs `seasons/added|edited|deleted {id, name, start}` and `seasons/conflict {field}`.
  - A rejected id is never guessed again (`INSERT OR IGNORE`, `save.ts:44`). If you press "Not me"
    by mistake, the rejected row's "That's me" undoes it.
- **Web cache**: an ids or seasons change can move every stat or period. On success the mutation
  runs `cancelQueries` and then `setQueryData` on its own key, as `useSaveSettings` does. That key
  holds the whole response: `{ ids }`, or `{ seasons }`, since `useSeasons` selects `.seasons`.
  It then invalidates with a pure predicate, `staleAfterTables(written)`, placed next to
  `staleAfter` in `src/web/logic/invalidation.ts` and unit-tested. The predicate covers every
  key except `settings` and the key just written.
  - Coarse, per the UI guidelines: the app is local.
  - Stored remark picks are untouched; they were chosen for what was shown then.
- **You section** (no reset link: it would forget which player is you):
  - Help: "Which players are you. The tracker guesses after a match from whose view the camera
    follows; pending guesses count as you until you answer."
  - A table: name, platform, status ("Waiting for you" badge / "You" / "Not you"), actions.
    Pending: "That's me" and "Not me". Confirmed: "Not me". Rejected: "That's me".
    Order stays by `added_at`, so a row never jumps when answered.
  - This revisits the features map, open to change at approval. The "is this also you?"
    confirmation was to sit at the top of You (`features-map.md:397`). Here it sits in each
    pending row, marked by the badge. A banner plus a table would show the same buttons twice,
    and focus would jump when an answered row moves from the banner into the table.
  - Empty list, or nothing but rejected rows: a warning "No player is you yet. The tracker will
    ask after your next match." The table (if any) still shows.
- **Seasons section** (no reset link: it would delete your rows):
  - Help: "Rocket League doesn't tell the tracker when a season starts. Add each new one here."
  - Rows by start date: name, start, end (the day before the next start; the last reads "still
    running", or "upcoming" if it hasn't started), a "current" badge on the one holding today
    (`periodRange` + `dayOf(now)`), and Edit / Delete.
  - Edit turns the row into a name `<input>` and a `<input type=date>` with Save/Cancel; Enter
    saves, Esc cancels. "+ Add" appends an editable row. One row edits at a time: the other rows'
    buttons and "+ Add" are disabled meanwhile.
  - Errors under the row, linked by `aria-describedby`: a pure `seasonErrors(rows, draft, id?)`
    gives "Give it a name.", "Pick a start date.", "Another season is called S25.", "S24 already
    starts on that day." before sending; a 409 from the server shows the same text.
- **Section list**: a `<nav aria-label="Settings sections">` of links to `#appearance`,
  `#defaults`, `#remarks`, `#you`, `#seasons`.
  - The anchor ids sit on each section's h2, which already has `tabIndex=-1`. A link's click
    handler also focuses that h2, because a fragment jump alone doesn't move focus.
  - From 768px: two columns, with the list `position: sticky`. Below 768px: a sticky row across
    the top that scrolls sideways.
  - `scroll-margin-top` on the h2s, so the header doesn't cover a heading you jumped to.
  - A reload with a hash doesn't jump. The sections render after their data loads, so the
    browser's first fragment scroll finds nothing. The hash isn't promised as state.
- **Section component**: WP8a's `Section` takes the anchor id as its own prop. The reset and `s`
  become optional, as a `reset?: { id: SectionId; s: Settings }`, so You and Seasons reuse
  `Section` without the link.
  - `SaveStatus` is widened to `{ isSuccess, isError, submittedAt }`, so the table mutations
    can use it.
  - Failed table saves log `[rlt] ids/save_failed {code}` and
    `[rlt] seasons/save_failed {action, code}`.
- **Page structure**: You and Seasons render outside `Form`, each with its own query. A failed
  settings GET then hides only the three settings sections (WP8a's EmptyState), and a failed ids
  or seasons GET hides only that section.

### Interaction contract
| Trigger | What shows | Focus |
|---|---|---|
| "That's me" / "Not me" | POST; on success the row's status and buttons change, "✓ Saved" in the row; every page's stats refresh | the row's remaining button |
| Status save fails | Row unchanged; "Couldn't save · Retry" in the row | stays; a working Retry → the row's remaining button |
| Edit (season) | Row becomes inputs; other actions disabled | the name input |
| Save (button or Enter), valid | POST; row shows the saved values, re-sorted by date; "✓ Saved" | that row's Edit |
| Save, invalid (client) | Error under the row, `aria-invalid` on the field, nothing sent | the first invalid field |
| Save → 409 | Same error text from the server code; row stays in edit | the field named by the code |
| Save → other failure | "Couldn't save · Retry"; row stays in edit with the draft | stays |
| Cancel / Esc | Row back to its stored values (a new row disappears) | that row's Edit (or "+ Add" for a new row) |
| + Add | An empty editable row at the end | its name input |
| Delete | POST; row gone; "✓ Saved" by the section heading | the next row's Edit, else "+ Add" |
| Delete fails | Row stays; "Couldn't save · Retry" in the row | stays |
| Section link | Jumps to the section | the section's h2 (`tabIndex=-1`, as in WP8a) |
| IDs or seasons GET fails | That section shows "Couldn't load …" with Retry; the rest of the page works | — |
| Reload / Back/Forward | From the server; no URL state (a `#section` hash isn't restored) | — |

## Approach and files
- New: `src/shared/schemas/tables.ts` (+test), `src/shared/platforms.ts` (+test) or a `platformOf`
  beside `src/server/recorder/players.ts` if the web doesn't need it (it does: display),
  `src/server/ids.ts` (+test), `src/server/seasons.ts` (+test), `src/web/logic/seasons.ts`
  (+test: `seasonErrors`, the end/current/upcoming rows), `src/web/pages/settings/YouSection.tsx`,
  `SeasonsSection.tsx`, `test/e2e/settings-tables.spec.ts`.
- Changed: `src/server/api/index.ts` (routes), `src/shared/schemas/responses.ts` (`idsResponse`),
  `src/web/queries.ts` (`useIds`, `useSetIdStatus`, `useSaveSeason`, `useDeleteSeason`),
  `SettingsPage.tsx` + `Settings.module.css` (nav, section ids, optional reset, the two
  sections), `src/web/logic/invalidation.ts` (+test), `test/e2e/stack.ts` and `fixtures.ts`
  (a new `tables` seed with its own stack: rich, plus one pending id per test that answers one
  and a rejected id, none of them a player in any seeded match).
- Reuse: `parse`/`ok`/`orNotFound` and the guard (`api/index.ts`), `postJson`/`ApiError`
  (`api.ts`), `readSeasons` (`query/read.ts:388`), `periodRange`/`dayOf` (`shared/periods.ts`),
  `dayParam`, `SaveStatus`/`Section`/`useSave` patterns, `EmptyState`, tokens.

## Steps
1. Save this plan to the repo path. Roadmap § WP8: WP8b in progress, the user's three trims (no
   manual ID add, so no ID-format checks; no scroll highlight) with date and reason; features map
   "Settings layout" tables/sticky-list lines get a "revisited 2026-10-28, simplest-first (user)"
   note. BACKLOG roadmap item → WP8b in progress.
2. TDD schemas and pure logic:
   - `seasonInput`: blank name, long name, bad day.
   - `idStatus`.
   - `platformOf`: the real `Epic|…|0`, `Steam|…|0`, `PS4|…|0` and `XboxOne|…|0` shapes, PS5,
     Switch, an unknown prefix, and no `|` at all.
   - `seasonErrors`: each message, a case-insensitive name clash, and a row checked against
     itself (no clash).
   - Season rows: end = the day before the next start; still running; upcoming; current.
   - `staleAfterTables`: spares `settings` and the key just written; marks everything else stale.
3. TDD stores against a temp DB (as `settings.test.ts`): ids list order, set status both ways,
   unknown id, and a rejected id is no longer you in `readResults` (one cross-check that the
   status reaches `MINE`); seasons add/edit/delete, each clash, unknown id, the seed survives,
   and the log lines (read the real `seasons/conflict` line once).
4. Routes in `api.test.ts`:
   - GET ids.
   - POST status round-trip.
   - 400 on a bad status, and on a non-number season id (`/api/seasons/abc`).
   - 404 on an unknown id.
   - Seasons add, edit and delete.
   - 409 on each clash.
   - 403 without the header.
5. Web: queries and the two sections, the nav, the optional reset, per the contract.
6. e2e (`tables` seed, own stack):
   - IDs:
     - "That's me" on its own pending guess.
     - "Not me" on the confirmed ME id empties a session's stats, and "That's me" restores them.
     - The warning when every id is rejected, with the rest restored afterwards.
     - A failed status save, then Retry, with focus as in the contract.
   - Seasons:
     - Add a season starting today (dates relative to `Date.now()`, as `stack.ts` does). It shows
       "current" and appears in the Trends strip.
     - Edit a date so the row re-sorts, with focus following it.
     - Each client-side error, and a 409 via route-fulfil.
     - Delete, with focus.
     - Esc on a new row.
   - Section links focus the h2.
   - axe in all three themes, and the 320px layout fits with the top row.
   - Each pending guess is answered once only, since none can be restored. `afterEach` puts ME
     back to confirmed and the seeded rejected id back to rejected, through the API, and deletes
     any season after the seed.
7. `bun run check`, `bun run e2e`. Browser pass: keyboard-only through both tables, 320/768/
   1024/1440, no console errors.

## Verification
- `bun run check` green with the new schema, logic, store and route tests.
- `bun run e2e` green, including the new spec, axe in all themes, 320px.
- Browser pass (step 7). After `bun run deploy` the user answers the real pending guess (if any)
  and adds S25 when it starts.
- Done when: an id's answer changes whose stats count, a season added or edited shows on Trends,
  and both persist across reload.

## Plan review
plan-reviewer (opus), 2026-10-28. Every finding is folded in:
1. High: the e2e couldn't restore an answered pending guess. Each test now answers its own seeded
   guess.
2. Med: a second spec on the `settings` seed would share that stack, and the seed needed a new
   branch. A `tables` seed now gets its own stack, and its ids are players in no match.
3. Med: platform names were keyed on display names. They're now keyed on the raw prefixes (PS4,
   XboxOne). The unseen ones (PS5, Switch) get a log line and a Watch item.
4. Med: the Q14 banner placement drifted without a note. It's now recorded as a revisit, open at
   approval.
5. Med: the cache rule had no test seam. It's now a pure, tested `staleAfterTables`, with
   `cancelQueries` before `setQueryData`, and the whole `{ seasons }` response goes in the cache.
6. Low/med: `Section` and `SaveStatus` were typed to settings. The anchor prop is separate, the
   reset is optional, `SaveStatus` is widened, and links focus the h2.
7. Low/med: a reload with a hash doesn't jump. That claim is dropped from the contract.
8. Low: a failed settings GET would hide the tables. You and Seasons now render outside `Form`.
9. Low: `wholeId` and a 400 for the season id; web save-failed logs; e2e dates relative to now;
   case-insensitive season names; the rejected-id recovery wording.

## Implementation notes (2026-10-28)
Steps 1–7 done; independent review pending.
- Deviations, each the smaller change:
  - `Section`, `SaveStatus`, `useSave` and a shared `TableState` moved to
    `src/web/pages/settings/parts.tsx`, so the two new section files don't import the page (a cycle).
  - The tables are lists of rows (`<ul>`, the existing `.row` layout) rather than `<table>`: they
    stack below 768px with no extra CSS, and each button is described by its row's name.
  - `seasonRows(seasons, today)` takes `dayOf(now)` rather than calling `periodRange`: the same
    edges (start day's cutoff), and simpler to test. `now` comes from Trends' `useNow`, moved to
    `src/web/components/useNow.ts`.
  - A tested `dateLabel` ("11 Mar 2026") was added to `format.ts` for the season rows.
  - The section links scroll and focus the h2 themselves (`preventDefault`); the URL gets no hash.
  - `POST /api/seasons` now exists, so the API test's 405 example moved to `/api/played-days`.
- Verified: `bun run check` (1036 tests), `bun run e2e` (60 passed, incl. `settings-tables.spec`
  11). A real `seasons/conflict` line read once:
  `{"level":"warn","cat":"seasons","event":"conflict","field":"name"}`. Browser pass at 1440:
  section links, Edit → error → Esc → focus on Edit, Tab order, no console errors. The browser
  window wouldn't resize below desktop width, so 320px rests on the e2e (scroll width, sticky row
  above the jumped-to heading).

## Review log

Diff re-classified at review: Substantial (796 non-test lines, Substantial by design). Snapshot
before round-1 fixes: `f4ee442`.

### Round 1: code-review high, arch-reviewer (opus), security-reviewer, simplify
- security: no findings.
- code-review 1 (Edit during a pending delete locks the table), 2 (double-click Delete sends two),
  4 (a late save closes a newer editor), 5 (Retry stays clickable while its retry is pending),
  arch 1–3 (delete Retry during an edit, editor Retry in flight, Cancel during a save then a late
  409 on the wrong row): one topic, the Seasons editor's races. **[Fixed]** with one rule: while a
  save or delete is pending every table action waits (`busy` guards edit/cancel/submit/remove,
  disables Cancel, ignores Esc, hides the editor's Retry); `failed` resets when a save goes out;
  starting an edit clears a delete failure.
- code-review 3 (stored remark picks don't refit after an id's answer): **[Verified, no fix
  needed]**: the plan's cache decision keeps stored picks, "chosen for what was shown then".
- code-review 6 (client folds Unicode case, SQLite NOCASE only A-Z): **[Fixed]** A-Z-only fold,
  test added.
- code-review 7 (`ids/unknown_platform` on every list read): **[Fixed]** once per prefix per run,
  test updated.
- code-review 8 (a fixed field keeps its error): **[Fixed]** a field's error clears when it
  changes.
- code-review 9 / arch 6 (a nav link to a section that failed to load writes a hash):
  **[Fixed]** `preventDefault` always.
- code-review 10 / arch (duplicated write header and cancel-then-set pattern): **[Fixed]** one
  `WRITE` header and one `useWholeWrite(key, write, stale?)` used by settings, ids and seasons.
- arch 4 (editor element built twice), arch 5 (`retry` stub): **[Fixed]**.
- simplify (applied): a table write spares both table keys (neither depends on the other;
  `staleAfterTables` is now a plain predicate, test updated); clash codes come from the
  `seasonConflict` schema; `SECTIONS` moved to `parts.tsx` and types `Section`'s anchor; a
  simpler error-clearing; the form-level `aria-describedby` that repeated the inputs' dropped;
  `Stored = Omit<IdRow, "platform">`; `firstInvalid` inlined. Skipped: logging failures in the
  shared write hook (the call sites carry the `action`), a `useRowSave` helper, `children !==
  false`, merging `saved`/`deleteFailed`, a `done()` helper in seasons.ts, the stack.ts seed chain,
  deriving `idStatus` from the response enum: marginal or outside the change's need.
- After fixes: `bun run check` green (1037 tests), `bun run e2e` green (60 passed).

### Round 2 (delta from `f4ee442`): code-review low, arch-reviewer (sonnet), security-reviewer
- security: no findings. code-review low: no findings (a first run diffed the wrong range and was
  re-run on `git diff f4ee442`).
- arch: every round-1 fix checks out. Two nits, **[Fixed]**, nothing executable changed:
  `Section`'s doc comment had been separated from it by `SECTIONS`; `useWholeWrite`'s `stale`
  is typed as any cache predicate (`CachedQuery` exported), not as `staleAfterTables`.
- `bun run check` green (1037 tests). Round clean: review done.
