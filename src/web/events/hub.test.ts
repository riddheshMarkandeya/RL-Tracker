import { beforeEach, describe, expect, test, vi } from "vitest";
import { createHub, SOURCE_CLOSED, SOURCE_CONNECTING, SOURCE_OPEN, type HubMessage, type HubSource } from "./hub";

class FakeSource implements HubSource {
  readyState = SOURCE_CONNECTING;
  closed = false;
  private listeners = new Map<string, ((e: { data?: unknown }) => void)[]>();
  addEventListener(type: string, fn: (e: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
    this.readyState = SOURCE_CLOSED;
  }
  emit(type: string, data?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
  open(): void {
    this.readyState = SOURCE_OPEN;
    this.emit("open");
  }
  /** What EventSource does after an HTTP error status: it closes for good, then fires error. */
  failHard(): void {
    this.readyState = SOURCE_CLOSED;
    this.emit("error");
  }
  /** A dropped connection the browser will retry itself. */
  failSoft(): void {
    this.readyState = SOURCE_CONNECTING;
    this.emit("error");
  }
}

const status = { connection: "connected", statsApiOff: false, configProblems: [] };
const port = () => {
  const got: HubMessage[] = [];
  return { got, postMessage: (m: HubMessage) => { got.push(m); } };
};

let sources: FakeSource[];
let timers: { fn: () => void; ms: number }[];
let warn: ReturnType<typeof vi.fn<(message: string, detail?: unknown) => void>>;
const hub = () =>
  createHub({
    openSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
    warn,
  });
const last = (): FakeSource => {
  const s = sources.at(-1);
  if (!s) throw new Error("no source opened");
  return s;
};
const fire = () => {
  const t = timers.shift();
  t?.fn();
  return t?.ms;
};

beforeEach(() => {
  sources = [];
  timers = [];
  warn = vi.fn();
});

describe("the events hub", () => {
  test("opens one source on the first port, and only one however many join", () => {
    const h = hub();
    expect(sources).toHaveLength(0);
    h.connect(port());
    h.connect(port());
    h.connect(port());
    expect(sources).toHaveLength(1);
  });

  test("fans each valid event out to every port", () => {
    const h = hub();
    const a = port();
    const b = port();
    h.connect(a);
    h.connect(b);
    last().open();
    last().emit("match_ended", JSON.stringify({ guid: "G1", sessionKey: "G0" }));
    last().emit("session_break", JSON.stringify({ at: 5 }));
    const expected: HubMessage[] = [
      { type: "link", link: "connecting" },
      { type: "link", link: "open" },
      { type: "match_ended", data: { guid: "G1", sessionKey: "G0" } },
      { type: "session_break", data: { at: 5 } },
    ];
    expect(a.got).toEqual(expected);
    expect(b.got).toEqual(expected);
  });

  test("a late joiner gets the current link and the latest status at once", () => {
    const h = hub();
    h.connect(port());
    last().open();
    last().emit("status", JSON.stringify(status));
    const late = port();
    h.connect(late);
    expect(late.got).toEqual([{ type: "link", link: "open" }, { type: "status", data: status }]);
  });

  test("a payload that fails its schema, or isn't JSON, is dropped with a warning", () => {
    const h = hub();
    const a = port();
    h.connect(a);
    last().emit("status", JSON.stringify({ connection: "nope" }));
    last().emit("match_ended", "{not json");
    expect(a.got).toEqual([{ type: "link", link: "connecting" }]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("a soft error is the browser's to retry: link down, no reopen of our own", () => {
    const h = hub();
    const a = port();
    h.connect(a);
    last().open();
    last().failSoft();
    expect(a.got.at(-1)).toEqual({ type: "link", link: "down" });
    expect(timers).toHaveLength(0);
    expect(sources).toHaveLength(1);
    last().open();
    expect(a.got.at(-1)).toEqual({ type: "link", link: "open" });
  });

  test("repeated errors don't repeat the link message", () => {
    const h = hub();
    const a = port();
    h.connect(a);
    last().failSoft();
    last().failSoft();
    expect(a.got.filter((m) => m.type === "link" && m.link === "down")).toHaveLength(1);
  });

  test("a hard close (an error status such as the startup 503) reopens after a backoff that grows to 10 s", () => {
    const h = hub();
    h.connect(port());
    last().failHard();
    expect(last().closed).toBe(true);
    expect(fire()).toBe(1000);
    expect(sources).toHaveLength(2);
    last().failHard();
    expect(fire()).toBe(2000);
    last().failHard();
    expect(fire()).toBe(4000);
    last().failHard();
    expect(fire()).toBe(8000);
    last().failHard();
    expect(fire()).toBe(10_000);
    last().failHard();
    expect(fire()).toBe(10_000);
  });

  test("the backoff resets once a stream opens, and the recovered stream delivers", () => {
    const h = hub();
    const a = port();
    h.connect(a);
    last().failHard();
    fire();
    last().failHard();
    fire();
    last().open();
    last().emit("status", JSON.stringify(status));
    expect(a.got.slice(-2)).toEqual([{ type: "link", link: "open" }, { type: "status", data: status }]);
    last().failHard();
    expect(fire()).toBe(1000);
  });

  test("events from a source the hub has replaced are ignored", () => {
    const h = hub();
    const a = port();
    h.connect(a);
    const old = last();
    old.failHard();
    fire();
    const before = a.got.length;
    old.emit("status", JSON.stringify(status));
    expect(a.got).toHaveLength(before);
  });
});
