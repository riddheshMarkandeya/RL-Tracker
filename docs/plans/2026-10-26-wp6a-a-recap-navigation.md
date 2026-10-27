# WP6a: Recap pages, split a/b/c. This plan covers WP6a-a: the MVP check fit and recap navigation

## Context
WP6a (roadmap `docs/plans/2026-10-16-v1-roadmap.md`) turns the Recap placeholder into the real
recap: session picker, playlist filter, Overview sections 1–8, Matches & numbers, the match page and
the goal map. Ported from variant D of `prototypes/recap-layout/recap-prototype.html` (branch
`prototype/recap-layout`) per the features map's "Recap layout" and "Little or no data" decisions.
At about 2,000+ lines it won't fit one session, so it is split. Two BACKLOG items fold in:
- **`mvp_count` flag** (WP4b's open flag): now examined on real data, see section 1 below.
- **Narrow the `match_ended` refresh** (`src/web/events/useLiveEvents.ts` invalidates every query).

### Split (each one is plan → TDD → review → deploy)
- **WP6a-a (this plan, ~700 lines)**: MVP check fit and recompute; query keys and narrowed
  invalidation; `/recap` routes and URL state; a `latest` session endpoint; session picker;
  playlist filter; empty and "nothing under this filter" states; Overview sections 1–4 (scorebug,
  change vs 30-day, the four tiles, match cards with the dense layout). The e2e seed grows to many
  sessions, plus an empty-DB stack.
- **WP6a-b (~700)**: Overview sections 5–8: per-game cards vs the 30-day average, "What stood out",
  By playlist, the SVG goal map (shared component, marks shrink above 60 goals), Extras and
  Highlights. Vitest on "what stood out", highlight visibility and the goal-map zones and threshold.
- **WP6a-c (~700)**: Matches & numbers (table with pinned header and totals, capped at 70vh), the
  side match list (scrolls in a viewport-high box, keeps the open match in view), the match page
  (scoreboard, goal map, extras, slim flag note), making match cards and goal dots links, ⚑ on the
  list. Playwright on all three pages and the roadmap's done-criterion.

### User decisions (this session)
- **MVP**: "Keep inferring, unflag". A podium with no MVP award is normal. The check flags only more
  than one award. Inferred MVPs stay as now, including the user's in the playlist-53 1v1.
- **Playlist 53 = Honor Duel** (user, 2026-10-26). The match was a 1v1 against HulkingPen12238,
  Mon 19 Oct, 23:04 CDT. HulkingPen was the user's teammate in the Doubles matches the same week,
  and it wasn't private (private is playlist 6). Add `53: p("Honor Duel", "extra")` to
  `src/shared/playlists.ts`, with a comment that this was observed live and named by the user. The
  playlists test should cover it.

## Constraints that bind this plan
- Global CLAUDE.md: TDD (`tdd-live-code-carveout`), with pure logic TDD'd and UI checked through
  Playwright and a real browser. Use `ui-implementation-guidelines` for all UI code, logging as in
  §2, and `independent-review-pass`.
- Project CLAUDE.md "Data shapes we haven't seen": a shape that never appeared gets flag-and-wait.
- Features map: "Recap layout", "Little or no data" (hide empty items, no fake zeros), and no counts
  in the playlist or teammate dropdowns (memory `ui-preferences`). The session picker keeps the
  map's W–L, match count, length and strip.
- Registry contract (`src/server/rules/registry.ts`): bump a rule's version on any change that can
  move a stored value. `check_flags` is stored.
- Accent and colour tokens from `src/web/styles/tokens.css`. Themes are carbon, slate and oled.
- WP5b-b handoff: real pages replace the visually hidden h1 with a visible one.
- The "with teammate" filter is not rendered until WP9. The remark line waits for WP6b.

## Approach

### 1. MVP check fit (records)
Evidence from the live DB (read-only, 2026-10-26; recounted after the plan review):
- Of 65 matches, 61 had a podium and one MVP award, and 3 had a podium but no award. The last match
  had an award but no `PodiumStart`.
- 61 of the 62 awards went to the winning team's top scorer. The other was a tie on score.
- No award ever went to a player who had left.
- The 3 podiums with no award are the 3 `mvp_count` flags. In 2 Casual Doubles matches the winning
  team's top scorer had left. The third is the playlist-53 Honor Duel.
- The registry evidence states this honestly. In the two leaver matches the game held the award
  back, and the inference names someone the game didn't pick. Keeping the inference was the user's
  choice ("keep inferring, unflag").
- Commit this separately from the UI work, so the change to stored data stands alone in history.

Changes:
- `src/server/recorder/checks.ts` `mvp_count`: flag `mvpCount > 1` only. Message `"N MVPs"`.
  Comment: a podium can end without an award (the game holds it back when the winning team's top
  scorer left).
- `sawPodium` has no other reader (grep: only this check), so remove the fact from
  `src/server/recorder/summary.ts` (Acc, facts, handler) and from the test fixtures. If removing it
  turns out to touch more than this, keep the fact and just stop reading it.
- `src/server/rules/registry.ts` rule `mvp`: version 1 → 2, with the figures above as evidence and
  this plan's repo copy added to refs. Then `bun run definitions` to regenerate
  `docs/definitions.md`, which the definitions test pins.
- Tests first (`src/server/recorder/checks.test.ts`): 0 MVPs with a podium is clean (this flips the
  existing line-100 case), 2 MVPs is flagged, 1 is clean.
- `bun run rules-diff` against the real data dir must show:
  - exactly the 3 guids losing `mvp_count` (4E14D0C2…, 0EE4073E…, 7B25B64A…),
  - no column moving,
  - and `rule versions changed: mvp` on every match.
- `deploy` runs `install-autostart` before `recompute`. A tab that reconnects in between keeps the
  old flags, so reload the page before checking that the amber dot is gone.

### 2. Query keys and narrowed invalidation (`src/web/queries.ts`, `src/web/logic/invalidation.ts`)
- Move `components/queries.ts` to `src/web/queries.ts`: one key factory plus the hooks.
  - `["sessions", "list", filter, from, to]`, `["sessions", "months", filter, before]`,
    `["sessions", "current", filter]` and `["sessions", "latest", filter]` hold the cheap lists.
  - `["session", key, filter]` holds the heavy detail.
  - WP6a-c adds `["match", guid]`, and WP7 adds `["period", …]`.
- Pure predicate `staleAfter(sessionKey | null)`, TDD'd. It is a denylist: every query is marked
  stale except a `["session", k, f]` detail where `k !== sessionKey` and the cached `next !== null`.
  - Those are the only queries a new match or a break can't move. Sessions are only appended
    (`cutSessions`), a break is always at now, a baseline reads only the window before its session,
    and `prev` never changes.
  - So a key added later (WP6a-c match, WP7 period) is refreshed by default instead of silently
    going stale under `staleTime: Infinity`.
  - Tests:
    - an unknown key is marked stale;
    - an older detail is spared;
    - the event's own detail and the newest detail (`next === null`) are marked stale;
    - a detail with no data yet is marked stale.
- `session_break` and `match_ended` with `sessionKey: null` both call it with null.
- Reconnect after the link was down still invalidates everything (unchanged).
- `useLiveEvents` calls `invalidateQueries({ predicate })`.

### 3. Server: `GET /api/sessions/latest?filter=`
*Superseded in review (Review log, round 1): `pages.latest` returns `latestResponse`,
`{ session, playlistsPresent }`, with the playlists of every match you played.*
- `pages.latestSummary(filter)` returns the last of `summaries(index(), filter)` or null.
- The route reuses `currentResponse` (`{session}`).
- Contract test in `src/server/api/api.test.ts`: empty DB gives null. A private-only newest session
  is skipped under `everything` and returned under `private`.
- Check that the router's best-match picks the literal path over `/api/sessions/:key`, as it does
  for `current`.
- Why: `/recap` needs the newest session under the filter, even one older than 2 weeks. Calling
  `/api/sessions?from=1000-01-01` would return the whole history to read one row.

### 4. Routes and URL state (`src/web/App.tsx`, `src/web/pages/recap/`)
*Superseded in review (Review log, round 1): no second `latest` query; an empty
`playlistsPresent` is the empty history, otherwise the filter note with the dropdown.*
- `/recap?filter=` resolves the latest session under the filter, then `replace`-navigates to
  `/recap/:session?filter=…`.
  - When nothing matches a filter other than everything, it also asks `latest` under everything.
  - If that finds a session, the page shows the filter control and "No matches under this filter
    yet". Only when everything is empty too does it show the empty-DB state.
- `/recap/:session` is the Overview. WP6a-c adds `/recap/:session/matches` and
  `/recap/:session/match/:guid`.
- The filter lives in the query string, parsed with the shared `filterParam`. A bad value falls back
  to everything and logs `[rlt] recap/bad_filter`. Leaving the filter out means everything (excl.
  private), the map's recap default.
- Changing the filter keeps the session.
- A visible h1 names the session (day plus time range). The picker button sits beside it.

### 5. Session picker (`src/web/pages/recap/SessionPicker.tsx` + `src/web/logic/picker.ts`)
*Rewritten in review (Review log, round 5: the user's redesign replaced a 2-week list with lazy
month folds).*
- « ‹ › » around the button: previous month, previous session, next session, next month. Each is a
  link from the detail's `prevMonth`, `prev`, `next`, `nextMonth`, or a disabled button when null.
  Lucide chevron icons, labelled for screen readers and with a title.
  - `prev`/`next`: the neighbouring session under the filter.
  - `prevMonth`: the previous month's newest session; `nextMonth`: the next month's first. Months
    with nothing under the filter are skipped. `prevMonth` never moves as sessions are added;
    `nextMonth` moves once, from null to the next month's first session.
  - A month is `monthOf(day)` from `src/shared/periods.ts`, on the server and the client alike.
- Once a session is on screen, focus that a load took from the control used (it fell to the page)
  goes to the picker button, the h1 naming the session (round 11, the user's call); after a filter
  change (not Back/Forward), back to the filter (round 12). Focus still on a control, or arriving on
  the page, is left be (round 16, the user's call).
- The button shows the session's day, time range, and a "2nd of 2 that day" chip when `ofDay > 1`.
- The list is a disclosure holding the open session's month (`/api/sessions?from&to` over
  `monthRange(month)`), headed by the month and grouped by day. When it arrives, focus moves once
  to the open session's row, else the first row. Escape and picking a row close it and return
  focus to the button; an outside click or any navigation closes it.
- Row: time range, W–L, "N matches · length", and a mini W/L strip of at most 24 squares, then
  "+N". A null result is a neutral square.
- Pure, TDD'd: `groupByDay`, `strip(results, 24)`, `monthRange(month)` in `picker.ts`; the
  formatters in `format.ts`.

### 6. Playlist filter (`src/web/components/PlaylistFilter.tsx` + `src/web/logic/filter-options.ts`)
- `filterOptions(present, selected)`, TDD'd:
  - Everything (excl. private).
  - Ranked: All ranked plus each ranked playlist present.
  - Casual: All casual plus each one present.
  - Extra modes: "All extra modes" plus the extra and LTM playlists present (this includes 53,
    Honor Duel).
  - Private, only when one is present.
  - Other: the unmapped, offline and tournament ids present, each as a single playlist. They
    otherwise have no slot, and `inFilter` allows each to be picked alone.
  - A group is left out when none of its playlists is present. The selected value always stays
    listed, so a deep link isn't silently dropped.
  - No counts. Names come from `playlistInfo`.
- Shared with Trends (WP7). A native `<select>` with `<optgroup>`.

### 7. Overview sections 1–4 (`src/web/pages/recap/Overview.tsx`, `src/web/logic/recap.ts`)
- **1. Scorebug**: WINS | day · session length · win % · match count | LOSSES. It carries an
  aria-label with the W–L.
- **2. Change vs 30-day**: win-% delta in points against `baseline.winPct`, hidden when the baseline
  has no matches. No remark text until WP6b: an empty slot is hidden, never filled with fake text.
- **3. Tiles**: best streak (`W n`), ended on (`W3`/`L2`), shooting % with ▲▼ against the baseline,
  MVPs (yours, `mvpKey === me.playerKey`). Each tile is hidden when its value is null. The MVP tile
  is hidden at 0, as in the prototype.
- **4. Match cards**: number, local time, W/L plus score with your team first (team 0 first when
  your team is unknown), short playlist name, an MVP icon, and an amber dot plus an aria note when
  flagged.
  - The `.dense` layout applies above 24 matches, about 13 per row.
  - Cards are not links yet. WP6a-c makes them open the match.
- Pure, TDD'd: `scoreFor(match)`, `winPctDelta(agg, baseline)` (null when there's no baseline),
  `tilesFor(agg, baseline, mine)` (hidden rules), `isDense(n)`.
- Copy the prototype's statfeed icons (`assets/icons/stat_events/*.png`) into
  `src/web/assets/icons/`. This package uses only MVP; WP6a-b uses the rest.

### 8. States
- Empty DB: `EmptyState` "Not enough data yet". Play a match with the tracker running and the recap
  appears here by itself, because `match_ended` triggers the refetch.
- A session with nothing under the filter (`summary === null`): the picker and filter stay, with a
  short note "No matches under this filter in this session". No scorebug or zeros.
- Unknown key (404 `not_found`): "This session isn't here any more" with a link to `/recap`. A key
  from a mistyped or old link lands here.
- Every state (empty, 404, loading, error) has its own visible h1, so axe's `page-has-heading-one`
  holds throughout.
- Loading: the page waits for the session (revised in review round 9, the user's call): the h1 and
  a pulsing block with a "Loading" announcement, shown only after 150ms so a quick load doesn't
  flash; the area keeps the page's height. `/recap` shows the same while it looks up the latest
  session. Focus then goes to the picker (§5).
- Other errors: a short error note. `api.ts` already logs each failure (`api/failed`,
  `api/network`).

### Logging
- Web: `[rlt] recap/bad_filter` (value). That's the only new decision point. Fetch failures are
  already logged by `getJson`.
- Server: the new route goes through the existing router and request logging. Nothing else.
- Records: `rules/diff_*` from rules-diff, and the recompute's own logs after deploy.

## Files
- Server: `src/server/recorder/checks.ts`, `summary.ts` (+tests), `src/server/rules/registry.ts`,
  `docs/definitions.md` (generated), `src/server/api/pages.ts`, `index.ts`, `api.test.ts`.
- Web: `src/web/queries.ts` (moved from `components/queries.ts`; update `SessionChip` and
  `HeaderActions` imports), `events/useLiveEvents.ts`, `logic/invalidation.ts`, `logic/picker.ts`,
  `logic/filter-options.ts`, `logic/recap.ts` (each with a test), `pages/recap/RecapPage.tsx`,
  `SessionPicker.tsx`, `Overview.tsx` with CSS modules, `components/PlaylistFilter.tsx`,
  `assets/icons/`, `App.tsx`, `pages/Placeholders.tsx` (drop `RecapPage`).
- e2e: `test/e2e/stack.ts` and `fixtures.ts` (seed mode `rich` | `empty`), a new
  `test/e2e/recap.spec.ts`, and `shell.spec.ts` (its recap assertions now meet the real page).
- Docs: roadmap WP6a split, BACKLOG (close the invalidation item, record the `mvp_count` outcome),
  repo plan copy `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`, review file in `docs/reviews/`.

## Test seams
- Pure logic (Vitest, red first): invalidation predicate, picker helpers, filter options, recap
  formatting and tile visibility, the `mvp_count` check.
- API contract: `/api/sessions/latest` against a seeded temp DB.
- Seed modes: `fixtures.ts` gets a worker-scoped option `seed: "rich" | "empty"`
  (`{ option: true, scope: "worker" }`, default `rich`), passed to `stack.ts` as an argument.
  - `recap-empty.spec.ts` sets `test.use({ seed: "empty" })`. With `workers: 1`, Playwright starts a
    separate worker, and so a separate stack, for it after the rich specs.
  - The rich seed keeps the current session at exactly the one won match `e2e-seed-won`, so
    `shell.spec.ts`'s chip "1–0" → "1–1" holds.
  - Every other seeded session ends more than 30 minutes earlier, on earlier days, so none is
    current. The private-only session isn't the newest overall.
  - `shell.spec.ts`'s `toHaveURL(/\/recap$/)` becomes `/\/recap\/[^/?]+/`.
- Playwright (`recap.spec.ts`), `rich` seed: two sessions on one day, one older than 2 weeks, a
  private-only session, a flagged match, and a 25+ match session for density.
  - `/recap` redirects to the newest non-private session.
  - ‹ › step between sessions, and "2nd of 2" shows.
  - An older month opens lazily and lists its session.
  - The filter changes the URL and the scorebug, and a filter with nothing shows the note.
  - Dense cards show above 24 matches.
- Playwright, `empty` seed: "Not enough data yet".
- The existing replay test checks that the Overview of the current session updates without a
  reload.
- The axe sweep covers the new page in every theme.
- Real browser: the installed dashboard on the user's real data (sessions 19–25 Oct).

## Steps
1. Save this plan to `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`. Update the roadmap's WP6a
   section with the a/b/c split.
2. MVP check: tests red → fix → registry bump → `bun run definitions` → `bun run rules-diff` (expect
   the 3 guids). Add playlist 53 = Honor Duel with its test. `bun run check` green. Offer this as
   its own commit.
3. `latest` endpoint, contract test first.
4. Query keys move plus the invalidation predicate (TDD), wired into `useLiveEvents`.
5. Pure logic: picker, filter options, recap (TDD).
6. Recap route, picker, filter, Overview 1–4, states. Load `ui-implementation-guidelines` first.
7. e2e seeds and `recap.spec.ts`. `bun run check` and `bun run e2e` green. Give the `/compact` line.
8. `independent-review-pass`.
9. On the user's go: `bun run deploy` (recompute included), then a real-browser check of the
   installed dashboard. Update BACKLOG and the roadmap status.

## Verification
- `bun run check` (typecheck, lint, Vitest) and `bun run e2e` (Playwright plus axe) pass.
- `bun run rules-diff` lists exactly the 3 `mvp_count` guids and no column changes. After deploy,
  `tracker.db` has 0 matches with `mvp_count`.
- Installed dashboard: `/recap` lands on the newest real session. Stepping back reaches 19 Oct. The
  playlist-53 match card shows "Honor Duel" and its MVP icon, with no amber dot. A replay
  or real match updates the open recap without a reload.

## Plan review
plan-reviewer (opus), 2026-10-26. Verdict: sound. Each finding and what was done with it:
1. med, the invalidation allowlist would let a future key go stale silently. **Folded in**: now a
   denylist with an unknown-key test, and `sessionKey: null` handled.
2. med, the filter options left out unmapped, offline and tournament ids and "All extra modes".
   **Folded in**: an "Other" group and "All extra modes".
3. med, the e2e seed modes weren't designed. **Folded in**: a worker-scoped `seed` option, the
   current-session constraint, and the `shell.spec.ts` URL assertion change.
4. low-med, `/recap?filter=X` with nothing under the filter looked like an empty DB. **Folded in**:
   a fallback `latest` under everything, then the filter note.
5. low, the stated reason for the `latest` endpoint was wrong. **Fixed**: one request reading one
   row instead of the whole history. The reviewer confirmed the router puts literal paths first.
6. low, the MVP figures were inconsistent. **Recounted**: 61 podiums with an award, 3 without, 1
   award without a podium. The evidence now states that the inference differs from the game in the
   leaver matches.
7. low, the rules-diff output and the deploy ordering. **Folded in**: expect the `rule versions
   changed: mvp` line, and reload before the amber-dot check.
8. low, the non-session states had no h1. **Folded in**.
- The reviewer confirmed that removing `sawPodium` is safe. The fixtures to edit are
  `checks.test.ts:57,86,91,150` and `recorder.test.ts:94,108,117`.
- **Folded in**: the reviewer's suggestion to commit the MVP fit separately.

## Review log

### Round 1 (2026-10-26), snapshot `9cb6b37`
Diff: 49 files, +1451/−68. Substantial by design tier and size. Passes: `/code-review high`,
arch-reviewer (sonnet), security-reviewer, `/simplify`. Prerequisites: `bun run check` (lint,
typecheck, Vitest) and `bun run e2e` green before the round.

Security: no findings.

`/code-review high`:
1. `staleAfter` spared an older detail from today, whose "Nth of M that day" moves when a new
   session starts today. **[Fixed]** `staleAfter(sessionKey, today)` also marks stale any detail
   whose `day` is today, with a red-first test.
2. The picker's focus missed the open session when it sits in an older month (that list loads
   later). **[Fixed]** The month focuses its row when its list arrives. The e2e now asserts focus.
3. A history of private matches alone showed "Not enough data yet" with no way in. **[Fixed]**
   First fixed with a client-side `fallbackFilter`, then replaced by the /simplify probe fix (below):
   `latest` also returns every playlist played, so `/recap` can tell an empty history from a
   filter that misses it, private-only and offline-only alike, and fills the dropdown.
4. ‹ › with the popover open left it open. **[Fixed]** Step links close it. Covered in e2e.
5. Scorebug label "1 wins, 1 losses". **[Fixed]** Singular forms; the e2e locators follow.
6. Under a narrow filter the scorebug shows the whole session's length. **[Disputed]** The length
   is the session's, as the heading's time range is: the filter narrows which matches count, not
   the session. Raise with the user at the real-browser check.
7. Comments pointing at other files (`queries.ts`, `fixtures.ts`, `recap.spec.ts`). **[Fixed]**
8. `letterOf` duplicated `letter`; `monthLabel` sat in the component. **[Fixed]** `letter` handles
   null and is shared. The formatters moved to `logic/format.ts` (with `monthLabel` and a test);
   `picker.ts` keeps the lists. This also settles the arch note on the formatters' module.
9. A redundant `avg !== null` guard; two `RecapIndex` branches giving the same notice. **[Fixed]**
   `winPctDelta` returns `{ points, avg }`; the branches are one condition.
10. `recap.spec.ts` relies on running before `shell.spec.ts` in the shared worker.
    **[Deferred → BACKLOG]** Holds today (file order, `workers: 1`). The trigger is sharding or
    a change to file order; then give the replay spec its own stack.

arch-reviewer (sonnet), no bugs or risks:
- q: `tilesFor` has no `mine` argument. **[Verified, no fix needed]** `aggregate.mvps` already
  counts only your MVPs (`mvpKey === me.playerKey` server-side). The plan's signature was loose.
- The formatters in `picker.ts`. **[Fixed]** (see 8).
- The h1 wraps the picker button, unlike the plan's "beside". **[Verified, no fix needed]** A
  deliberate change: the visible h1 names the session, and axe passes. The JSX indentation is fixed.
- `present={[]}` in the narrow-filter state. **[Fixed]** Comment added.
- The loading h1. **[Verified, no fix needed]**
- Header comment wrapping in `stack.ts` and `shell.spec.ts`; import order in `stack.ts`. **[Fixed]**
- Process: the MVP fit should be committed on its own; BACKLOG and the review file are pending.
  **[Verified, no fix needed]** They're step 9 and the commit.

`/simplify` (reuse, simplification, efficiency, altitude; sonnet):
- The probe: `/recap`'s second probe query and its hard-coded filter pairing. **[Fixed]**
  `GET /api/sessions/latest` returns `{ session, playlistsPresent }` (`latestResponse`), with
  `playlistsPresent` over every match you played. Contract test added; `fallbackFilter` is gone.
- `SECTIONS` restated `GROUPS`. **[Fixed]** `GROUPS` is exported from
  `shared/playlist-filter.ts` and the sections read it.
- `Math.round(x * 100)` beside `pct`. **[Fixed]** `pct` exported.
- Six singular/plural ternaries. **[Fixed]** `plural()` in `format.ts`, tested.
- `words` beside `letter`. **[Fixed]** `resultWord` in `recap.ts`, tested.
- The "Recap" h1 written four times. **[Fixed]** One `Title`.
- `Seed` defined twice. **[Fixed]** `stack.ts` imports the type.
- Skipped (fine as is, or cost above benefit at this size): reusing `periods.ts` month math in
  `monthBounds` (it's tested across a leap February); one URL/params builder for the query hooks
  (worth doing when WP7 adds period queries); a shared ▲▼ trend helper; one option renderer in
  `PlaylistFilter`; a pre-made "Other" group in `filterOptions`; one focus hook for the popover
  and month; inlining `strip`; a context or one prop for `Month`'s props; splitting the
  narrow-filter state out of `RecapIndex`; a typed read in `staleAfter` (the cache is `unknown`);
  the e2e spec importing the label text; resolving `latest` inside `/api/sessions/:key` and a
  month-aware stale predicate (a few ms of local work each).
- `staleAfter` holds server rules on the client; `latest` sits beside `current`:
  **[Verified, no fix needed]** The plan's design, reviewed at plan time. Event-named keys would
  move the same knowledge into the server's events without removing it.
- Keep `mvp_count`, scoped to non-leaver matches: **[Disputed]** The user chose "keep
  inferring, unflag", and the third case (Honor Duel 1v1) had no leaver, so the narrower scope
  would still flag a normal match.

After fixes: `bun run check` 66 files, 754 tests; `bun run e2e` 9 passed.

### Round 2 (2026-10-26), delta `git diff 9cb6b37`
The fixes touched files outside the round-1 diff (`responses.ts`, `playlist-filter.ts`), so the
full table ran on the delta: `/code-review high`, arch-reviewer (sonnet), security-reviewer.

Security: no findings.

arch-reviewer: the deferral had no BACKLOG entry yet **[Fixed]** (Watch list); §3 and §4 still
read as the old design **[Fixed]** (superseded notes); the log named reviewer items by number
**[Fixed]**; a double blank line in `Overview.tsx` **[Fixed]**; the `queries.ts` header described
invalidation **[Fixed]**. q: under everything with only private matches, the page reads "No
matches under this filter yet" with the dropdown **[Verified, no fix needed]**: true of the
default filter too, and the dropdown offers Private.

`/code-review high` (delta):
1. A session whose first match starts before the 4am cutoff belongs to yesterday, but the day rule
   used today. **[Fixed]** `staleAfter(sessionKey, sameDayFrom)`: after a match, details from
   yesterday on are stale (`sessionDayFrom` in `useLiveEvents`).
2. With no month to focus the open session (filtered out, or the months query failed), focus
   stayed on the button. **[Fixed]** The popover focuses its first entry then.
3. Null playlist ids drop out of `playlistsPresent`. **[Deferred → BACKLOG]** Watch list: none
   among the 65 real matches (playlists 2, 11, 53; checked read-only).
4. The narrow-filter state lost its link to the latest session. **[Fixed]** Restored; e2e clicks it.
5. Closing on ‹ › only: Back left the popover open. **[Fixed]** The open state is held per session
   key (`openFor`), so any navigation closes it; Step's `onStep` is gone. e2e covers Back.
6. The e2e locator restated the plural rule. **[Fixed]** It imports `plural`.
7. "Other" hard-coded the complement of `GROUPS`. **[Fixed]** It's derived (`covered`).
8. A break needlessly refreshed today's older details. **[Fixed]** A break passes null (see 1).

After fixes: `bun run check` 66 files, 755 tests; `bun run e2e` 9 passed.

### Round 3 (2026-10-26), delta `git diff` (working tree against round 2's staged state)
Passes: `/code-review high` (its round-2 findings were fixed), security-reviewer. Arch's round-2
fixes were wording only, so it doesn't re-run.

Security: no findings.

`/code-review high`:
1. `openFor` reopened the popover on coming back to the session it was opened on; 3. closing
   waited for the next session's data (`keepPreviousData`). **[Fixed]** This is the third finding
   on closing the popover (round 1 #4, round 2 #5), each a gap in the previous fix, so it gets one
   mechanism: the list closes whenever the location changes (React's adjust-state-on-change
   pattern on `useLocation().key`). That covers ‹ ›, rows, Back/Forward and the filter at once.
   e2e: step, Back, and Forward without reopening.
2. Under everything, "See the latest session" led back to the same page. **[Fixed]** Shown only
   under a narrower filter.
4, 5. The focus hand-off between popover and month could leave focus nowhere, or jump after the
   user had moved. **[Fixed]** Simpler: the popover focuses the current row, else the first entry,
   when the recent list arrives; the current row focuses itself when it mounts (an older month's
   list from localhost arrives within milliseconds).
6. A match in a session dated before yesterday under a narrow filter. **[Verified, no fix
   needed]** A session ends after a `SESSION_GAP_MS` gap with no match, so a current session dated
   before yesterday needs 24+ hours of near-continuous play.
7. The e2e locator built its expectation with `plural`, so it couldn't catch a plural bug.
   **[Fixed]** Literal names again (reverses round 2 #6, which had it the wrong way round).
8. `TODAY` in the invalidation tests named the wrong thing. **[Fixed]** `FROM`.
9. The `invalidation.ts` header still described the old rule. **[Fixed]**

After fixes: `bun run check` 66 files, 755 tests; `bun run e2e` 9 passed.

### Round 4 (2026-10-26), the round-3 fixes
Round 3's fixes were staged before a snapshot was taken, so this round was scoped by file
(`SessionPicker.tsx`, `RecapPage.tsx`, `invalidation.ts` and its test, `recap.spec.ts`). Snapshot
for round 5: `eb73cba`. Passes: `/code-review high`, security-reviewer.

Security: no findings.

`/code-review high`:
1. The empty-state link could still lead to an empty everything (private/offline-only history).
   **[Fixed]** Shown only when `everythingHas(playlistsPresent)` (shared `inFilter`, unit-tested).
   This is the third finding on this link; the condition now comes from the data, not the filter.
2. Plain-string `getByRole` names match as substrings. **[Fixed]** `exact: true`.
3. Focus can be pulled back when a list arrives after the user has moved. **[Escalated → user
   chose the simplest]** Second time (round 3 #5). The user: "We do not need to have a very
   complicated auto session picker." Focus goes to the open session's row only when the recent
   list holds it, else the first entry, once; an older session's month still starts open, but
   nothing moves focus later.
4. Picking a row dropped focus to `<body>`. **[Fixed]** Focus returns to the picker button.
5. No test for the hidden link. **[Fixed]** by 1's unit test (`everythingHas`).
6. `openedAt` misnamed. **[Fixed]** `seenAt`, with why derived state won't do.
7. Escape anywhere closed the list. **[Fixed]** Only when focus is inside the picker.

After fixes: `bun run check` 66 files, 756 tests; `bun run e2e` 9 passed.

### Round 5 (2026-10-26), delta `git diff eb73cba`
Passes: `/code-review high`, security-reviewer. Security: no findings.

`/code-review high` found 10 more, nearly all in the two places every round had circled: the
picker's keyboard and loading behaviour (Escape when focus drifts, Ctrl-click, which row gets
focus while an older month loads, untested focus) and the empty-state link (null ids, a redundant
gate). **[Escalated → user]** Per the stop rule. The user redesigned the picker: "Lets change the
design and make the picker simpler and deterministic. 4 buttons <<, < and >, >>. List dropdown
always shows sessions of current month." Then: "you can work on it directly."

The redesign, which supersedes the round-5 findings on the picker and the link:
- Server: `SessionDetail` gains `prevMonth` (the previous month's newest session) and `nextMonth`
  (the next month's first), skipping empty months, under the filter. Nearest in time either way,
  and both stay put as sessions are added (a next month's newest wouldn't). Test in
  `pages.test.ts`.
- `SessionPicker`: « ‹ › » as Lucide chevrons, each a link or a disabled button, labelled
  "Previous month", "Previous session", "Next session", "Next month". The list is the open
  session's month (`monthRange`, tested), focused once on its row when it arrives. Any Escape
  closes it to the button, as does picking a row; any navigation closes it.
- Gone: the 2-week list, month folds, `monthBounds`, `useMonthFolds`, the `enabled` flag on
  `useSessionList`, the empty-state link and `everythingHas`. `/api/sessions/months` stays on the
  server (Trends may use it).
- `staleAfter`: after a match, an older detail with no `nextMonth` yet is stale too (the match
  may have started the next month's first session). Red-first test.
- e2e: the seed is anchored to months (last month, the month before), so month membership doesn't
  depend on the run's date. New test for « »; the picker test covers the month list, focus,
  Escape, picking a row, a step, Back and Forward.
- The features map and roadmap record the revisited picker decision.

After: `bun run check` 66 files; `bun run e2e` 10 passed.

### Round 6 (2026-10-26), delta `git diff eb73cba` for the redesign
Snapshot `ce11fbc`. Passes: security-reviewer (clean), arch-reviewer (sonnet), `/code-review high`
(still running when the session hit its usage limit; read its result first). e2e after the
invalidation change: 10 passed. Open arch findings, none fixed yet:
- risk: `staleAfter` marks every cached detail with `nextMonth === null` stale after any match,
  i.e. all of the current month. Narrow to `monthOf(sameDayFrom) > monthOf(day)`, with a
  same-month test case.
- risk: §5's old bullets (2-week list, folds, `monthBounds`) still sit under the superseded note,
  and ~line 348 mentions `monthBounds`. Rewrite §5 to the new design.
- nit: roadmap line ~350 "sessions (range + month folds)" → "months".
- nit: invalidation.ts header comment hard to parse; make it a short list.
- nit: `day.slice(0, 7)` in SessionPicker and server `monthOf`; share one `monthOf` in
  `src/shared/periods.ts`.
- q: a month with nothing under the filter leaves focus on the button; untested. Likely accept.

Dispositions:
- invalidation over-refresh: **[Fixed]** after `/code-review high` raised it again (below). The
  arch reviewer's `monthOf(sameDayFrom) > monthOf(day)` misses a month boundary, so it wasn't taken.
- §5 stale: **[Fixed]** rewritten. The `monthBounds` mention in round 1's log is history, kept.
- roadmap "month folds": **[Fixed]**.
- invalidation header: **[Fixed]** as a list.
- shared month key: **[Fixed]** `monthOf` in `src/shared/periods.ts`, used by `pages.ts` (both
  places) and the picker.
- empty month focus: **[Verified, no fix needed]** focus stays on the button, which is right when
  the list has nothing to pick; the button reads expanded and the note follows it.

`/code-review high` (after the arch fixes), 8 findings:
- e2e « » and picker tests click a step as soon as the URL changes, while the last session's detail
  (kept as placeholder) still names the old targets: flaky. **[Fixed]** `at(page, key)` waits for
  the URL and for `aria-busy` to clear.
- The same race for users: a quick second « goes to the session already loading. **[Fixed]** While
  the detail is a placeholder, the steps are `aria-disabled` links whose click does nothing (they
  stay links, so focus holds across repeated steps), and the list doesn't open.
- The seed's months came from `dayOf(now)`; on the 1st between 04:00 and 04:10 the current session
  falls in the month before. **[Fixed]** from `dayOf(now - 10 min)`, the current session's start.
- `pages.ts` comment claimed `nextMonth` never moves. **[Fixed]** it starts null.
- Over-refresh of the current month's details (second time). **[Fixed]** `staleAfter(key, today)`
  now takes today (null for a break) and derives yesterday itself; earlier-month details with no
  next month are stale, the current month's aren't. Tests: same month spared, Oct 31 → Nov 1 stale.
- Month rollover written three times. **[Fixed]** `nextMonthStart` in `periods.ts`, used by
  `periodRange` and `monthRange` (tested). The e2e seed's months-back helper stays: it's a test
  fixture going the other way.
- `monthOf(day)` recomputed per comparison. **[Fixed]** hoisted.

After: `bun run check` 66 files, 757 tests; `bun run e2e` 10 passed.

### Round 7 (2026-10-26), delta from the round-6 snapshot
Snapshot `715e58a`, delta `git diff ce11fbc`. Passes: security-reviewer (clean), arch-reviewer
(sonnet), `/code-review high`.

Arch (all doc/comment nits): §5 said both month targets stay put, and lacked the busy behaviour;
the `Step` comment was hard to parse; a busy step still showed hover; test `FROM` →
`YESTERDAY`. **[Fixed]** all.

`/code-review high`, 8:
- `at()` could pass against the old page: the URL changes before the new render commits, and the
  old page's `aria-busy=false` already matches. **[Fixed]** the page's wrapper carries
  `data-session={key}`; `at()` waits for that key with `aria-busy=false`.
- The picker button opened while busy, with nothing to show, then stole focus on arrival.
  **[Fixed]** it's `aria-disabled` and ignores clicks while busy, like the steps.
- A detail whose `day` isn't a string was spared, against stale-by-default. **[Fixed]** stale;
  tested.
- Send the session's day in `match_ended` instead of deriving today and yesterday. **[Disputed]**
  The derived rule is never wrong, only over-refreshes (a session begun before 04:00 on the 1st
  refetches last month's details), and the event schema change reaches the server and SSE for that
  one case. Worth taking if the event payload is reworked anyway.
- The month-boundary test never reached the month clause (Oct 31 is yesterday). **[Fixed]** Oct 15.
- `shiftDay`/`monthOf(today)` recomputed per query. **[Fixed]** hoisted out of the predicate.
- A busy step looks clickable. **[Fixed in part]** hover is suppressed and the cursor shows
  progress. Not dimmed: on a local API the busy window is tens of ms, and dimming would flash on
  every step.
- Ctrl/Cmd/Shift-click on a busy step was swallowed. **[Fixed]** modified clicks go through.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 8 (2026-10-26), delta from the round-7 snapshot
Snapshot `18e4c71`, delta `git diff 715e58a`. Passes: security-reviewer (clean), `/code-review high`, 8:
- The playlist filter navigated from the placeholder's key while busy, back to the session just
  left. **[Fixed]** it navigates from the URL's `session`, which is the root of it: the bar's own
  navigation reads the URL, and only the steps, which need the new data, wait for it.
- Altitude, per-control busy guards. **[Fixed]** by the above for the filter; the steps and the
  picker keep theirs, since their targets come only from the new detail.
- Alt-click swallowed while busy. **[Fixed]** passed through like React Router does.
- Busy picker still showed hover. **[Fixed]**.
- The unknown-shape test missed the break case. **[Fixed]** both cases.
- Two hoisted nullables for one condition. **[Fixed]** one `after` object.
- e2e `at()` doesn't escape the key or allow a query string. **[Verified, no fix needed]** a test
  helper over fixed seed keys, used only on unfiltered URLs.
- The list's staying closed while busy relies on every busy spell starting with a navigation.
  **[Verified, no fix needed]** true by construction (key and filter both come from the URL);
  the `Step` comment now says so.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 9 (2026-10-26), delta from the round-8 snapshot
Snapshot `50532a1`, delta `git diff 18e4c71`. Passes: security-reviewer (clean), `/code-review high`,
6: no regression test for the filter fix; the filter's options came from the placeholder; the
alt-click comment; a hand copy of React Router's modified-click check; the unknown-shape test only
covers a missing `day`; the busy invariant was untested.

**[Escalated → user]** by the stop rule: rounds 6–9 each found another bar control acting on the
last session's data while the next one loaded, the same cause each time. The user: "if its loading
just wait for it. Show some loading animation or blank UI flashing loading stuff... No need to make
things complicated in UI."

The fix, which makes the busy findings moot:
- `useSessionDetail` drops `keepPreviousData`. While a session loads, the page shows its h1 and a
  pulsing block, held back 150ms (CSS) so a quick load doesn't flash. Reduced motion shows it still.
- Gone: the `busy` prop, the `aria-disabled` steps and picker, the modified-click check, their CSS.
- The loading state replaces the control with focus, so each navigating control names itself in
  the location state (`{ focus }`) and carries `data-focus`; the page focuses it once loaded, or
  the picker button when it's no longer there (a disabled end step). The filter does this too.
- e2e: `at()` waits for `data-session={key}`; new checks that focus returns to « and to the filter.
- Unknown-shape test with a string `day`: **[Verified, no fix needed]** a detail whose day, next
  and nextMonth all read normally is spared by design; the default covers fields it can't read.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 10 (2026-10-26), delta from the round-9 snapshot
Snapshot `c7c2da3`, delta `git diff 50532a1`. Passes: security-reviewer (clean; suggested
`CSS.escape`), `/code-review high`, 8:
- Focus handoff re-fired on Back, Forward and reload, as history keeps the state. **[Fixed]** the
  request is cleared (`replace`, `state: null`) once used.
- The page blanks and collapses on a quick uncached load. **[Disputed, in part]** waiting with a
  blank page is the user's call this round. The collapse is fixed: the loading area keeps
  `min-height: 70vh`, so the scroll position survives.
- On `/recap` with nothing under the filter, a filter change lost focus. **[Fixed]** that filter
  asks for focus too, and the redirect to the session passes the request on.
- Unescaped history-state string in a selector. **[Fixed]** `CSS.escape`.
- The delay lived in an animation, which reduced motion removes. **[Fixed]** a 150ms timer.
- The live region was mounted already holding its text, so it was often not announced. **[Fixed]**
  the region mounts empty; the text is added when the delay ends.
- The fallback to the picker was untested. **[Fixed]** e2e: after « to e2e-old (its « disabled),
  the picker has focus. A row pick was already covered.
- `seenAt` comment named a stale-data window that no longer exists. **[Fixed]**.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 11 (2026-10-26), delta from the round-10 snapshot
Snapshot `bc52b10`, delta `git diff c7c2da3`. Passes: security-reviewer (clean), `/code-review
high`, 7, all on the focus hand-off: no restore on `/recap` after an empty result; the request
lingered in history when left mid-load; `/recap` loading had no loading state; no tests for the
clearing or the redirect; the clearing replace made a phantom navigation and dropped the hash; the
error link asked for no focus; a stale comment.

**[Escalated → user]** by the stop rule: rounds 10 and 11 both found holes in the hand-off. The
user chose one rule: after any recap navigation loads, focus the picker.
- Gone: the location `{ focus }` state, `data-focus`, `CSS.escape`, the clearing replace, the
  `<Navigate state>`. Moot with them: every hand-off finding above.
- `RecapSession` remembers the first session and filter it showed; when another loads, focus goes
  to the h1's button. A refetch of the same session (a live match) doesn't move it.
- `/recap` shows `<Loading />` while it looks up the latest session. **[Fixed]**
- The `seenAt` comment lists the filter as a closing cause. **[Fixed]**
- e2e: after «, a step to a disabled end, a row pick and a filter change, the picker has focus.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 12 (2026-10-26), delta from the round-11 snapshot
Snapshot `9f8be40`, delta `git diff bc52b10`. Passes: security-reviewer (clean), `/code-review
high`, 10:
- On Windows, arrowing through a closed select fires a change per key; with focus moved to the
  picker, the second arrow lands there. **[Fixed]** a filter-only change focuses the filter again.
- Steps lose their own focus; Back/Forward focus the picker. **[Disputed]** the user's chosen rule
  (round 11), which accepted Shift+Tab per step.
- `/recap` → session (fresh mount) never moved focus; StrictMode's second effect run stole focus
  on the first session; `firstShown` held a string only compared with null. **[Fixed]** one
  module-level `lastShown` (session and filter) compared with what loaded: the first sets it, the
  same again does nothing, a change moves focus.
- Focus found by `h1 button`. **[Fixed]** refs: `buttonRef` into `SessionPicker`, `selectRef`
  into `PlaylistFilter`.
- A failed background refetch replaced a loaded session with the error notice (pre-existing, in a
  touched function). **[Fixed]** the error shows only when no data loaded.
- `/recap` then the session each show a loading state, so a slow load can pulse and announce twice.
  **[Verified, no fix needed]** both lookups are real waits; the second is short.
- The focus assertion after the step to a disabled end was dropped. **[Fixed]** restored; and the
  filter test now expects focus on the filter.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 13 (2026-10-26), delta from the round-12 snapshot
Snapshot `e045673`, delta `git diff 9f8be40`. Passes: security-reviewer (clean), `/code-review
high`, 7:
- Back to the same session during a load or after an error left focus on body; arriving from
  another page behaved differently on a first and a later visit. **[Fixed]** both came from keying
  the rule on which data loaded. It now keys on the router's location: each new location, once a
  session is on screen, moves focus (same path: the filter; else the picker). One ref on the
  component, reset when the page is left; the module-level record is gone.
- A filter change on `/recap`'s empty state that lands on a session leaves focus be. **[Verified,
  no fix needed]** that's arriving on the session page, which the rule leaves alone.
- A 404 on a background refetch no longer showed "isn't here any more" (a regression from round
  12). **[Fixed]** a 404 shows the notice even with data; other refetch errors keep the session.
- Focus depends on the server echoing the URL's key. **[Verified, no fix needed]** moot: the rule
  no longer reads the key.
- Escape copied `closeToButton`. **[Fixed]** `useCallback`, used in the effect.
- No test for Back. **[Fixed]** e2e: after Back, the picker has focus.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 14 (2026-10-26), delta from the round-13 snapshot
Snapshot `6a3291c`, delta `git diff e045673`. Passes: security-reviewer (clean), `/code-review
high`, 7:
- Picking the open session's own row (a same-URL navigation) focused the filter; Back to a session
  after one that never loaded did too. **[Fixed]** a filter change is now the same session with
  another query string; anything else focuses the picker. e2e: Enter on the current row keeps
  focus on the picker.
- Compare the `session` param rather than the pathname. **[Fixed]** with the above.
- Arriving through `/recap` (its empty state's filter, or the error notice's link) leaves focus on
  body. **[Verified, no fix needed]** that is arriving on the page, which the rule leaves alone.
- A 404 on a background refetch swaps to the notice with no focus move or announcement; untested.
  **[Verified, no fix needed]** session keys are stable (a session's first match), so a 404 for a
  loaded session needs its matches deleted under it; the notice's h1 says what happened.
- The picker's `seenAt` and the page's `seen` both react to a new location. **[Verified, no fix
  needed]** they do different jobs at different times (close at once; focus once loaded).

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 15 (2026-10-26), delta from the round-14 snapshot
Snapshot `86ddaef`, delta `git diff 6a3291c`. Passes: security-reviewer (clean), `/code-review
high`, 6:
- The raw query string stood in for the filter, so a non-canonical URL (`?filter=everything`, a
  bad value) made picking the current row a "filter change". **[Fixed]** the parsed filter is
  compared.
- Back/Forward across a filter change focused the select. **[Fixed]** a history move (`POP`) is
  never a filter change. e2e: Back after a filter change focuses the picker.
- Back to the last-shown entry while a load was in flight left focus on body (same key, so
  skipped). **[Fixed]** a load clears the remembered key, so returning counts as a navigation.
- The current-row e2e can pass on `closeToButton`'s own focus before the page's effect runs.
  **[Verified, no fix needed]** the assertion is still right either way; the canonical-URL case
  above is what could have moved focus, and it no longer can.
- Two sources for the filter. **[Fixed]** with the first.
- Branches untested. **[Fixed]** Back across a filter change; the rest are covered by the
  parsed-filter comparison.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

### Round 16 (2026-10-26), delta from the round-15 snapshot
Snapshot `cd5d15c`, delta `git diff 86ddaef`. Passes: security-reviewer (clean), `/code-review
high`, 5:
- A load that finishes long after the navigation (tracker down, then an SSE reconnect) pulled focus
  from wherever the user had moved it. **[Fixed, escalated]** focus moves only when it fell to the
  page (`document.activeElement === document.body`). This narrows the user's round-11 rule: a step
  to a cached session now keeps focus on the step. The location-key bookkeeping is gone.
- The "cleared key" path untested; `key === ""` meant two things. **[Fixed]** both gone with the above.
- The filtered page's Overview was no longer asserted. **[Fixed]** asserted before Back.
- The focus decision wasn't logged. **[Fixed]** `[rlt] recap/focus` (target, navigation, session,
  filter) at debug level.

After: `bun run check` 66 files, 758 tests; `bun run e2e` 10 passed.

**Stop rule:** focus had come back every round since round 11, so it went to the user before round
17. The user kept the round-16 rule ("rec sounds good"): reset to the picker only when a load took
focus, else leave it. **Review closed**; focus is checked by hand in the real browser (step 9).

### Round 17 (2026-10-26), from the step-9 real-browser check
A live finding opens a new round (stop rules). Passes: `/code-review low` on the CSS block (clean);
the test is e2e only, and no executable app code changed, so no security pass.
- At 320px a scorebug with a two-digit count (the real 22–19 session) overran the screen by 48px;
  single digits fit exactly. **[Fixed]** below 420px each side stacks its label over its number.
  Regression test: "at 320px a two-digit scorebug fits" on the seeded 17–9 session (red first:
  6px of overflow).

After: `bun run check` 66 files, 758 tests; `bun run e2e` 11 passed. **Review closed.**

## Implementation notes (step 9, 2026-10-26)
- `bun run deploy` passed check, e2e, install and recompute (65 written, 0 failed).
  `tracker.db`: 0 matches with `mvp_count`, every match at `mvp: 2`. Two matches keep
  `goal_events_equal_score` (see the BACKLOG bug below). Redeployed after round 17.
- Real browser (Chrome, installed dashboard, real data 19–24 Oct):
  - Keyboard: Tab order is header, ‹, picker, filter. Enter on ‹ steps and lands focus on the
    picker. The picker opens on the current row; Tab, Enter on another row goes there and focus
    returns to the closed picker. ArrowDown on the filter changes the URL and keeps focus on the
    filter, and Back keeps it there too. No console errors; the one `api/failed` is the expected
    404.
  - Widths (same-origin iframes, as the maximized window ignored resizing): 768, 1024 and 1440 have
    no sideways scroll; 320 did on a two-digit session (round 17, fixed).
  - States: a filter with nothing in the session shows its note under the picker and filter;
    `/recap?filter=private` shows "No matches under this filter yet."; an unknown key shows the
    404 notice with its link.
  - The Honor Duel card (19 Oct, 11:04 PM) shows its name and the MVP icon with no amber dot.
- **Found, not this package's bug:** two stored matches end days after they started
  (`closed_via` superseded and timeout), so 21–24 Oct shows as one 67-hour session of 41 matches.
  Their `ended_at` is a records bug in the recorder, not the recap. **[Deferred → BACKLOG]** (High).
- Raised with the user (round 1, item 6, disputed): under a filter the scorebug's length stays the
  whole session's (seen live: 19 Oct under All ranked reads 1 h 34 min over 7 of 13 matches).
  The user kept it: "fine to show whole session time for now".

