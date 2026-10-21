// Sessions are cut at read time, not stored, because adding a break changes where they cut.
// They are cut over every recorded match (any playlist, spectated too): a session is time at the
// PC, and filters apply inside it.
import { SESSION_GAP_MS } from "../../shared/constants";

export interface SessionMatch {
  guid: string;
  startedAt: number;
  endedAt: number;
}

export interface Session {
  /** The first match's GUID: stable across recomputes, new if a re-cut moves the first match. */
  key: string;
  guids: string[];
  startedAt: number;
  /** The latest end among its matches. */
  endedAt: number;
  lastStartedAt: number;
}

const byStart = (a: SessionMatch, b: SessionMatch) => a.startedAt - b.startedAt || (a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0);

const breakBetween = (breaks: readonly number[], prevStart: number, start: number) => breaks.some((b) => prevStart < b && b <= start);

/**
 * Oldest first. A match starts a new session when it begins more than the gap after the latest end
 * so far, or when a break falls after the previous match's start and no later than its own; a
 * break during a match so cuts before the next one.
 */
export function cutSessions(matches: readonly SessionMatch[], breaks: readonly number[]): Session[] {
  const sessions: Session[] = [];
  for (const match of [...matches].sort(byStart)) {
    const current = sessions.at(-1);
    if (current && match.startedAt - current.endedAt <= SESSION_GAP_MS && !breakBetween(breaks, current.lastStartedAt, match.startedAt)) {
      current.guids.push(match.guid);
      current.endedAt = Math.max(current.endedAt, match.endedAt);
      current.lastStartedAt = match.startedAt;
    } else {
      sessions.push({ key: match.guid, guids: [match.guid], startedAt: match.startedAt, endedAt: match.endedAt, lastStartedAt: match.startedAt });
    }
  }
  return sessions;
}

/**
 * The session still going on: the last one, within the gap of its end and with no break after its
 * last match began. Takes `cutSessions`' whole list; a filtered one would miss the latest session.
 */
export function currentSession(sessions: readonly Session[], breaks: readonly number[], now: number): Session | null {
  const last = sessions.at(-1);
  if (!last || now - last.endedAt > SESSION_GAP_MS) return null;
  return breakBetween(breaks, last.lastStartedAt, Infinity) ? null : last;
}
