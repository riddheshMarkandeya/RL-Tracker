import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { serveStatic } from "./static";

let root: string;
let dist: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rltracker-static-"));
  dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html>app</html>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
  // A sibling whose name starts with the static dir's.
  mkdirSync(join(root, "dist-evil"));
  writeFileSync(join(root, "dist-evil", "secret.txt"), "secret");
  writeFileSync(join(root, "outside.txt"), "outside");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const body = async (res: Response) => [res.status, await res.text()] as const;
const APP = [200, "<html>app</html>"] as const;
const NOT_FOUND = [404, "not found"] as const;

describe("serveStatic", () => {
  test("a file under the dir, with its type", async () => {
    const res = serveStatic(dist, "/assets/app.js");
    expect(await body(res)).toEqual([200, "console.log(1)"]);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
  });

  test("any other path is the app, for its client-side routes; a directory too", async () => {
    expect(await body(serveStatic(dist, "/"))).toEqual(APP);
    expect(await body(serveStatic(dist, "/sessions/abc"))).toEqual(APP);
    expect(await body(serveStatic(dist, "/assets"))).toEqual(APP);
    expect(serveStatic(dist, "/").headers.get("content-type")).toMatch(/text\/html/);
  });

  test("a path outside the dir is 404, however it is spelled", async () => {
    for (const path of ["/../outside.txt", "/..%2foutside.txt", "/..%5coutside.txt", "/%2e%2e/outside.txt", "/../dist-evil/secret.txt", "/..%2fdist-evil%2fsecret.txt"]) {
      expect(await body(serveStatic(dist, path)), path).toEqual(NOT_FOUND);
    }
  });

  test("a drive or UNC path never leaves the dir", async () => {
    const abs = join(root, "outside.txt").replaceAll("\\", "/");
    expect(await body(serveStatic(dist, `/${abs}`))).toEqual(NOT_FOUND);
    expect(await body(serveStatic(dist, `/${encodeURIComponent(join(root, "outside.txt"))}`))).toEqual(NOT_FOUND);
    // Read under the dir: no such file there, and it has an extension.
    expect(await body(serveStatic(dist, "/%5c%5cserver%5cshare%5cx.txt"))).toEqual(NOT_FOUND);
    expect(await body(serveStatic(dist, "/%5c%5cserver%5cshare%5cx"))).toEqual(APP);
  });

  test("a missing file with an extension is 404, not the app: a stale asset after a rebuild", async () => {
    expect(await body(serveStatic(dist, "/assets/index-oldhash.js"))).toEqual(NOT_FOUND);
    expect(await body(serveStatic(dist, "/sessions/abc.def/x"))).toEqual(APP);
  });

  test("a path too long to stat is the app, not a throw", async () => {
    expect(await body(serveStatic(dist, `/${"a".repeat(40_000)}`))).toEqual(APP);
  });

  test("a NUL byte or a malformed escape is 404", async () => {
    expect(await body(serveStatic(dist, "/index.html%00.js"))).toEqual(NOT_FOUND);
    expect(await body(serveStatic(dist, "/%E0%A4%A"))).toEqual(NOT_FOUND);
  });

  test("a missing static dir, or one without index.html: 404 dashboard not built", async () => {
    expect(await body(serveStatic(join(dist, "missing"), "/"))).toEqual([404, "dashboard not built"]);
    rmSync(join(dist, "index.html"));
    expect(await body(serveStatic(dist, "/sessions"))).toEqual([404, "dashboard not built"]);
    expect(await body(serveStatic(dist, "/assets/app.js"))).toEqual([200, "console.log(1)"]);
  });
});
