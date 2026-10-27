# WP6a-b: Overview sections 5–8 (per-game cards, What stood out, By playlist, goal map, Extras, Highlights)

## Context
WP6a (roadmap `docs/plans/2026-10-16-v1-roadmap.md`) is split a/b/c. WP6a-a (navigation, Overview
1–4) is deployed (`docs/plans/2026-10-26-wp6a-a-recap-navigation.md`). This package finishes the
Overview below the match cards, ported from variant D of `prototypes/recap-layout/recap-prototype.html`
(branch `prototype/recap-layout`, `dOverview`/`dTiles`/`goalMap`/`dExtras`/`dByPl`), per the features
map's "Recap layout" items 5–8 and "Little or no data".

**No server change.** `GET /api/sessions/:key` already sends everything (`sessionDetailResponse` in
`src/shared/schemas/responses.ts`): `aggregate` and `baseline` (per game, extras, your statfeed),
`byPlaylist`, `matches` (with `me.playerKey`, `me.teamNum`, your goals' speeds, your extras), and
`goals` (every goal in those matches, both teams: `teamNum`, `scorerKey`, `pos` at the scoring
team's last touch, `distance`, `speedKmh`, `deflected`, `aerial`, `ownGoal`). So this is web only:
pure logic (TDD'd) plus components and e2e.

## User decisions (this session)
- **What stood out**: up to 3 of the six per-game stats that differ from the 30-day average by at
  least 10% either way (up or down), biggest first. Keep 10% for now and check back after two months
  of data (BACKLOG item, see Docs). Real data, read-only from the installed API on 2026-10-27: the 5
  sessions with a baseline had 4–6 stats past ±10% (3–5 past ±20%). That overstates it: recording
  began 19 Oct, so every baseline is under a month old (13–65 matches) and swings are large. As
  baselines fill out, fewer stats will pass 10%; the check-back (~2026-12-27) re-runs the same
  table with full 30-day baselines and picks the number then.
- **Nothing stood out** (asked after the plan review): the panel stays and says "Close to your
  30-day average on every stat." That is a finding, not an empty slot, so it isn't hidden. The
  panel is hidden only when there is no baseline at all.
- **Highlights**: the map's 7 (hat tricks, overtime goals, Savior, epic saves, aerial goals, long
  goals, bicycle hits) plus the 5 rare ones seen in real data (Playmaker, PoolShot, BackwardsGoal,
  FlipReset, LowFive). The user may trim them later if the row feels cluttered.
- **Goal-map units**: metres (the game unit is the centimetre, so `uu / 100` is exact).
- **By playlist**: hidden when the session (under the filter) has one playlist; "What stood out"
  then takes the full width.

## Constraints that bind this plan
- Global CLAUDE.md: TDD (`tdd-live-code-carveout`) for pure logic; UI through Playwright and a real
  browser; `ui-implementation-guidelines` and `dataviz` loaded before UI/chart code; logging §2;
  `independent-review-pass`.
- Roadmap "UI interaction defaults": charts stay passive (SVG `<title>` for values, no custom
  keyboard navigation); native controls; no placeholder data.
- "Little or no data": hide empty items, no fake zeros. A measured zero (0 crossbar hits) is real
  and shown; a null is hidden.
- Project rule "Data shapes we haven't seen" → global §2 *Unseen input shapes*.
- Colours from `src/web/styles/tokens.css` (`--blue`, `--orange` for teams; accents avoid them).
  Themes carbon, slate, oled; axe runs on every page × theme.
- Goal ranges from `goalRange` in `src/shared/goal-range.ts` (registry rule `goal_range`: close under
  a quarter pitch, long from half), not the prototype's 1500/4000.
- Match cards and goal dots are not links yet; WP6a-c makes them open the match.

## Approach

### 1. Pure logic, TDD'd
`src/web/logic/recap.ts` (beside `tilesFor`; "what the Overview shows"):
- `PER_GAME`: the six stats in order `score, goals, assists, saves, shots, demos`, with label and
  icon (Goal, Assist, Save, Shot, Demolition; score has none).
- `vsAverage(value, avg)` → `{ pct, dir: "up" | "down" | "same" } | null`: null when `avg` is null
  or 0 (no fair ratio); `pct` is the whole-percent change; `same` under 3% (prototype's "≈ 30-day
  avg").
- `perGameCards(agg, base)` → per stat: per-game value, total, `vs` (null when
  `base.matches === 0`). A stat whose per-game value is null is left out.
- `stoodOut(agg, base)` → `null` when `base.matches === 0` (panel hidden); else the stats with
  `|pct| ≥ STOOD_OUT_MIN_PCT` (10, compared on the rounded pct as shown), sorted by `|pct|` desc,
  first 3. `[]` means "close to your average on every stat".
- `playlistRows(byPlaylist)` → `{ name, wins, losses, winPct | null, goalsPerGame }[]`, or `null`
  with fewer than 2 playlists. Names from `playlistInfo`.
- `extrasCards(agg, matches)` → cards in the map's order: hardest shot (km/h), fastest goal (km/h),
  crossbar hits, avg boost, supersonic %, empty tank %, aerial touches. Each null value is left
  out. Hardest shot and fastest goal carry "match N" (N = 1-based position in the session, as on
  the match cards) when the session has more than one match: the match whose `me.hardestShotKmh`,
  or a non-own goal's `speedKmh`, equals the aggregate's. Returns `[]` when `extrasMatches === 0`.
  When `0 < extrasMatches < matches`, the section notes "Over N of M matches".
  The "match N" lookup considers only matches with extras computed (`me.woodworkHits !== null`, as
  the aggregate does); on a tie, the first match.
- `HIGHLIGHTS` (12 `[eventName, label]`, fixed order) and `highlights(statfeed)` → those with a
  count > 0. `LongGoal` is labelled "Long goal awards": the game's award follows no simple distance
  rule (registry `goal_range` evidence), so it must not read as the goal map's own "long" class.
- `decimal(v)` in `logic/format.ts`: the prototype's `f1` (≥ 100 whole, else up to 2 decimals,
  trailing zeros trimmed).

`src/web/logic/goal-map.ts` (shared with WP6a-c's match page):
- Pitch constants: `GOAL_LINE_Y` and `SIDE_WALL_X`, both from `src/shared/constants.ts`.
  `SIDE_WALL_X` (4096) moves there from `src/server/recorder/extras.ts`; `extras.ts` and
  `registry.ts` import it from shared (same value, so no rule version moves; `constant-pins.json`
  and the definitions test must stay green). Drawn sideways, your goal
  on the left. `toScreen(pos, myTeam, W, H)`: team 0 attacks +Y, so for your team 1 the point is
  rotated 180° (`x → −x`, `y → −y`); `y` clamped to ±GOAL_LINE_Y (real goals reach 5173, in the
  goal mouth).
- A goal is one of three kinds: **placed** (`pos` and `distance` set), **own goal** (`ownGoal`), or
  **unplaced** (`pos` null but not an own goal: you joined before the first kickoff, so the
  scoring touch is unknown; `play.ts` `addGoal`, the `joined-in-progress` fixture).
- `goalMarks(matches, goals)` → `{ marks, skipped }`. One mark per placed goal: screen point,
  `side` ("scored" when `teamNum === me.teamNum`, else "conceded"), `yours`
  (`scorerKey === me.playerKey`), `aerial`, `deflected`, match number, and title text, e.g.
  `Match 3 · your goal · 112 km/h · 24 m out · an opponent touched it last`; aerial goals add
  "7 m up" (height only for aerials, as in the prototype: `z` is the ball's centre, so a ground
  ball would read "1 m up"). Conceded: "your team touched it last"; a teammate's: "a teammate's
  goal".
- `skipped: { guid, goals }[]`: matches with goals where `me.teamNum` is null (no orientation, no
  side), left out of marks and summary. Unseen in real data (0 of 76 player rows), so per §2 the
  component warns once per loaded session from a `useEffect` keyed on session key + filter:
  `console.warn("[rlt] recap/goal_no_team", { guid, goals })` per skipped match; plus a Watch list
  item. Vitest covers `skipped`; the warn line is checked by hand once.
- `goalSummary(goals, matches)` → for scored and conceded: total (every goal of that side), by
  `goalRange` over placed goals only (close/mid/long), aerial count, own goals and unplaced goals
  as separate counts ("1 own goal", "1 not placed": shown only when > 0, never dotted); plus "you
  scored X of the team's N". The aria-label's N and M are these same totals.
- `markScale(goalCount)`: 0.65 when the view has more than 60 goals (all goals counted, as the map
  and prototype do), else 1.

### 2. Components (`src/web/pages/recap/Overview.tsx` + CSS module; `src/web/components/GoalMap.tsx` + CSS module)
Section order below the match cards, each a `<section>` with an h2:
- **5. "Per game vs your 30-day average"**: a wrapped tile grid (prototype `dTiles`): icon + label,
  `decimal(v)` "/game", the ▲▼ % or "≈ 30-day avg" (hidden without a baseline), "N total".
- **6.** A two-column grid that stacks below ~720px: **"What stood out"** (icon, "1.4 goals per
  game", ▲ 35% vs 30-day avg (1.04)) or the "close to your average" line; hidden with no baseline.
  **"By playlist"**: a `<table>` Playlist · W–L · Win % · Goals/g; hidden with one playlist. When
  one of the two is hidden, the other takes the full width; when both are, the grid isn't rendered.
- **7. "Where the goals came from"** (`GoalMap`, hidden only when the view has no goals at all; a
  session whose goals are all unplaced shows the empty pitch with its summary): an SVG pitch (`viewBox` 560 × 448, `width: 100%`) with field lines and the two goal mouths
  in team colours, "your goal"/"their goal" labels; marks per the map (yours filled blue,
  teammate's blue ring, conceded filled orange, aerial a diamond, deflected a dashed outer ring),
  each with a `<title>`; `role="img"` and an aria-label "Where N goals for and M against came
  from". A legend. Beside it (below on narrow screens) the summary: Scored · N (· k aerial), a bar
  split close/mid/long, "You scored X of the team's N", the same for Conceded, and the range note
  ("Close: within a quarter of the pitch from goal. Long: from halfway or further."). The summary is
  the visible text equivalent of the chart.
- **8. "Extras"**: tiles from `extrasCards`; then **"Highlights"** (h3) tiles from `highlights`,
  only when one happened.

### 3. Logging
- Web: `[rlt] recap/goal_no_team` (`{ guid, goals }`, once per loaded session), the only new decision point that can
  meet an unseen shape. Everything else is a pure render of already-logged fetches.
- Server: nothing new.

## Files
- Shared/server (constant move only): `src/shared/constants.ts`, `src/server/recorder/extras.ts`,
  `src/server/rules/registry.ts`.
- Web: `src/web/logic/recap.ts`, `logic/format.ts`, new `logic/goal-map.ts` (each with tests),
  `pages/recap/Overview.tsx` + `Overview.module.css`, new `components/GoalMap.tsx` +
  `GoalMap.module.css`.
- e2e: `test/e2e/stack.ts` (seed), `test/e2e/recap.spec.ts`.
- Docs: roadmap WP6a status, BACKLOG (the threshold check-back, the Watch item), repo plan copy
  `docs/plans/2026-10-27-wp6a-b-overview-sections.md`, review file in `docs/reviews/`.

## Test seams
- Vitest, red first: `vsAverage` (null/0 average, the 3% "same" edge, sign), `perGameCards`
  (no baseline → no `vs`), `stoodOut` (no baseline → null; ±10% edge on the rounded pct, both
  directions; top-3 cap and order; zero average skipped; none → `[]`), `playlistRows` (one
  playlist → null; null win %), `extrasCards` (null values left out; real zero kept; "match N" only
  with >1 match, only among matches with extras, first on a tie; own goals don't count for
  fastest; partial extras), `highlights` (order, zero counts dropped, unknown names ignored,
  the "Long goal awards" label), `decimal`, `toScreen` (team 0 vs team 1 orientation, the clamp),
  `goalMarks` (sides, yours vs teammate, own goal and unplaced → no mark, null team → in `skipped`,
  height only on aerials), `goalSummary` (ranges via `goalRange` over placed goals, aerial, own
  and unplaced counts, totals including them, your share), `markScale` (60 vs 61 goals).
  The Overview's layout states (goal map hidden with no goals; the section-6 grid with one or both
  panels hidden) follow from these functions' null/empty returns, which the tests above pin.
- e2e seed (`stack.ts`, `rich`), keeping the long session at 17 wins, 9 losses
  (`recap.spec.ts:73`) and never using playlist 17 (the "nothing under this filter" test,
  `recap.spec.ts:136`):
  - one long-session match on playlist 11 (By playlist shows two rows);
  - one long-session match where you scored 4 instead of 1 (+3 goals: 29/26 = 1.115 per game, ▲ 12%
    against the 1-match baseline from `e2e-old`, so Goals is in What stood out; +2 would be 8%);
  - one with a `HatTrick` statfeed and an aerial, deflected conceded goal.
  - `e2e-seed-won` stays as is (the shell spec's chip).
- Playwright (`recap.spec.ts`): on the long session, the per-game section, "What stood out" with
  Goals, "By playlist" with two rows, the goal map's aria-label counts and its summary text, the
  Extras tiles and a "Hat tricks" highlight; on a one-playlist session, By playlist is absent; on
  `e2e-old` (no baseline), no "What stood out" and no ▲▼ on the per-game cards. The 320px
  no-sideways-scroll check extends to the long session's full Overview. The axe sweep adds
  `/recap/e2e-old` (a no-baseline session) to its paths in every theme.
- Real browser: the installed dashboard on real data (sessions 19–26 Oct, ~90 goals in a session,
  so the 60-mark shrink shows); hover titles, light check of all three themes, 320/768/1440 widths.

## Steps
1. Save this plan to `docs/plans/2026-10-27-wp6a-b-overview-sections.md`; roadmap WP6a status →
   WP6a-b in progress.
2. Pure logic, TDD (`tdd-live-code-carveout`): `recap.ts`, `format.ts`, `goal-map.ts`.
3. Load `ui-implementation-guidelines` and `dataviz`; build sections 5–8 and `GoalMap`.
4. e2e seed and specs. `bun run check` and `bun run e2e` green. Give the `/compact` line.
5. `independent-review-pass`.
6. On the user's go: `bun run deploy`, real-browser check, BACKLOG (threshold check-back
   ~2026-12-27 with the figures above; Watch: `me.teamNum` null on a match with goals) and roadmap
   status.

## Verification
- `bun run check` (typecheck, lint, Vitest) and `bun run e2e` (Playwright + axe) pass.
- Installed dashboard: on the 21 Oct session, per-game cards read against the 30-day average
  (e.g. Assists ▼ 28%), What stood out lists Shots, Goals and Demos (the three largest), By
  playlist shows when the session has two playlists, the goal map's dots sit on the correct side
  for matches played as team 1 (spot-check a conceded goal near your goal), Extras show real values,
  and Highlights show only events you had. The 19 Oct session (no baseline) shows no stood-out
  panel and no ▲▼.

## Plan review
plan-reviewer (opus), 2026-10-27. Verdict: the approach fits; no server change needed. Findings and
what was done with each:
1. med, a goal with no point that isn't an own goal (joined before the first kickoff) was
   unhandled: `goalRange(null)`, a bar not adding up, the map wrongly hidden. **Folded in**: three
   goal kinds; "not placed" counted; ranges over placed goals only; totals include all; hidden only
   with no goals; tests.
2. med, Highlights' "Long goals" (the game's award) beside the map's own "long" class. **Folded
   in**: labelled "Long goal awards".
3. med, where the `goal_no_team` warn fires (a render-body warn repeats). **Folded in**:
   `goalMarks` returns `skipped`; a `useEffect` keyed on session + filter warns once; one field set
   `{ guid, goals }`.
4. low, the e2e seed needed exact numbers. **Folded in**: +3 goals (12%; +2 would be 8%), 17–9
   kept, playlist 17 avoided.
5. low, `SIDE_WALL_X` is server-only. **Folded in**: moved to `src/shared/constants.ts`.
6. low, "1 m up" on ground balls. **Folded in**: height only on aerial goals, as in the prototype.
7. low, `markScale` counted marks. **Folded in**: counts all goals in the view.
8. low, untested states. **Folded in**: axe adds `/recap/e2e-old`; "match N" only among matches
   with extras, first on a tie, tested; layout states pinned through the logic's null/empty
   returns rather than separate e2e cases.

## Implementation notes
Steps 1–4 done 2026-10-27. `bun run check`: 804 tests pass, typecheck and lint clean. `bun run e2e`:
13 pass (axe in all three themes, now including `/recap/e2e-old`; 320px on the full long Overview).
Where the build departs from the text above:
- The `goal_no_team` warn's `useEffect` is keyed on the session key and the skipped list itself, not
  the filter: a refetch of the same view doesn't warn again, and `GoalMap` needs no filter prop.
- Without a baseline the per-game heading reads "Per game", not "… vs your 30-day average".
- Field X on screen: +X is taken as blue's left (the usual Rocket League convention), drawn at the
  top while your goal is on the left. Nothing in the repo records the Stats API's handedness, so this
  is unverified; a wrong guess mirrors the map top to bottom, never left to right.
- The e2e seed puts the hat trick, the +3 goals and the aerial deflected conceded goal in one match
  (long-session match 2); match 3 is on playlist 11. Saves are 0 in the seed, so the e2e also pins
  "no comparison against a zero average".
- The goal-map palette (`--blue`/`--orange`) passes the dataviz validator on all three themes'
  pitch surface (CVD ΔE 26.8, normal 31.8).
- Signatures: `toScreen(pos, myTeam)` uses the module's `MAP_W`/`MAP_H` rather than taking them, and
  `goalSummary(matches, goals)` takes its arguments in `goalMarks`' order.

## Review log
**Round 1** (2026-10-27). The diff is about 600 non-test lines, so it is reviewed as Substantial:
`/code-review high`, arch-reviewer (opus), security-reviewer and `/simplify`. Snapshot `14eab7c`.
- security: no findings.
- By playlist rows keyed on the name, but ids 16 and 35 share "Rocket Labs" (code-review).
  **[Fixed]**: the row carries `playlistId` and is keyed on it.
- `playlistRows` turned null wins/losses into 0 (arch). **[Fixed]**: they pass through, and a null
  record shows "–". Test added, red first.
- "You scored 0 of the team's 0." (code-review, arch). **[Fixed]**: the line shows only when the
  team scored.
- HAT_TRICK seed: score 2–1 against 4 goals (code-review, arch). **[Fixed]**: `scoreTeam0: 4`.
- `toScreen` comment stated the X handedness as fact (arch). **[Fixed]**: worded as an assumption.
- `goal-map.ts` header described the match page as existing (arch). **[Fixed]**.
- Pitch lines hard-coded 10240/8192 (arch). **[Fixed]**: derived from `GOAL_LINE_Y`/`SIDE_WALL_X`.
- Plan signatures differ from the code (arch). **[Fixed]**: recorded in Implementation notes.
- The JSON round trip for the effect's dependency (code-review, arch). **[Verified, no fix needed]**:
  it gives a value-stable dependency without a hooks-lint suppression. A comment now says why.
- Warn not keyed on the filter (code-review). **[Verified, no fix needed]**: a deliberate deviation,
  already in Implementation notes. A filter change that keeps the same skipped matches has nothing new
  to report.
- BACKLOG Watch item for `goal_no_team` missing (code-review). **[Verified, no fix needed]**: it is
  scheduled in step 6 with the other BACKLOG items.
- `sided()` runs twice, and `perGameCards` runs twice per render (code-review). **[Verified, no fix
  needed]**: at most about 100 goals and 6 stats, and the same pure function can't drift from itself.
- Redundant guards in `perGameCards`, `stoodOut` and `extrasCards` (code-review).
  **[Verified, no fix needed]**: `avg === null` and `m.me !== null` narrow types. `base.matches === 0`
  states the spec's "no baseline, no comparison" rule rather than relying on null averages.
- `decimal(1.005)` gives "1" (code-review). **[Verified, no fix needed]**: a binary-float edge at the
  second decimal of a derived ratio, invisible in practice.
- `/simplify` (4 agents: reuse, simplification, efficiency, altitude). Applied: `GoalMark.match`
  was unused outside tests, so it is dropped; `PerGameCard` carries `avg`, so `stoodOut` no longer
  looks the average up again (test updated, red first). Skipped: the efficiency notes (microseconds at
  ~100 goals); shared homes for pitch sizes, statfeed labels and stat icons (one consumer each today,
  so YAGNI); small markup tidies (a legend item component, the tone prop, the unit spacing branch,
  the icon placeholder span, the heading CSS).
- After the fixes: `bun run check` passes 805 tests, typecheck and lint clean; `bun run e2e` 13 pass.

**Round 2** (delta from `14eab7c`): `/code-review low`, arch-reviewer (sonnet), security-reviewer.
- security: no findings. arch (sonnet): no findings; every round-1 fix is in place.
- `/code-review low`: the first run reviewed the round-1 snapshot instead of the delta, so it was
  re-run on `git diff HEAD`. Its findings:
  - The fastest-goal "match N" matches any team's goal (raised twice). **[Verified, no fix needed]**:
    `MyMatchWire.goals` holds only your goals (`read.ts` filters on `scorer_key`). The wire schema
    now carries the `/** Your goals. */` doc that the server type already had, a comment-only nit.
  - The "· N aerial" note counts own goals and unplaced goals the map doesn't draw.
    **[Verified, no fix needed]**: the side's header counts every goal of that side, its total
    included, so the aerial note uses the same scope. The map's marks are a subset by design (own and
    unplaced goals are listed apart).
- No new finding, so the review is **done** after 2 rounds: 9 fixed and 2 `/simplify` edits, the rest
  verified; nothing deferred or disputed.

**Real-browser check** (2026-10-27, installed dashboard after `bun run deploy`, Chrome, real data):
- 21 Oct (15 matches, 96 goals, so the marks shrink): per game reads Assists ▼ 28%; What stood out
  lists Shots ▲ 41%, Goals ▲ 35% and Demos ▲ 30%; By playlist shows Doubles 3–5 and Ranked Doubles
  4–3. The goal map's sides are right: conceded marks cluster at your goal, scored ones at theirs.
  Extras are real (hardest 123 km/h, match 15), and 9 hat tricks agrees with the per-match goals
  (a 6-goal match gives 2). No sideways scroll and no console errors. The 19 Oct session (no
  baseline) shows "Per game", no What stood out and no "30-day avg".
- `goal_no_team`: with fetch patched in the page to null one match's `me.teamNum`, the 19 Oct view
  logged one `[rlt] recap/goal_no_team` warn, and that match's goals left both counts (36/45 to
  29/39).
- Themes: carbon, slate and oled all look right (axe also passes on each in e2e).
- Not done: the Chrome window wouldn't resize, so the narrow widths rely on the e2e 320px check.
  Field X handedness is still unverified (BACKLOG).
- Found: marks on the pitch edge (a touch in a goal mouth, drawn on the line) were cut in half by
  the viewBox. **[Fixed]**: a 12-unit pad around the pitch, deployed again (check and e2e green).

**Round 3** (from the live check; delta: the viewBox pad in `GoalMap.tsx`): `/code-review low` and
security-reviewer, both clean. Review done.
