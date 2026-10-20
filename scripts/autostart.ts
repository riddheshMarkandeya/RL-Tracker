// Installs the background tracker: compiles the supervisor and tracker into <dataDir>\bin and
// registers a logon task that runs the supervisor. Running it again is the update path.
// `bun run install-autostart` / `bun run uninstall-autostart`.
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, SUPERVISOR_EXE, TRACKER_EXE } from "../src/server/paths";
import { DASHBOARD_PORT } from "../src/shared/constants";
import { killImage, stopTracker } from "./stop";

const TASK_NAME = "RLTracker";
const SERVER_DIR = join(import.meta.dirname, "..", "src", "server");

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Task Scheduler definition. Declared UTF-16, so it must be written as UTF-16 with a BOM. */
export function taskXml({ userId, exe, workDir }: { userId: string; exe: string; workDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>RL Tracker: records Rocket League matches in the background.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(userId)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEscape(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(exe)}</Command><WorkingDirectory>${xmlEscape(workDir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

class StepFailed extends Error {}

function run(cmd: string[]): string {
  const res = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) throw new StepFailed(`${cmd.slice(0, 2).join(" ")} failed (exit ${String(res.exitCode)}):\n${res.stderr.toString().trim() || res.stdout.toString().trim()}`);
  return res.stdout.toString();
}

/** A running exe can't be opened for writing, so this says whether it's still in use. */
function locked(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    closeSync(openSync(path, "r+"));
    return false;
  } catch {
    return true;
  }
}

async function waitUnlocked(paths: string[], ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (paths.some(locked)) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(250);
  }
  return true;
}

/** Stops the background tracker and its supervisor, so their exes can be replaced or removed. */
async function stopInstalled(bin: string): Promise<void> {
  const exes = [join(bin, SUPERVISOR_EXE), join(bin, TRACKER_EXE)];
  const { message, exitCode, notRunning } = await stopTracker(DASHBOARD_PORT, true);
  console.log(message);
  if (exitCode !== 0 && !notRunning) throw new StepFailed("Could not stop the running tracker.");
  if (await waitUnlocked(exes, 10_000)) return;
  // A supervisor sleeping between restarts has no tracker to ask; nothing is recording, so ending
  // it loses nothing. The supervisor goes first so it can't start the tracker again.
  console.log("Ending the leftover background processes.");
  for (const exe of [SUPERVISOR_EXE, TRACKER_EXE]) killImage(exe);
  if (!(await waitUnlocked(exes, 10_000))) throw new StepFailed(`${bin} is still in use; close RL Tracker in Task Manager and try again.`);
}

/** Moves `from` over `to`, retrying while antivirus still holds the fresh exe. */
async function replace(from: string, to: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const locked = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!locked || Date.now() > deadline) throw new StepFailed(`Could not replace ${to}: ${(err as Error).message}. Run bun run install-autostart again.`);
      await Bun.sleep(250);
    }
  }
}

async function install(): Promise<void> {
  const bin = join(dataDir(), "bin");
  mkdirSync(bin, { recursive: true });
  // Build beside the installed pair while it keeps recording, and stop it only once both built, so
  // a failed build leaves it intact and running.
  const builds = [
    { entry: join(SERVER_DIR, "supervisor.ts"), exe: join(bin, SUPERVISOR_EXE), fresh: join(bin, "rltracker-supervisor.new.exe") },
    { entry: join(SERVER_DIR, "main.ts"), exe: join(bin, TRACKER_EXE), fresh: join(bin, "rltracker.new.exe") },
  ];
  try {
    for (const { entry, exe, fresh } of builds) {
      console.log(`Building ${exe}`);
      run([process.execPath, "build", "--compile", "--windows-hide-console", entry, "--outfile", fresh]);
    }
    await stopInstalled(bin);
    for (const { exe, fresh } of builds) await replace(fresh, exe);
  } finally {
    // A swapped-in build is gone already; whatever failed leaves no ~92 MB leftovers.
    for (const { fresh } of builds) rmSync(fresh, { force: true });
  }

  const supervisor = join(bin, SUPERVISOR_EXE);
  const xmlPath = join(tmpdir(), "rltracker-task.xml");
  writeFileSync(xmlPath, "﻿" + taskXml({ userId: `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`, exe: supervisor, workDir: bin }), "utf16le");
  try {
    run(["schtasks", "/Create", "/TN", TASK_NAME, "/XML", xmlPath, "/F"]);
  } finally {
    rmSync(xmlPath, { force: true });
  }
  run(["schtasks", "/Run", "/TN", TASK_NAME]);
  console.log(`RL Tracker is installed in ${bin} and running; it starts at each logon.`);
  console.log("Stop it: bun run stop. Remove it: bun run uninstall-autostart. After code changes, run bun run install-autostart again.");
}

async function uninstall(): Promise<void> {
  const bin = join(dataDir(), "bin");
  try {
    run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"]);
    console.log(`Removed the ${TASK_NAME} task.`);
  } catch (err) {
    // Usually it's already gone. If the delete failed for another reason (printed above), going on is
    // still safe: a task left pointing at a removed exe just fails at logon.
    console.log((err as Error).message);
  }
  await stopInstalled(bin);
  try {
    rmSync(bin, { recursive: true, force: true });
    console.log(`Removed ${bin}. Your data in ${dataDir()} is kept.`);
  } catch (err) {
    throw new StepFailed(`Could not remove ${bin} (${(err as Error).message}); run bun run stop first.`);
  }
}

if (import.meta.main) {
  const action = process.argv[2];
  if (action !== "install" && action !== "uninstall") {
    console.error("usage: bun run scripts/autostart.ts install|uninstall");
    process.exit(1);
  }
  try {
    await (action === "install" ? install() : uninstall());
  } catch (err) {
    if (!(err instanceof StepFailed)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
