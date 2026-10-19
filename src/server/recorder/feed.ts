// Feeding a capture file (one `{t, raw}` JSON line per frame) through a recorder, with the file's
// own times, so in-file gaps orphan matches the way live play does.
import type { Recorder } from "./recorder";

export interface CaptureLine {
  t: number;
  raw: string;
}

/** One capture line, or null for anything else (a blank or torn last line). */
export function parseCaptureLine(row: string): CaptureLine | null {
  if (!row.trim()) return null;
  let line: unknown;
  try {
    line = JSON.parse(row);
  } catch {
    return null;
  }
  const { t, raw } = (line ?? {}) as Partial<CaptureLine>;
  return typeof t === "number" && typeof raw === "string" ? { t, raw } : null;
}

/** The frame lines of a capture. */
export function readCapture(text: string): CaptureLine[] {
  return text.split("\n").flatMap((row) => parseCaptureLine(row) ?? []);
}

export function feed(recorder: Recorder, lines: readonly CaptureLine[]): void {
  for (const { t, raw } of lines) {
    recorder.checkIdle(t);
    recorder.handleFrame(raw, t);
  }
}
