// The tracker's exit codes, which the supervisor reads to decide whether to restart it.
// Bun itself exits 1 on an uncaught exception or rejection; a Task Manager kill shows up as 255.
// The supervisor restarts on any code but the ones below that say not to.

/** A clean stop: Ctrl+C, a signal or the shutdown endpoint. Not restarted. */
export const EXIT_OK = 0;
/** Storage or migration failed before recording started. Restarted with backoff: often transient (a locked DB, antivirus). */
export const EXIT_START_FAILED = 2;
/** Another instance holds the dashboard port. Not restarted. */
export const EXIT_PORT_TAKEN = 3;
/** An environment setting (RLTRACKER_PORT, STATS_API_URL) is invalid. Not restarted: no retry fixes it. */
export const EXIT_CONFIG_INVALID = 4;
