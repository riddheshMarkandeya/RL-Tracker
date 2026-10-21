# WP5b-a: the web shell

## Context
WP5a-b shipped the dashboard API (`src/server/api/`, schemas in `src/shared/schemas/`). There is
no web app yet: no `src/web/`, no Vite/React, and the tracker answers pages with "dashboard not
built". Roadmap `docs/plans/2026-10-16-v1-roadmap.md` → "WP5b: Web shell". Tier: Substantial (new
module, new stack, UI). WP5b (~1,200 lines) is split, as the user chose:
- **WP5b-a (this plan)**: the stack and tooling, the themes, the router and header, TanStack
  Query plus one SSE stream shared across tabs, the empty-state component, Vitest on the logic,
  checked in a real browser through the Vite dev proxy against a replay.
- **WP5b-b (next, its own plan)**: a Playwright harness against a seeded temp DB plus a replay
  (the roadmap's done-criterion as an automated smoke, plus axe), `vite build` in `deploy`, the
  installed `dist` path (`staticDir()` default; today only `RLTRACKER_STATIC_DIR`), the Start menu
  shortcut.

## Constraints that bind this plan
- Roadmap scope: Vite, React, TS; React Router with real paths and filters in the query string;
  TanStack Query refetching on "match ended"; a global stylesheet of theme tokens (carbon default)
  plus CSS Modules; a header with tabs Recap / Trends / Settings, a status indicator, a "This
  session: W–L" chip, a "Start new session" button and Quit; a shared empty-state component;
  Vite's dev proxy for `/api`.
- **User decisions (2026-10-21)**:
  - Themes: only **carbon (default), slate, oled** for now. This revises the map's 7 ("Recap layout").
    The other 4 go to a BACKLOG item. Each is one CSS line plus the tests below, so adding one back is cheap.
  - Sharing the stream: a **SharedWorker** owns the one `EventSource` and fans out to the tabs, with an
    in-page fallback when `SharedWorker` is undefined. This closes the BACKLOG item from WP5a-b's review.
  - "Start new session": an **inline two-step** confirm ("Start new session? Yes · Cancel", reverts
    after ~5 s, no modal), disabled when there's no current session.
- API contract (exists, don't change): `GET /api/events` SSE named events `status`
  (`statusSchema`), `match_ended {guid, sessionKey}`, `session_break {at}`, heartbeat comments;
  the server sends `status` at once on connect. `GET /api/sessions/current?filter=` →
  `{session: SessionSummary|null}`. `POST /api/sessions/break` needs `X-RLTracker-Request: 1`
  (`REQUEST_HEADER`, `src/server/api/index.ts:32`). `POST /api/shutdown` needs
  `X-RLTracker-Shutdown: 1` (`SHUTDOWN_HEADER`, `src/server/host.ts:7`). `/api/*` returns 503
  `{error:"starting"}` before mount.
- Map: header status labels "waiting for game", "connected", "recording match", "Stats API off"
  ("Background program form"); the browser never opens by itself; the "Live running total" is the
  header chip plus refetch on "match ended"; no fake zeros. Settings has no Quit, since the header has one.
- Visual reference: `prototype/settings-layout:prototypes/settings-layout/settings-prototype.html`
  (header `:249-262`, header CSS and theme tokens `:41-75`), `prototype/recap-layout` (`.empty`, `:105`).
- Cross-cutting: loopback only; strict TS + typescript-eslint strict; pages read the API only.

## Approach

### 1. Tooling
- Deps: `react`, `react-dom`, `react-router` (v7, library mode: `BrowserRouter`), `@tanstack/react-query` v5.
  Dev: `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `eslint-plugin-react-hooks`,
  `globals`. Pin with `bun add`, using versions at least two weeks old.
- `vite.config.ts` at the repo root:
  - `root: "src/web"`, `build.outDir: "../../dist"`, `emptyOutDir: true`. `dist/` is already
    gitignored and eslint-ignored.
  - `worker: { format: "es" }`, for the module SharedWorker.
  - `server.host: "127.0.0.1"`: loopback only, and it avoids a `localhost` that resolves to `::1`
    alone on Windows.
  - Port `5173`, `strictPort`.
  - `server.proxy["/api"]` → `http://127.0.0.1:49101` (the `bun run dev` tracker), with
    `changeOrigin: true` so the Host check sees `127.0.0.1:49101`.
  - Add `vite.config.ts` to the root tsconfig `include`, next to `vitest.config.ts`.
- Scripts: `web:dev` = `vite`, `web:build` = `vite build`. Vite runs on Node (the shebang), not
  `--bun`. That's the same split as Playwright's (decision `2026-10-16-bun-runtime.md`).
- TS:
  - `src/web/tsconfig.json` extends the root and sets its own `include: ["."]` and `exclude: []`. It
    must set both, because `include` and `exclude` are inherited, resolved against the root's folder.
  - It adds `lib: [ESNext, DOM, DOM.Iterable, WebWorker]`, `jsx: react-jsx` and
    `types: ["vite/client"]`. No bun types, so a server import in the bundle is a type error.
  - The root `tsconfig.json` excludes `src/web`.
  - `typecheck` and `check` run `tsc --noEmit && tsc --noEmit -p src/web`. Step 2 confirms the web
    project actually checks files, with a deliberate type error once.
- ESLint: a `src/web/**` block with browser globals and `react-hooks` recommended. projectService
  picks up the web tsconfig. Check that the plugin's peer range covers ESLint 10 before adding it.
  If it doesn't, leave it out and record why.
- Vitest: unchanged (node env). Web tests cover pure logic only, so there's no jsdom. Rendering is
  WP5b-b's Playwright job.

### 2. Themes (`src/web/styles/`)
- `tokens.css`: `:root` holds the shared tokens from the prototype (blue, orange, win, loss, up, down,
  flag, `--r`, `--s1…s6`). Then one **full** block per theme, `:root[data-theme=carbon|slate|oled]`,
  with page, surf, surf2, line, grid, ink, ink2, muted and accent. Slate gets its own block, since the
  prototype leaves it implicit in the base. `index.html` ships `<html data-theme="carbon">`; choosing a
  theme is WP8's Settings.
- `global.css`: the prototype's base (`body`, `:focus-visible` in accent, `.num` tabular). Font is the
  system stack (`"Segoe UI", system-ui, sans-serif`). No Google Fonts link: local-only, so nothing
  fetched from outside. WP6a decides number fonts (e.g. a self-hosted Barlow).
- Components use CSS Modules (`*.module.css`).

### 3. App shell (`src/web/`)
- `main.tsx`: `QueryClientProvider` (`staleTime: Infinity`, `refetchOnWindowFocus: false`, since
  freshness comes from SSE, plus a full invalidate on every stream reopen; see §4), `BrowserRouter`, `<App/>`.
- `App.tsx`: `<Header/>`, then routes `/` → `<Navigate to="/recap">`, `/recap`, `/trends`, `/settings`,
  `*` → not found. Each page is a placeholder with `<EmptyState>` ("Recap arrives with the next update"
  style copy, nothing faked). Filters in the query string are each page's job (WP6a+); tab links carry
  no query string, since filters are page-specific.
- `components/Header.tsx` (+ module CSS), laid out like the settings prototype:
  - Left: brand, then `topnav` with `NavLink` Recap, Trends (aria-current via NavLink).
  - Right: status, session chip, Start new session, Settings (a `NavLink` styled `hbtn`, for
    `aria-current`), Quit (`hbtn`).
- `components/StatusBadge.tsx`: dot plus label from `statusLabel()` (§5). Wrapped in `role="status"`
  so screen readers announce changes.
- `components/SessionChip.tsx`: `useQuery(["sessions","current","everything"])` →
  "This session: 4–2". Hidden when `session` is null or the query fails (no fake zeros).
- `components/StartSessionButton.tsx`: an inline two-step. State `idle | confirming | sending`.
  Confirming shows "Start new session?" with Yes and Cancel, and focus moves to Yes. Escape or ~5 s
  reverts it. Yes sends the POST with the header. On success, invalidate `["sessions"]`; the SSE
  `session_break` does the same in other tabs. On failure, an inline "Couldn't start a new session"
  for 5 s, plus a console line. Disabled with a tooltip when the chip has no session.
- `components/QuitButton.tsx`: the same two-step pattern ("Quit tracker? Yes · Cancel"; Quit stops
  recording). It shares one `ConfirmButton` component with the start button (DRY). When Cancel, Escape
  or the timeout ends the confirm, focus returns to the trigger. On 202, this tab sets `stopped`, and
  the header shows "tracker stopped" instead of "tracker not running". `stopped` clears on the next
  `link: open`, for example when the tracker is started again.
- `components/EmptyState.tsx`: `{title, children?}`, styled from the prototype `.empty` (centred,
  `--s6` padding, `--ink2`).
- `api.ts`: `getJson(path, schema, fetchFn = fetch)` fetches and parses with the shared Zod schema.
  It throws `ApiError(status, body)` on a non-2xx and on a parse failure, and logs a console line
  tagged `[rlt]` with the path and the Zod issue paths. `post(path, headers)` sends writes.
- `REQUEST_HEADER` (`src/server/api/index.ts:32`) and `SHUTDOWN_HEADER` (`src/server/host.ts:7`)
  move to `src/shared/constants.ts`, and the server imports them from there. Their current modules
  pull in `node:fs` and `bun`, so the browser can't import them.

### 4. Live events (`src/web/events/`)
- `hub.ts` (pure, TDD'd): `createHub({ openSource, setTimer })` manages one source and many ports.
  - `connect(port)`: adds the port and opens the source on the first port. It replays the latest
    `status` and the current `link` state (`connecting | open | down`) to the new port.
  - On a source message: validate with `sseEvents[name]` (`src/shared/schemas/responses.ts:197`),
    drop a bad payload with a console warn, and post each event to every port.
  - `open` → `link: open`. `error` → `link: down`.
  - **Reconnect is the hub's job.** `EventSource` gives up for good after an HTTP error status
    (`src/server/api/events.ts:17-18`). That covers the tracker's 503 `starting` window
    (`host.ts:59`) and a 5xx from Vite's proxy while the tracker is down. So when `error` finds the
    source `CLOSED`, the hub closes it and reopens after a backoff (1 s doubling, capped at 10 s,
    reset on `open`). An `error` with `CONNECTING` is left to the browser's own retry.
  - No `disconnect`. The worker dies when its last tab closes, which closes the source. A dead port
    only costs a no-op `postMessage`. That keeps us clear of the back/forward-cache trap a
    `pagehide` "bye" would set.
  - Port, source and timer are tiny interfaces (`postMessage`; `readyState`, `addEventListener`,
    `close`; `setTimer`), so the tests use fakes and no DOM.
- `worker.ts` (SharedWorker entry): `onconnect` → `hub.connect(e.ports[0])`.
- `client.ts`: `subscribe(onMessage)`.
  - It uses `new SharedWorker(new URL("./worker.ts", import.meta.url), {type: "module", name: "rlt-events"})`
    when `typeof SharedWorker !== "undefined"`.
  - Otherwise it builds the same hub in the page with a `MessageChannel` port. It logs which path
    it took, once, tagged `[rlt]`.
- `useLiveEvents()` (in `App`): wires messages into the query cache.
  - `status` → `setQueryData(["status"], s)`.
  - `link` → `setQueryData(["link"], l)`. On `open` after a `down`, it runs `invalidateQueries()`:
    events sent while the stream was down are lost, and a query that failed on the startup 503
    would stay failed under `staleTime: Infinity`. It also clears `stopped`.
  - `match_ended` → `invalidateQueries()` (every page's data can move).
  - `session_break` → `invalidateQueries({queryKey: ["sessions"]})`.
  - The status and link queries use `enabled: false` with the cache as their store, so there's no
    `/api/status` fetch. The stream sends `status` on connect.

### 5. Pure logic (TDD'd)
- `statusLabel({link, status, stopped})` → `{label, tone}`, where tone is `ok | busy | warn | off`.
  Precedence: stopped → "tracker stopped"; link down → "tracker not running"; no status yet →
  "connecting…"; `statsApiOff` → "Stats API off"; `configProblems.length` → "setup problem" (warn;
  the details are Settings' job); else by `connection`: waiting → "waiting for game", connected →
  "connected", recording → "recording match".
- `chipText(summary)` → `"This session: 4–2"` or null.
- `confirmMachine` (the two-step's reducer: click, confirm, cancel, timeout, sent, failed).

### Logging (web)
There's no server logger in the browser. Console lines tagged `[rlt] <event>` answer: did the
stream connect, and through which path (worker vs in-page)? Which API call failed, with what
status or Zod issue paths? Did a break or quit POST fail? The server side is already logged
(`api/sse_open`, `api/session_break`, `api/write_rejected`).

### BACKLOG
- New: **[design, Low, Trivial]** add back the themes midnight, dusk, steel, daylight (values in the
  `prototype/settings-layout` tokens). Daylight is the one with a real cost: every chart is checked in
  light mode.
- Close: the WP5b "share one `/api/events` stream" item.
- Next pointer → WP5b-b.

## Files
- New: `vite.config.ts`; `src/web/{index.html, main.tsx, App.tsx, api.ts, tsconfig.json}`;
  `src/web/styles/{tokens.css, global.css}`; `src/web/components/{Header, StatusBadge, SessionChip,
  ConfirmButton, StartSessionButton, QuitButton, EmptyState}.tsx` (+ `.module.css` where styled);
  `src/web/pages/{Recap, Trends, Settings, NotFound}.tsx` (placeholders);
  `src/web/events/{hub, worker, client, useLiveEvents}.ts`; `src/web/logic/{status, chip,
  confirm}.ts`. Tests: `hub.test.ts`, `api.test.ts`, `status.test.ts`, `chip.test.ts`,
  `confirm.test.ts`, `src/web/styles/tokens.test.ts`.
- Changed: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/shared/constants.ts`
  (the two header constants), `src/server/host.ts` and `src/server/api/index.ts` (import them) plus
  any tests that import them from the old places,
  `docs/plans/2026-10-16-v1-roadmap.md`, `BACKLOG.md`, `PROJECT_INDEX.md`.

## Test seams
- `hub.ts` via `connect` with a fake source, ports and timer:
  - replay to a late joiner, fan-out and the validation drop;
  - link states;
  - error on a `CLOSED` source → reopen after backoff, with the backoff growing and resetting on `open`;
  - error while `CONNECTING` → no reopen of its own;
  - a 503-style close during startup recovers.
- `api.ts` with a fake fetch: 2xx parsed; non-2xx → `ApiError`; a schema mismatch → `ApiError` plus a log.
- `statusLabel`, `chipText`, `confirmMachine`: pure functions, expected values from the map's labels;
  `stopped` precedence.
- `tokens.test.ts` reads `tokens.css?raw` (Vite's raw import, so no Node types in the web project):
  - the 3 themes define the same token names;
  - WCAG contrast of `ink` and `ink2` on `page`, `surf` and `surf2` is ≥ 4.5, and `muted` on `surf` is ≥ 4.5;
  - the accent against `surf` is ≥ 3, as a UI component.

  A failing value is reported to the user, not silently changed.
- Rendering and the worker in a real browser: the live-verification steps below (WP5b-b automates them).

## Steps
1. Save this plan to `docs/plans/2026-10-21-wp5b-a-web-shell.md`. Roadmap: split WP5b into a/b
   with status lines and the themes revision. BACKLOG Next pointer.
2. Tooling: deps, Vite config, web tsconfig, ESLint block, scripts. Move the two header constants
   to `src/shared/constants.ts`. A minimal `main.tsx` renders "RL Tracker". Green bar:
   - `bun run check` passes;
   - a deliberate type error in `src/web` fails `tsc -p src/web`;
   - `vite build` emits `dist/`;
   - `web:dev` shows the page.
3. TDD `tokens.css` (`tokens.test.ts` red first), then `global.css`.
4. TDD `statusLabel`, `chipText`, `confirmMachine`.
5. TDD `hub.ts`; then `worker.ts`, `client.ts`, `useLiveEvents`.
6. `api.ts`, the header components, the pages, `EmptyState`.
7. `bun run check` green. `vite build` again: `dist/` holds a separate ES worker chunk. Live
   verification (below). The `/compact` line. Then
   `independent-review-pass` (with the security pass, since it adds the browser's POSTs to the
   tracker).
8. Docs per `documentation-backlog-hygiene` (the ADR gate for the SharedWorker and the theme cut),
   PROJECT_INDEX, roadmap status, BACKLOG.

## Verification
- `bun run check` green, with each new suite red first.
- Live, written down in the plan's Verification section. Run `bun run dev` with
  `STATS_API_URL=ws://127.0.0.1:49130` and
  `bun run scripts/replay.ts test/fixtures/completed.ndjson --speed 20 --port 49130`, plus
  `bun run web:dev`. Precondition: `.dev-data` has the fixture's player as a configured "you".
  Otherwise the match has no result and the chip stays hidden, which is correct but looks like a
  bug. Then in Chrome (Claude in Chrome), at `http://127.0.0.1:5173/`:
  - `/` goes to `/recap`; the tabs navigate with aria-current; reloading `/trends` works.
  - The status walks "connecting…" → "connected" → "recording match" → "connected" during the
    replay. The chip appears after `match_ended` with no reload. No console errors.
  - Open 7 tabs: the network panel shows one `/api/events` stream in total. A second tab joining
    late shows the current status at once.
  - Start new session: the two-step; a timeout reverts; Yes → the chip disappears in **both** tabs
    (`session_break`).
  - Stop the dev tracker: "tracker not running". Restart it: within about 10 s it recovers by
    itself, through the proxy's 5xx and the 503 `starting` window, and the chip refetches.
  - Quit: "tracker stopped", and the tracker process exits. Start it again: that tab returns to
    the live status.
  - Navigate away and press Back: the page still gets events.
  - Keyboard-only pass over the header (tab order, Escape cancels the confirm, focus visible).
    Widths 320, 768, 1024 and 1440: the header wraps without horizontal scroll. Each of the 3 themes,
    via devtools `data-theme`.
- Residual for the user: subjective look of the header against the prototype.

## Plan review
Run by the `plan-reviewer` agent (opus), 2026-10-21. Findings and how each was handled:
1. High: EventSource never retries after an HTTP error status (503 `starting`, the proxy's 5xx).
   **Fixed**: the hub reopens on a `CLOSED` error with a backoff; hub tests added.
2. High: the web tsconfig inherited the root `exclude`, so it would check nothing. **Fixed**: its
   own `include`/`exclude`, a deliberate-error check, and `vite.config.ts` in the root include.
3. Med: data stays stale after an outage. **Fixed**: invalidate everything on a reopen.
4. Med: "tracker stopped" never clears. **Fixed**: cleared on `link: open`.
5. Med: the worker build was never checked. **Fixed**: `worker.format: "es"`, plus `vite build`
   again at step 7.
6. Med: a `pagehide` "bye" breaks back/forward-cache restores. **Fixed differently**: no
   disconnect at all; the worker's lifetime handles the cleanup.
7. Med: Vite's `localhost` can resolve to `::1` alone. **Fixed**: `server.host: "127.0.0.1"`.
8. Med: the header constants aren't browser-safe. **Fixed**: they move to `src/shared/constants.ts`.
9. Low: `node:fs` in `tokens.test.ts`. **Fixed**: `?raw` import.
10. Low: `api.ts` had no seam. **Fixed**: `api.test.ts` with a fake fetch.
11. Low: focus return and Settings `aria-current`. **Fixed**.
12. Low: `emptyOutDir` and the react-hooks peer range. **Fixed**, with a check at install.
13. Low: the chip's precondition in the live check. **Fixed**: stated in Verification.

## Implementation notes
- Versions at least two weeks old: react/react-dom 19.3.0, react-router **8.4.0** (v8 replaced v7
  since the plan was written; library mode with `BrowserRouter` is unchanged), @tanstack/react-query
  5.104.1, vite 8.3.3, @vitejs/plugin-react 6.1.2, eslint-plugin-react-hooks 7.1.1 (peer range covers
  ESLint 10), globals 17.13.0.
- Vitest needs `css: true`: without it a `?raw` CSS import is an empty string.
- The header's live state (link, status, stopped) is a small `useSyncExternalStore` store
  (`events/live.ts`), not `enabled: false` queries. It is pushed, never fetched, and keeping it out of
  the query cache lets "invalidate everything" stay safe.
- `statusLabel`: a setup problem replaces only "waiting for game". Found live: the dev tracker reports
  `web_port_mismatch` under a replay, and a problem that hid "recording match" while data flowed
  would be wrong. Test added.
- The chip also hides a session with no W–L yet (every result null), rather than show 0–0.
- Files merged against the plan's list: `components/HeaderActions.tsx` holds both header actions,
  `pages/Placeholders.tsx` the four placeholder pages. `components/queries.ts` (the current-session
  query) and `components/cx.ts` (a class joiner; CSS Module classes are typed `string | undefined`)
  are new. The browser wiring for the hub is `events/browser.ts`.
- `client.ts` falls back to the in-page hub if the SharedWorker fails to load, so the header can't
  stick on "connecting…".
- Dev proxy, two fixes found live:
  - The key is `/api/`. A bare `/api` prefix also proxied the module `/api.ts`, and the page
    rendered blank.
  - When the tracker dies, the proxy kept the browser's stream open and silent, so the header still
    said "connected". `configure` now ends the browser side when the upstream response closes, which
    matches what the real tracker gives.

## Verification (2026-10-21)
- `bun run check`: 60 files, 712 tests green at the end of implementation (719 after review). Each new suite was red first. A deliberate type error in
  `src/web` fails `tsc -p src/web`.
- `vite build`: `dist/` holds `index.html`, the app chunk, CSS, and a separate `worker-*.js` chunk.
- Live, in Chrome via Claude in Chrome, against a scratch copy of `.dev-data` with its earlier break
  cleared, plus the `completed.ndjson` replay at 20x:
  - `/` → `/recap`. Deep links `/trends`, `/settings` and an unknown path (the not-found note) all work.
  - The status went "setup problem" (waiting + `web_port_mismatch`) → "recording match" →
    "connected". After `match_ended` the chip showed "This session: 0–1" with no reload.
  - A tab opened mid-match showed "recording match" at once.
  - Seven tabs: the tracker log shows one `sse_open` (subscribers 1), and a fetch from the 7th tab
    answered 200.
  - Start new session:
    - the click shows the confirm with focus on Yes;
    - after 5 s it reverts, with focus back on the trigger;
    - Enter then Escape cancels;
    - Enter, Enter sends: `session_break` is logged, and the chip went away and the button disabled
      in both tabs.
  - Tracker killed: "tracker not running" in every tab. Restarted: live again within 10 s with no
    reload.
  - Quit:
    - the confirm, then the tracker exited 0;
    - that tab showed "tracker stopped" and the others "tracker not running";
    - after a restart, the stopped tab returned to live.
  - Leaving to another site and going Back: the page reloads (not served from the back/forward
    cache) and is live again.
  - Widths 320, 768 and 1024 in same-origin iframes: no horizontal scroll. At 320 the header wraps to
    three rows (140 px). The window couldn't be resized (maximized), so 1440 is covered by the
    1536 px window.
  - carbon, slate and oled all render.
- Residual for the user:
  - The look of the header against the prototype.
  - After Yes on Start new session, the trigger is disabled (there's no session any more), so focus
    falls to the page. There is no spoken confirmation besides the chip disappearing. This goes to
    review.

## Review log
Tier: Substantial (design tier; about 1,275 changed lines). Snapshot `f4c81ca`.

### Round 1
Passes: `/code-review high`, `arch-reviewer` (sonnet), `security-reviewer`, `/simplify` (4 angles).

**Security:** no findings. It checked CSRF headers, CORS/DNS rebinding through the dev proxy,
XSS sinks, response validation, and logs.

**Code review:**
1. A fetch rejection or a non-JSON 2xx escaped `api.ts` as a raw TypeError/SyntaxError with no
   `[rlt]` line. **[Fixed]** Both now give a logged `ApiError` (`network`, status 0; `bad_body`),
   with tests. The arch review raised the same point.
2. On a failed send, focus fell to `<body>` and then jumped back after 5 s. **[Fixed]** Focus
   returns to the trigger whenever the confirm ends, whether it was sent, failed or cancelled.
3. Yes stayed live after the action became unavailable, for example after another tab's break.
   **[Fixed]** An open confirm is cancelled when `disabledReason` appears. Checked live by killing
   the tracker while the Quit confirm was open.
4. The clicking tab refetched sessions twice: its own invalidate, then its own `session_break`.
   **[Fixed]** The local invalidate is gone; the event refetches every tab.
5. React Query's default 3 retries also retried 4xx and `bad_shape`. **[Fixed]** `shouldRetry`
   retries only no-answer and 5xx, up to 3 times, with tests.
6. A hanging request left the confirm stuck on "sending". **[Fixed]** Every request has a 10 s
   `AbortSignal.timeout`. The altitude angle asked for GETs too.
7. After Quit, both actions stayed live. **[Fixed]** Both are unavailable while the tracker is
   stopped or not running, with the reason as the tooltip.
8. `scripts/stop.ts` had two imports from one module. **[Fixed]** The imports are merged, and the
   server tests' import order is fixed too.
9. `check` repeated the other scripts' commands. **[Fixed]** It now runs `bun run typecheck`,
   `lint` and `test`.

**Arch review:**
- `client.ts`: a later worker error would start a second stream. **[Fixed]** It falls back once
  (`{ once: true }`).
- Duplicated hub wiring in `worker.ts` and `client.ts`. **[Fixed]** It is now `events/browser.ts`.
- A late subscriber gets no replay. **[Fixed]** A comment on `subscribe` states the coupling to
  the live store.
- The Start new session focus/announce residual. **[Fixed]**
  - The trigger uses `aria-disabled`, so focus stays on it.
  - A polite `role="status"` note says "New session started" for 5 s. It is in the DOM before its
    text arrives.
  - The reducer has a `done` state, tested.
  - Checked live.
- `ConfirmButton` imports `Header.module.css`. **[Verified, no fix needed]** It is a header action
  and shares `.hbtn` with the Settings link, so the header stylesheet is its home.
- File merges not in the plan (`HeaderActions.tsx`, `Placeholders.tsx`, `queries.ts`, `cx.ts`).
  **[Fixed]** Recorded in the Implementation notes.
- BACKLOG, PROJECT_INDEX, ADR gate, this log. **[Fixed]** Done in step 8.
  - **ADR gate: not met.** The SharedWorker is contained in `src/web/events/`; swapping it is
    a one-file change, and this plan records the fork. The theme cut is a BACKLOG item away from
    reversal.
- The plan body still describes `enabled: false` queries. **[Verified, no fix needed]** The
  Implementation notes record the change.

**/simplify, applied:**
- One `request()` in `api.ts`.
- `ConfirmButton` takes only `disabledReason`.
- `{ once: true }` and one shared `deliver` in `client.ts`.
- One `live.set` on link.
- The header actions read a string snapshot (`useOffline`), so a status event doesn't re-render
  them.

**/simplify, skipped:**
- `css: true` versus `readFileSync`: the web project has no Node types. Plan review #9 chose
  `?raw`.
- A `stopped` link state or a server signal: the server is gone by then. The difference between
  tabs ("stopped" here, "not running" in others) is intended.
- Pruning dead ports in the hub: plan review #6 decided on no disconnect, and the worker dies with
  its last tab.
- A shared `nextDelay` for backoff: the shapes differ, and it's a one-liner.
- Narrowing `invalidateQueries()` on `match_ended`: decide when WP6 adds the heavy queries.
- Status dedupe in `live.set`: the server sends status on change.
- `browserWarn`: cosmetic.

After round 1: `bun run check` gives 60 files and 718 tests green. A live re-check in Chrome
covered:
- Start by keyboard: focus stays, the note shows and clears, and Enter on the unavailable button
  does nothing.
- Killing the tracker while the Quit confirm was open: it cancels, focus goes back to Quit, and
  both actions say "Tracker not running".
- Restart, then Quit: "tracker stopped", both say "Tracker stopped", and there are no console
  errors.

### Round 2 (delta from `f4c81ca`)
Passes: `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`.
- Code review and security: no findings. The low code review returned an empty report.
- Arch:
  1. The timeout firing while the body streams was caught as `bad_body`, and so not retried.
     **[Fixed]** It is now `network`, with a test.
  2. The "Tracker not running" tooltip showed while the page was still connecting. **[Fixed]** It
     now says "Connecting…".
  3. A hook call sat inside a JSX prop. **[Fixed]** Hoisted.
  4. A boolean spread. **[Fixed]** Replaced with a ternary.

### Round 3 (delta: the round-2 fixes)
Passes: `/code-review low`, `arch-reviewer` (sonnet), `security-reviewer`. No findings. Review done.

Final: `bun run check` gives 60 files and 719 tests green.
