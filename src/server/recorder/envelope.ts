// One Stats API frame: `{Event, Data}`, where Data is itself a JSON string on the wire.

export type Data = Record<string, unknown>;

export interface StatsEvent {
  name: string;
  /** "" when absent: freeplay, training and some join/leave events carry no guid. */
  guid: string;
  data: Data;
}

export type ParseResult = { ok: true; ev: StatsEvent } | { ok: false; reason: "not_json" | "no_event" | "bad_data" };

export const isObject = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseFrame(raw: string): ParseResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (!isObject(envelope) || typeof envelope.Event !== "string") return { ok: false, reason: "no_event" };
  let data: unknown = envelope.Data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, reason: "bad_data" };
    }
  }
  if (!isObject(data)) return { ok: false, reason: "bad_data" };
  const guid = typeof data.MatchGuid === "string" ? data.MatchGuid : "";
  return { ok: true, ev: { name: envelope.Event, guid, data } };
}
