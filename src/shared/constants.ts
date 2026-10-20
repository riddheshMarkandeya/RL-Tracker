// Values v1 keeps fixed; each is meant to become a user setting later.

/** A gap longer than this between matches starts a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/** Local hour at which a "day" rolls over, so late-night play counts toward the previous day. */
export const DAY_CUTOFF_HOUR = 4;
/** First day of the week, as Date.getDay() numbers it (1 = Monday). */
export const WEEK_START_DAY = 1;
/** The goal lines are at Y ±5120 on the pitch, goal line to goal line 10240 uu. */
export const GOAL_LINE_Y = 5120;
/** How long raw match data is kept. */
export const RETENTION_DAYS = 90;
/** The game's Stats API (WebSocket, ws://127.0.0.1:49124). */
export const STATS_API_PORT = 49124;
/** The dashboard listens on loopback only. */
export const DASHBOARD_HOST = "127.0.0.1";
/** Near the game's ports and below the Windows dynamic range (49152+). */
export const DASHBOARD_PORT = 49100;
