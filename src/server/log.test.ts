import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createLogger } from "./log";

// renameSync stays real except in the test that simulates a locked file.
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, renameSync: vi.fn(real.renameSync) };
});

const fixedNow = () => new Date("2026-10-16T12:00:00.000Z");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-log-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lines = (file = "tracker.log") =>
  readFileSync(join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("createLogger", () => {
  test("writes one JSON line per call with ts, level, cat, event and fields", () => {
    const log = createLogger({ dir, now: fixedNow, echo: false });
    log.info("app", "started", { pid: 7, dataDir: "x" });
    log.warn("ws", "retry");
    log.error("db", "failed", { code: "E1" });
    expect(lines()).toEqual([
      { ts: "2026-10-16T12:00:00.000Z", level: "info", cat: "app", event: "started", pid: 7, dataDir: "x" },
      { ts: "2026-10-16T12:00:00.000Z", level: "warn", cat: "ws", event: "retry" },
      { ts: "2026-10-16T12:00:00.000Z", level: "error", cat: "db", event: "failed", code: "E1" },
    ]);
  });

  test("serializes Errors, BigInts and cycles instead of dropping the line", () => {
    const log = createLogger({ dir, now: fixedNow, echo: false });
    const err = new TypeError("boom");
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const shared = { k: 1 };
    log.error("x", "y", { err, big: 12n, cyclic, nested: { err }, s1: shared, s2: shared });
    const [line] = lines();
    expect(line?.err).toEqual({ name: "TypeError", message: "boom", stack: err.stack });
    expect(line?.big).toBe("12");
    expect(line?.cyclic).toEqual({ a: 1, self: "[Circular]" });
    expect(line?.nested).toEqual({ err: { name: "TypeError", message: "boom", stack: err.stack } });
    expect([line?.s1, line?.s2]).toEqual([{ k: 1 }, { k: 1 }]);
  });

  test("keeps an Error's code, cause and aggregated errors, and survives a cause cycle", () => {
    const log = createLogger({ dir, now: fixedNow, echo: false });
    const fsErr = Object.assign(new Error("busy"), { code: "EBUSY", syscall: "rename" });
    const wrapped = new TypeError("fetch failed", { cause: fsErr });
    const agg = new AggregateError([new Error("a")], "many");
    const loop = new Error("loop");
    loop.cause = loop;
    log.error("x", "y", { wrapped, agg, loop });
    const [line] = lines();
    expect(line?.wrapped).toMatchObject({
      name: "TypeError",
      message: "fetch failed",
      cause: { name: "Error", message: "busy", code: "EBUSY", syscall: "rename" },
    });
    expect(line?.agg).toMatchObject({ message: "many", errors: [{ message: "a" }] });
    expect(line?.loop).toMatchObject({ message: "loop", cause: "[Circular]" });
  });

  test("the logger's own ts, level, cat and event win over same-named fields", () => {
    const log = createLogger({ dir, now: fixedNow, echo: false });
    log.info("ws", "frame", { event: "MatchEnded", level: 3, ts: "x", cat: "y", n: 1 });
    expect(lines()).toEqual([
      { ts: "2026-10-16T12:00:00.000Z", level: "info", cat: "ws", event: "frame", n: 1 },
    ]);
  });

  test("rejects options that would break the file limit", () => {
    expect(() => createLogger({ dir, maxFiles: 1 })).toThrow(RangeError);
    expect(() => createLogger({ dir, maxBytes: Number.NaN })).toThrow(RangeError);
    expect(() => createLogger({ dir, maxBytes: 0 })).toThrow(RangeError);
  });
});

describe("failures", () => {
  const stderrLines = () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    return () => spy.mock.calls.map(([chunk]) => String(chunk));
  };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("an unwritable target never throws and is reported to stderr once", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const reported = stderrLines();
    const log = createLogger({ dir: join(blocker, "sub"), echo: false });
    expect(() => {
      log.info("c", "a");
      log.warn("c", "b");
      log.error("c", "c");
    }).not.toThrow();
    const out = reported();
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? "")).toMatchObject({ level: "error", cat: "log", event: "log_write_failed" });
  });

  test("a failure after a success is reported again", () => {
    const reported = stderrLines();
    const log = createLogger({ dir, echo: false });
    const base = join(dir, "tracker.log");
    mkdirSync(base); // a directory where the file should be: appends fail
    log.info("c", "fail1");
    log.info("c", "fail2");
    rmdirSync(base);
    log.info("c", "ok");
    rmSync(base);
    mkdirSync(base);
    log.info("c", "fail3");
    expect(reported()).toHaveLength(2);
  });

  test("a field that can't be serialized, even in the report, never throws", () => {
    const reported = stderrLines();
    const log = createLogger({ dir, echo: false });
    // toJSON throws an Error whose own enumerable getter throws again while being reported.
    const unreportable = Object.defineProperty(new Error("outer"), "boom", {
      enumerable: true,
      get() {
        throw new Error("getter");
      },
    });
    const hostile = {
      toJSON() {
        throw unreportable;
      },
    };
    expect(() => {
      log.info("c", "e", { hostile });
    }).not.toThrow();
    expect(JSON.parse(reported()[0] ?? "")).toMatchObject({ event: "log_write_failed" });
  });

  test("echo still shows the line when the file write fails", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    createLogger({ dir: join(blocker, "sub"), now: fixedNow, echo: true }).info("c", "e");
    expect(out.mock.calls.map(([chunk]) => String(chunk))).toEqual([
      '{"ts":"2026-10-16T12:00:00.000Z","level":"info","cat":"c","event":"e"}\n',
    ]);
  });

  test("an async console stream error after a write doesn't crash the process", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createLogger({ dir, echo: true }).info("c", "e");
    // With no "error" listener, emit throws: that is the crash a broken console pipe causes.
    expect(() => process.stdout.emit("error", new Error("EPIPE"))).not.toThrow();
  });

  test("echo mirrors each line to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createLogger({ dir, now: fixedNow, echo: true }).info("c", "e");
    expect(spy.mock.calls.map(([chunk]) => String(chunk))).toEqual([
      '{"ts":"2026-10-16T12:00:00.000Z","level":"info","cat":"c","event":"e"}\n',
    ]);
  });
});

describe("rotation", () => {
  // Each line is ~75 bytes, so with maxBytes 100 every line after the first rotates.
  const opts = () => ({ dir, now: fixedNow, echo: false, maxBytes: 100, maxFiles: 3 });
  const ns = (file: string) => lines(file).map((l) => l.n);

  test("keeps maxFiles files, newest in the base file, oldest dropped", () => {
    const log = createLogger(opts());
    for (let n = 1; n <= 6; n++) log.info("c", "e", { n });
    expect(readdirSync(dir).sort()).toEqual(["tracker.log", "tracker.log.1", "tracker.log.2"]);
    expect([ns("tracker.log"), ns("tracker.log.1"), ns("tracker.log.2")]).toEqual([[6], [5], [4]]);
  });

  test("counts a pre-existing file's size", () => {
    writeFileSync(join(dir, "tracker.log"), JSON.stringify({ n: 0, pad: "x".repeat(80) }) + "\n");
    createLogger(opts()).info("c", "e", { n: 1 });
    expect([ns("tracker.log"), ns("tracker.log.1")]).toEqual([[1], [0]]);
  });

  test("a single line over maxBytes into an empty file is written without rotating", () => {
    createLogger(opts()).info("c", "e", { n: 1, pad: "x".repeat(200) });
    expect(readdirSync(dir)).toEqual(["tracker.log"]);
    expect(ns("tracker.log")).toEqual([1]);
  });

  test("re-checks the real size before rotating (another process truncated or rotated it)", () => {
    const log = createLogger(opts());
    log.info("c", "e", { n: 1 });
    writeFileSync(join(dir, "tracker.log"), "");
    log.info("c", "e", { n: 2 });
    expect(readdirSync(dir)).toEqual(["tracker.log"]);
    expect(ns("tracker.log")).toEqual([2]);
  });

  test("a failed rotation keeps the line and loses no rotated history", async () => {
    const real = await vi.importActual<typeof import("node:fs")>("node:fs");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const base = join(dir, "tracker.log");
    const log = createLogger({ ...opts(), maxFiles: 4 });
    for (let n = 1; n <= 3; n++) log.info("c", "e", { n }); // base [3], .1 [2], .2 [1]
    // The base file is locked (a viewer or antivirus holding it): renaming it fails.
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (from === base) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      real.renameSync(from, to);
    });
    log.info("c", "e", { n: 4 });
    log.info("c", "e", { n: 5 });
    vi.mocked(renameSync).mockImplementation(real.renameSync);
    log.info("c", "e", { n: 6 });
    expect(readdirSync(dir).sort().map((f) => [f, ns(f)])).toEqual([
      ["tracker.log", [6]],
      ["tracker.log.1", [3, 4, 5]],
      ["tracker.log.2", [2]],
      ["tracker.log.3", [1]],
    ]);
    expect(stderr.mock.calls.map(([c]) => JSON.parse(String(c)) as unknown)).toEqual([
      expect.objectContaining({ event: "log_rotate_failed" }),
    ]);
    stderr.mockRestore();
  });
});
