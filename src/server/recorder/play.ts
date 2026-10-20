// One pass over a match's deduped events into what happened in live play: hits, counted touches,
// shots, woodwork, goals and car samples, each attributed to a roster key. Every extra stat reads
// this view, so the live-window rule and the player resolution live in one place.
import { GOAL_LINE_Y } from "../../shared/constants";
import { isObject, type Data } from "./envelope";
import { playerKey, resolveTarget } from "./players";
import type { StoredEvent } from "./store";
import { num, players, str, teamOf, type MatchSummary, type TeamNum } from "./summary";

export interface Pos {
  x: number;
  y: number;
  z: number;
}

/** One BallHit in play. A 50/50 lists both players, and each is a hitter. */
export interface Hit {
  ts: number;
  /** `key` is null when the player isn't on the roster. */
  hitters: { key: string | null; team: TeamNum | null }[];
  /** `Players` has at least one entry, and every one is a player object on the roster. */
  known: boolean;
  speedKmh: number | null;
  pos: Pos | null;
}

/** A car's state from one UpdateState in play, weighted by the time until the next one. */
export interface CarSample {
  key: string;
  boost: number;
  supersonic: boolean;
  weightMs: number;
}

/** One goal, for the goal map. */
export interface GoalPoint {
  teamNum: TeamNum;
  scorerKey: string;
  assisterKey: string | null;
  /** Whose touch the dot sits at: the scoring team's last touch. Null for an own goal. */
  toucherKey: string | null;
  /** The ball at that touch, raw field coordinates; null for an own goal. */
  pos: Pos | null;
  /** From that touch to the centre of the goal attacked. */
  distance: number | null;
  speedKmh: number | null;
  /** The other team touched the ball after the origin touch. */
  deflected: boolean;
  aerial: boolean;
  /** The scoring team never touched the ball since the kickoff; false when the kickoff came before the recording. */
  ownGoal: boolean;
}

export interface Play {
  goals: GoalPoint[];
  /** Counted touches by key, where the ball was: a player's hits merge as `TOUCH_MERGE_MS` says. */
  touches: Record<string, Pos[]>;
  /** The fastest shot by key, over each Shot statfeed's last touch and each goal's origin hit. */
  hardestShot: Record<string, number>;
  /** Woodwork hits by key (CrossbarHit fires for the posts too). */
  woodwork: Record<string, number>;
  samples: CarSample[];
  facts: {
    /** Wall time spent in live play. */
    playMs: number;
    shotsWithoutTouch: number;
    /**
     * Goals whose BallLastTouch player isn't among the last hit's hitters. Only counted when both
     * sides are known: the last touch resolves, and the last hit is `known`, or there was no hit
     * since a seen kickoff.
     */
    lastTouchDisagrees: number;
    /** Goals whose scorer didn't resolve to a roster player with a team, so they have no point. */
    droppedGoals: number;
    /**
     * Player objects that matched no roster entry, by kind. A missing or non-object reference isn't
     * counted, except a hit's `Players` entry: the entry is a hitter who couldn't be identified.
     */
    unresolved: Record<RefKind, number>;
  };
}

/**
 * States are stored about 2/s; a longer gap (a dropped state, a stall) would otherwise give one
 * sample the whole stretch.
 */
export const CAR_SAMPLE_CAP_MS = 1000;

/**
 * The game sends a BallHit per contact, 1.2–1.8× its own touch count. A player's hit is a new
 * touch only after someone else touched the ball, or this long after their last counted one.
 */
export const TOUCH_MERGE_MS = 1000;

/** A ball rolling along the bar fires CrossbarHit repeatedly; one hit per this window. */
export const WOODWORK_WINDOW_MS = 1000;

type Phase = "countdown" | "play" | "replay" | "paused" | "ended";

interface Acc {
  phase: Phase;
  /** The phase a pause interrupted. */
  beforePause: Phase;
  /** When the current play stretch began; null outside play. */
  playStart: number | null;
  /** The last in-play state's samples, waiting for the next state to weigh them. */
  pending: { ts: number; samples: Omit<CarSample, "weightMs">[] } | null;
  roster: MatchSummary["roster"];
  /** Players of the latest state, for resolving a Shortcut at that moment. */
  latestPlayers: Data[];
  /** Hits since the last RoundStarted, where a goal's origin and a shot's touch are looked for. */
  sinceKickoff: Hit[];
  /** Joined in progress, the hits before the first RoundStarted are only those since the join. */
  sawKickoff: boolean;
  /** Each player's last counted touch, and whether someone else has hit since. */
  lastTouch: Map<string, { ts: number; otherSince: boolean }>;
  lastWoodworkTs: number | null;
  /** AerialGoal statfeeds by scorer key, waiting for their goal. */
  aerialPending: Map<string, number>;
  play: Play;
}

interface GoalInput {
  team: TeamNum;
  scorerKey: string;
  assisterKey: string | null;
  speedKmh: number | null;
  aerial: boolean;
}

export const REF_KINDS = ["hit", "shot", "woodwork", "lastTouch"] as const;
export type RefKind = (typeof REF_KINDS)[number];

const resolve = (acc: Acc, target: unknown) => resolveTarget(acc.latestPlayers, acc.roster, (target ?? {}) as Data);

/** Resolves a player reference, counting a player object that isn't on the roster under `kind`. */
function resolveRef(acc: Acc, ref: unknown, kind: RefKind): string | null {
  if (!isObject(ref)) return null;
  const k = resolve(acc, ref);
  if (k === null) acc.play.facts.unresolved[kind]++;
  return k;
}

function readPos(v: unknown): Pos | null {
  const loc = (v ?? {}) as Data;
  const [x, y, z] = [num(loc.X), num(loc.Y), num(loc.Z)];
  return x === null || y === null || z === null ? null : { x, y, z };
}

/** Closes the open sample stretch: its last state weighs 0. */
function endStretch(acc: Acc): void {
  acc.pending = null;
}

function setPhase(acc: Acc, phase: Phase, ts: number): void {
  if (acc.phase === "ended" || acc.phase === phase) return;
  // Max 0: the wall clock can step back mid-match.
  if (acc.phase === "play" && acc.playStart !== null) acc.play.facts.playMs += Math.max(0, ts - acc.playStart);
  if (acc.phase === "play") endStretch(acc);
  acc.playStart = phase === "play" ? ts : null;
  acc.phase = phase;
}

function sampleCars(acc: Acc, ts: number, inReplay: boolean): void {
  if (acc.phase !== "play" || inReplay) {
    endStretch(acc);
    return;
  }
  if (acc.pending) {
    const weightMs = Math.max(0, Math.min(ts - acc.pending.ts, CAR_SAMPLE_CAP_MS));
    for (const s of acc.pending.samples) acc.play.samples.push({ ...s, weightMs });
  }
  const samples = acc.latestPlayers
    .filter((p) => p.bHasCar === true)
    .map((p) => ({ key: playerKey(p), boost: num(p.Boost) ?? 0, supersonic: p.bSupersonic === true }));
  acc.pending = { ts, samples };
}

/** Counts a touch for each hitter it is new for. */
function countTouches(acc: Acc, h: Hit): void {
  const keys = new Set(h.hitters.map((p) => p.key));
  for (const k of keys) {
    if (k === null) continue;
    const last = acc.lastTouch.get(k);
    if (last && !last.otherSince && h.ts - last.ts < TOUCH_MERGE_MS) continue;
    acc.lastTouch.set(k, { ts: h.ts, otherSince: false });
    if (h.pos) (acc.play.touches[k] ??= []).push(h.pos);
  }
  for (const [k, last] of acc.lastTouch) if (!keys.has(k)) last.otherSince = true;
}

/** The last hit in `hits` with a hitter matching `is`, its index and that hitter. */
function lastHitBy(hits: readonly Hit[], is: (p: Hit["hitters"][number]) => boolean) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    const hitter = h?.hitters.find(is);
    if (h && hitter) return { index: i, hit: h, hitter };
  }
  return null;
}

function addShot(acc: Acc, k: string, speed: number | null): void {
  if (speed !== null) acc.play.hardestShot[k] = Math.max(speed, acc.play.hardestShot[k] ?? speed);
}

/** Team 0 attacks +Y, team 1 attacks −Y. */
const goalY = (team: TeamNum) => (team === 0 ? GOAL_LINE_Y : -GOAL_LINE_Y);

function addGoal(acc: Acc, g: GoalInput): void {
  const hits = acc.sinceKickoff;
  const origin = lastHitBy(hits, (p) => p.team === g.team);
  // In a 50/50 origin the scorer is preferred among the scoring team's hitters.
  const toucher = origin ? (origin.hit.hitters.find((p) => p.key !== null && p.key === g.scorerKey) ?? origin.hitter) : null;
  const pos = origin?.hit.pos ?? null;
  if (origin && toucher?.key) addShot(acc, toucher.key, origin.hit.speedKmh);
  acc.play.goals.push({
    teamNum: g.team,
    scorerKey: g.scorerKey,
    assisterKey: g.assisterKey,
    toucherKey: toucher?.key ?? null,
    pos,
    distance: pos ? Math.hypot(pos.x, goalY(g.team) - pos.y) : null,
    speedKmh: g.speedKmh,
    deflected: origin ? hits.slice(origin.index + 1).some((h) => h.hitters.some((p) => p.team !== g.team)) : false,
    aerial: g.aerial,
    ownGoal: origin === null && acc.sawKickoff,
  });
}

type Handler = (acc: Acc, ev: StoredEvent) => void;

const HANDLERS: Readonly<Record<string, Handler>> = {
  CountdownBegin: (acc, ev) => {
    setPhase(acc, "countdown", ev.ts);
  },
  RoundStarted: (acc, ev) => {
    setPhase(acc, "play", ev.ts);
    acc.sinceKickoff = [];
    acc.sawKickoff = true;
    acc.aerialPending.clear();
  },
  // Dedup has already dropped the replay's copy, so this is the live goal.
  GoalScored: (acc, ev) => {
    if (acc.phase === "ended") return;
    setPhase(acc, "replay", ev.ts);
    const scorer = (ev.data.Scorer ?? {}) as Data;
    const lastTouchKey = resolveRef(acc, ((ev.data.BallLastTouch ?? {}) as Data).Player, "lastTouch");
    const last = acc.sinceKickoff.at(-1);
    const comparable = lastTouchKey !== null && (last ? last.known : acc.sawKickoff);
    if (comparable && !last?.hitters.some((p) => p.key === lastTouchKey)) acc.play.facts.lastTouchDisagrees++;
    const scorerKey = resolve(acc, scorer);
    const team = teamOf(scorer.TeamNum);
    if (scorerKey === null || team === null) {
      acc.play.facts.droppedGoals++;
      return;
    }
    const aerials = acc.aerialPending.get(scorerKey) ?? 0;
    if (aerials > 0) acc.aerialPending.set(scorerKey, aerials - 1);
    addGoal(acc, {
      team,
      scorerKey,
      assisterKey: resolve(acc, ev.data.Assister),
      speedKmh: num(ev.data.GoalSpeed),
      aerial: aerials > 0,
    });
  },
  MatchPaused: (acc, ev) => {
    if (acc.phase === "paused" || acc.phase === "ended") return;
    acc.beforePause = acc.phase;
    setPhase(acc, "paused", ev.ts);
  },
  MatchUnpaused: (acc, ev) => {
    if (acc.phase === "paused") setPhase(acc, acc.beforePause, ev.ts);
  },
  MatchEnded: (acc, ev) => {
    setPhase(acc, "ended", ev.ts);
  },
  UpdateState: (acc, ev) => {
    // The podium and teardown states may be retagged with the next match's guid.
    if (acc.phase === "ended") return;
    acc.latestPlayers = players(ev.data);
    sampleCars(acc, ev.ts, ((ev.data.Game ?? {}) as Data).bReplay === true);
  },
  BallHit: (acc, ev) => {
    if (acc.phase !== "play") return;
    const ball = (ev.data.Ball ?? {}) as Data;
    const entries: unknown[] = Array.isArray(ev.data.Players) ? ev.data.Players : [];
    const hitters = entries.filter(isObject).map((p) => ({ key: resolveRef(acc, p, "hit"), team: teamOf(p.TeamNum) }));
    const malformed = entries.length - hitters.length;
    acc.play.facts.unresolved.hit += malformed;
    const h: Hit = {
      ts: ev.ts,
      hitters,
      known: hitters.length > 0 && malformed === 0 && hitters.every((p) => p.key !== null),
      speedKmh: num(ball.PostHitSpeed),
      pos: readPos(ball.Location),
    };
    acc.sinceKickoff.push(h);
    countTouches(acc, h);
  },
  StatfeedEvent: (acc, ev) => {
    const name = str(ev.data.EventName);
    if (acc.phase !== "play" || (name !== "Shot" && name !== "AerialGoal")) return;
    if (name === "AerialGoal") {
      const k = resolve(acc, ev.data.MainTarget);
      // It comes just before its GoalScored; the goal consumes it.
      if (k !== null) acc.aerialPending.set(k, (acc.aerialPending.get(k) ?? 0) + 1);
      return;
    }
    const k = resolveRef(acc, ev.data.MainTarget, "shot");
    if (k === null) return;
    const last = lastHitBy(acc.sinceKickoff, (p) => p.key === k);
    if (last) addShot(acc, k, last.hit.speedKmh);
    else acc.play.facts.shotsWithoutTouch++;
  },
  CrossbarHit: (acc, ev) => {
    if (acc.phase !== "play") return;
    if (acc.lastWoodworkTs !== null && ev.ts - acc.lastWoodworkTs < WOODWORK_WINDOW_MS) return;
    acc.lastWoodworkTs = ev.ts;
    const k = resolveRef(acc, ((ev.data.BallLastTouch ?? {}) as Data).Player, "woodwork");
    if (k !== null) acc.play.woodwork[k] = (acc.play.woodwork[k] ?? 0) + 1;
  },
};

export function emptyPlay(): Play {
  return { goals: [], touches: {}, hardestShot: {}, woodwork: {}, samples: [], facts: emptyFacts() };
}

export function emptyFacts(): Play["facts"] {
  return { playMs: 0, shotsWithoutTouch: 0, lastTouchDisagrees: 0, droppedGoals: 0, unresolved: { hit: 0, shot: 0, woodwork: 0, lastTouch: 0 } };
}

/** `events` are one match's events, deduped, in seq order. */
export function buildPlay(events: readonly StoredEvent[], summary: Pick<MatchSummary, "roster" | "joinedInProgress">): Play {
  const start: Phase = summary.joinedInProgress ? "play" : "countdown";
  const acc: Acc = {
    phase: start,
    beforePause: start,
    playStart: start === "play" ? (events[0]?.ts ?? 0) : null,
    pending: null,
    roster: summary.roster,
    latestPlayers: [],
    sinceKickoff: [],
    sawKickoff: !summary.joinedInProgress,
    lastTouch: new Map(),
    lastWoodworkTs: null,
    aerialPending: new Map(),
    play: emptyPlay(),
  };
  for (const ev of events) HANDLERS[ev.name]?.(acc, ev);
  // A match closed mid-play (left, orphaned) still counts its last stretch.
  setPhase(acc, "ended", events.at(-1)?.ts ?? 0);
  return acc.play;
}
