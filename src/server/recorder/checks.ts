// Sanity checks over a MatchSummary, as a table. A failure is logged and flags the summary; the
// summary still goes to the hook. Each stat added to the summary gets a row here.
import { PLAYER_EXTRAS } from "./extras";
import { REF_KINDS, type RefKind } from "./play";
import { NO_CONTEST, TEAMS, type MatchSummary, type PlayerStats, type TeamNum } from "./summary";

interface Check {
  id: string;
  appliesTo?: (s: MatchSummary) => boolean;
  /** null when the check passes, else what was wrong. */
  run: (s: MatchSummary) => string | null;
}

export interface CheckFailure {
  id: string;
  detail: string;
}

type Score = NonNullable<MatchSummary["score"]>;
const total = (score: Score) => score[0] + score[1];

/** A check against the score; with no usable score there is nothing to compare, so it passes. */
const withScore = (run: (s: MatchSummary, score: Score) => string | null) => (s: MatchSummary) => (s.score ? run(s, s.score) : null);

const teamSum = (s: MatchSummary, team: TeamNum, stat: "goals" | "assists") =>
  s.roster.filter((r) => r.teamNum === team).reduce((sum, r) => sum + r.stats[stat], 0);

/** The teams whose players' summed `stat` `fails` against the team's goals; null when none do. */
function perTeam(s: MatchSummary, score: Score, stat: "goals" | "assists", fails: (sum: number, goals: number) => boolean): string | null {
  const bad = TEAMS.map((t) => [t, teamSum(s, t, stat)] as const).filter(([t, sum]) => fails(sum, score[t]));
  return bad.length ? bad.map(([t, sum]) => `team ${String(t)}: ${stat} ${String(sum)}, score ${String(score[t])}`).join("; ") : null;
}

/** Each scoreboard stat and the statfeed events that count it, for the players' tallies. */
const STATFEED_FOR: readonly [keyof PlayerStats, readonly string[]][] = [
  ["goals", ["Goal"]],
  ["assists", ["Assist"]],
  ["shots", ["Shot"]],
  ["demos", ["Demolish"]],
  ["saves", ["Save", "EpicSave"]],
];

function statfeedMismatches(s: MatchSummary): string | null {
  const bad: string[] = [];
  for (const r of s.roster) {
    const counts = s.statfeed[r.key] ?? {};
    for (const [stat, events] of STATFEED_FOR) {
      const fed = events.reduce((sum, e) => sum + (counts[e] ?? 0), 0);
      if (fed !== r.stats[stat]) bad.push(`${r.key} ${stat}: statfeed ${String(fed)}, scoreboard ${String(r.stats[stat])}`);
    }
  }
  return bad.length ? bad.join("; ") : null;
}

type Extras = NonNullable<MatchSummary["extras"]>;

/** A check against the extras; a summary without them (summarise alone) has nothing to check. */
const withExtras = (run: (s: MatchSummary, x: Extras) => string | null) => (s: MatchSummary) => (s.extras ? run(s, s.extras) : null);

const fails = (n: number, what: string) => (n === 0 ? null : `${String(n)} ${what}`);

/** The players' extra stats outside their registry range. */
function extrasOutOfRange(s: MatchSummary, x: Extras): string | null {
  const bad: string[] = [];
  for (const r of s.roster) {
    for (const { column, inRange } of PLAYER_EXTRAS) {
      const n = x.players[r.key]?.[column] ?? null;
      if (n !== null && inRange && !inRange(n, r, x.facts)) bad.push(`${r.key} ${column} ${String(n)}`);
    }
  }
  return bad.length ? bad.join("; ") : null;
}

const REF_LABELS: Record<RefKind, string> = { hit: "hitter(s)", shot: "shooter(s)", woodwork: "woodwork toucher(s)", lastTouch: "goal last toucher(s)" };

const CHECKS: readonly Check[] = [
  {
    // MatchEnded's winner is kept only when it names a real team; a no contest names none.
    id: "winner_valid",
    appliesTo: (s) => s.facts.sawMatchEnded && s.facts.endedWinnerTeamNum !== NO_CONTEST,
    run: (s) => (s.winner !== null ? null : `MatchEnded winner ${String(s.facts.endedWinnerTeamNum)} is not a team`),
  },
  {
    // The MVP is awarded on the podium, and a match can end without one.
    id: "mvp_count",
    run: ({ facts: { mvpCount, sawPodium } }) =>
      mvpCount > 1 || (sawPodium && mvpCount !== 1) ? `${String(mvpCount)} MVPs${sawPodium ? " with a podium" : ""}` : null,
  },
  { id: "mvp_on_roster", appliesTo: (s) => s.mvp !== null, run: (s) => (s.mvp?.key ? null : `MVP ${String(s.mvp?.name)} not on the roster`) },
  { id: "statfeed_resolved", run: (s) => (s.facts.unresolvedStatfeed === 0 ? null : `${String(s.facts.unresolvedStatfeed)} statfeed target(s) not on the roster`) },
  {
    // A rejected scoreboard leaves the score at the last good one, or none: this keeps it visible.
    id: "scoreboards_complete",
    run: (s) => (s.facts.rejectedScoreboards === 0 ? null : `${String(s.facts.rejectedScoreboards)} scoreboard(s) without both teams' goals`),
  },
  {
    // Joined in progress, the statfeeds before the recording began were never seen.
    id: "statfeed_matches_scoreboard",
    appliesTo: (s) => !s.joinedInProgress,
    run: statfeedMismatches,
  },
  {
    // Also fails when no single player held the camera, as when spectating: the match has no "you".
    id: "camera_on_roster",
    appliesTo: (s) => s.facts.cameraTargets > 0,
    run: (s) => (s.cameraKey === null ? `the camera followed no single roster player over ${String(s.facts.cameraTargets)} target(s)` : null),
  },
  {
    // Validates dedup itself: each goal should be counted once.
    id: "goal_events_equal_score",
    appliesTo: (s) => !s.joinedInProgress,
    run: withScore((s, score) => (s.facts.liveGoals === total(score) ? null : `${String(s.facts.liveGoals)} goal events, score total ${String(total(score))}`)),
  },
  {
    // An own goal would fail this: it's in the score but credited to no one on the scoring team.
    // Joined in progress, a scorer who left before the recording began is on no roster, so the
    // roster can only fall short.
    id: "player_goals_equal_score",
    run: withScore((s, score) => perTeam(s, score, "goals", (sum, goals) => (s.joinedInProgress ? sum > goals : sum !== goals))),
  },
  { id: "assists_within_goals", run: withScore((s, score) => perTeam(s, score, "assists", (sum, goals) => sum > goals)) },
  {
    id: "player_stats_non_negative",
    run: (s) => {
      const bad = s.roster.filter((r) => Object.values(r.stats).some((v) => v < 0)).map((r) => r.key);
      return bad.length ? `negative stats for ${String(bad.length)} player(s)` : null;
    },
  },
  { id: "clock_non_negative", run: (s) => (s.facts.minClock !== null && s.facts.minClock < 0 ? `clock reached ${String(s.facts.minClock)}` : null) },
  { id: "playlist_present", run: (s) => (s.playlistId === null ? "no playlist id seen" : null) },
  {
    // Joined in progress, the goals before the recording began have no point.
    id: "goals_per_team_equal_score",
    appliesTo: (s) => !s.joinedInProgress,
    run: withExtras((s, x) => {
      const score = s.score;
      if (!score) return null;
      const bad = TEAMS.map((t) => [t, x.goals.filter((g) => g.teamNum === t).length] as const).filter(([t, n]) => n !== score[t]);
      return bad.length ? bad.map(([t, n]) => `team ${String(t)}: ${String(n)} goal points, score ${String(score[t])}`).join("; ") : null;
    }),
  },
  { id: "extras_computed", run: (s) => s.extrasError },
  { id: "goals_placed", run: withExtras((_, x) => fails(x.facts.droppedGoals, "goal(s) whose scorer isn't a roster player with a team, so no point")) },
  {
    id: "touches_resolved",
    run: withExtras((_, { facts: { unresolved: u } }) => {
      const bad = REF_KINDS.filter((k) => u[k] > 0).map((k) => `${String(u[k])} ${REF_LABELS[k]}`);
      return bad.length ? `unidentified: ${bad.join(", ")}` : null;
    }),
  },
  // A Shot statfeed whose shooter never touched the ball since the kickoff has no speed.
  { id: "shots_have_touch", run: withExtras((_, x) => fails(x.facts.shotsWithoutTouch, "shot(s) with no touch by the shooter since the kickoff")) },
  {
    id: "aerial_goals_match_statfeed",
    run: withExtras((s, x) => {
      const fed = Object.values(s.statfeed).reduce((sum, c) => sum + (c.AerialGoal ?? 0), 0);
      const marked = x.goals.filter((g) => g.aerial).length;
      return marked === fed ? null : `${String(marked)} aerial goal(s), ${String(fed)} AerialGoal statfeed(s)`;
    }),
  },
  // The origin rule leans on BallHit; this keeps a disagreement with the game's own last touch visible.
  { id: "goal_last_touch_agrees", run: withExtras((_, x) => fails(x.facts.lastTouchDisagrees, "goal(s) whose last touch isn't the last hit")) },
  { id: "extras_in_range", run: withExtras(extrasOutOfRange) },
  {
    // A key change since thinning would otherwise drop the frozen car stats and camera silently.
    id: "thinned_snapshot_on_roster",
    appliesTo: (s) => s.thinned !== null,
    run: (s) => (s.thinned?.offRoster.length ? `snapshot key(s) not on the roster: ${s.thinned.offRoster.join(", ")}` : null),
  },
  {
    // A rule marked dense after thinning has no snapshot, and its outputs read null.
    id: "thinned_snapshot_covers_dense",
    appliesTo: (s) => s.thinned !== null,
    run: (s) => (s.thinned?.unsnapshotted.length ? `dense rule(s) newer than the snapshot: ${s.thinned.unsnapshotted.join(", ")}` : null),
  },
];

export const CHECK_IDS: readonly string[] = CHECKS.map((c) => c.id);

export function runChecks(s: MatchSummary): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const check of CHECKS) {
    if (check.appliesTo && !check.appliesTo(s)) continue;
    const detail = check.run(s);
    if (detail !== null) failures.push({ id: check.id, detail });
  }
  return failures;
}
