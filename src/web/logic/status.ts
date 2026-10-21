import type { Status } from "../../shared/schemas/responses";

/** The tab's link to the events stream. */
export type Link = "connecting" | "open" | "down";
export type Tone = "ok" | "busy" | "warn" | "off";

export interface StatusInput {
  link: Link;
  /** Undefined until the stream's first `status` arrives. */
  status: Status | undefined;
  /** This tab sent Quit. */
  stopped: boolean;
}

const BY_CONNECTION: Record<Status["connection"], { label: string; tone: Tone }> = {
  waiting: { label: "waiting for game", tone: "busy" },
  connected: { label: "connected", tone: "ok" },
  recording: { label: "recording match", tone: "ok" },
};

/** The header's status text. A dead link outranks the last status it delivered, which may be stale. */
export function statusLabel({ link, status, stopped }: StatusInput): { label: string; tone: Tone } {
  if (stopped) return { label: "tracker stopped", tone: "off" };
  if (link === "down") return { label: "tracker not running", tone: "off" };
  if (!status) return { label: "connecting…", tone: "busy" };
  if (status.statsApiOff) return { label: "Stats API off", tone: "warn" };
  // A setup problem explains a game that never connects; once data flows, the connection is the news.
  if (status.connection === "waiting" && status.configProblems.length > 0) return { label: "setup problem", tone: "warn" };
  return BY_CONNECTION[status.connection];
}
