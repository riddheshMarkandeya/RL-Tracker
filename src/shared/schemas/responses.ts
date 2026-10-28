// What the API sends. The server's handlers are typed by these schemas' inferred types, and the
// web parses with them, so a shape change is a type error on both sides.
import { z } from "zod";
import { FLAG_REASONS } from "../flags";
import type { Season } from "../periods";
import type { TrendStats } from "../trends";

const counted = z.object({ goals: z.number(), assists: z.number(), saves: z.number(), shots: z.number(), demos: z.number(), score: z.number() });
const countedOrNull = z.object({
  goals: z.number().nullable(),
  assists: z.number().nullable(),
  saves: z.number().nullable(),
  shots: z.number().nullable(),
  demos: z.number().nullable(),
  score: z.number().nullable(),
});
const result = z.enum(["win", "loss"]);
const endKind = z.enum(["completed", "early_end", "left", "orphaned"]);
const closedVia = z.enum(["destroyed", "timeout", "restart", "superseded"]);

export const aggregateSchema = z.object({
  matches: z.number(),
  wins: z.number().nullable(),
  losses: z.number().nullable(),
  noResult: z.number().nullable(),
  winPct: z.number().nullable(),
  leftEarly: z.number().nullable(),
  mvps: z.number().nullable(),
  totals: countedOrNull,
  perGame: countedOrNull,
  shootingPct: z.number().nullable(),
  bestWinStreak: z.number().nullable(),
  bestLossStreak: z.number().nullable(),
  endedOn: z.object({ result, length: z.number() }).nullable(),
  extrasMatches: z.number(),
  hardestShotKmh: z.number().nullable(),
  fastestGoalKmh: z.number().nullable(),
  woodworkHits: z.number().nullable(),
  aerialTouches: z.number().nullable(),
  boostAvg: z.number().nullable(),
  supersonicShare: z.number().nullable(),
  emptyBoostShare: z.number().nullable(),
  statfeed: z.record(z.string(), z.number()),
});

/** The extras columns of a player row; null until computed, the car stats also without car state. */
const extras = {
  hardestShotKmh: z.number().nullable(),
  woodworkHits: z.number().nullable(),
  aerialTouches: z.number().nullable(),
  carMs: z.number().nullable(),
  boostAvg: z.number().nullable(),
  supersonicMs: z.number().nullable(),
  emptyBoostMs: z.number().nullable(),
};

export const myRowSchema = counted.extend({ playerKey: z.string(), teamNum: z.number().nullable(), touches: z.number(), ...extras });

export const myMatchSchema = z.object({
  guid: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  playlistId: z.number().nullable(),
  arena: z.string().nullable(),
  endKind,
  closedVia,
  overtime: z.boolean(),
  scoreTeam0: z.number().nullable(),
  scoreTeam1: z.number().nullable(),
  winnerTeamNum: z.number().nullable(),
  mvpKey: z.string().nullable(),
  /** Why the match is flagged; [] when it isn't. */
  flags: z.array(z.enum(FLAG_REASONS)),
  me: myRowSchema.nullable(),
  result: result.nullable(),
  /** Your goals. */
  goals: z.array(z.object({ speedKmh: z.number().nullable(), ownGoal: z.boolean() })),
  statfeed: z.record(z.string(), z.number()),
});

export const goalSchema = z.object({
  matchGuid: z.string(),
  idx: z.number(),
  teamNum: z.number(),
  scorerKey: z.string(),
  assisterKey: z.string().nullable(),
  toucherKey: z.string().nullable(),
  /** The ball at the touch, raw field coordinates; null for an own goal. */
  pos: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  distance: z.number().nullable(),
  speedKmh: z.number().nullable(),
  deflected: z.boolean(),
  aerial: z.boolean(),
  ownGoal: z.boolean(),
});

/** A session as the picker and the header chip show it, counting only matches you played under the filter. */
export const sessionSummarySchema = z.object({
  key: z.string(),
  /** Local `YYYY-MM-DD` of its first match. */
  day: z.string(),
  /** "2nd of 2 that day", over the sessions listed under the same filter. */
  ordinal: z.number(),
  ofDay: z.number(),
  startedAt: z.number(),
  endedAt: z.number(),
  matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  /** Oldest first. */
  results: z.array(result.nullable()),
});

/** Newest first. */
export const sessionsResponse = z.object({ sessions: z.array(sessionSummarySchema), currentKey: z.string().nullable() });

/** Newest first; `month` is `YYYY-MM`. */
export const monthsResponse = z.object({
  months: z.array(z.object({ month: z.string(), sessions: z.number(), wins: z.number(), losses: z.number() })),
});

export const currentResponse = z.object({ session: sessionSummarySchema.nullable() });

/** The newest session under the filter, and every playlist you've played, so an empty history and a narrow filter can be told apart. */
export const latestResponse = z.object({ session: sessionSummarySchema.nullable(), playlistsPresent: z.array(z.number()) });

export const sessionDetailResponse = z.object({
  key: z.string(),
  day: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  current: z.boolean(),
  /** Null when nothing in the session is under the filter. */
  summary: sessionSummarySchema.nullable(),
  /** Yours under the filter, oldest first. */
  matches: z.array(myMatchSchema),
  aggregate: aggregateSchema,
  byPlaylist: z.array(z.object({ playlistId: z.number().nullable(), aggregate: aggregateSchema })),
  /** Every playlist you played in the session, whatever the filter, for the dropdown. */
  playlistsPresent: z.array(z.number()),
  baseline: aggregateSchema,
  goals: z.array(goalSchema),
  /** The neighbouring sessions listed under the filter. */
  prev: z.string().nullable(),
  next: z.string().nullable(),
  prevMonth: z.string().nullable(),
  nextMonth: z.string().nullable(),
});

export const matchPlayerSchema = counted.extend({
  playerKey: z.string(),
  name: z.string(),
  isBot: z.boolean(),
  teamNum: z.number().nullable(),
  presentAtEnd: z.boolean(),
  touches: z.number(),
  ...extras,
  isMe: z.boolean(),
});

export const matchDetailResponse = z.object({
  match: z.object({
    guid: z.string(),
    startedAt: z.number(),
    endedAt: z.number(),
    playlistId: z.number().nullable(),
    arena: z.string().nullable(),
    endKind,
    closedVia,
    joinedInProgress: z.boolean(),
    overtime: z.boolean(),
    scoreTeam0: z.number().nullable(),
    scoreTeam1: z.number().nullable(),
    winnerTeamNum: z.number().nullable(),
    mvpKey: z.string().nullable(),
    checkFlags: z.array(z.string()),
  }),
  players: z.array(matchPlayerSchema),
  goals: z.array(goalSchema),
  /** Yours; null when spectated or undecided. */
  result: result.nullable(),
  sessionKey: z.string().nullable(),
});

const rangeSchema = z.object({ from: z.number().nullable(), to: z.number(), running: z.boolean() });

const orNull = z.number().nullable();
export const trendStatsSchema = z.object({
  matches: z.number(),
  wins: orNull,
  losses: orNull,
  winPct: orNull,
  shootingPct: orNull,
  perGame: z.object({ goals: orNull, assists: orNull, saves: orNull, shots: orNull }),
}) satisfies z.ZodType<TrendStats>;

export const periodResponse = z.object({
  range: rangeSchema,
  aggregate: aggregateSchema,
  playlistsPresent: z.array(z.number()),
  /** Sessions with a match of yours under the filter in the range; one across an edge counts in both periods. */
  sessions: z.number(),
  /** The period compared with, under the same filter; null where there's none (this year, all time, day, year, the first season). */
  previous: z.object({ range: rangeSchema, aggregate: aggregateSchema }).nullable(),
  /** The first day with a match of yours under the filter in the range; all time starts there. */
  firstDay: z.string().nullable(),
  bucket: z.enum(["day", "week", "month"]),
  buckets: z.array(z.object({ from: z.number(), to: z.number(), day: z.string(), stats: trendStatsSchema })),
});

/** Matches you played per local day of a year under the filter; `firstDay` and `totalMatches` cover every match you played, whatever the filter. */
export const playedDaysResponse = z.object({
  days: z.array(z.object({ day: z.string(), matches: z.number() })),
  firstDay: z.string().nullable(),
  totalMatches: z.number(),
});

export const seasonsResponse = z.object({ seasons: z.array(z.object({ id: z.number(), name: z.string(), startDate: z.string() }) satisfies z.ZodType<Season>) });

export const statusSchema = z.object({
  connection: z.enum(["waiting", "connected", "recording"]),
  /** The game has run a minute or more without the Stats API answering. */
  statsApiOff: z.boolean(),
  configProblems: z.array(z.enum(["no_ini", "user_missing", "send_rate_off", "web_port_off", "web_port_mismatch"])),
});

export const breakResponse = z.object({ at: z.number() });

/** A session's headline remarks. Texts are templates: `{n}`-style placeholders filled from `values` (raw numbers, km/h, epoch ms). */
export const remarksResponse = z.object({
  mood: z.object({ band: z.string(), text: z.string() }),
  quip: z.object({ trigger: z.string(), text: z.string(), values: z.record(z.string(), z.number()) }).nullable(),
});

/** Server-sent events, by event name. */
export const sseEvents = {
  status: statusSchema,
  match_ended: z.object({ guid: z.string(), sessionKey: z.string().nullable() }),
  session_break: breakResponse,
};
export type SseEvents = { [K in keyof typeof sseEvents]: z.infer<(typeof sseEvents)[K]> };

export type AggregateWire = z.infer<typeof aggregateSchema>;
export type MyMatchWire = z.infer<typeof myMatchSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionList = z.infer<typeof sessionsResponse>;
export type LatestSession = z.infer<typeof latestResponse>;
export type MonthFolds = z.infer<typeof monthsResponse>;
export type PeriodView = z.infer<typeof periodResponse>;
export type PlayedDays = z.infer<typeof playedDaysResponse>;
export type SessionDetail = z.infer<typeof sessionDetailResponse>;
export type MatchDetail = z.infer<typeof matchDetailResponse>;
export type Status = z.infer<typeof statusSchema>;
export type Remarks = z.infer<typeof remarksResponse>;
