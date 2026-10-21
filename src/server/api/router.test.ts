import { describe, expect, test } from "vitest";
import { matchRoute, type Route } from "./router";

const routes: Route<string>[] = [
  { method: "GET", path: "/api/sessions/:key", handler: "detail" },
  { method: "GET", path: "/api/sessions/months", handler: "months" },
  { method: "POST", path: "/api/sessions/break", handler: "break" },
  { method: "GET", path: "/api/sessions", handler: "list" },
];

describe("matchRoute", () => {
  test("captures a :param", () => {
    expect(matchRoute(routes, "GET", "/api/sessions/abc-123")).toEqual({ kind: "found", handler: "detail", path: "/api/sessions/:key", params: { key: "abc-123" } });
  });

  test("a literal segment beats a :param listed before it", () => {
    expect(matchRoute(routes, "GET", "/api/sessions/months")).toMatchObject({ handler: "months", params: {} });
  });

  test("a :param is decoded; a malformed escape doesn't match", () => {
    expect(matchRoute(routes, "GET", "/api/sessions/a%20b")).toMatchObject({ params: { key: "a b" } });
    expect(matchRoute(routes, "GET", "/api/sessions/%E0%A4%A")).toEqual({ kind: "not_found" });
  });

  test("a known path with another method is 405; an unknown one 404", () => {
    expect(matchRoute(routes, "POST", "/api/sessions")).toEqual({ kind: "method_not_allowed" });
    expect(matchRoute(routes, "GET", "/api/sessions/break")).toMatchObject({ kind: "found", handler: "detail" });
    expect(matchRoute(routes, "GET", "/api/nope")).toEqual({ kind: "not_found" });
    expect(matchRoute(routes, "GET", "/api/sessions/a/b")).toEqual({ kind: "not_found" });
    expect(matchRoute(routes, "GET", "/api/sessions/")).toEqual({ kind: "not_found" });
  });
});
