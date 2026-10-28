# WP6c: Share card

Repo copy (step 1): `docs/plans/2026-10-27-wp6c-share-card.md`. Tier: Substantial.

## Context
The roadmap's WP6c (`docs/plans/2026-10-16-v1-roadmap.md` § WP6c) adds a PNG image of one session, made to send to friends and read on a phone in a chat. The design is variant **F4** in `prototypes/share-card/share-card-prototype.html` on branch `prototype/share-card` (commit 97d610d). F4 is a 360×480 CSS-px card (3:4) exported at 3× = **1080×1440**, and its Stress scenarios are the layout cases. Tier: **Substantial**: a new module, a new dependency, and open items with more than one approach. Estimated at ~600 lines with tests, which fits one session. The midpoint is a `/compact` point (step 5).

## Decisions (the user's, 2026-10-27)
- **Null stat** → render "–" in the tile so the grid holds, warn once, and add a BACKLOG Watch item. Why: `aggregate()` (`src/shared/aggregate.ts:130-171`) returns non-null `bestWinStreak`, `totals.*` and `mvps` whenever ≥1 match was played, and the card is offered only when `summary` is non-null, which implies that (`pages.ts:99-111`). So the gap is an unseen shape (global §2), not a case to design for.
- **Rendering** → `html-to-image` **1.11.11**, pinned exact. It is proven for Copy and Download in Chrome by the prototype. The card stays React + CSS on the theme tokens. The app has no CSP and no `@font-face`, so neither of the library's usual problems applies.
- **Filename** → `rl-session-YYYY-MM-DD-HHMM-<filter>.png`, from `detail.startedAt` in local time.
  - Filter slug: `everything` → `all`; group values as-is (`ranked`, `casual`, `extra`, `private`).
  - A single playlist → its `playlistInfo` name lowercased, with runs of non-alphanumerics → `-` and leading/trailing `-` trimmed. E.g. `rl-session-2026-10-27-2010-ranked-doubles.png`, and `Unknown playlist (99)` → `unknown-playlist-99`.
- **Time line** → reuse the recap helpers in `src/web/logic/format.ts`: `dayLabel`, `clock` (locale; WP8's 12h/24h setting lands there) and `durationText` ("2 h 35 min"). The line may wrap; the form line gives up the height.
- **Eight tiles, 4×2** (changed from the prototype's six in a 3×2 grid, after friends' feedback), in this order: best win streak, goals, assists, saves / shots (+ sub), MVPs, demos, **the 8th slot**.
  - The 8th slot takes the first stat in this chain that is there: **Aerial goals** (`aggregate.statfeed.AerialGoal`) → **Crossbar hits** (`aggregate.woodworkHits`) → **Aerial touches** (`aggregate.aerialTouches`) → **Epic saves** (`statfeed.EpicSave`) → none, which leaves 7 tiles (4 + 3).
  - "There" means non-null **and > 0**. Statfeed counts are absent rather than 0 when nothing happened, and extras are null when not computed. Reading 0 as "not there" keeps a flat "0" off the card and lets the chain reach something that happened. ⚠ This reading is my interpretation; confirm at plan approval.
  - Demos is `totals.demos`, non-null with ≥1 match like the other fixed six, so the "–" rule above covers the seven fixed tiles.
  - The 4-column tiles are ~74px wide, so a long label ("Aerial touches", "Crossbar hits") may wrap to 2 lines. The form line absorbs the extra height; the Stress check covers it.
- **Default filter label** → **"All but private"**, not the spec's "All playlists". That filter excludes private matches (`filter-options.ts:36`), so "All playlists" would mislabel a private-heavy night. This revises the roadmap's wording (§4: new information, raised at plan review); the roadmap text is updated in step 8.
  - **Revised by the user after step 8 (2026-10-27):** the default filter gets **no pill** at all. Only a chosen filter (a group such as "All ranked", or a playlist) is labelled. "All but private" is app jargon to a friend. `shareCard`'s `label` is null on `everything`; the filename slug stays `all`. The stress spec now opens under `?filter=13`, since the worst case is a pill beside the name (without one, the 32-character name fit uncut). Re-run: Vitest 898/898, typecheck and lint clean, e2e 28/28.

## Resolved from the code (no fork)
- **Record, results, win %**: the record is `summary.wins/losses` and the form-line results come from `summary`'s per-match results. Both are typed non-null (`responses.ts:106-110`), as the Scorebug uses them (`Overview.tsx:65-72`). Win % is `aggregate.winPct`, hidden when null (e.g. a single left-early match), which is a real case.
- **In-game name**: session detail carries no player name. Reuse `useMatchDetail(lastGuid)` (`src/web/queries.ts:48`) for the latest filtered match, and take `players.find(p => p.isMe)?.name`. This needs no server change. A missing name or failed fetch leaves the line out and warns `share/no_name` once.
- **Mood line**: `useRemarks(key, filter)` (`queries.ts:59`). It is already cached from the Overview, and ↻ writes the same key (`queries.ts:74`), so the card follows. The card shows `mood.text` only (no quip). On error the line is left out.
- **Ready**: both secondary queries have settled (success or error). Until then the card shows its loading state and Copy/Download are disabled.
- **Live**: `detail.current` (`pages.ts:108`) → "<duration> so far · ● live". Duration is `endedAt − startedAt`, as on the Scorebug.
- **Stood out**: the first item of `stoodOut(detail.aggregate, detail.baseline)` (`recap.ts:85`) → "**Saves:** 2.17 per game, 48% above your 30-day average".
  - Built from `decimal(perGame)`, `Math.abs(vs.pct)`, and "above"/"below" from the sign; "same" can't occur past the 10% threshold.
  - The fallback when it's null or `[]` is `aggregate.hardestShotKmh` → "**Hardest shot:** 134.2 km/h". With neither, there is no callout.
- **Shots tile sub**: `pct(aggregate.shootingPct)` + "% scored" when shootingPct is non-null. This reuses `pct` from `recap.ts`.
- **Filter label**: extract `filterLabel(filter)` in `src/web/logic/filter-options.ts`, and make `filterOptions`' fallback at line 49 call it (no duplicate logic). `everything` → "All but private" (superseded in review: the dropdown's "Everything (excl. private)"; the card shows no pill for it), groups → the `SECTIONS[].all.label`, single → `playlistInfo(id).name`.
- **Where the button sits**: in the recap's `.bar` (`RecapPage.tsx:143`), after `PlaylistFilter`, only when `d.summary` is non-null. That puts it on every recap view and on past sessions.
- **Dialog**: the native `<dialog>` + `showModal()`, which gives Esc, the focus trap and focus return; there is no modal component yet.
- **Theme**: the card inherits `:root[data-theme]` tokens (`styles/tokens.css`). `.card` sets `color: var(--ink)` explicitly, since the dialog's UA style sets `CanvasText`. The background is the F4 glow over `var(--page)`. SVG dots are coloured by CSS classes, not `fill="var(...)"` attributes.

## Approach and files
**Pure logic (Vitest, TDD).** New `src/web/logic/share-card.ts`:
- `shareCard({ detail, summary, filter, name, mood })` → view model `{ name, when, live, label, wins, losses, winPct, smallRecord, results, mood, tiles, stood, nullStats }`.
  - `tiles` = 7 fixed entries (streak "W<n>", goals, assists, saves, shots + sub, MVPs, demos), plus the 8th from `eighthTile(aggregate)` (the chain above), or none. A fixed tile's null → "–", with its id listed in `nullStats`.
  - `smallRecord` = digits(wins) + digits(losses) > 4.
  - No logging inside it; it runs on every render.
- `formLine(results, w, h)` → `{ points, dots: {x, y, r, kind: "win"|"loss"|"none"}[], zeroY }`, ported from the prototype's `formLine` (lines 162-175).
  - Levels: running wins − losses; a null result keeps the level and gets a hollow dot.
  - Range: at least −1..1; pad 7.
  - Dot radius `clamp(1.6, 3.6, step × 0.35)`.
  - `LINE_MIN = 48`.
- `shareFilename(detail, filter)`.

**Component.** New `src/web/pages/recap/ShareCard.tsx` + `ShareCard.module.css`:
- `ShareButton({ detail, summary, filter })`: a "Share" button with `aria-haspopup="dialog"`. The dialog's contents, and so their queries, mount only while it's open.
- `Card`: F4 markup and CSS ported from the prototype: the `.meta`/`.pill` ellipsis, `.hero` with the 50px `small` record, the SVG line slot, `.mood`, a 4-column `.grid` (`repeat(4, 1fr)`), `.callout`, and the "RL Tracker" footer. Fixed 360×480, padding 22px.
  - Line height: `useLayoutEffect` measures the slack between the footer and the card's inner bottom, then sets `max(LINE_MIN, LINE_MIN + slack)`.
  - It re-measures on any height-changing input: name, mood, label, stood line, match count, live. A live session can invalidate while the dialog is open (`useLiveEvents.ts:29`).
- `useEffect` keyed on `key|filter` warns once for `nullStats` / `no_name`. This is the dedupe pattern of `GoalMap.tsx:30`, and survives StrictMode double-invoke.
- **Copy image** / **Download PNG**, plus a status text with `aria-live="polite"`.
  - `const blob = () => toBlob(cardEl, { pixelRatio: 3 }).then(b => b ?? Promise.reject(new Error("empty blob")))`, so the export is 3× regardless of DPR. `toBlob` returns `Blob | null`.
  - Copy: `navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })])`. The promise is passed in so Chrome keeps the user gesture.
  - Download: an object URL and `<a download>`, with the URL revoked in a `setTimeout` after the click.
  - Status: "Copied" / "Saved", or "Couldn't copy, try Download" / "Couldn't make the image".

**Wire-up.** `RecapPage.tsx` `.bar` → `<ShareButton …/>` when `d.summary`.

**Dependency.** `bun add html-to-image@1.11.11 --exact`.

**Logging** follows the web convention of `"[rlt] area/event"` with a detail object. Failures go to `console.warn` (`RecapPage.tsx:24`), never `console.error`, which the e2e afterEach treats as a failure (`recap.spec.ts:25`).
- `console.debug share/open` {key, filter, matches} answers whether it was opened and for what.
- `console.info share/export` {kind, ms, bytes} answers whether it worked, how slow it was and how big the image was.
- `console.warn share/export_failed` {kind, step: "render"|"clipboard", error: name+message, ms} answers which step failed and why.
- `console.warn share/null_stat` {key, filter, stats} and `share/no_name` {key, guid} flag unseen shapes.

**e2e seed.** `test/e2e/fixtures.ts` `Seed` gains `"share"`. In `test/e2e/stack.ts`, the argv parse at `:131` (today only `"empty"`, else rich) learns `"share"`, and `seed()` (`:79`) gets a `"share"` branch: a 48-match session with mixed results where ME's name is 32 chars, via `player(ME, 0, { name })` + `player(THEM, 1)`. The rich seed's current session (1 match) covers the one-match Stress case.

## Steps
1. Copy this plan to `docs/plans/2026-10-27-wp6c-share-card.md`.
2. Invoke `tdd-live-code-carveout` and `ui-implementation-guidelines`. Install `html-to-image@1.11.11` (exact).
3. TDD `filterLabel` (`filter-options.test.ts`, plus the existing fallback tests still passing) and `share-card.ts` (`share-card.test.ts`):
   - formLine levels with W,W,L,null → 1,2,1,1; the hollow dot for null; range min −1..1; dot radius at 1/10/48/200 matches against the clamp; zeroY.
   - Tiles: order, the shots sub only with shootingPct, "W0" on a winless night, "–" + `nullStats` on null.
   - The 8th-tile chain: each link wins when present, and is skipped when null, 0 or absent from the statfeed; all missing → 7 tiles.
   - The stood-out wording (above/below, abs pct), then the hardest-shot fallback, then none.
   - smallRecord at the 4/5-digit edge; the live suffix; name omitted when null.
   - Filename slugs: all, ranked, ranked-doubles, unknown-playlist-99 (trimmed).
4. `ShareCard.tsx` + CSS + RecapPage wire-up. Lint and typecheck.
5. Full Vitest green → offer `/compact` (midpoint).
6. Playwright, in two files, because `seed` is worker-scoped and `test.use` must be top-level:
   - `test/e2e/share.spec.ts` (rich):
     - Open the card on the current one-match session; run the overflow checks below; axe on the open dialog.
     - Download → the PNG IHDR reads 1080×1440 and the filename matches the slug rule.
     - Copy with `clipboard-read/write` granted → reading it back gives `image/png`, and `createImageBitmap` gives 1080×1440. First check that headless Chrome's clipboard doesn't overwrite the user's real Windows clipboard; if it does, assert via a stubbed `clipboard.write` that captures the item instead.
     - Copy failure: `page.addInitScript` makes `navigator.clipboard.write` reject → the status shows, and the `share/export_failed` console line is read.
     - `no_name`: `page.route` 500s `/api/matches/*` → the card renders without a name, and the warn fires.
     - The pill reflects a changed filter; Esc closes and focus returns to Share.
   - `test/e2e/share-stress.spec.ts` (top-level `test.use({ seed: "share" })`): the 48-match session, with the remarks response patched via `page.route` to the longest `MOOD_LINES` text (from `src/server/remarks/copy.ts`; never printed). Overflow checks:
     - card `scrollHeight ≤ clientHeight`;
     - the footer's bottom ≤ the card's inner bottom;
     - the name is truncated (`scrollWidth > clientWidth`) and inside the card;
     - the line slot is ≥ 48px;
     - the seed gives ME aerial touches but no aerial goals, so the 8th tile has a 2-line label ("Aerial touches") in the worst case.
7. Real-browser look in Chrome at each theme (set `data-theme` carbon/slate/oled) against prototype F4, then a usability pass per `ui-implementation-guidelines`.
8. Docs:
   - Roadmap WP6c: status; the label change "All playlists" → "All but private" (also its WP9 example line 606); the tiles line → eight in 4×2 with the 8th-slot chain.
   - BACKLOG Watch item "share card null tile" (trigger: a `share/null_stat` warn).
   - Commit body recording the five decisions.
9. Full suite green → `/compact` line → `independent-review-pass`. Commit only on request.

## Verification
- `bun run test`, `bun run typecheck`, lint, and `bun run e2e` (both share specs plus all existing specs) all green.
- Manually: against real data, open a past session's recap, Share, Copy, and paste into a chat app (or Paint). Download, then check the file name and 1080×1440 in Explorer. Switch the filter and see the pill and stats change. Press ↻ on the Overview, reopen the card, and see the new mood line.

## Plan review
Opus `plan-reviewer`, round 1. All findings were folded in:
1. must-fix: rich and share seeds can't share one spec file (worker-scoped `seed`), and `stack.ts:131` argv doesn't know the new mode → two spec files; argv + `seed()` branch named.
2. should-fix: there's no way to deny the clipboard in Playwright → an `addInitScript` stub as the seam; failures use `console.warn`, never `error` (e2e afterEach).
3. should-fix: the null_stat warn inside a render-time function would repeat → `nullStats` in the view model, warned once in a keyed effect.
4. should-fix: `toBlob` returns `Blob | null` → wrapped to reject on null (typechecks with `ClipboardItem`).
5. should-fix: the record came from nullable `aggregate.wins/losses` → `summary` (non-null).
6. should-fix: `filterLabel` duplicated `filter-options.ts:49` → extracted and reused. "All playlists" was inaccurate → the user chose "All but private".
7. should-fix: the filename example contradicted the slug rule, and the trailing `-` wasn't trimmed → fixed; `startedAt` named.
8. consider: stood-out wording (abs pct, `decimal` gives 2 places), and reuse `shootingPct` + `pct()` → adopted.
9. consider: the layout effect's dependencies and the "ready" definition → adopted.
10. consider: the dialog's `CanvasText` colour, SVG fills via classes, deferred `revokeObjectURL`, and the real-clipboard check in e2e → adopted.
After the review, at plan approval, the user moved the grid from six tiles to eight (4×2: + demos + the 8th-slot fallback chain). This is a contained change in one function and the CSS grid, with its own Vitest and Stress coverage, so there was no second review round; `independent-review-pass` covers it in the diff.

11. consider: `no_name` seam via `page.route` → adopted. Dot r ≥ 1.6 at 48 matches can't fail → dropped from e2e and kept in the Vitest clamp test (radius at 200 matches).

## Implementation notes (2026-10-27)
Where the build departs from the wording above, and why:
- **Hardest shot** prints through `decimal()`, which shows values from 100 up as whole numbers ("134 km/h", not "134.2"), as the Overview's own Hardest-shot tile does.
- **Mood line** is shown without F4's added curly quotes, as on the Overview: some lines open with a quote of their own (`"Calculated." All of it.`), which gave doubled quotes.
- **● live** follows "so far" without a "·" and never breaks inside; on a long time line it wraps whole to the next line.
- **Copy e2e** stubs `navigator.clipboard.write` and reads the captured PNG, instead of granting clipboard permissions: the stub never touches the machine's real clipboard, so the real-clipboard check was not needed.
- **no_name e2e** answers the match detail with a 404, not a 500: queries retry a 5xx (seconds of backoff), and the card's path is the same either way.
- **Stress name** is `WWW_MaximumWidthNameWWWWWWWWWWWW`: a first 32-character name of narrow letters fit the meta column untruncated, so the seed uses wide letters to force the ellipsis.
- **At 320px** the dialog scrolls sideways inside itself; the card keeps 360px because it is the image. The page itself gets no sideways scroll (e2e).
- **Real-browser look** (step 7): Playwright screenshots of the stress card in carbon, slate and oled against the F4 prototype; the two fixes above came from it.

## Verification log
- `bun run test`: 74 files, 898 tests passed.
- `bun run typecheck`, `bun run lint`: clean.
- `bun run e2e`: 28 passed (share.spec.ts 7, share-stress.spec.ts 1, and all existing specs).

## Review log

**Round 1** (snapshot `e9f9ad58`; Substantial by design tier, 415 non-test lines): `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify` (4 angles).
- security: no findings.
- code-review: live session switches the match guid and unmounts the card mid-export → [Fixed] guid picked once at opening (`useState`).
- code-review: backdrop close also fires on the dialog's padding and on a drag that ends outside → [Fixed] padding moved to the body; close needs the press to start on the backdrop too.
- code-review + arch: `useMatchDetail("")` fetches `/api/matches/` → [Fixed] `useMatchDetail(guid, enabled)`; `ready` doesn't wait on a disabled query; `share/no_name` still warns.
- code-review: a failed remarks fetch drops the mood silently → [Fixed] `share/no_mood` warn, fired once in a new e2e test.
- code-review: html-to-image loaded with every recap → [Fixed] dynamic import on first export.
- code-review: filename date is the calendar date, the card's is the session day (cutoff hour) → [Verified, no fix needed] the filename is a timestamp of the start: date and HHMM must name a real instant (a 01:30 start on Oct 28 read as "10-27-0130" would be wrong).
- code-review: Copy shown where no clipboard API exists (insecure origin) → [Verified, no fix needed] the server binds 127.0.0.1, a secure context; Chrome is the target; a failure still says "try Download".
- code-review: CSS comment points at the prototype's "F4" → [Fixed].
- arch: `filterLabel("everything")` unreachable and a second name for the filter → [Fixed] returns the dropdown's `EVERYTHING.label`.
- arch: a failed download after render logged `step: "clipboard"` → [Fixed] `save` step with its own status text.
- arch: roadmap content list still said the label always shows → [Fixed].
- simplify, applied: ResizeObserver line slot (flex row) replaces the stringify key and settle loop; `share/open` logged in `show()` (drops an eslint-disable); `nullStats` derived from the tiles; shared `Result` type; `PAD` exported for the zero line.
- simplify, tried and reverted: flat step tracking in `run` — a denied copy throws before the render settles, so it blamed the render (caught by the refused-copy e2e); the re-await stays, with its reason in the comment.
- simplify, skipped: slug via `filterLabel` (changes the user's chosen slugs); `dayOf` for the filename date (applies the cutoff, see above); view-model pass-throughs, two-button map, seed table, moving `warnings` to fixtures, reusing `tilesFor` (different tile set), caching the blob across Copy+Download (rare, ~100s ms).
- After fixes: Vitest 898/898, typecheck and lint clean, e2e 29/29.

**Round 2** (delta `e9f9ad58..bbdd1502`; full round, since `queries.ts` was outside round 1's diff): `/code-review high`, `arch-reviewer` (sonnet), `security-reviewer`.
- security: no findings.
- arch: plan still said "All but private" in the Approach → [Fixed] marked superseded. arch: `pressedOutside` stale on a synthetic click → [Verified, no fix needed] (code since removed).
- code-review: the lazy `import("html-to-image")` breaks Copy/Download in a tab left open across a rebuild (old chunk 404s) → [Fixed] static import again; round 1's bundle finding re-dispositioned [Verified, no fix needed]: a local app on 127.0.0.1, where load size doesn't matter.
- code-review: backdrop close still fires on the dialog's scrollbar and on a drag from the backdrop into the card → **second finding on this topic; escalated.** User chose the native `closedby="any"` light dismiss; the hand-built pointer tracking is gone. [Fixed]
- code-review: the card can still unmount mid-export when a query key changes (Back to another filter while open) → **second finding on this topic; escalated.** User chose to keep the card once shown; a reload greys the buttons instead. [Fixed]
- code-review: `share/no_mood` fired when a background refetch failed with the mood still cached, and neither warn carried the error → [Fixed] `isError && !data`; both warns log `error`.
- code-review: no test for the drag-out rule → [Verified, no fix needed] the rule is now the browser's.
- code-review: `clientHeight` rounding can make the line a fraction taller than its slot → [Fixed] floored `getBoundingClientRect().height`.
- code-review: the widened console-error regex hid a remarks 404 in every test → [Fixed] each test allows only the 404 it causes.
- code-review: the no-mood test didn't check the mood is gone → [Fixed] `data-part="mood"`, asserted absent.
- code-review: `filterLabel("everything")` still unreachable → [Verified, no fix needed] kept so the function is total over every filter, with the dropdown's own name; the doc comment no longer claims the card uses it.
- code-review: `nullStats` found by comparing display strings → [Fixed] back to recording null inputs (simplify's round-1 change reverted).
- After fixes: Vitest 898/898, typecheck and lint clean, e2e 29/29.

**Round 3** (delta `bbdd1502..bb4430bb`): `/code-review low`, `security-reviewer`.
- security: no findings.
- code-review: browsers without `closedby` (Safari) lose click-outside, leaving Esc and × → [Verified, no fix needed] the user's round-2 choice; the dashboard runs in Chrome, and both remaining ways out work everywhere. Types accept it (React 19.3).
- No new finding: review done. Totals: 3 rounds; code-review high/high/low, arch (opus, sonnet), security ×3, simplify (round 1).
