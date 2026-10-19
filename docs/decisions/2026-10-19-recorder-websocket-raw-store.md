# Recorder: WebSocket transport, raw store with dedup on read, attribution at write time

Date: 2026-10-19

## Context
WP3a turns the game's Stats API stream into stored matches. The roadmap planned a TCP client. The
weekend captures (`docs/research/2026-10-19-weekend-captures.md`) showed the stream can't be read
literally:
- every goal is sent twice;
- after a private game, the old match's teardown carries the next match's guid;
- a lobby can open and close with no game.

The full plan and its review are in `docs/plans/2026-10-19-wp3a-recorder.md`.

## Decision
1. **WebSocket, not TCP**: `ws://127.0.0.1:49124`, overridable with `STATS_API_URL`.
2. **Store raw, dedup on read.**
   - `raw.db` keeps what arrived. The exceptions: `UpdateState` is sampled to about 2/s, each player's `Loadout` is kept once per match, and the menu states before a match's first non-zero `PlaylistId` are dropped.
   - Duplicates are dropped by one pure rule table (`src/server/recorder/dedup.ts`) every time a match is read: live, and in WP4's `recompute`.
3. **Attribution is fixed at write time.**
   - One match is open at a time, and `MatchDestroyed` closes it whatever guid it carries.
   - A `MatchCreated` with another guid supersedes it, and other guids are filed under the open match.
   - The `match_guid` column is final: `recompute` can't move an event to another match. Only dedup rules and summary or stat logic reach old matches.

## Why
- **WebSocket:** every capture used the WebSocket port, and each frame holds exactly one envelope. That removes the framing parser and its split and merged-chunk cases. `Data` is still a JSON string inside the envelope.
- **Store raw:** a dedup rule that turns out wrong, or a duplicate pattern found later, can be fixed in code and applied to old matches by recompute. Dropping duplicates at write time would lose them for good. The cost is a few duplicate rows per match, and every reader must go through `dedupe`.
- **Attribution:** the alternative was re-deciding which match an event belongs to on every read. That would make the lifecycle a read-time concern too, for a case the captures never showed going wrong: the retag rule held on every private transition. A wrong attribution needs a migration, not a recompute.

## Files touched
`src/server/recorder/` (`client.ts`, `envelope.ts`, `lifecycle.ts`, `store.ts`, `dedup.ts`, `summary.ts`, `checks.ts`, `recorder.ts` and the rest), `src/server/main.ts`, and `scripts/replay.ts`, `scripts/import-capture.ts`, `scripts/make-fixture.ts`.

## Verification
- All 8 anonymised fixtures were replayed live into `bun run start`.
- All 4 weekend captures were imported:
  - 46 finished matches;
  - every `MatchEnded` match has a winner;
  - 5 retagged teardowns were kept with their match;
  - the lobby was discarded.

Details are in the plan's "Verification results".

## Related
- `docs/plans/2026-10-19-wp3a-recorder.md`
- `docs/research/2026-10-19-weekend-captures.md`
- `docs/plans/2026-10-16-v1-roadmap.md` (WP3a, WP4)
