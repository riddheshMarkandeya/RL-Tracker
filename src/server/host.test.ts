import { afterEach, describe, expect, test, vi } from "vitest";
import { PortTakenError, startHost, type Host } from "./host";
import { memoryLogger } from "./testing";

describe("startHost", () => {
  const hosts: Host[] = [];
  afterEach(() => {
    for (const h of hosts.splice(0)) h.stop();
    vi.useRealTimers();
  });

  const start = (port = 0) => {
    const logger = memoryLogger();
    let shutdowns = 0;
    const host = startHost({ port, logger, onShutdown: () => shutdowns++ });
    hosts.push(host);
    const url = (path: string) => `http://127.0.0.1:${String(host.port)}${path}`;
    return { host, logger, url, shutdowns: () => shutdowns };
  };

  test("a second bind on the same port is PortTakenError: the single-instance guard", () => {
    const { host } = start();
    expect(() => start(host.port)).toThrow(PortTakenError);
  });

  test("shutdown without the header is refused and doesn't stop anything", async () => {
    const { url, logger, shutdowns } = start();
    const res = await fetch(url("/api/shutdown"), { method: "POST" });
    expect(res.status).toBe(403);
    await Bun.sleep(10);
    expect(shutdowns()).toBe(0);
    expect(logger.events()).toContain("host/shutdown_rejected");
  });

  test("shutdown with the header answers 202 first, then calls onShutdown", async () => {
    // Only setTimeout is faked, so fetch and serve still run for real; the deferred onShutdown can't race the response.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { url, logger, shutdowns } = start();
    const res = await fetch(url("/api/shutdown"), { method: "POST", headers: { "X-RLTracker-Shutdown": "1" } });
    expect(res.status).toBe(202);
    expect(shutdowns()).toBe(0);
    vi.runAllTimers();
    expect(shutdowns()).toBe(1);
    expect(logger.events()).toContain("host/shutdown_requested");
  });

  test("a foreign Host header (DNS rebinding) is refused, even with the shutdown header", async () => {
    const { url, logger, shutdowns } = start();
    const res = await fetch(url("/api/shutdown"), { method: "POST", headers: { Host: "evil.example:80", "X-RLTracker-Shutdown": "1" } });
    expect(res.status).toBe(403);
    await Bun.sleep(10);
    expect(shutdowns()).toBe(0);
    expect(logger.lines.find((l) => l.event === "bad_host")?.fields).toMatchObject({ host: "evil.example:80" });
  });

  test("before mount, anything else is 503 starting, localhost included", async () => {
    const { host, url } = start();
    for (const path of ["/", "/api/status"]) {
      const res = await fetch(url(path));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "starting" });
    }
    expect((await fetch(`http://localhost:${String(host.port)}/`)).status).toBe(503);
  });

  test("a mounted handler gets the rest; the Host check and shutdown stay ahead of it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { host, url, shutdowns } = start();
    const seen: string[] = [];
    host.mount((req, server) => {
      seen.push(new URL(req.url).pathname);
      expect(typeof server.timeout).toBe("function");
      return new Response("mounted");
    });
    expect(await (await fetch(url("/api/status"))).text()).toBe("mounted");
    expect((await fetch(url("/api/status"), { headers: { Host: "evil.example:80" } })).status).toBe(403);
    expect((await fetch(url("/api/shutdown"), { method: "POST", headers: { "X-RLTracker-Shutdown": "1" } })).status).toBe(202);
    vi.runAllTimers();
    expect(shutdowns()).toBe(1);
    expect(seen).toEqual(["/api/status"]);
  });

  test("a second mount throws", () => {
    const { host } = start();
    host.mount(() => new Response());
    expect(() => {
      host.mount(() => new Response());
    }).toThrow(/already mounted/);
  });
});
