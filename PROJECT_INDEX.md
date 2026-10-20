# Project index

Personal Rocket League stats tracker: a local Windows tracker first, with a web or mobile app
maybe later.

## Code layout and commands
- `src/server/` (Bun process: `main.ts` entry, `host.ts` HTTP server and shutdown endpoint,
  `supervisor.ts` restart loop (its own exe), `game-watch.ts` game detection and toast,
  `exit-codes.ts`, `log.ts` logger, `paths.ts` data dir and port, `storage.ts` opens both DBs, `maintenance.ts` schedules retention and backups; `db/`: `sqlite.ts` driver seam, `migrate.ts`, `migrations.ts`,
  `backup.ts`, `retention.ts`; `recorder/`: Stats API client, lifecycle, raw store, dedup,
  summary, checks, `read-match.ts`); `records/`: `record.ts` summary → rows, `save.ts` writer,
  `recompute.ts`), `src/shared/` (`constants.ts`, `result.ts` your W/L, `playlists.ts` ID map),
  `scripts/` (standalone `capture.ts`; `stop.ts`, `autostart.ts`, `replay.ts` fake Stats API,
  `import-capture.ts` (also writes records), `recompute.ts`, `make-fixture.ts`), `test/fixtures/`
  (anonymised capture excerpts).
- `bun run recompute` rebuilds match records in `tracker.db` from `raw.db` (safe with the
  tracker running; never deletes records).
- `STATS_API_URL` points `bun run start` at a replay: `bun run scripts/replay.ts <file> --port P`.
- `bun run check` = typecheck + lint (zero warnings) + tests (Vitest under Bun);
  `bun run start` runs the server from source on the real data dir and port 49100;
  `bun run dev` runs it beside the background one (`.dev-data/`, port 49101); `bun run stop`
  stops it (`RLTRACKER_PORT=49101` for dev). Bun lives at `~/.bun/bin/bun` and may not be on
  PATH.
- Background: `bun run install-autostart` compiles `rltracker-supervisor.exe` and `rltracker.exe`
  into `%LOCALAPPDATA%\RLTracker\bin\` and registers the `RLTracker` logon task. It runs that
  snapshot, not the repo, so re-run it after code changes. `uninstall-autostart` removes both.
- Data and logs: `%LOCALAPPDATA%\RLTracker\` (`tracker.log` and `supervisor.log`, 5 × 5 MB, JSON
  lines);
  `RLTRACKER_DATA_DIR` overrides it for tests and dev runs. Also `tracker.db` (settings, seasons,
  IDs, match records; backed up to `backups/`, 7 kept), `raw.db` (raw events, 90-day retention).

## Decisions
- `docs/decisions/2026-10-20-match-records-per-player.md`: match records cover every player and
  "you" is joined at read time; result with no winner; camera share; final player stats.
- `docs/decisions/2026-10-19-supervisor-autostart.md`: the background tracker is a compiled
  snapshot run by a supervisor exe from a logon task; exit codes; the port as single-instance guard.
- `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`: recorder reads the Stats API over
  WebSocket, stores raw and dedups on read, attribution to a match is final at write time.
- `docs/decisions/2026-10-16-bun-runtime.md`: Bun runtime, Vitest under Bun, Playwright on Node;
  Task Scheduler doesn't restart a crashed task.

## Plans
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
