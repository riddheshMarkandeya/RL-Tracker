// Contract tests: the real host on port 0 with the API mounted, over a seeded temp DB. Every
// response is parsed with the schema the web will use.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { z } from "zod";
import { REQUEST_HEADER } from "../../shared/constants";
import {
  breakResponse,
  currentResponse,
  latestResponse,
  matchDetailResponse,
  monthsResponse,
  periodResponse,
  seasonsResponse,
  sessionDetailResponse,
  sessionsResponse,
  statusSchema,
  type Status,
} from "../../shared/schemas/responses";
import { startHost, type Host } from "../host";
import { createQueryReader } from "../query/read";
import { createRecordWriter } from "../records/save";
import { openStorage, type Storage } from "../storage";
import { ME, memoryLogger, record } from "../testing";
import { createApi, type Api } from "./index";

let dir: string;
let storage: Storage;
let host: Host;
let api: Api;
let logger: ReturnType<typeof memoryLogger>;
let clock: number;
const status: Status = { connection: "connected", statsApiOff: false, configProblems: ["user_missing"] };

const T0 = Date.UTC(2026, 9, 10, 18);
const MIN = 60_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-api-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', 1)", ME);
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  writer.save(record("A", T0, {}, { endedAt: T0 + 5 * MIN }));
  writer.save(record("B", T0 + 10 * MIN, {}, { endedAt: T0 + 15 * MIN, winnerTeamNum: 1 }));
  const dist = join(dir, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<html>app</html>");
  clock = T0 + 20 * MIN;
  logger = memoryLogger();
  host = startHost({ port: 0, logger, onShutdown: () => undefined });
  api = createApi({
    tracker: storage.tracker,
    reader: createQueryReader({ tracker: storage.tracker, logger }),
    status: () => status,
    staticDir: dist,
    logger,
    now: () => clock,
    // Out of the way of the idle-timeout test, which needs a quiet stream.
    events: { heartbeatMs: 60_000 },
  });
  host.mount(api.handle);
});
afterEach(() => {
  api.stop();
  host.stop();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => `http://127.0.0.1:${String(host.port)}${path}`;
async function get<S extends z.ZodType>(schema: S, path: string): Promise<z.infer<S>> {
  const res = await fetch(url(path));
  expect(res.status, path).toBe(200);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  return schema.parse(await res.json());
}
const breakNow = () => fetch(url("/api/sessions/break"), { method: "POST", headers: { [REQUEST_HEADER]: "1" } });

/** Reads SSE frames from a live stream. */
function sse(res: Response) {
  const r = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    /** The next event frame, skipping heartbeats. */
    async next(): Promise<{ event: string; data: unknown }> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (chunk.startsWith(":")) continue;
          const [, event = "", data = ""] = /^event: (.*)\ndata: (.*)$/.exec(chunk) ?? [];
          return { event, data: JSON.parse(data) };
        }
        const { value, done } = await r.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value);
      }
    },
    cancel: () => r.cancel(),
  };
}

describe("endpoints", () => {
  test("every endpoint answers in its schema", async () => {
    expect(await get(statusSchema, "/api/status")).toEqual(status);
    const list = await get(sessionsResponse, "/api/sessions?from=2026-10-01&to=2026-10-31");
    expect(list).toMatchObject({ sessions: [{ key: "A", matches: 2, wins: 1, losses: 1 }], currentKey: "A" });
    expect((await get(monthsResponse, "/api/sessions/months?before=2026-12-01&filter=ranked")).months).toEqual([{ month: "2026-10", sessions: 1, wins: 1, losses: 1 }]);
    expect((await get(currentResponse, "/api/sessions/current")).session?.key).toBe("A");
    const detail = await get(sessionDetailResponse, "/api/sessions/A?filter=13");
    expect(detail.matches.map((m) => m.guid)).toEqual(["A", "B"]);
    expect((await get(matchDetailResponse, "/api/matches/B")).sessionKey).toBe("A");
    expect((await get(periodResponse, "/api/period?kind=month&day=2026-10-01")).aggregate.matches).toBe(2);
    expect((await get(periodResponse, "/api/period?kind=season&season=3")).sessions).toBe(1);
    expect((await get(seasonsResponse, "/api/seasons")).seasons).toHaveLength(3);
  });

  test("bad params are 400 with the issues; unknown keys and routes 404; wrong method 405", async () => {
    const bad = await fetch(url("/api/sessions?from=2026-02-30&to=2026-03-01"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "bad_request", issues: [{ path: ["from"] }] });
    expect(logger.lines.find((l) => l.event === "bad_request")?.fields).toMatchObject({ route: "/api/sessions", issues: ["from"] });
    expect((await fetch(url("/api/period?kind=decade"))).status).toBe(400);
    for (const path of ["/api/sessions/nope", "/api/matches/nope", "/api/period?kind=season&season=99", "/api/nothing"]) {
      const res = await fetch(url(path));
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await fetch(url("/api/seasons"), { method: "POST", headers: { [REQUEST_HEADER]: "1" } })).status).toBe(405);
  });

  test("a write without the request header is 403 and logged", async () => {
    const res = await fetch(url("/api/sessions/break"), { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(logger.lines.find((l) => l.event === "write_rejected")?.fields).toMatchObject({ method: "POST", path: "/api/sessions/break", origin: "https://evil.example" });
    expect(storage.tracker.all("SELECT * FROM session_breaks")).toEqual([]);
  });

  test("other paths get the app; requests are logged by route", async () => {
    const res = await fetch(url("/sessions/A"));
    expect([res.status, await res.text()]).toEqual([200, "<html>app</html>"]);
    expect(logger.lines.filter((l) => l.event === "request").map((l) => l.fields.route)).toEqual([]);
    await fetch(url("/api/sessions/A"));
    expect(logger.lines.find((l) => l.event === "request")?.fields).toMatchObject({ method: "GET", route: "/api/sessions/:key", status: 200 });
  });

  test("HEAD reads like GET; static files are nosniff too", async () => {
    expect((await fetch(url("/api/status"), { method: "HEAD" })).status).toBe(200);
    // HEAD on the stream answers its headers without opening one.
    const head = await fetch(url("/api/events"), { method: "HEAD" });
    expect([head.status, head.headers.get("content-type")]).toEqual([200, "text/event-stream"]);
    expect(logger.events()).not.toContain("api/sse_open");
    expect((await fetch(url("/"))).headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("once stopped, requests get 503 stopping rather than a closed DB", async () => {
    api.stop();
    const res = await fetch(url("/api/sessions/current"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "stopping" });
  });

  test("a handler that throws is 500 and logged", async () => {
    storage.tracker.exec("DROP TABLE seasons");
    const res = await fetch(url("/api/seasons"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(logger.lines.find((l) => l.event === "failed")).toMatchObject({ level: "error", fields: { route: "/api/seasons" } });
  });
});

describe("latest session", () => {
  test("the newest session under the filter, or null; a private-only one is skipped by everything", async () => {
    const latest = async (filter: string) => (await get(latestResponse, `/api/sessions/latest?filter=${filter}`)).session?.key ?? null;
    expect(await latest("private")).toBeNull();
    createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 }).save(record("C", T0 + 60 * MIN, {}, { endedAt: T0 + 65 * MIN, playlistId: 6 }));
    expect(await latest("everything")).toBe("A");
    expect(await latest("private")).toBe("C");
  });

  test("lists the playlists played across all history, whatever the filter", async () => {
    createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 }).save(record("C", T0 + 60 * MIN, {}, { endedAt: T0 + 65 * MIN, playlistId: 6 }));
    const body = await get(latestResponse, "/api/sessions/latest?filter=17");
    expect(body).toEqual({ session: null, playlistsPresent: [6, 13] });
  });
});

describe("session break", () => {
  test("cuts the session now, and tells open pages", async () => {
    const events = sse(await fetch(url("/api/events")));
    expect(await events.next()).toEqual({ event: "status", data: status });
    const res = await breakNow();
    expect(breakResponse.parse(await res.json())).toEqual({ at: clock });
    expect(await events.next()).toEqual({ event: "session_break", data: { at: clock } });
    expect((await get(currentResponse, "/api/sessions/current")).session).toBeNull();
    // A second break at the same instant is the same break.
    expect((await breakNow()).status).toBe(200);
    expect(storage.tracker.all("SELECT at FROM session_breaks")).toEqual([{ at: clock }]);
    expect(logger.events()).toContain("api/session_break");
    await events.cancel();
  });
});

describe("match ended", () => {
  test("pushes the match and its session to open pages", async () => {
    const events = sse(await fetch(url("/api/events")));
    await events.next();
    api.matchEnded("B");
    expect(await events.next()).toEqual({ event: "match_ended", data: { guid: "B", sessionKey: "A" } });
    expect(logger.lines.find((l) => l.event === "match_ended")?.fields).toMatchObject({ guid: "B", sessionKey: "A", subscribers: 1 });
    await events.cancel();
  });

  test("a failure is logged and doesn't throw into the recorder", () => {
    storage.tracker.exec("DROP TABLE session_breaks");
    expect(() => {
      api.matchEnded("B");
    }).not.toThrow();
    expect(logger.lines.find((l) => l.event === "match_ended_failed")).toMatchObject({ level: "error", fields: { guid: "B" } });
  });

  // Bun's default idle timeout is 10 s, checked coarsely: a quiet stream was seen closing at about 12 s.
  test("a stream quiet past Bun's idle timeout still gets the next event", { timeout: 25_000 }, async () => {
    const events = sse(await fetch(url("/api/events")));
    await events.next();
    await Bun.sleep(14_000);
    api.matchEnded("A");
    expect(await events.next()).toEqual({ event: "match_ended", data: { guid: "A", sessionKey: "A" } });
    await events.cancel();
  });
});
