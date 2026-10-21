# Raw retention thins old UpdateStates and keeps every other event

Date: 2026-10-20

## Context
Until this change, retention deleted every raw event older than 90 days (WP2). A rule fix could
then reach only the last 90 days of matches through recompute. `UpdateState` is 94% of raw.db,
and most of it is car and ball state that only the car stats and the camera read. This revisits
WP2's 90-day rule. It is an ADR because the deletion can't be undone. The full plan, its review
and the review log are in `docs/plans/2026-10-20-wp4c-b-retention-split.md`.

## Decision
1. **Every non-`UpdateState` event is kept forever.** After 90 days an `UpdateState` is deleted
   only when it changes nothing the scoreboard rules read (registry rule `update_state_thinning`):
   - each player's Name, PrimaryId, Shortcut, TeamNum and scoreboard stats;
   - the teams' scores, or whether the scoreboard is missing (a missing and an incomplete one
     differ);
   - PlaylistId, Arena and bOvertime;
   - a clock reading that isn't the running clock (the last finite reading of any event).

   The first and last states always stay, kept states stay byte-for-byte, and "changes nothing"
   compares with the previous original state. A test ties the projected fields to the known
   fields list, so a newly recognised field forces a decision.
2. **Whole matches.** A match is thinned once its last event is past the cutoff, so retention no
   longer splits a match at the edge.
3. **Dense outputs are snapshotted in raw.db** (migration 2, `retention_matches`). Before
   thinning, retention runs `readMatch` on the full events and stores what thinned raw can't
   support: the four car stats per player and the camera's key. `readMatch` substitutes them on a
   thinned match before the checks, so recompute and rules-diff still need only raw.db.
   - Rules that read every `UpdateState` are marked `dense` in the registry (`car_sampling`,
     `car_stats`, `camera_identity`). A thinned match records the versions they had when it was
     thinned, so rules-diff shows a dense-rule change moving only whole matches.
   - `live_play_window`, `target_resolution` and `player_key` also feed the frozen columns but
     write others that do recompute, so they aren't dense. They are listed as `MIXED_WITH_DENSE`,
     and a thinned match records their current versions even though its frozen columns came from
     the snapshot.
   - A snapshot key that is no longer on the roster (a `player_key` change, say) is flagged by
     `thinned_snapshot_on_roster`, rather than silently nulling the car stats and camera.
   - The snapshot lists the dense rules it was taken under. A rule marked dense later has no
     snapshot on older thinned matches, so its outputs read null there, and
     `thinned_snapshot_covers_dense` flags it.
4. **Flagged matches stay whole** as the rule corpus (rule `retention_flag_exempt`). The decision
   comes from the same `readMatch`, so retention never reads tracker.db. It is stored with the
   rule versions it was made under and re-checked only when they change; a match a rule fix
   unflags is thinned on the next run.
5. **Not a record → kept whole and logged**: a lobby, a match with no close marker, or one that
   already lost its start. A `readMatch` that throws leaves the match whole, logged, and retried
   next run.

## Consequences
- A rule fix reaches every match ever recorded, except a dense-rule change on a thinned match.
- The candidate query is a daily `GROUP BY` over `events`, and matches with no decision row
  (lobbies, open, trimmed) are re-scanned and logged each run. That is acceptable at this scale.
- What the registry tests can't catch: a *future* rule that reads dense state without being
  marked `dense`. The fixture-equivalence test (thinned recompute equals full recompute) is what
  catches that, as far as the coarse fixtures reach.
- An exempt match is re-checked only when a recorded rule version changes. A check fixed or
  removed without a version bump leaves its exempt matches whole until some version does change.
  That fails safe: the match is kept, not lost.
- A flag that marks an expected case, such as `camera_on_roster` on a spectated match, keeps that
  match whole for good. It was 1 of the 46 captured matches; a BACKLOG watch item covers growth.
- Migration 2 also drops the `events_ts` index: only the time-based delete used it.
- `rejectedScoreboards` and `cameraTargets` count states, so thinning changes them. A positive
  `rejectedScoreboards` flags the match, so it is never thinned; `camera_on_roster` reads the
  substituted camera key.

## Alternatives considered
- **Keep deleting at 90 days**: a rule fix stays limited to 90 days of matches.
- **Thin by a fixed sample rate**: it loses scoreboard changes between samples, which the score,
  roster and statfeed resolution need.
- **Recompute the dense stats from thinned states**: they would silently change, so they are
  snapshotted instead.
