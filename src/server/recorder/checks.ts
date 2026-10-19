// Sanity checks over a MatchSummary, as a table. A failure is logged and flags the summary; the
// summary still goes to the hook. WP4 adds a row for each stat it adds.
import type { MatchSummary } from "./summary";

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

const hasScore = (s: MatchSummary) => s.score !== null;
const total = (score: number[]) => score.reduce((a, b) => a + b, 0);
const teams = (score: number[]) => [...score.keys()].filter((t) => score[t] !== undefined);
const teamSum = (s: MatchSummary, team: number, stat: "goals" | "assists") =>
  s.roster.filter((r) => r.teamNum === team).reduce((sum, r) => sum + r.stats[stat], 0);

/** Per team, where `actual` differs from the score; null when every team matches. */
function perTeam(s: MatchSummary, stat: "goals" | "assists", fails: (sum: number, score: number) => boolean): string | null {
  const score = s.score ?? [];
  const bad = teams(score).filter((t) => fails(teamSum(s, t, stat), score[t] ?? 0));
  return bad.length ? bad.map((t) => `team ${String(t)}: ${stat} ${String(teamSum(s, t, stat))}, score ${String(score[t])}`).join("; ") : null;
}

const CHECKS: readonly Check[] = [
  {
    id: "winner_valid",
    appliesTo: (s) => s.facts.sawMatchEnded && hasScore(s),
    run: (s) => (s.winnerTeamNum !== null && s.score?.[s.winnerTeamNum] !== undefined ? null : `winner ${String(s.winnerTeamNum)} is not a team`),
  },
  {
    // The MVP is awarded on the podium, and a match can end without one.
    id: "mvp_count",
    run: ({ facts: { mvpCount, sawPodium } }) =>
      mvpCount > 1 || (sawPodium && mvpCount !== 1) ? `${String(mvpCount)} MVPs${sawPodium ? " with a podium" : ""}` : null,
  },
  { id: "mvp_on_roster", appliesTo: (s) => s.mvp !== null, run: (s) => (s.mvp?.key ? null : `MVP ${String(s.mvp?.name)} not on the roster`) },
  {
    // Validates dedup itself: each goal should be counted once.
    id: "goal_events_equal_score",
    appliesTo: (s) => hasScore(s) && !s.joinedInProgress,
    run: (s) => (s.facts.liveGoals === total(s.score ?? []) ? null : `${String(s.facts.liveGoals)} goal events, score total ${String(total(s.score ?? []))}`),
  },
  {
    // An own goal would fail this: it's in the score but credited to no one on the scoring team.
    // Joined in progress, a scorer who left before the recording began is on no roster, so the
    // roster can only fall short.
    id: "player_goals_equal_score",
    appliesTo: hasScore,
    run: (s) => perTeam(s, "goals", (sum, score) => (s.joinedInProgress ? sum > score : sum !== score)),
  },
  { id: "assists_within_goals", appliesTo: hasScore, run: (s) => perTeam(s, "assists", (sum, score) => sum > score) },
  {
    id: "player_stats_non_negative",
    run: (s) => {
      const bad = s.roster.filter((r) => Object.values(r.stats).some((v) => v < 0)).map((r) => r.key);
      return bad.length ? `negative stats for ${String(bad.length)} player(s)` : null;
    },
  },
  { id: "clock_non_negative", run: (s) => (s.facts.minClock !== null && s.facts.minClock < 0 ? `clock reached ${String(s.facts.minClock)}` : null) },
  { id: "playlist_present", run: (s) => (s.playlistId === null ? "no playlist id seen" : null) },
];

export function runChecks(s: MatchSummary): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const check of CHECKS) {
    if (check.appliesTo && !check.appliesTo(s)) continue;
    const detail = check.run(s);
    if (detail !== null) failures.push({ id: check.id, detail });
  }
  return failures;
}
