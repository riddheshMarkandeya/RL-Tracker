// Server-sent events for open pages: the tracker's status when it changes, a match saved, a session
// break. Status changes are found by one poll of a snapshot rather than by hooks into each source;
// a second of lag doesn't matter for a header badge.
import type { SseEvents, Status } from "../../shared/schemas/responses";
import type { Logger } from "../log";

const C = "api";
const encoder = new TextEncoder();

export interface EventHubOptions {
  status: () => Status;
  logger: Logger;
  pollMs?: number;
  heartbeatMs?: number;
  /**
   * A no-cors fetch from any site passes the Host check and can hold a stream open (though not read
   * it), so the count is capped. Past it the oldest stream is ended rather than the new one refused:
   * EventSource reconnects after a stream ends, but never after an error status.
   */
  cap?: number;
}

const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function createEventHub({ status, logger, pollMs = 1000, heartbeatMs = 15_000, cap = 16 }: EventHubOptions) {
  /** Each subscriber's send; it removes itself on failure. */
  const subscribers = new Map<symbol, { send: (chunk: Uint8Array) => void; close: () => void }>();
  let lastStatus = JSON.stringify(status());

  const broadcast = (chunk: Uint8Array) => {
    for (const s of subscribers.values()) s.send(chunk);
  };

  const poll = setInterval(() => {
    const next = status();
    const json = JSON.stringify(next);
    if (json === lastStatus) return;
    lastStatus = json;
    broadcast(frame("status", next));
  }, pollMs);
  const heartbeat = setInterval(() => {
    broadcast(encoder.encode(": hb\n\n"));
  }, heartbeatMs);

  const headers = { "content-type": "text/event-stream", "cache-control": "no-store" };

  function subscribe(signal: AbortSignal): Response {
    if (subscribers.size >= cap) {
      logger.warn(C, "sse_cap", { cap, evicting: "oldest" });
      // A Map iterates in insertion order: the first is the oldest.
      subscribers.values().next().value?.close();
    }
    const id = Symbol("subscriber");
    const remove = () => {
      if (!subscribers.delete(id)) return;
      logger.info(C, "sse_close", { subscribers: subscribers.size });
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: Uint8Array) => {
          try {
            controller.enqueue(chunk);
          } catch {
            remove(); // the stream already closed under us
          }
        };
        const close = () => {
          remove();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        subscribers.set(id, { send, close });
        send(frame("status", status()));
      },
      cancel: remove,
    });
    signal.addEventListener("abort", remove, { once: true });
    logger.info(C, "sse_open", { subscribers: subscribers.size });
    return new Response(stream, { headers });
  }

  return {
    subscribe,
    /** A HEAD's answer: the stream's headers, without opening one. */
    head: () => new Response(null, { headers }),
    publish: <K extends keyof SseEvents>(event: K, data: SseEvents[K]) => {
      broadcast(frame(event, data));
    },
    count: () => subscribers.size,
    stop: () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      for (const s of [...subscribers.values()]) s.close();
    },
  };
}

export type EventHub = ReturnType<typeof createEventHub>;
