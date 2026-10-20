import { describe, expect, test } from "vitest";
import { taskXml } from "./autostart";

describe("taskXml", () => {
  const xml = taskXml({ userId: String.raw`PC\me`, exe: String.raw`C:\Users\A&B\bin\rltracker-supervisor.exe`, workDir: String.raw`C:\Users\A&B\bin` });

  test("declares UTF-16, which is how the file is written", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
  });

  test("starts the supervisor at the user's logon, unelevated, with paths XML-escaped", () => {
    expect(xml).toContain(String.raw`<LogonTrigger><Enabled>true</Enabled><UserId>PC\me</UserId></LogonTrigger>`);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain(String.raw`<Command>C:\Users\A&amp;B\bin\rltracker-supervisor.exe</Command>`);
    expect(xml).toContain(String.raw`<WorkingDirectory>C:\Users\A&amp;B\bin</WorkingDirectory>`);
  });

  test("runs one instance with no time limit, on battery too, and retries a failed start", () => {
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toContain("<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>");
  });
});
