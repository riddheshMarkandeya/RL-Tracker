import { describe, expect, test, vi } from "vitest";
import { DASHBOARD_PORT } from "../src/shared/constants";
import { describeStopResult, stopTracker } from "./stop";

describe("describeStopResult", () => {
  test("202 means it's stopping", () => {
    expect(describeStopResult({ kind: "status", status: 202 })).toEqual({ message: "RL Tracker is stopping.", exitCode: 0 });
  });

  test("a refused connection means nothing is running", () => {
    expect(describeStopResult({ kind: "refused" })).toEqual({ message: "RL Tracker is not running.", exitCode: 1 });
  });

  test("a reset after sending most likely means it stopped before answering", () => {
    expect(describeStopResult({ kind: "reset" })).toMatchObject({ exitCode: 0 });
    expect(describeStopResult({ kind: "reset" }).message).toMatch(/probably stopping/);
  });

  test("any other status, or another error, is a failure that says what came back", () => {
    expect(describeStopResult({ kind: "status", status: 403 })).toEqual({ message: "Stop request failed: HTTP 403.", exitCode: 1 });
    expect(describeStopResult({ kind: "error", message: "boom" })).toEqual({ message: "Stop request failed: boom", exitCode: 1 });
  });
});

describe("stopTracker", () => {
  test("nothing on the installed port: a supervisor sleeping before a restart is ended, so it can't bring the tracker back", async () => {
    const endSupervisor = vi.fn(() => true);
    const result = await stopTracker(DASHBOARD_PORT, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor });
    expect(endSupervisor).toHaveBeenCalledOnce();
    expect(result).toEqual({ message: "RL Tracker wasn't running; ended its supervisor, which was waiting to restart it.", exitCode: 0, notRunning: true });
  });

  test("no supervisor either: not running", async () => {
    const result = await stopTracker(DASHBOARD_PORT, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor: () => false });
    expect(result).toEqual({ message: "RL Tracker is not running.", exitCode: 1, notRunning: true });
  });

  test("another port is a dev run, which has no supervisor, so the installed one is left alone", async () => {
    const endSupervisor = vi.fn(() => true);
    const result = await stopTracker(DASHBOARD_PORT + 1, false, { request: () => Promise.resolve({ kind: "refused" }), endSupervisor });
    expect(endSupervisor).not.toHaveBeenCalled();
    expect(result.notRunning).toBe(true);
  });

  test("a stopping tracker is not 'not running'", async () => {
    const result = await stopTracker(DASHBOARD_PORT, false, { request: () => Promise.resolve({ kind: "status", status: 202 }), endSupervisor: () => true });
    expect(result).toEqual({ message: "RL Tracker is stopping.", exitCode: 0, notRunning: false });
  });
});
