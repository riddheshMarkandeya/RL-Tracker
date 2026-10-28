# WP8a: Settings: storage, Appearance, Defaults, Remarks

Repo copy (step 1): `docs/plans/2026-10-28-wp8a-settings.md`. Tier: Substantial (first half of
WP8; ~700–900 lines with tests, one session).

## Context
Roadmap § WP8 (`docs/plans/2026-10-16-v1-roadmap.md`) turns hard-coded defaults into settings on
a Settings page. Today `/settings` is a placeholder (`src/web/pages/Placeholders.tsx`), and the
`settings` table (`key TEXT PRIMARY KEY, value TEXT -- JSON`) has no keys or schema yet. The user
asked (2026-10-28) to keep only the simplest, cheapest settings, and agreed to this trim and
split ("Go ahead"):
- **WP8a (this plan)**: storage + Zod, then Appearance (theme, clock, speed), Defaults (start
  page, recap filter, trends filter, rolling window) and Remarks (master, mood line).
- **WP8b (next)**: the You (IDs, "That's me / Not me", empty-list warning) and Seasons tables,
  plus the sticky section list once those make the page long.
- **Dropped from v1, revisiting the 2026-10-16 "Settings page" decisions (§4: the user asked
  for simplest-first)**:
  - Headline comparison: it changes the baseline query (`pages.ts:103`), and remark triggers
    and their stored picks depend on that baseline.
  - Per-tier and per-trigger remark switches with the half-way state: the biggest UI and test
    cost, plus the re-pick logic.
  - Toast switch: the toast doesn't show over the full-screen game anyway.
  - Inline Undo on reset: a plain reset link is enough.
  - Theme preview cards → plain swatches.
  - Friends link → WP9 adds it.

Reference: variant A of `prototypes/settings-layout/settings-prototype.html` (branch
`prototype/settings-layout`): its defaults (`DEF`), its row copy, and its rolling-window
validation (5–100, "Use a whole number from 5 to 100.").

## Decisions (no fork the user needs; open to change at approval)
- **Settings and defaults** (`src/shared/schemas/settings.ts`, one Zod object, each field with
  `.default()`):
  | key | values | default |
  |---|---|---|
  | `theme` | carbon / slate / oled (the blocks in `tokens.css`) | carbon |
  | `clock` | 24h / 12h | 24h (prototype). This is a visible change: today the clock follows the browser locale. |
  | `speed` | kmh / mph | kmh |
  | `startPage` | recap / trends | recap |
  | `recapFilter` | everything / ranked / casual / extra / private | everything |
  | `trendsFilter` | same list | ranked |
  | `rollingWindow` | whole number 5–100 | 20 (`ROLLING_WINDOW`) |
  | `remarks` | bool | true |
  | `moodLine` | bool | true |
  The bare field schemas are defined once. `settingsSchema` adds `.default()` to each, and the
  patch schema is the bare fields with `.partial().strict()` and a refine for at least one key.
  This matters because in Zod 4 `.partial()` on a defaulted object still fills in the defaults,
  so every save would write the other keys back to their defaults.
  The default filters are group filters only, not single playlists. A single playlist would need
  the "played" list on Settings, and a default for one playlist is a niche choice.
  `SETTINGS_SECTIONS` (appearance / defaults / remarks → keys) lives in the same file. The page
  uses it for the reset link and its "Defaults" state.
- **API: `GET /api/settings`** returns the full object. **`POST /api/settings?key=value…`**
  saves a partial patch and returns the full object.
  - The patch goes in the query string, not a JSON body. Route handlers are synchronous
    (`RouteHandler = (ctx) => Response` in `api/index.ts`), and every value is a scalar. This
    matches the reroll POST.
  - The patch schema is strict (an unknown key is a 400), needs at least one key, and parses
    booleans with `z.stringbool()` and the window as a 5–100 whole number.
  - The existing request-header guard covers the POST.
  - Reset = POST the section's defaults. There's no reset endpoint and no row deletion.
- **Store** (`src/server/settings.ts`, `createSettings({ tracker, logger })` → `get()` /
  `save(patch)`):
  - One row per key, value as JSON. `save` upserts in one transaction.
  - `get` parses each row with its field schema. A bad JSON value, a value the schema rejects,
    or an unknown key logs `settings/bad_stored {key}` and falls back to the default, so a bad
    row can't break the dashboard.
  - `save` logs `settings/saved {changes}`.
- **The rolling window reaches the server as a parameter.** `periodParams` gets
  `window` (optional, 5–100, default `ROLLING_WINDOW`), `pages.period(spec, filter, window)`
  passes it to `rolling()`, and `usePeriod` puts it in the URL and query key. This keeps `pages`
  free of settings, and the cache is correct with no invalidation. The Trends texts that print
  20 (`trend-chart.ts:40,43,77,81` and `TrendChart.tsx:75,90`) take the window as an argument.
- **Web reads settings through one query** (`useSettings()`, key `["settings"]`,
  `data ?? DEFAULT_SETTINGS`) plus `useSaveSettings()`, which puts the response into the cache
  with `setQueryData`.
  - Save race: `match_ended` and reconnects refetch every non-session query, `["settings"]`
    included (`invalidation.ts:26`). So `onSuccess` first runs `cancelQueries(["settings"])`,
    then `setQueryData`, so a GET already in flight can't put back the old value. (Addendum,
    review: the reroll does `setQueryData` then `invalidateQueries`, so it isn't the same pattern;
    and after review a match no longer refetches settings, only a reconnect does.)
  - App gate: `App` shows `Loading` until the first settings fetch settles, so the start page,
    the default filters and the theme are right on first render.
  - If the fetch fails, the app runs on defaults and logs `[rlt] settings/load_failed`.
  - There's no React context: the query cache is the shared store.
- **Theme**:
  - An effect in `App` sets `<html data-theme>` and mirrors the value to `localStorage`
    (inside try/catch). It runs **only once the settings query has succeeded**. On a failed
    GET, the stored mirror stays in place rather than being overwritten with carbon.
  - A 3-line inline script in `index.html`'s `<head>` applies the mirror before the first
    paint, so there's no carbon flash. There is no CSP to block it. The share card is DOM drawn with the CSS tokens, so it follows
  the theme for free; the e2e checks that.
- **Clock and speed** go to the formatters as arguments, not as module state:
  - `clock(ms, hours, locale?)`, with `hourCycle` set to `h23` for 24h and `h12` for 12h.
  - A new `speedText(kmh, unit)` in `format.ts`, with mph = km/h × 0.621371 and the same
    rounding as each call site uses today. (Addendum, as built: `speedIn(kmh, unit)` converts and
    `SPEED_LABEL` names the unit; each caller rounds and joins them, as the rounding differs per site.)
  - Callers: `goal-map.ts:71`, `recap.ts:130` (the tile's `unit`), `recap.ts:230`,
    `remarks.ts:11–12` (`fillRemark`), `share-card.ts:64,88`, `timeRange` (`format.ts:22`)
    and its callers in `SessionPicker.tsx:79,141`, and the `clock(...)` calls in
    `Matches.tsx`, `MatchView.tsx` and `Overview.tsx`.
  - 12h output varies by locale ("9:04 PM" in en-US, "09:04 pm" in en-GB). Unit tests pass an
    explicit locale, and the e2e matches am/pm case-insensitively.
  - The pure logic gets a `units: { clock, speed }` argument, and components pass in
    `useSettings()`.
- **Default filters**:
  - `parseFilter(raw, fallback = "everything")`: a missing or bad value gives the fallback.
    `PlaylistFilter.tsx:12` always parses a real option, so it keeps the default. Recap passes
    `recapFilter` and Trends passes `trendsFilter` (this replaces the `DEFAULT_FILTER` constant
    in `logic/trends.ts`).
  - `recapPath` and `trendsPath` **always write `?filter=`**. Today they leave out the
    hard-coded default (`recap.ts:183`, `trends.ts:108`). With a setting, an omitted
    "everything" would read back as a ranked default. Bare `/recap` and `/trends` (header tabs,
    the start page) are the only filter-less URLs, so they mean "your default".
- **Start page**: `/` → `<Navigate to={'/' + startPage} replace>`.
- **Remarks**: both switches only change what the dashboard shows.
  - Master off: neither `Overview`'s `Remarks` nor the share card fetches remarks (`useRemarks`
    gains `enabled`), so no first-view pick is written.
  - Mood line off: the mood text is hidden on the recap and the share card. ↻ moves next to the
    quip. With no quip either, nothing renders.
  - The stored picks are untouched, so switching back on shows the same lines.
- **Page layout** (`src/web/pages/settings/SettingsPage.tsx` + module CSS, replacing the
  placeholder):
  - One column of three sections, each with an h2 and a "Reset to defaults" link (it reads
    "Defaults" as plain text when nothing has changed). No sticky list: the three sections fit
    about one screen, and WP8b adds the list.
  - Rows: label and help text on the left, the control on the right; they stack below 768px.
  - Controls are native:
    - Theme: three radio inputs drawn as swatches.
    - Clock, speed and start page: radio groups drawn as segmented buttons (arrow keys come
      free).
    - Filters: `<select>`.
    - Window: `<input type=number>`.
    - Remarks: checkboxes with `role="switch"`.
    - Mood line: disabled while the master is off; its value is kept.
  - Save state per row in a `role="status"` span: "✓ Saved", which fades after about 2 s, or
    "Couldn't save · Retry". Retry resends the same patch.
  - Saves aren't optimistic: the control shows the stored value, and on the local server the
    round trip is milliseconds.
  - Logs: `[rlt] settings/save_failed {keys, code}`.

### Interaction contract
| Trigger | What shows | Focus |
|---|---|---|
| Pick a swatch / segment / select option | POST; on success the value is stored, the row shows "✓ Saved", and the theme applies at once | stays on the control |
| Save fails | Control shows the old value; the row shows "Couldn't save · Retry" | stays |
| Retry | Resends the patch; the result is shown as above | Retry disappears while the save runs (a few ms locally); on success focus moves back to the row's control. |
| Window: type, then Enter or blur | Valid and changed: saves. Invalid: "Use a whole number from 5 to 100." under the input, `aria-invalid`, nothing sent. Esc restores the stored value. | stays in the input |
| Remarks master off | Mood line greyed and disabled, value kept | stays |
| Reset to defaults | POSTs the section's defaults; "✓ Saved" next to the h2; the link becomes "Defaults" | moves to the section's h2 (`tabIndex=-1`) |
| Reload | Values come from the server; the theme comes from the mirror, so there's no flash | — |
| Settings GET failed | The page shows `EmptyState` "Couldn't load your settings" with Retry; other pages run on defaults; the theme keeps the stored mirror | Retry |
| Slow first load | App-level `Loading` | — |
| Back/Forward | Settings has no URL state | — |

## Approach and files
- New: `src/shared/schemas/settings.ts` (+test), `src/server/settings.ts` (+test),
  `src/web/pages/settings/SettingsPage.tsx` + `Settings.module.css`, `src/web/logic/settings.ts`
  (+test: the section-at-defaults check and window-draft validation),
  `test/e2e/settings.spec.ts`.
- Changed:
  - Server: `api/index.ts` (two routes), `schemas/params.ts` (`window`), `api/pages.ts`
    (`period` and `rolling` take the window).
  - Web wiring: `queries.ts` (`useSettings`, `useSaveSettings`, `usePeriod` window,
    `useRemarks` enabled), `App.tsx` (gate, start page, theme effect), `index.html` (the
    inline theme script).
  - Formatting and links: `logic/format.ts`, `filter-options.ts`, `trends.ts`, `recap.ts`,
    `remarks.ts`, `goal-map.ts`, `share-card.ts`, `trend-chart.ts`.
  - Pages: `Overview.tsx`, `ShareCard.tsx`, `TrendChart.tsx`, `RecapPage.tsx`,
    `TrendsPage.tsx`, `Matches.tsx`, `MatchView.tsx`, `SessionPicker.tsx`.
  - e2e: the recap URL assertions in `recap.spec.ts` and `shell.spec.ts`, which now end in
    `?filter=…`.
  - Delete `SettingsPage` from `Placeholders.tsx`.
- Reuse: `parse`/`ok` and the header guard (`api/index.ts`), `postJson` (`api.ts`), `Loading`,
  `EmptyState`, the tokens, and `filterLabel` for the select labels.

## Steps
1. Save this plan to `docs/plans/2026-10-28-wp8a-settings.md`. In the roadmap, split § WP8 into
   WP8a/WP8b and record the dropped items with the date and reason. Update the BACKLOG roadmap
   item and the "WP8 remarks settings" item (per-tier and per-trigger are now deferred, with
   the clock/speed part done here). In the toast item, record that there's no toast switch in
   v1. Annotate the features map's "Settings page" and "Settings layout" decisions
   (`2026-10-15-rl-tracker-features-map.md:327-385`): each dropped or deferred item gets a
   "revisited 2026-10-28, simplest-first (user)" note.
2. TDD the schema:
   - Defaults.
   - Each field's bad values (window 4, 101, "2.5", "x").
   - stringbool.
   - An unknown key is rejected, and so is an empty patch.
   - **A one-key patch parses to exactly that one key.**
3. TDD the store:
   - An empty table gives the defaults; save then get.
   - **Saving `{speed}` leaves `theme` as it was.**
   - Bad JSON, a rejected value and an unknown key each fall back to the default and log
     `bad_stored` (read the real line once).
   - A save is one transaction.
4. Routes:
   - `api.test.ts` covers GET, a POST that round-trips, 400 on a bad value, and 403 without
     the header.
   - Window: `window` goes into each branch of the `periodParams` union. `params.test.ts` gets
     two cases, one with `window` and one without (`parseTrends` reuses the schema).
     `pages.test.ts` gets a case where a window of 5 gives the first point at match 5.
5. Web logic, TDD:
   - `clock` in 12h and 24h; `speedText` in km/h and mph.
   - `fillRemark`, `goal-map`, recap tiles and the share card with mph and 12h.
   - `parseFilter` fallback.
   - `trendsPath` and `recapPath` always write the filter.
   - Trend texts with the window argument.
   - The `logic/settings.ts` helpers.
   Update the existing URL assertions.
6. Wiring: queries, App gate, start page, theme effect and mirror, Recap and Trends defaults,
   remarks switches on Overview and the share card.
7. Settings page per the layout and interaction contract.
8. e2e. Update the existing recap URL assertions for `?filter=`. `settings.spec.ts` uses
   **its own seed value**, so it gets its own worker stack and data dir: the stack is keyed by
   seed (`fixtures.ts:24,80`), so the settings it writes can't leak into
   `shell`/`trends`/`share`. Cases:
   - Each setting saves and survives a reload.
   - The theme sets `data-theme`, and the share card follows it.
   - 12h shows am/pm on the recap; mph on the hardest-shot tile.
   - Start page trends: `/` lands on `/trends`.
   - The recap and trends defaults apply on bare URLs, and an explicit `?filter=everything`
     still wins.
   - Window 10 changes the By-match note; an invalid window shows the error and sends nothing.
   - Remarks off hides the headline lines; mood off hides only the mood line.
   - A failed save shows Retry (route intercept). Retry then succeeds, and focus moves back to
     the row's control.
   - Mood off on a session with no quip shows no headline lines.
   - Reset moves focus to the h2.
   - axe per theme, and a run at 320px.
9. `bun run check`, `bun run e2e`. Browser pass via `/run`: keyboard-only, 320/768/1024/1440,
   every state in the contract, no console errors.

## Verification
- `bun run check` green, with the new and updated cases in the schema, store, api, params,
  pages, format, remarks, recap, trends, trend-chart, share-card and settings tests.
- `bun run e2e` green, including `settings.spec.ts`, axe on all three themes, and 320px.
- The browser pass in step 9. After `bun run deploy`, the user checks the real DB: change each
  setting, reload, and see it apply.
- Done when: every WP8a setting saves, persists across reload, and changes what its page shows.

## Plan review
plan-reviewer (opus), 2026-10-28. Every finding was folded in:
1. High: `.partial()` on a defaulted Zod object fills in the defaults, so each save would
   reset the other keys. Fixed with bare field schemas and a patch built from them, plus
   step 2/3 cases.
2. High: the e2e stack is shared per seed, so settings would leak into other specs. The
   settings spec now uses its own seed.
3. Med: about 17 e2e recap URL assertions break with an always-written `?filter=`. Now listed
   in the files and step 8.
4. Med: on a failed GET, the theme effect would overwrite the mirror with carbon. Now applied
   only after success.
5. Med: a refetch already in flight could undo a save. Now `cancelQueries` before
   `setQueryData`.
6. Med: `timeRange`/`SessionPicker` and `PlaylistFilter`'s `parseFilter` were missing. Now
   added.
7. Low: a carbon flash before the deferred module runs. Fixed with an inline head script.
8. Low: the features map holds the revisited decisions. Step 1 now annotates it.
9. Low: 12h output varies by locale. Unit tests pin a locale, and the e2e matches
   case-insensitively.
10. Low: missing test seams (Retry focus, mood off with no quip, `window` optional in the
    union). Now added.

## Review log
Tier: Substantial (design tier; ~660 non-test lines). Snapshots: round 1 `e8c4246`, round 3 `6a86731`.

**Round 1**: code-review high, arch-reviewer (opus), security-reviewer, /simplify (4 angles).
- [Fixed] `WindowInput` was keyed by the stored value, so a save on Enter remounted it and focus
  fell to `<body>` (code-review, arch). It now keeps one element and resyncs its draft from the
  settings; e2e asserts focus after Enter.
- [Fixed] Two overlapping saves could land out of order and the older whole-object answer would
  win in the cache (code-review, arch; the race asked about at step 9). `scope: { id: "settings" }`
  runs settings saves one at a time.
- [Fixed] A failed window save left the typed draft showing (code-review, arch). It reverts to the
  stored value; e2e covers it.
- [Fixed] A failing `/api/settings` held every page on "Loading" through the default retries.
  The settings query has `retry: false`.
- [Fixed] `staleAfter` refetched settings after every match; settings are now spared (unit test).
- [Fixed] `TrendChart` read the window from settings itself; `TrendsPage` passes it as `size`.
- [Fixed] The group filter list was declared twice; `groupFilter` is exported and used by
  `filterParam` and the Settings select. Speed labels use `SPEED_LABEL`.
- [Fixed] `periodParams`' common fields are one `common` object; `pages.period`'s window is
  required (one default, in the schema).
- [Fixed] Stale comments: `clock()` in `format.ts`, `rolling` in `responses.ts`.
- [Fixed] Plan text: the reroll isn't the same pattern; `speedIn` + `SPEED_LABEL` as built; the
  Retry focus row of the contract.
- [Verified, no fix needed] Enter then blur before the answer sends a second identical POST:
  idempotent, and now serialised.
- [Verified, no fix needed] (/simplify) the app gate adds one local round trip before page
  queries: deliberate, so the start page and default filters are right on first render. A window
  change refetches whole periods: only on a settings edit. `save()` re-reads the table: under 15
  rows. `useSettingsQuery` called three times in `App`: cache reads. A `ChoiceRow` helper, shared
  retry plumbing, the double remarks gate, the `Remarks` controls branch, `parseWindow`'s shape,
  `patchQuery` vs `periodQuery`, a second filter `<select>` next to `PlaylistFilter`: judgment
  calls with little gain. A `staleTime` opt-out instead of the predicate branch:
  `invalidateQueries` ignores `staleTime`.
- Security: no issues.

**Round 2** (delta from `e8c4246`): code-review low, arch-reviewer (sonnet), security-reviewer.
- [Fixed] The draft resync keyed on `dataUpdatedAt`, which also moves on a refetch with nothing
  new, so a reconnect could wipe a draft being typed (code-review). It keys on the settings
  object's identity; structural sharing keeps it on an unchanged refetch.
- [Fixed] Nit: the `invalidation.ts` header comment re-wrapped.
- Security: no issues.

**Round 3** (delta from `6a86731`: `WindowInput` only): code-review low, security-reviewer.
- [Escalated to the user] Any other setting's save gives the settings a new identity, so an
  invalid window draft left in the field snaps back to the stored value, its error cleared.
  Third finding on the window draft's sync (rounds 1–3), so it goes to the user per the stop
  rule. Recommendation: keep it (the draft was never saved; the page's rule is "controls show the
  stored value").
- Security: no issues.

Tests after the last edit: `bun run check` green (80 files, 1005 tests); settings.spec 10 passed;
full `bun run e2e` 49 passed (run before the round-2 resync fix; settings.spec rerun after it).
