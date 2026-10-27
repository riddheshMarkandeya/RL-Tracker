# WP6a-c: Matches & numbers, the side match list, the match page and flags, links, done-criterion

## Context
WP6a (roadmap `docs/plans/2026-10-16-v1-roadmap.md`) is split into a, b and c. WP6a-a (navigation and
Overview 1–4) and WP6a-b (Overview 5–8) are deployed and committed (`694a4ad`). This package finishes the
recap with the following:
- the second page, **Matches & numbers**
- the **match page**, with its side list, scoreboard, goal map, extras and flag note
- match cards and goal-map dots become **links** to the match page
- the roadmap's **done-criterion**

It is Substantial: new routes, three new views, a server read change and a new read rule.

Spec sources:
- Features map `docs/plans/2026-10-15-rl-tracker-features-map.md`, "Recap layout", L151–211:
  - Flags (L190–191): an amber dot on cards, ⚑ on the match list, a slim left-border note on the match page, no count.
  - Matches & numbers (L192–195).
  - Density (L198–210).
  - Goal-map clicks (L176–189).
  - Incomplete matches (L53–56).
- Prototype: variant D on branch `prototype/recap-layout`, in `prototypes/recap-layout/recap-prototype.html`:
  - `dDetail` L734–754, `rail` L737–739 and its CSS L306–312, the `.numtab` CSS L193–202, `.callout` L132.
  - `scoreboard` L585–589, the `FLAG` text L370–375.
  - The keep-in-view rule L849.
- WP6a-a plan `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`:
  - L21–24: the WP6a-c scope.
  - L125: the routes `/recap/:session/matches` and `/recap/:session/match/:guid`.
  - L88 and L94: the query key `["match", guid]`.

## User decisions (this session)
- **What a flag means** ("Guessed or cut short"). A match is flagged when any of these is true:
  - you left
  - the tracker lost the ending (orphaned)
  - you joined in progress
  - the winner was taken from the score (`winner_source = 'decided'`)
  - the MVP was inferred (`mvp_source = 'inferred'`)
  - a data check failed (`check_flags != '[]'`)

  Forfeits (`early_end`) are not flagged; they count normally. Real data, read-only from the installed
  `tracker.db` on 2026-10-27: 76 matches, of which 21 are `early_end`, 1 `left`, 0 joined, 0 decided,
  3 inferred MVP and 0 failed checks. That gives 4 of 76 flagged, against 0 under today's meaning,
  which counts only failed checks.

  **Revisiting WP6a-a's "keep inferring, unflag"**: that decision was about the `mvp_count` *check*, so
  that a podium with no award isn't a data error. The user now chose to show an inferred MVP as a
  user-facing flag. The check stays as it is.

## Approach

### 1. Flags as a read rule (shared + server)
- **New `src/shared/flags.ts`**, pure, in the style of `src/shared/result.ts`.
  - Signature: `flagReasons({ endKind, joinedInProgress, winnerSource, mvpSource, checkFailed }): FlagReason[]`.
  - The reasons, in a fixed order: `"left" | "lost_ending" | "joined" | "winner_decided" | "mvp_inferred" | "check_failed"`.
  - TDD'd in `src/shared/flags.test.ts`: each reason alone; `early_end` and `completed` give `[]`; several reasons come out in order.
- **`src/server/query/read.ts`**:
  - `readMyMatches` selects `joined_in_progress, winner_source, mvp_source, check_flags != '[]' AS check_failed` in place of `… AS flagged`.
  - `toMyMatch` sets `flags: flagReasons(…)`.
  - The `MyMatch` type in `aggregate.ts` swaps `flagged: boolean` for `flags: FlagReason[]`.
  - Also update `FullMatchRow`'s `Omit<MatchRow, "flagged" …>` (`read.ts:87`) and the `aggregate.test.ts:40` fixture.
  - `myMatchSchema` in `responses.ts` gets `flags: z.array(z.enum([...]))`, built from the shared list so there is one source.
  - `read.test.ts:162`, the "whether a check flagged the match" test, is updated, and gains cases for left and inferred MVP.
- **Registry** (`src/server/rules/registry.ts`): a new rule after `your_result`.
  - `id: "match_flags"`, `applied: "read"`, `version: 1`, `checks: []`, area `match`.
  - Rule text: the six conditions, and that a forfeit isn't flagged.
  - Evidence: "the user's choice, 2026-10-27; real data 4 of 76".
  - `refs`: the repo plan copy from step 1. `registry.test.ts:70` requires that the ref files exist.
  - Regenerate `docs/definitions.md` with `bun run definitions`.
- The match endpoint (`readMatch`) is unchanged. The page takes its flags from the session's `MyMatch`, so the two can't disagree.

### 2. Routes and views (`src/web/App.tsx`, `src/web/pages/recap/RecapPage.tsx`)
- **Routes**: `/recap/:session` (Overview), `/recap/:session/matches` and `/recap/:session/match/:guid`. All three render `RecapSession`, which gets a `view` prop (`"overview" | "matches" | "match"`) from its route.
- **Paths**: `recapPath(key, filter, view?)` in `logic/recap.ts` gains an optional view, either `{ match: guid }` or `"matches"`. TDD'd: `encodeURIComponent` on the guid, and the filter is kept.
- **Tabs**: a `<nav aria-label="Recap pages">` with two links, Overview and Matches & numbers.
  - The current tab gets `aria-current="page"`.
  - On a match page, "Matches & numbers" gets `aria-current="true"` instead, as `SessionPicker` does, because it isn't that exact page.
- **Navigation keeps the view**:
  - The session picker's steps keep overview or matches; a match view becomes matches.
  - A filter change keeps the view, the match page included.
  - `SessionPicker` gets the current view, or a path builder, to do this.
- **Focus**: the existing effect gains one case. On a view change with focus fallen to `body`:
  - on the match page, focus the open match's rail link;
  - on the other views, focus the current tab.

  Otherwise the existing rule stands, as in the cross-cutting UI defaults.

  The effect's deps (`RecapPage.tsx:107`) and the `seen` ref gain `view` and `guid`; without them the effect never runs on a row click. `RecapSession` stays mounted across the three routes because it is the same element type in the same position. The e2e tests in section 6 pin this.

### 3. Matches & numbers table (new `src/web/pages/recap/Matches.tsx` + `.module.css`)
- **Data**: `detail.matches` and `detail.aggregate.totals`. Heading: "Every match · N matches · W–L".
- **Columns**: `# | Time | Playlist | Result | Score | G | A | Sv | Sh | Dm`.
  - The Result cell holds the W/L letter, `scoreFor(m)`, the MVP icon and a ⚑ (with an `aria-label` listing the reasons).
  - Null stats show "–", as in `playlistRows`.
- **Totals row** in `<tfoot>`. Its cells are "–" where `totals.x` is null.
- **Each row's # cell is a `<Link>`** to the match page ("click-throughs as real links").
  - The link is stretched across the row with a `::after` overlay on a `position: relative` row, so "Click a row to open the match" holds.
  - The ⚑'s tooltip comes from its `title`. If the overlay hides it, the reasons are still in the link's aria-label and in the match page's note.
- **Size**: the wrapper is capped at `max-height: 70vh; overflow: auto`, with sticky `thead th` and `tfoot td`, ported from `.numtab`. The table is `num` tabular.
- **No-summary state**: when `detail.summary` is null, the existing "No matches under this filter in this session." covers all three views.

### 4. The match page (new `src/web/pages/recap/MatchView.tsx` + `.module.css`)
- **Layout**: a `.split` grid with a 320px rail on the left, then the match. Below 860px it is one column and the rail is capped at 320px high, as in the prototype CSS.
- **Rail**: an `<ol>` of links.
  - The first link is "← All matches", which goes to the matches view.
  - Each row has the W/L letter, playlist, score, MVP icon, time, and a ⚑ with `title` and `aria-label` from `flagShort`.
  - The open one has `aria-current="page"`.
  - The box scrolls on its own, sticky with `max-height: calc(100vh - 16px)`.
  - Keep-in-view: on a guid change, set the box's `scrollTop` so the current link is centred, as in prototype L849. Use the container's scrollTop, not `scrollIntoView`, so the page doesn't jump.
- **Match lookup**: the match comes from `detail.matches.find(guid)`.
  - When it isn't there, show a Notice in the match area: "This match isn't in this view." It always links back to All matches. Its other link depends on `useMatchDetail(guid)`:
    - `sessionKey` names another session: link to that session's match page.
    - A filter is set: link to the same match under "Everything".
    - The match is a 404: "This match isn't here any more."
  - Log it once, from a `useEffect` keyed on guid and filter: `console.warn("[rlt] recap/match_not_in_view", { session, guid, filter, sessionKey })`.
- **Header panel**: W/L, score, playlist name, "time · match N", and an MVP chip ("MVP", or "MVP (inferred)" when the reason is present).
- **Flag note**: when `flags.length`, a slim left-border callout using `var(--flag)`, the existing amber token (check its name in `tokens.css`). It shows one line per reason from `flagLines(flags)`.
  - Pure and TDD'd in `logic/recap.ts` as `flagLines(flags, result)`, worded after the prototype's `FLAG.long`.
  - **The wording follows the match's actual `result`, never a fixed "loss".** A decided winner is filled in exactly when you left or the ending was lost (`winner` rule, `registry.ts:361`), and `resultFor` checks the winner first. So leaving after an overtime goal won it for you is a **win**.
    - left: "You left before the end — counted as a {win | loss}." With a decided winner, it adds ", which the score had already decided".
    - lost_ending: "The tracker lost this match's ending — counted as a {win | loss}" or "— so there's no result" (null result, after a restart).
    - joined: "You joined in progress — counted as a full game."
    - winner_decided, shown only when neither left nor lost_ending is present, since those lines already say it: "The game didn't report a winner — it was taken from the score, which had already decided it."
    - Tests cover: left with a decided win, left with no winner (a loss), and orphaned after a restart (no result).
    - mvp_inferred: "MVP inferred: no MVP award fired, so it went to the top score on the winning team."
    - check_failed: "A data check failed on this match, so some numbers may be off." The check ids are not shown, since dev tooling stays out of the app.
  - `flagShort(flags)` gives the short forms for aria-labels and titles. The match card's existing aria text, "flagged: a check failed on this match", switches to it.
- **Scoreboard**: comes from the new `useMatchDetail(guid)` in `queries.ts`.
  - Key `["match", guid]`, endpoint `/api/matches/:guid`, parsed with `matchDetailResponse`.
  - Staleness: under `staleAfter` the default is to invalidate everything after `match_ended`. Leave it, per the UI default "narrow only for a measured cost".
  - Two team tables ("Your team · won/lost" and "Opponents"), built by the pure `scoreboardTeams(players, myTeam)`, TDD'd:
    - your team first, rows sorted by score descending;
    - players with a null team go into an "Unknown team" group, shown only when not empty;
    - unseen in real data, so `console.warn("[rlt] recap/player_no_team", { guid, count })`, plus a BACKLOG Watch item.
  - Columns: Player, Score, G, A, Sv, Sh. Your row is bold with "(you)", from `isMe`.
  - When `players` is empty, hide the scoreboard.
  - Loading and error states apply to the scoreboard section only. It shows a loading area while it waits, and on error "Couldn't load the scoreboard." The rest of the page renders from the session.
- **Goal map**: "Where the goals came from" is `<GoalMap matches={detail.matches} goals={this match's goals} viewKey={guid} />`, hidden when this match has no goals.
  - It gets the whole session's matches so the dot titles carry the right "Match N". `sided` numbers matches by their index in the array.
  - `goalMarks` and `goalSummary` only walk the goals, so the counts stay correct.
- **"Your match" extras**: one aggregate, no copy.
  - Move `src/server/query/aggregate.ts` and its test to `src/shared/aggregate.ts`. It imports only `src/shared`, and `MyMatch` is already pinned equal to `MyMatchWire` (`responses.test.ts:8`). Update the server's imports.
  - The match page calls `extrasCards(aggregate([m]), [m])` and `highlights(m.statfeed)`. `matchOf` returns null for one match, so the cards have no "match N" sub.
  - The Extras markup in `Overview.tsx` becomes a shared `ExtrasSection({ agg, matches, heading })` used by both pages. The `extrasMatches < matches` note stays inside it, and it never shows for one match.

### 5. Links from match cards and goal dots
- **`MatchCards`** in `Overview.tsx`: each `<li>` wraps a `<Link>` to the match page.
  - The aria-label moves to the link.
  - The card styles move to the link: a block display, and a focus ring from the existing focus token.
- **`GoalMark`** gets `matchGuid` in `goalMarks`, which is updated in `goal-map.test.ts`.
- **`GoalMap`** takes an optional `hrefFor?: (guid) => string`.
  - With it, each `Mark` is an SVG `<a href>` around the `<g>`.
  - The SVG is `role="img"`, so the dots stay out of the tab order and the accessibility tree. Keyboard users reach the same matches through the cards, so the dots get `tabIndex={-1}`.
  - The Overview passes `hrefFor`. The match page doesn't, since it is already that match.
  - The plan reviewer checked axe-core: `img` has no `childrenPresentational`, so `nested-interactive` doesn't apply. The e2e axe run confirms it.
  - Clicks go through react-router's `useLinkClickHandler(href)` (installed in 8.4.0), so the page doesn't reload. It leaves Ctrl, Cmd, Shift and middle clicks to the browser.

### 6. e2e (`test/e2e/stack.ts`, `test/e2e/recap.spec.ts`)
- **Seed**: in the `e2e-first` sessions, add a match with `endKind: "left"` and no winner, and one with `mvpSource: "inferred"`. `e2e-first-b`'s `mvp_count` check flag stays as the check_failed case.
  - The `over` type of `match()` (`stack.ts:43`) gains `endKind`, `winnerTeamNum` and `mvpSource`.
  - The extra loss changes the "1 win, 1 loss" assertions at `recap.spec.ts:39` and `:174`. Update them.
  - `:41` expects `/flagged/`, so the `flagShort` aria text keeps the word "flagged".
- **New tests**:
  - The Matches & numbers table: rows, totals, ⚑ on the flagged rows, and sticky header and footer (`position: sticky` computed).
  - A row link opens the match page. The rail shows `aria-current` on the open match, and "← All matches" goes back.
  - The match page: header, flag note lines for left, inferred MVP and failed check; the HAT_TRICK match's scoreboard with the "(you)" row; the goal map; Your match extras.
  - A match card click on the Overview opens its match page. A goal-dot click opens its match.
  - A filter that excludes the open match shows the not-in-view notice and its link.
  - Session stepping from Matches & numbers stays on Matches & numbers.
  - Focus:
    - a table-row link click leaves focus on the open match's rail link;
    - Back from the match page doesn't move focus (it's a Pop); a "← All matches" click focuses the "Matches & numbers" tab.
  - Keep-in-view: on `e2e-long-25`'s last match, the open rail link sits inside the rail's visible scroll box.
  - axe in all three themes on `/recap/:s/matches` and `/recap/:s/match/:guid`.
  - 320px: no horizontal page scroll on both new views.
- `recap-empty.spec.ts` already covers the empty DB's "not enough data yet".

### 7. Done-criterion and docs
- **Deploy and live check** in Chrome against the installed app with real data. The `ui-implementation-guidelines` real-browser check and usability review cover:
  - a real session's Overview, Matches & numbers and a match page;
  - the flagged "left" match and the inferred-MVP matches;
  - the goal-dot and card links.
- **Docs**:
  - roadmap WP6a status set to done;
  - BACKLOG: the roadmap line's next step becomes WP6b, plus the Watch item for `player_no_team`;
  - this plan copied to `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md` (step 1);
  - review file and commit body via `documentation-backlog-hygiene`.

## Steps
1. Save this plan to `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`, and set the roadmap WP6a status to "WP6a-c in progress".
2. Flags: `shared/flags.ts` with tests, the read.ts and schema change, the registry rule, `bun run definitions`. Move `aggregate.ts` to `src/shared`. Run `bun run check`.
3. Web logic, TDD:
   - `recapPath` view
   - `flagLines` (by result) / `flagShort`
   - `scoreboardTeams`
   - `goalMarks.matchGuid`

   Run `bun run check`. This is the natural midpoint for a `/compact` offer.
4. Routes, tabs, view-keeping navigation and focus. The Matches & numbers table.
5. The match page: rail, header, flag note, scoreboard (`useMatchDetail`), goal map, shared Extras section.
6. Links: match cards, and goal dots.
7. e2e seed and specs. `bun run check` and `bun run e2e`.
8. `independent-review-pass`, then deploy, the live check (the done-criterion), docs.

## Logging (what each answers)
- `[rlt] recap/match_not_in_view` (warn): which guid was opened outside its view, under which filter? That tells a stale link from a filter mismatch.
- `[rlt] recap/player_no_team` (warn): did a real match ever give a scoreboard player no team, and in which match?
- The existing `recap/focus` debug gains `to: "rail" | "tab"`: where did focus go after a view change, and why?
- The server's `readMyMatches` is already timed. The flags are a pure mapping, with no new failure point.

## Verification
- `bun run check` (Vitest, typecheck, lint) green after each of steps 2, 3 and 7.
- `bun run e2e` green, including axe in all three themes on the new pages.
- Deploy, then Chrome on `http://127.0.0.1:49100/`:
  - open a real session, then both tabs and a match page;
  - the "left" match shows its note;
  - click a goal dot and a card.
- Then a read-only DB recount confirms 4 flagged matches show ⚑.

## Implementation notes
Steps 1–7 done on 2026-10-27. After step 6, `bun run check` passed 818 tests, with typecheck and lint clean. The departures from the text above:
- **Focus**: a page change moves focus to the rail or the tab whether or not it was a Back. Only the filter case keeps the Pop guard, which was there for the arrow-through-select case. Back from a match page therefore lands focus on the "Matches & numbers" tab, which the existing rule would otherwise have sent to the picker.
- **Match page header**: the h2 reads "Match N: win 4–1". The letter and score are what's visible, and "Match N:" plus the result word are visually hidden.
- **e2e seed**: the two new flagged matches (`e2e-first-c` left, `e2e-first-d` inferred MVP) are on playlist 11 in the `e2e-first-a` session, so its single-playlist checks still hold. That session now reads 2 wins, 2 losses.
- **Goal-dot links** use react-router's default (HTML) generic for `useLinkClickHandler`, because JSX types every `<a>` as HTML. The handler reads only the button and the modifier keys.
- **Goal map role**: the plan reviewer said axe wouldn't flag links inside a `role="img"` svg. The e2e axe run showed it does (`nested-interactive`), so the svg is now `role="group"` and the dot links carry `aria-hidden="true"` as well as `tabIndex={-1}`. A screen reader still gets the svg's label and the counts beside it, and the cards give keyboard users the same matches.
- **Rail contrast**: in carbon, the `--muted` meta text on the open (`--surf2`) rail row failed contrast, so `.meta` uses `--ink2`.
- **e2e**: the dot test clicks the last mark, since the seed's goals share a spot and the last is drawn on top. `bun run e2e` passed 19 of 19, including axe in 3 themes on both new pages and the 320px checks.
- **Red runs**: the first runs of `flags.test.ts` and of the step-3 logic tests couldn't be run while they were red, because the tool's safety check gave no verdict. They were seen green once the code was in. The reader test was seen red (`flags` undefined) before its change.

## Plan review
plan-reviewer (opus), 2026-10-27. All 9 findings folded in:
1. High: the left and lost-ending notes hard-coded "loss", but a decided winner can make it a win. **Folded**: `flagLines(flags, result)`, with tests for a decided win.
2. Medium: `matchExtras` duplicated the server's aggregate. **Folded**: `aggregate.ts` moves to `src/shared`, and the match page calls `aggregate([m])`.
3. Medium: a hand-rolled click on the dots broke modified clicks. **Folded**: `useLinkClickHandler`.
4. Medium: the seed change breaks existing e2e assertions. **Folded**: listed in section 6.
5. Medium: focus deps and keep-in-view had no test seam. **Folded**: the deps gain view and guid, and e2e checks focus and keep-in-view.
6. Low: the dots said "Match 1" on the match page. **Folded**: pass the session's matches.
7. Low: the not-in-view notice for another session's guid. **Folded**: it uses the match endpoint's `sessionKey`, and the warn moves to an effect.
8. Low: the axe fallback wasn't needed. **Folded**: dropped.
9. Low:
   - The row hover now goes with a stretched link.
   - The tabs use `aria-current="true"` on a match page.
   - The missed spots (`FullMatchRow`, the aggregate fixture, registry `refs`) are now listed.

## Review log
Classified Substantial (design tier). Snapshot before fixes: `1c9c692`.

### Round 1 (2026-10-27)
Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify` (4 agents). Security: no findings. It read the new files, the SQL and the link building, but not the full diff, because Bash had no classifier verdict.

Code review and arch, deduplicated:
1. `NotInView` showed "isn't in this view" for a failed lookup and while pending, and logged a server error as a filter miss. **[Fixed]** A loading state while pending; "Couldn't look up this match." on a non-404 error; the warn logs `status`.
2. `flagLines`: with a null result, `left` + `winner_decided` dropped the decided-winner reason. **[Fixed]** The end lines absorb it only when there's a result; test added.
3. A dead `left` guard in the `lost_ending` case (both come from one `endKind`). **[Fixed]** Removed.
4. A stale `/** A check failed on this match. */` above `flags` in `responses.ts`. **[Fixed]**
5. `flags.ts` comment pointed to `result.ts` instead of the reason. **[Fixed]**
6. "Ported from variant D" header comments in the two new CSS modules. **[Fixed]** They now say what the styles do. The same comments in `Overview.module.css` and `SessionPicker.module.css` predate this diff and stay.
7. `!important` on `.winText`/`.lossText`. **[Fixed]** `.title .winText` specificity.
8. MVP test and match aria-label repeated (4× / 3×), and the table's label had already drifted. **[Fixed]** `isMyMvp` and `matchLabel(m, n)` in `logic/recap.ts`, tested; all three lists use them.
9. The scoreboard said "No team" (plan: "Unknown team"), and never "lost". **[Fixed]** "Unknown team"; each team heading reads " · won" or " · lost" when the winner and its team are known. The e2e assertion follows.
10. Three overlapping view types. **[Fixed]** in part: the picker's `PageView` is `Exclude<RecapView, { match: string }>`. `SessionView` stays, as the routes' own prop.
11. The focus target was a nested ternary with `to` worked out again from the DOM. **[Fixed]** `to` and the target are chosen together.
12. `MatchView` imports `ExtrasSection` from `Overview`. **[Verified, no fix needed]** It uses Overview's stat-grid styles, so moving it would split or copy that stylesheet. The import is from a sibling in the same recap folder.
13. The scoreboard fetches the whole match detail for its players. **[Verified, no fix needed]** That is the plan's design, and it costs one localhost request.
14. The BACKLOG Watch item for `recap/player_no_team`. **[Fixed]** in the step-8 docs.

`/simplify`: applied the Matches `COLS`/`ABBR` merge and one `status` in `NotInView`. Skipped, with reasons:
- the dot links as an `onClick` on `<g>`: loses modified and middle clicks (plan review 3);
- moving the one-match aggregate to the server: the plan review chose the shared aggregate (2);
- source enums in `src/shared`: `FlagInput` follows `result.ts`'s convention;
- a `left_decided` reason: changes the read rule for wording;
- remodelling the view props and focus as refs: design churn with no behaviour gain;
- one router hook per goal mark, memoising the rail, `staleTime` and prefetch: unmeasured at real session sizes, as the UI defaults narrow only for a measured cost;
- `MatchMarks` and `matchRow` extractions: the markup differs per list.

After the fixes: `bun run check` passed 820 of 820. `bun run e2e` passed 19 of 19, after the Opponents heading assertion was updated to " · lost".

### Round 2 (2026-10-27, delta from `1c9c692`)
Passes: `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`. No bugs.
- `isMyMvp` had no doc comment. **[Fixed]** (nit)
- The table's link label now repeats the time and playlist from its own cells. **[Verified, no fix needed]** One label for all three lists, which is what fixed the drift; the cells are read only when the reader moves across the row.
- Code review asked whether `left` and `lost_ending` together give two end lines. **[Verified, no fix needed]** Both come from the one `endKind`, so they can't be set together.

The review is done: a round with no new finding and no `/simplify` edit.

## Done-criterion
`bun run deploy` passed on 2026-10-27: 820 tests, 19 e2e, the install and a recompute with 0 failed. Then a live Chrome check at `http://127.0.0.1:49100/`:
- the left match's note reads "You left before the end — counted as a loss.";
- an inferred-MVP match shows its note and ⚑;
- a goal dot opens its match;
- the team headings read won and lost;
- Matches & numbers shows ⚑ on the flagged row, and the rail keeps the open match in view;
- the console has no errors.

A read-only recount of the installed DB gives 4 of 76 matches flagged (1 left, 3 inferred MVP).
