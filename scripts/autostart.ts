// Installs the background tracker: compiles the supervisor and tracker into <dataDir>\bin, builds
// the dashboard into <dataDir>\bin\web, registers a logon task that runs the supervisor, and adds a
// Start menu shortcut to the dashboard. Running it again is the update path.
// `bun run install-autostart` / `bun run uninstall-autostart`.
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dataDir, SUPERVISOR_EXE, TRACKER_EXE } from "../src/server/paths";
import { DASHBOARD_HOST, DASHBOARD_PORT } from "../src/shared/constants";
import { killImage, stopTracker } from "./stop";

const TASK_NAME = "RLTracker";
const REPO = join(import.meta.dirname, "..");
const SERVER_DIR = join(REPO, "src", "server");
const DASHBOARD_URL = `http://${DASHBOARD_HOST}:${String(DASHBOARD_PORT)}/`;

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

/** A Start menu Internet Shortcut: it opens the URL in the default browser and never runs the tracker. */
export function shortcutFile(url: string): string {
  return `[InternetShortcut]\r\nURL=${url}\r\n`;
}

class StepFailed extends Error {}

function run(cmd: string[], cwd?: string): string {
  const res = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
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

/** Best-effort removal of an install leftover: a held file only costs disk until the next install. */
function removeLeftover(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  } catch (err) {
    // Only rmSync above; a failure here must not hide the real outcome or skip the restart.
    console.log(`Could not remove ${path} (${(err as Error).message}); the next install removes it.`);
  }
}

/** Swaps the fresh web build in, putting the old one back if that fails. Runs with the tracker stopped. */
async function swapWeb(fresh: string, web: string): Promise<void> {
  const old = `${web}.old`;
  let hadOld: boolean;
  if (existsSync(web)) {
    removeLeftover(old);
    await replace(web, old);
    hadOld = true;
  } else {
    // From an interrupted install whose rollback failed: the leftover is the only working dashboard,
    // so it stays as the backup rather than being deleted.
    hadOld = existsSync(old);
  }
  try {
    await replace(fresh, web);
  } catch (err) {
    if (hadOld) {
      try {
        renameSync(old, web);
      } catch (rollback) {
        throw new StepFailed(`${(err as Error).message} Putting the previous dashboard back also failed (${(rollback as Error).message}); it is in ${old}.`);
      }
    }
    throw err;
  }
  removeLeftover(old);
}

/** The Start menu shortcut, or null when APPDATA is unset. */
function shortcutPath(): string | null {
  const appData = process.env.APPDATA;
  return appData ? join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "RL Tracker.url") : null;
}

/** Best-effort: by now the tracker is installed and running, so a missing shortcut only costs a lookup of the URL. */
function writeShortcut(): void {
  const path = shortcutPath();
  if (path === null) {
    console.log(`Could not create the Start menu shortcut (APPDATA is not set); the dashboard is at ${DASHBOARD_URL}`);
    return;
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, shortcutFile(DASHBOARD_URL));
    console.log(`Added the Start menu shortcut ${path}`);
  } catch (err) {
    // Only filesystem calls above; any failure degrades the same way.
    console.log(`Could not create the Start menu shortcut (${(err as Error).message}); the dashboard is at ${DASHBOARD_URL}`);
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
  const web = join(bin, "web");
  const webFresh = join(bin, "web.new");
  let swapFailed: StepFailed | null = null;
  try {
    for (const { entry, exe, fresh } of builds) {
      console.log(`Building ${exe}`);
      run([process.execPath, "build", "--compile", "--windows-hide-console", entry, "--outfile", fresh]);
    }
    // Its own build, not the repo's dist/, which may be stale.
    console.log(`Building the dashboard into ${web}`);
    try {
      run([process.execPath, "run", "web:build", "--outDir", webFresh, "--emptyOutDir"], REPO);
    } catch (err) {
      if (!(err instanceof StepFailed)) throw err;
      throw new StepFailed(`Building the dashboard failed: ${err.message}`);
    }
    await stopInstalled(bin);
    for (const { exe, fresh } of builds) await replace(fresh, exe);
    console.log("Swapping in the new dashboard");
    try {
      await swapWeb(webFresh, web);
    } catch (err) {
      // Only filesystem calls in swapWeb, so any failure degrades the same way: the new exes are in
      // place, the tracker still gets restarted below, and the install reports it once it's running.
      swapFailed = err instanceof StepFailed ? err : new StepFailed(`Could not swap in the new dashboard: ${(err as Error).message}.`);
    }
  } finally {
    // A swapped-in build is gone already; whatever failed leaves no ~92 MB leftovers.
    for (const { fresh } of builds) removeLeftover(fresh);
    removeLeftover(webFresh);
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
  writeShortcut();
  if (swapFailed !== null) throw new StepFailed(`RL Tracker is running again, but the dashboard was not updated: ${swapFailed.message}`);
  console.log(`RL Tracker is installed in ${bin} and running; it starts at each logon. The dashboard is at ${DASHBOARD_URL}`);
  console.log("Stop it: bun run stop. Remove it: bun run uninstall-autostart. After code changes, run bun run deploy.");
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
  const shortcut = shortcutPath();
  if (shortcut !== null && existsSync(shortcut)) {
    try {
      rmSync(shortcut, { force: true });
      console.log("Removed the Start menu shortcut.");
    } catch (err) {
      console.log(`Could not remove the Start menu shortcut ${shortcut} (${(err as Error).message}); delete it by hand.`);
    }
  }
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
