# Project index

Personal Rocket League stats tracker: a local Windows tracker first, with a web or mobile app
maybe later.

## Code layout and commands
- `src/server/` (Bun process: `main.ts` entry, `log.ts` logger, `paths.ts` data dir,
  `storage.ts` opens both DBs, `maintenance.ts` schedules retention and backups; `db/`: `sqlite.ts` driver seam, `migrate.ts`, `migrations.ts`,
  `backup.ts`, `retention.ts`), `src/shared/` (`constants.ts`), `scripts/` (standalone
  `capture.ts`).
- `bun run check` = typecheck + lint (zero warnings) + tests (Vitest under Bun);
  `bun run start` runs the server.
  Bun lives at `~/.bun/bin/bun` and may not be on PATH.
- Data and logs: `%LOCALAPPDATA%\RLTracker\` (`tracker.log`, 5 × 5 MB, JSON lines);
  `RLTRACKER_DATA_DIR` overrides it for tests and dev runs. Also `tracker.db` (settings, seasons,
  IDs; backed up to `backups/`, 7 kept), `raw.db` (raw events, 90-day retention).

## Decisions
- `docs/decisions/2026-10-16-bun-runtime.md`: Bun runtime, Vitest under Bun, Playwright on Node;
  Task Scheduler doesn't restart a crashed task.

## Plans
- `docs/plans/2026-10-16-wp2-storage.md`: WP2 plan (SQLite storage, migrations, backups,
  retention, Bun check).
- `docs/plans/2026-10-16-v1-roadmap.md`: v1 roadmap, ordered work packages WP1–WP9 with per-WP
  status.
- `docs/plans/2026-10-16-wp1-foundations.md`: WP1 plan (package, strict TS/ESLint, Vitest,
  logger, constants); done.
- `docs/reviews/2026-10-16-wp1-foundations.md`: WP1 review summary (2 rounds, all fixed).
- `docs/plans/2026-10-15-rl-tracker-features-map.md`: the wayfinder map for the v1 feature spec
  (done; the spec WPs cite; build order lives in the roadmap).

## Research
- `docs/research/2026-10-16-bun-windows-check.md`: Vitest/Playwright under Bun, Task Scheduler
  restart and console behaviour (sources only; results in the Bun ADR).
- `docs/research/2026-10-15-rl-stats-api-and-trackers.md`: Stats API events and limits, MMR
  sources, features of existing trackers, season dates.
- `docs/research/2026-10-15-rl-playlist-ids.md`: playlist ID to name mapping and how to handle
  unknown IDs.
- `docs/research/2026-10-15-live-capture-findings.md`: what the Stats API actually sends in online
  play (6 captured matches): car state for your team only, match-end and leave signatures, playlist
  IDs, and stream volume.
