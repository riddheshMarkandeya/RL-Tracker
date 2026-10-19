import type { Logger } from "./log";

export interface LogLine {
  level: "info" | "warn" | "error";
  cat: string;
  event: string;
  fields: Record<string, unknown>;
}

/** A Logger that keeps its lines in memory, for tests. */
export function memoryLogger(): Logger & { lines: LogLine[]; events: () => string[] } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine["level"]) =>
    (cat: string, event: string, fields: Record<string, unknown> = {}) => {
      lines.push({ level, cat, event, fields });
    };
  return { lines, events: () => lines.map((l) => `${l.cat}/${l.event}`), info: at("info"), warn: at("warn"), error: at("error") };
}
