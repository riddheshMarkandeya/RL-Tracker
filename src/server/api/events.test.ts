import { afterEach, describe, expect, test, vi } from "vitest";
import type { Status } from "../../shared/schemas/responses";
import { memoryLogger } from "../testing";
import { createEventHub } from "./events";

const decoder = new TextDecoder();

/** Reads a stream's text as it arrives. */
function reader(res: Response) {
  const r = (res.body as ReadableStream<Uint8Array>).getReader();
  return {
    /** The next chunk's text, or null once the stream has ended. */
    next: async () => {
      const { value, done } = await r.read();
      return done ? null : decoder.decode(value);
    },
    cancel: () => r.cancel(),
  };
}

const waiting: Status = { connection: "waiting", statsApiOff: false, configProblems: [] };

function hub(opts: { cap?: number } = {}) {
  let status = waiting;
  const logger = memoryLogger();
  const h = createEventHub({ status: () => status, logger, pollMs: 1000, heartbeatMs: 15_000, ...opts });
  hubs.push(h);
  return { h, logger, set: (s: Status) => (status = s) };
}
const hubs: ReturnType<typeof createEventHub>[] = [];
afterEach(() => {
  for (const h of hubs.splice(0)) h.stop();
  vi.useRealTimers();
});

describe("event hub", () => {
  test("an SSE response that starts with the current status", async () => {
    const { h } = hub();
    const res = h.subscribe(new AbortController().signal);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await reader(res).next()).toBe(`event: status\ndata: ${JSON.stringify(waiting)}\n\n`);
  });

  test("status is sent again only when the polled snapshot changes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { h, set } = hub();
    const r = reader(h.subscribe(new AbortController().signal));
    await r.next();
    vi.advanceTimersByTime(3000); // unchanged: nothing sent
    set({ connection: "recording", statsApiOff: false, configProblems: [] });
    vi.advanceTimersByTime(1000);
    h.publish("session_break", { at: 5 });
    expect(await r.next()).toBe(`event: status\ndata: {"connection":"recording","statsApiOff":false,"configProblems":[]}\n\n`);
    expect(await r.next()).toBe(`event: session_break\ndata: {"at":5}\n\n`);
  });

  test("published events reach every subscriber", async () => {
    const { h } = hub();
    const [a, b] = [reader(h.subscribe(new AbortController().signal)), reader(h.subscribe(new AbortController().signal))];
    await a.next();
    await b.next();
    h.publish("match_ended", { guid: "G", sessionKey: "K" });
    const frame = `event: match_ended\ndata: {"guid":"G","sessionKey":"K"}\n\n`;
    expect([await a.next(), await b.next()]).toEqual([frame, frame]);
  });

  test("a heartbeat comment every 15 s", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { h } = hub();
    const r = reader(h.subscribe(new AbortController().signal));
    await r.next();
    vi.advanceTimersByTime(15_000);
    expect(await r.next()).toBe(": hb\n\n");
  });

  test("an abort or a cancel unsubscribes; open and close are logged with the count", async () => {
    const { h, logger } = hub();
    const ac = new AbortController();
    h.subscribe(ac.signal);
    const r = reader(h.subscribe(new AbortController().signal));
    expect(h.count()).toBe(2);
    ac.abort();
    expect(h.count()).toBe(1);
    await r.cancel();
    expect(h.count()).toBe(0);
    expect(logger.lines.filter((l) => l.cat === "api").map((l) => [l.event, l.fields.subscribers])).toEqual([
      ["sse_open", 1],
      ["sse_open", 2],
      ["sse_close", 1],
      ["sse_close", 0],
    ]);
  });

  test("over the cap, the oldest stream is ended to make room, with a warning", async () => {
    const { h, logger } = hub({ cap: 2 });
    const oldest = reader(h.subscribe(new AbortController().signal));
    h.subscribe(new AbortController().signal);
    const newest = reader(h.subscribe(new AbortController().signal));
    expect(h.count()).toBe(2);
    await oldest.next();
    expect(await oldest.next()).toBeNull();
    expect(await newest.next()).toMatch(/^event: status/);
    expect(logger.lines.find((l) => l.event === "sse_cap")).toMatchObject({ level: "warn", fields: { cap: 2, evicting: "oldest" } });
  });

  test("stop ends every stream", async () => {
    const { h } = hub();
    const r = reader(h.subscribe(new AbortController().signal));
    await r.next();
    h.stop();
    expect(await r.next()).toBeNull();
    expect(h.count()).toBe(0);
  });
});
