import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  checkStatsConfig,
  describeProblem,
  diagnose,
  expandEnv,
  expectedPort,
  findUserConfigDir,
  parseEpicManifest,
  parseRegSz,
  parseStatsIni,
  type Locator,
  type UserDirResult,
} from "./stats-config";
import type { CommandResult } from "./powershell";
import { memoryLogger } from "./testing";

// TAStatsAPI.ini as found on the dev machine, CRLF line ends.
const REAL_INI = [
  "[TAGame.MatchStatsExporter_TA]",
  "",
  "; Port the client will listen for tcp connections on (must be different than WebPort, set to 0 to disable)",
  "Port=49123",
  "",
  "; Port the client will listen for web connections on (must be different than Port, set to 0 to disable)",
  "WebPort=49124",
  "",
  "; How many times per second the game sends the update state (capped at 120, 0 disables this feature)",
  "PacketSendRate=30",
].join("\r\n");

describe("parseStatsIni", () => {
  test("reads the real file", () => {
    expect(parseStatsIni(REAL_INI)).toEqual({ packetSendRate: 30, port: 49123, webPort: 49124 });
  });

  test("section and keys are case-insensitive, values trimmed, a BOM ignored", () => {
    expect(parseStatsIni("﻿[tagame.matchstatsexporter_ta]\npacketsendrate =  0 \n")).toEqual({ packetSendRate: 0 });
  });

  test("only the exporter section counts", () => {
    expect(parseStatsIni("[Other]\nPacketSendRate=30\n[TAGame.MatchStatsExporter_TA]\nWebPort=1\n[Next]\nPort=2\n")).toEqual({ webPort: 1 });
    expect(parseStatsIni("PacketSendRate=30\n")).toEqual({});
  });

  test("a non-numeric value stays undefined; a commented-out key is skipped", () => {
    expect(parseStatsIni("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=fast\n;WebPort=49124\nPort=\n")).toEqual({});
  });
});

describe("diagnose", () => {
  const good = { packetSendRate: 30, port: 49123, webPort: 49124 };
  const shippedDefault = { packetSendRate: 0, port: 49123, webPort: 49124 };

  test("a good Documents copy has no problems", () => {
    expect(diagnose({ user: good, install: null, default: shippedDefault }, 49124)).toEqual({ file: "user", effective: good, problems: [] });
  });

  test("the Documents copy's 0 beats the install copy's 30", () => {
    expect(diagnose({ user: { ...good, packetSendRate: 0 }, install: good, default: shippedDefault }, 49124)).toEqual({
      file: "user",
      effective: { ...good, packetSendRate: 0 },
      problems: ["send_rate_off"],
    });
  });

  test("no Documents copy is a problem even when the install copy is good", () => {
    expect(diagnose({ user: null, install: good, default: shippedDefault }, 49124)).toEqual({ file: "install", effective: good, problems: ["user_missing"] });
  });

  test("only the shipped Default: the Documents copy is missing, and the send rate is off", () => {
    expect(diagnose({ user: null, install: null, default: shippedDefault }, 49124)).toEqual({
      file: "default",
      effective: shippedDefault,
      problems: ["user_missing", "send_rate_off"],
    });
  });

  test("no file at all", () => {
    expect(diagnose({ user: null, install: null, default: null }, 49124)).toEqual({ file: null, effective: {}, problems: ["no_ini"] });
  });

  test("a key missing from a higher layer comes from the one below", () => {
    expect(diagnose({ user: { webPort: 49124 }, install: null, default: shippedDefault }, 49124).problems).toEqual(["send_rate_off"]);
    expect(diagnose({ user: { webPort: 49124 }, install: { packetSendRate: 30 }, default: shippedDefault }, 49124).problems).toEqual([]);
    expect(diagnose({ user: { webPort: 49124 }, install: null, default: null }, 49124).problems).toEqual(["send_rate_off"]);
  });

  test("send rate 0 or negative is off", () => {
    expect(diagnose({ user: { ...good, packetSendRate: 0 }, install: null, default: null }, 49124).problems).toEqual(["send_rate_off"]);
    expect(diagnose({ user: { ...good, packetSendRate: -1 }, install: null, default: null }, 49124).problems).toEqual(["send_rate_off"]);
  });

  test("WebPort 0 is off; another WebPort is a mismatch", () => {
    expect(diagnose({ user: { ...good, webPort: 0 }, install: null, default: null }, 49124).problems).toEqual(["web_port_off"]);
    expect(diagnose({ user: { ...good, webPort: 49200 }, install: null, default: null }, 49124).problems).toEqual(["web_port_mismatch"]);
    expect(diagnose({ user: good, install: null, default: null }, 49200).problems).toEqual(["web_port_mismatch"]);
    // Missing from every file: no port is opened, same as 0.
    expect(diagnose({ user: { packetSendRate: 30 }, install: null, default: null }, 49124).problems).toEqual(["web_port_off"]);
  });
});

describe("describeProblem", () => {
  const userIni = "Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini";

  test("with the Documents copy in effect, names it", () => {
    expect(describeProblem("send_rate_off", 49124, "user")).toBe(`Set PacketSendRate to 30 in ${userIni}, then restart the game.`);
    expect(describeProblem("web_port_off", 49124, "user")).toBe(`Set WebPort to 49124 in ${userIni}, then restart the game.`);
    expect(describeProblem("web_port_mismatch", 49200, "user")).toBe(`Set WebPort to 49200 in ${userIni} (the port the tracker connects to), then restart the game.`);
  });

  test("with an install file in effect, names the game's config folder", () => {
    const where = "TAStatsAPI.ini in the game's TAGame\\Config folder";
    expect(describeProblem("send_rate_off", 49124, "install")).toBe(`Set PacketSendRate to 30 in ${where}, then restart the game.`);
    expect(describeProblem("web_port_off", 49124, "default")).toBe(`Set WebPort to 49124 in ${where}, then restart the game.`);
  });

  test("a missing Documents copy, or no file at all, points at the Documents path", () => {
    const text = `Rocket League's settings file ${userIni} wasn't found. Set PacketSendRate=30 there, then restart the game.`;
    expect(describeProblem("user_missing", 49124, "install")).toBe(text);
    expect(describeProblem("no_ini", 49124, null)).toBe(text);
  });

  test("no problem: points at a restart", () => {
    expect(describeProblem(undefined, 49124, "user")).toBe("The settings file looks right but no data arrived. Restart the game if you edited it while it was running.");
  });
});

describe("parseRegSz", () => {
  // `reg query "HKCU\...\User Shell Folders" /v Personal` on the dev machine, byte for byte.
  const REAL_REG = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    Personal    REG_EXPAND_SZ    C:\\Users\\riddh\\OneDrive\\Documents\r\n\r\n";

  test("reads the real output", () => {
    expect(parseRegSz(REAL_REG, "Personal")).toBe("C:\\Users\\riddh\\OneDrive\\Documents");
  });

  test("spaces inside the path survive; REG_SZ works too; the name is case-insensitive", () => {
    const out = "\r\nHKEY_CURRENT_USER\\X\r\n    Personal    REG_SZ    C:\\Users\\John Smith\\OneDrive - Contoso\\Documents  \r\n\r\n";
    expect(parseRegSz(out, "personal")).toBe("C:\\Users\\John Smith\\OneDrive - Contoso\\Documents");
  });

  test("an unexpanded variable is returned as-is", () => {
    expect(parseRegSz("    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents\r\n", "Personal")).toBe("%USERPROFILE%\\Documents");
  });

  test("a missing value or an empty output is null", () => {
    expect(parseRegSz("\r\nHKEY_CURRENT_USER\\X\r\n    Desktop    REG_EXPAND_SZ    C:\\D\r\n", "Personal")).toBeNull();
    expect(parseRegSz("    Personal    REG_EXPAND_SZ    \r\n", "Personal")).toBeNull();
    expect(parseRegSz("", "Personal")).toBeNull();
  });
});

describe("expandEnv", () => {
  const env = { USERPROFILE: "C:\\Users\\riddh", OneDrive: "C:\\Users\\riddh\\OneDrive" };

  test("expands %VAR%, case-insensitively", () => {
    expect(expandEnv("%UserProfile%\\Documents", env)).toBe("C:\\Users\\riddh\\Documents");
    expect(expandEnv("%ONEDRIVE%\\Documents", env)).toBe("C:\\Users\\riddh\\OneDrive\\Documents");
  });

  test("an unknown variable and plain text are left alone", () => {
    expect(expandEnv("%NOPE%\\Documents", env)).toBe("%NOPE%\\Documents");
    expect(expandEnv("C:\\Docs", env)).toBe("C:\\Docs");
  });
});

describe("parseEpicManifest", () => {
  test("Rocket League's manifest (AppName Sugar) gives its install location", () => {
    expect(parseEpicManifest(JSON.stringify({ AppName: "Sugar", InstallLocation: "C:\\Games\\rocketleague" }))).toBe("C:\\Games\\rocketleague");
  });

  test("another app, a missing location or bad JSON is null", () => {
    expect(parseEpicManifest(JSON.stringify({ AppName: "Fortnite", InstallLocation: "C:\\Games\\Fortnite" }))).toBeNull();
    expect(parseEpicManifest(JSON.stringify({ AppName: "Sugar" }))).toBeNull();
    expect(parseEpicManifest("{not json")).toBeNull();
    expect(parseEpicManifest("null")).toBeNull();
  });
});

describe("checkStatsConfig", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rltracker-statscfg-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const ini = (rate: number) => `[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=${String(rate)}\r\nWebPort=49124\r\n`;
  /** An install dir holding the given ini files under TAGame\Config. */
  const install = (name: string, files: Record<string, string | Buffer>) => {
    const dir = join(root, name);
    mkdirSync(join(dir, "TAGame", "Config"), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, "TAGame", "Config", file), text);
    return dir;
  };
  /** A Documents config dir, holding TAStatsAPI.ini when given its text. */
  const userConfig = (text?: string | Buffer) => {
    const dir = join(root, "docs", "My Games", "Rocket League", "TAGame", "Config");
    mkdirSync(dir, { recursive: true });
    if (text !== undefined) writeFileSync(join(dir, "TAStatsAPI.ini"), text);
    return dir;
  };
  const found = (method: string, dir: string): Locator => ({ method, find: () => Promise.resolve({ dir }) });
  const missed = (method: string, outcome: string): Locator => ({ method, find: () => Promise.resolve({ outcome }) });
  const userAt = (dir: string) => (): Promise<UserDirResult> => Promise.resolve({ dir, foundBy: "registry", tried: [] });
  const noUser = () => Promise.resolve({ outcome: "no_userprofile" });

  test("the Documents copy's 0 beats the install's 30: logged with every layer and the path in effect", async () => {
    const dir = install("rl", { "TAStatsAPI.ini": ini(30) });
    const userDir = userConfig(ini(0));
    const logger = memoryLogger();
    const result = await checkStatsConfig({ expectedWebPort: 49124, logger, locators: [found("epic", dir)], userDir: userAt(userDir) });
    expect(result).toMatchObject({
      installDir: dir,
      foundBy: "epic",
      userConfigDir: userDir,
      file: "user",
      path: join(userDir, "TAStatsAPI.ini"),
      problems: ["send_rate_off"],
    });
    expect(logger.lines).toMatchObject([
      {
        level: "warn",
        cat: "game",
        event: "stats_config",
        fields: {
          userConfigDir: userDir,
          userFoundBy: "registry",
          installDir: dir,
          path: join(userDir, "TAStatsAPI.ini"),
          layers: { user: { packetSendRate: 0, webPort: 49124 }, install: { packetSendRate: 30, webPort: 49124 }, default: null },
          problems: ["send_rate_off"],
        },
      },
    ]);
  });

  test("a good config logs at info; a UTF-16 file is read", async () => {
    const text = ini(30);
    const userDir = userConfig(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    const logger = memoryLogger();
    const result = await checkStatsConfig({ expectedWebPort: 49124, logger, locators: [], userDir: userAt(userDir) });
    expect(result?.problems).toEqual([]);
    expect(logger.lines[0]?.level).toBe("info");
  });

  test("no install found but a Documents copy: still a result", async () => {
    const userDir = userConfig(ini(30));
    const logger = memoryLogger();
    const result = await checkStatsConfig({ expectedWebPort: 49124, logger, locators: [missed("epic", "not_listed")], userDir: userAt(userDir) });
    expect(result).toMatchObject({ installDir: null, foundBy: null, file: "user", problems: [] });
    expect(logger.lines[0]?.fields.tried).toEqual([{ method: "epic", outcome: "not_listed" }]);
  });

  test("no Documents dir: user_missing from the install files, and the Default's path when it's all there is", async () => {
    const dir = install("rl", { "DefaultStatsAPI.ini": ini(0) });
    const logger = memoryLogger();
    const result = await checkStatsConfig({ expectedWebPort: 49124, logger, locators: [found("epic", dir)], userDir: noUser });
    expect(result).toMatchObject({
      userConfigDir: null,
      file: "default",
      path: join(dir, "TAGame", "Config", "DefaultStatsAPI.ini"),
      problems: ["user_missing", "send_rate_off"],
    });
    expect(logger.lines[0]?.fields.tried).toEqual([{ method: "documents", outcome: "no_userprofile" }]);
  });

  test("a Documents lookup that rejects is recorded, and the install still counts", async () => {
    const dir = install("rl", { "TAStatsAPI.ini": ini(30) });
    const logger = memoryLogger();
    const result = await checkStatsConfig({
      expectedWebPort: 49124,
      logger,
      locators: [found("epic", dir)],
      userDir: () => Promise.reject(new Error("spawn reg ENOENT")),
    });
    expect(result).toMatchObject({ file: "install", path: join(dir, "TAGame", "Config", "TAStatsAPI.ini"), problems: ["user_missing"] });
    expect(logger.lines[0]?.fields.tried).toEqual([{ method: "documents", outcome: "error: spawn reg ENOENT" }]);
  });

  test("a Documents dir without the file is user_missing too", async () => {
    const dir = install("rl", { "TAStatsAPI.ini": ini(30) });
    const result = await checkStatsConfig({ expectedWebPort: 49124, logger: memoryLogger(), locators: [found("epic", dir)], userDir: userAt(userConfig()) });
    expect(result).toMatchObject({ file: "install", problems: ["user_missing"] });
  });

  test("the Documents lookup's own failed attempts are logged", async () => {
    const userDir = userConfig(ini(30));
    const logger = memoryLogger();
    await checkStatsConfig({
      expectedWebPort: 49124,
      logger,
      locators: [],
      userDir: () => Promise.resolve({ dir: userDir, foundBy: "userprofile", tried: [{ method: "documents", outcome: "exit 1" }] }),
    });
    expect(logger.lines[0]?.fields).toMatchObject({ userFoundBy: "userprofile", tried: [{ method: "documents", outcome: "exit 1" }] });
  });

  test("a failing locator, a throwing one and a dir with no TAGame\\Config fall through to the next", async () => {
    const dir = install("rl", { "TAStatsAPI.ini": ini(30) });
    const logger = memoryLogger();
    const throwing: Locator = { method: "boom", find: () => Promise.reject(new Error("wmi broke")) };
    const result = await checkStatsConfig({
      expectedWebPort: 49124,
      logger,
      locators: [missed("other", "timeout"), throwing, found("stale", join(root, "nowhere")), found("epic", dir)],
      userDir: userAt(userConfig(ini(30))),
    });
    expect(result).toMatchObject({ foundBy: "epic", problems: [] });
    expect(logger.lines[0]?.fields.tried).toEqual([
      { method: "other", outcome: "timeout" },
      { method: "boom", outcome: "error: wmi broke" },
      { method: "stale", outcome: "no_config_dir" },
    ]);
  });

  test("neither found: null, and what was tried is logged", async () => {
    const logger = memoryLogger();
    const result = await checkStatsConfig({ expectedWebPort: 49124, logger, locators: [missed("epic", "not_listed")], userDir: noUser });
    expect(result).toBeNull();
    expect(logger.lines).toEqual([
      expect.objectContaining({
        cat: "game",
        event: "stats_config_unknown",
        fields: { tried: [{ method: "documents", outcome: "no_userprofile" }, { method: "epic", outcome: "not_listed" }] },
      }),
    ]);
  });
});

describe("findUserConfigDir", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rltracker-userdir-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const regOut = (value: string) => `\r\nHKEY_CURRENT_USER\\X\r\n    Personal    REG_EXPAND_SZ    ${value}\r\n\r\n`;
  const ran = (r: Partial<CommandResult>) => () => Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false, ...r });
  const configUnder = (docs: string) => join(docs, "My Games", "Rocket League", "TAGame", "Config");

  test("the registry's Documents folder, its variables expanded", async () => {
    const docs = join(root, "OneDrive", "Documents");
    mkdirSync(docs, { recursive: true });
    const result = await findUserConfigDir({ run: ran({ stdout: regOut("%OneDrive%\\Documents") }), env: { OneDrive: join(root, "OneDrive"), USERPROFILE: root } });
    expect(result).toEqual({ dir: configUnder(docs), foundBy: "registry", tried: [] });
  });

  test.each([
    ["a nonzero exit", { code: 1, stderr: "ERROR: The system was unable to find the specified registry key or value." }, "exit 1"],
    ["a timeout", { code: null, timedOut: true }, "timeout"],
    ["an unparsable value", { stdout: "nothing useful" }, "unparsable"],
    ["a folder that doesn't exist", { stdout: regOut("C:\\nowhere\\Documents") }, "missing C:\\nowhere\\Documents"],
  ])("%s falls back to Documents under USERPROFILE", async (_name, r, outcome) => {
    const result = await findUserConfigDir({ run: ran(r), env: { USERPROFILE: root } });
    expect(result).toEqual({ dir: configUnder(join(root, "Documents")), foundBy: "userprofile", tried: [{ method: "documents", outcome }] });
  });

  test("no USERPROFILE to fall back on", async () => {
    expect(await findUserConfigDir({ run: ran({ code: 1 }), env: {} })).toEqual({ outcome: "exit 1; no_userprofile" });
  });
});

describe("expectedPort", () => {
  test("an explicit port", () => {
    expect(expectedPort("ws://127.0.0.1:49124")).toBe(49124);
  });

  test("no port means the scheme default", () => {
    expect(expectedPort("ws://localhost")).toBe(80);
    expect(expectedPort("wss://localhost/")).toBe(443);
  });
});
