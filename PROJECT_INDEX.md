# Project index

Personal Rocket League stats tracker: a local Windows tracker first, with a web or mobile app
maybe later.

## Code layout and commands
- `src/server/` (Bun process: `main.ts` entry, `host.ts` HTTP server and shutdown endpoint,
  `supervisor.ts` restart loop (its own exe), `game-watch.ts` game detection and toast,
  `exit-codes.ts`, `log.ts` logger, `paths.ts` data dir and port, `storage.ts` opens both DBs, `maintenance.ts` schedules retention and backups; `db/`: `sqlite.ts` driver seam, `migrate.ts`, `migrations.ts`,
  `backup.ts`, `retention.ts`; `recorder/`: Stats API client, lifecycle, raw store, dedup,
  summary, checks, `play.ts` live-play view, `extras.ts` stat registry, `read-match.ts`, `thin.ts`
  which old UpdateStates retention deletes); `records/`: `record.ts` summary → rows, `save.ts` writer,
  `recompute.ts`, `rules-diff.ts`); `rules/`: `registry.ts` every stat rule with its version,
  `definitions.ts` renders the doc; `query/`: `read.ts` match records for pages with "you"
  joined, `sessions.ts` session cutting, `aggregate.ts` stats and the 30-day baseline; `api/`: the
  dashboard API mounted on the host: `index.ts` routes and writes, `pages.ts` composes each page,
  `events.ts` SSE, `router.ts`, `static.ts` built web app; `remarks/`: the recap headline,
  `copy.ts` line pool, `triggers.ts` mood and quip triggers, `pick.ts` the pure picker, `store.ts`
  stored picks and history),
  `src/web/` (the dashboard: Vite + React + React Router + TanStack Query; `main.tsx`, `App.tsx`
  routes, `api.ts` fetch + Zod parse; `events/`: `hub.ts` one `/api/events` stream fanned out to
  tabs from a SharedWorker (`worker.ts`, in-page fallback in `client.ts`), `live.ts` header state,
  `useLiveEvents.ts` refetch on events; `logic/` pure header logic; `components/` header and empty
  state; `styles/tokens.css` themes carbon, slate, oled; `pages/` placeholders until WP6+),
  `src/shared/` (`constants.ts`, `result.ts` your W/L, `playlists.ts` ID map, `goal-range.ts`
  close/mid/long, `periods.ts` local days and periods, `playlist-filter.ts` filter groups, `schemas/` API params
  and response shapes),
  `scripts/` (standalone `capture.ts`; `stop.ts`, `autostart.ts`, `replay.ts` fake Stats API,
  `import-capture.ts` (also writes records), `recompute.ts`, `make-fixture.ts`, `definitions.ts`,
  `rules-diff.ts`), `test/fixtures/`
  (anonymised capture excerpts), `test/e2e/` (Playwright on Node: `fixtures.ts` starts
  `stack.ts` under Bun, which seeds a temp data dir and runs the real tracker against a gated
  replay; `shell.spec.ts`).
- `bun run recompute` rebuilds match records in `tracker.db` from `raw.db` (safe with the
  tracker running; never deletes records).
- Rules: `docs/definitions.md` is generated from `src/server/rules/registry.ts` (`bun run
  definitions`, which also writes `src/server/rules/constant-pins.json`; a test fails when out of
  sync or when a constant changed without a version bump). To change a rule, one at a time: edit its entry and bump its
  version, `bun run rules-diff` (recomputes into a scratch DB and reports what moved; read-only on
  the data dir), ADR if past the gate, `bun run definitions`, `bun run deploy`.
- `STATS_API_URL` points `bun run start` at a replay: `bun run scripts/replay.ts <file> --port P`.
- `bun run check` = typecheck + lint (zero warnings) + tests (Vitest under Bun);
  `bun run start` runs the server from source on the real data dir and port 49100;
  `bun run dev` runs it beside the background one (`.dev-data/`, port 49101); `bun run stop`
  stops it (`RLTRACKER_PORT=49101` for dev). `bun run web:dev` serves `src/web` on
  `127.0.0.1:5173` with `/api/` proxied to the dev tracker; `bun run web:build` builds `dist/`.
  `bun run e2e` builds `dist/` and runs Playwright in the installed Chrome (`RLT_E2E_KEEP=1` keeps
  the temp data dir and its `tracker.log`). Bun lives at `~/.bun/bin/bun` and may not be on PATH.
- Background: `bun run install-autostart` compiles `rltracker-supervisor.exe` and `rltracker.exe`
  and the dashboard (`bin\web`, which the tracker serves) into `%LOCALAPPDATA%\RLTracker\bin\`,
  registers the `RLTracker` logon task and adds a Start menu shortcut to
  `http://127.0.0.1:49100/`. It runs that snapshot, not the repo. `bun run deploy` ships code
  changes: check, e2e, then install-autostart (builds while the old one records, then swaps and
  restarts), then recompute. `uninstall-autostart` removes the task, shortcut and `bin`.
- Data and logs: `%LOCALAPPDATA%\RLTracker\` (`tracker.log` and `supervisor.log`, 5 × 5 MB, JSON
  lines);
  `RLTRACKER_DATA_DIR` overrides it for tests and dev runs. Also `tracker.db` (settings, seasons,
  IDs, match records; backed up to `backups/`, 7 kept), `raw.db` (raw events; after 90 days a
  match's UpdateStates are thinned to the scoreboard changes, with its car stats and camera
  snapshotted in `retention_matches`; a flagged match is kept whole, and every other event is
  kept).

## Decisions
- `docs/decisions/2026-10-21-query-sessions-baseline.md`: sessions cut at read time over every
  match, key = first match's GUID; baseline = 30 days before the session; "everything" leaves out
  private and offline.
- `docs/decisions/2026-10-20-raw-thinning.md`: retention thins old UpdateStates and keeps every
  other event; dense outputs snapshotted; flagged matches kept whole; dense rules in the registry.
- `docs/decisions/2026-10-20-rule-registry-versions.md`: one rule registry generates the
  definitions doc; each match stores the rule versions it was computed under; rules-diff warns per
  match, reviews per column.
- `docs/decisions/2026-10-20-match-extras-play-view.md`: match extras and goal points read one
  live-play view; shot, aerial, touch, woodwork and goal-origin rules; registry with ranges.
- `docs/decisions/2026-10-20-match-records-per-player.md`: match records cover every player and
  "you" is joined at read time; result with no winner; camera share; final player stats.
- `docs/decisions/2026-10-19-supervisor-autostart.md`: the background tracker is a compiled
  snapshot run by a supervisor exe from a logon task; exit codes; the port as single-instance guard.
- `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`: recorder reads the Stats API over
  WebSocket, stores raw and dedups on read, attribution to a match is final at write time.
- `docs/decisions/2026-10-16-bun-runtime.md`: Bun runtime, Vitest under Bun, Playwright on Node;
  Task Scheduler doesn't restart a crashed task.

## Plans
- `docs/plans/2026-10-28-wp8b-settings-tables.md`: WP8b plan (Settings: the You table answering
  "is this you?", the Seasons table with add/edit/delete, `/api/ids` and `/api/seasons` writes,
  the section list), review log.
- `docs/reviews/2026-10-28-wp8b-settings-tables.md`: WP8b review summary (2 rounds).
- `docs/plans/2026-10-28-wp8a-settings.md`: WP8a plan (Settings: per-key store + Zod, `/api/settings`,
  theme / clock / speed, start page and default filters, rolling window via `?window=`, remarks and
  mood-line switches, the Settings page), review log.
- `docs/reviews/2026-10-28-wp8a-settings.md`: WP8a review summary (3 rounds).
- `docs/plans/2026-10-28-wp7b-trends-charts.md`: WP7b plan (Trends charts: the big chart By date /
  By match with rolling 20 served by `/api/period`, auto x mode and `x` in the URL, the W/L chart
  whose columns open a day's recap or a week/month), review log.
- `docs/reviews/2026-10-28-wp7b-trends-charts.md`: WP7b review summary (4 rounds).
- `docs/plans/2026-10-27-wp7a-trends-page.md`: WP7a plan (Trends page: shared buckets and previous
  period, `/api/period` with previous + buckets, `/api/played-days`, period controls, year strip,
  header, six tiles with sparklines), review log.
- `docs/reviews/2026-10-27-wp7a-trends-page.md`: WP7a review summary (2 rounds).
- `docs/plans/2026-10-27-wp6b-remarks.md`: WP6b plan (recap remarks: mood bands, tiered quips,
  picks stored per session + filter, repeat avoidance, ↻), review log.
- `docs/reviews/2026-10-27-wp6b-remarks.md`: WP6b review summary (3 rounds).
- `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`: WP6a-c plan (Matches & numbers, the
  match page with its side list, scoreboard and flag note, links from cards and goal dots, the
  `match_flags` read rule), review log.
- `docs/reviews/2026-10-27-wp6a-c-matches-and-match-page.md`: WP6a-c review summary (2 rounds).
- `docs/plans/2026-10-27-wp6a-b-overview-sections.md`: WP6a-b plan (Overview sections 5–8, the SVG
  goal map), review log.
- `docs/reviews/2026-10-27-wp6a-b-overview-sections.md`: WP6a-b review summary (3 rounds).
- `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`: WP6a-a plan (session picker, playlist
  filter, Overview 1–4, narrowed refresh), review log.
- `docs/reviews/2026-10-26-wp6a-a-recap-navigation.md`: WP6a-a review summary.
- `docs/plans/2026-10-21-wp5b-b-harness-install.md`: WP5b-b plan (Playwright harness with a seeded
  temp DB and gated replay, axe, web build at install, `bin\web`, Start menu shortcut), live install
  checks, review log. Confirms Playwright on Node.
- `docs/reviews/2026-10-21-wp5b-b-harness-install.md`: WP5b-b review summary (4 rounds).
- `docs/plans/2026-10-21-wp5b-a-web-shell.md`: WP5b-a plan (tooling, themes, header, shared SSE via
  SharedWorker, TanStack Query), live Chrome check, review log.
- `docs/reviews/2026-10-21-wp5b-a-web-shell.md`: WP5b-a review summary (3 rounds).
- `docs/plans/2026-10-21-wp5a-b-api.md`: WP5a-b plan (host `mount`, router, static, SSE, page
  composition, endpoints, schemas), live replay check, review log.
- `docs/reviews/2026-10-21-wp5a-b-api.md`: WP5a-b review summary (3 rounds).
- `docs/plans/2026-10-21-wp5a-a-query-logic.md`: WP5a-a plan (periods, playlist filters, sessions,
  aggregates, baseline, read layer, `queries` rules), real-DB figures, review log.
- `docs/reviews/2026-10-21-wp5a-a-query-logic.md`: WP5a-a review summary (2 rounds).
- `docs/plans/2026-10-20-wp4c-b-retention-split.md`: WP4c-b plan (thinning rule, raw migration 2,
  snapshot substitution in `readMatch`, dense rules, retention rewrite), 46-match figures, review log.
- `docs/plans/2026-10-20-wp4c-a-rule-registry.md`: WP4c-a plan (registry and backfill, generated
  definitions, migration 4 `rule_versions`, read-only `openDb`, `rules-diff`), review log.
- `docs/reviews/2026-10-20-wp4c-a-rule-registry.md`: WP4c-a review summary (9 rounds).
- `docs/reviews/2026-10-21-wp4c-b-retention-split.md`: WP4c-b review summary (2 rounds).
- `docs/plans/2026-10-20-wp4b-match-extras.md`: WP4b plan (play view, extras registry, checks,
  migration 3, `match_goals`, goal range), real-data figures, review log.
- `docs/reviews/2026-10-20-wp4b-match-extras.md`: WP4b review summary.
- `docs/plans/2026-10-20-wp4a-match-records.md`: WP4a plan (schema, record writer, recompute,
  result, MVP, pending guess, playlist map), capture-driven changes, review log.
- `docs/plans/2026-10-19-wp3b-background-process.md`: WP3b plan (host, supervisor, autostart,
  game watch, stop/dev scripts), spike and footprint figures, review log.
- `docs/plans/2026-10-19-wp3a-recorder.md`: WP3a plan (recorder: lifecycle, raw store, dedup,
  summary and checks, client, replay/import tools, fixtures); done, with review log.
- `docs/plans/2026-10-16-wp2-storage.md`: WP2 plan (SQLite storage, migrations, backups,
  retention, Bun check).
- `docs/plans/2026-10-16-v1-roadmap.md`: v1 roadmap, ordered work packages WP1–WP9 with per-WP
  status.
- `docs/plans/2026-10-16-wp1-foundations.md`: WP1 plan (package, strict TS/ESLint, Vitest,
  logger, constants); done.
- `docs/reviews/2026-10-20-wp4a-match-records.md`: WP4a review summary (12 rounds, 1 deferred,
  1 disputed).
- `docs/reviews/2026-10-16-wp1-foundations.md`: WP1 review summary (2 rounds, all fixed).
- `docs/plans/2026-10-15-rl-tracker-features-map.md`: the wayfinder map for the v1 feature spec
  (done; the spec WPs cite; build order lives in the roadmap).

## Research
- `docs/research/2026-10-19-weekend-captures.md`: weekend captures (casual/ranked, private,
  spectated 1v1): duplicates, mis-tagged teardown, winner/MVP sources, bots, WP3a requirements,
  captures still wanted.
- `docs/research/2026-10-16-bun-windows-check.md`: Vitest/Playwright under Bun, Task Scheduler
  restart and console behaviour (sources only; results in the Bun ADR).
- `docs/research/2026-10-15-rl-stats-api-and-trackers.md`: Stats API events and limits, MMR
  sources, features of existing trackers, season dates.
- `docs/research/2026-10-15-rl-playlist-ids.md`: playlist ID to name mapping and how to handle
  unknown IDs.
- `docs/research/2026-10-15-live-capture-findings.md`: what the Stats API actually sends in online
  play (6 captured matches): car state for your team only, match-end and leave signatures, playlist
  IDs, and stream volume.
