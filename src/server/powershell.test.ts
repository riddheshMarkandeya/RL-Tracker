import { describe, expect, test } from "vitest";
import { runCommand, runPowerShell } from "./powershell";

// Real processes: what's under test is the spawn and its timeout.
describe("runCommand", () => {
  test("returns stdout and the exit code of any program", async () => {
    expect(await runCommand(["cmd", "/c", "echo hi& exit 3"], 10_000)).toMatchObject({ code: 3, stdout: "hi\r\n", timedOut: false });
  });
});

describe("runPowerShell", () => {
  test("returns stdout and the exit code", async () => {
    expect(await runPowerShell("Write-Output 'hi'; exit 3", 10_000)).toMatchObject({ code: 3, stdout: "hi\r\n", timedOut: false });
  });

  test("a hung script is killed at the timeout", async () => {
    const started = Date.now();
    const result = await runPowerShell("Start-Sleep -Seconds 20", 1_500);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
