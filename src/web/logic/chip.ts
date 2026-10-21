import type { SessionSummary } from "../../shared/schemas/responses";

/** "This session: 4–2", or null when there's no W–L to show. */
export function chipText(session: SessionSummary | null | undefined): string | null {
  if (!session || session.wins + session.losses === 0) return null;
  return `This session: ${String(session.wins)}–${String(session.losses)}`;
}
