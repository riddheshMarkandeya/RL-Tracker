import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { ApiError, getJson, post, postJson, shouldRetry } from "./api";

const schema = z.object({ n: z.number() });
const reply = (status: number, body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
const unreachable = () => vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));

describe("getJson", () => {
  test("parses a 2xx body with the schema", async () => {
    await expect(getJson("/api/x", schema, { fetchFn: reply(200, { n: 1 }), warn: vi.fn() })).resolves.toEqual({ n: 1 });
  });

  test("a non-2xx throws ApiError with the status and the server's error code", async () => {
    const err = await getJson("/api/x", schema, { fetchFn: reply(503, { error: "starting" }), warn: vi.fn() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: "starting" });
  });

  test("a body that doesn't match the schema throws and logs the issue paths", async () => {
    const warn = vi.fn();
    const err = await getJson("/api/x", schema, { fetchFn: reply(200, { n: "one" }), warn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 200, code: "bad_shape" });
    expect(warn).toHaveBeenCalledWith("[rlt] api/bad_shape", { path: "/api/x", issues: ["n"] });
  });

  test("an unreachable tracker throws ApiError network and logs it", async () => {
    const warn = vi.fn();
    const err = await getJson("/api/x", schema, { fetchFn: unreachable(), warn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "network" });
    expect(warn).toHaveBeenCalledWith("[rlt] api/network", { path: "/api/x", error: "TypeError: Failed to fetch" });
  });

  test("a 2xx body that isn't JSON throws ApiError bad_body and logs it", async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(() => Promise.resolve(new Response("<!doctype html>", { status: 200 })));
    const err = await getJson("/api/x", schema, { fetchFn, warn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 200, code: "bad_body" });
    expect(warn).toHaveBeenCalledWith("[rlt] api/bad_body", { path: "/api/x", status: 200 });
  });

  test("the timeout firing while the body streams is no answer, not a bad body", async () => {
    const warn = vi.fn();
    const timedOut = { ok: true, status: 200, json: () => Promise.reject(new DOMException("timed out", "TimeoutError")) } as unknown as Response;
    const err = await getJson("/api/x", schema, { fetchFn: vi.fn(() => Promise.resolve(timedOut)), warn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "network" });
    expect(warn).toHaveBeenCalledWith("[rlt] api/network", { path: "/api/x", error: "TimeoutError: timed out" });
  });
});

describe("post", () => {
  test("sends the given header and returns the response on 2xx", async () => {
    const fetchFn = reply(202, {});
    await post("/api/shutdown", { "X-Test": "1" }, { fetchFn, warn: vi.fn() });
    expect(fetchFn).toHaveBeenCalledWith("/api/shutdown", { method: "POST", headers: { "X-Test": "1" }, signal: expect.any(AbortSignal) as unknown });
  });

  test("an unreachable tracker throws ApiError network and logs it", async () => {
    const warn = vi.fn();
    const err = await post("/api/shutdown", {}, { fetchFn: unreachable(), warn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "network" });
    expect(warn).toHaveBeenCalledWith("[rlt] api/network", { path: "/api/shutdown", error: "TypeError: Failed to fetch" });
  });

  test("a non-2xx throws ApiError and logs it", async () => {
    const warn = vi.fn();
    const err = await post("/api/sessions/break", {}, { fetchFn: reply(403, { error: "forbidden" }), warn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403 });
    expect(warn).toHaveBeenCalledWith("[rlt] api/failed", { path: "/api/sessions/break", status: 403 });
  });
});

describe("postJson", () => {
  test("posts with the header and parses the body with the schema", async () => {
    const fetchFn = reply(200, { n: 2 });
    await expect(postJson("/api/x", { "X-H": "1" }, schema, { fetchFn, warn: vi.fn() })).resolves.toEqual({ n: 2 });
    expect(fetchFn).toHaveBeenCalledWith("/api/x", expect.objectContaining({ method: "POST", headers: { "X-H": "1" } }));
  });

  test("a body the schema rejects throws bad_shape and logs it, as for a GET", async () => {
    const warn = vi.fn();
    const err = await postJson("/api/x", {}, schema, { fetchFn: reply(200, {}), warn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 200, code: "bad_shape" });
    expect(warn).toHaveBeenCalledWith("[rlt] api/bad_shape", { path: "/api/x", issues: ["n"] });
  });
});

describe("shouldRetry", () => {
  test("retries what can pass next time: no answer, a 5xx, or an unknown error, up to 3 times", () => {
    expect(shouldRetry(0, new ApiError(0, "network"))).toBe(true);
    expect(shouldRetry(0, new ApiError(503, "starting"))).toBe(true);
    expect(shouldRetry(2, new Error("boom"))).toBe(true);
    expect(shouldRetry(3, new ApiError(503, "starting"))).toBe(false);
  });

  test("doesn't retry what will fail the same way: a 4xx or a body the schema rejects", () => {
    expect(shouldRetry(0, new ApiError(400, "bad_filter"))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, "not_found"))).toBe(false);
    expect(shouldRetry(0, new ApiError(200, "bad_shape"))).toBe(false);
    expect(shouldRetry(0, new ApiError(200, "bad_body"))).toBe(false);
  });
});
