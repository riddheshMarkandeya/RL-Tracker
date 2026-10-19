// Cuts a time window out of a capture into an anonymised test fixture (test/fixtures/<name>.ndjson).
// Usage: bun run scripts/make-fixture.ts <capture.ndjson> <fromISO> <toISO> <name>
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseFrame, type Data } from "../src/server/recorder/envelope";
import { parseCaptureLine } from "../src/server/recorder/feed";
import { BOT_ID } from "../src/server/recorder/players";
import { createUpdateStateSampler } from "../src/server/recorder/sampler";
import { stripRepeatLoadouts } from "../src/server/recorder/store";

const DEFAULT_TEAM_NAMES = new Set(["Blue", "Orange"]);
/**
 * Fixtures keep about one UpdateState per 3 s, plus the one held before each lifecycle, goal or
 * statfeed event, to stay small. The once-a-second and per-touch events below don't get a held
 * state written before them (the live sampler's rule), which would put states back near 1/s; the
 * state held when one passes is dropped instead, so lines stay in time order.
 */
const FIXTURE_STATE_INTERVAL_MS = 3000;
const NO_HELD_STATE = new Set(["ClockUpdatedSeconds", "BallHit"]);
const MAX_FIXTURES_BYTES = 5 * 1024 * 1024;
/** Shorter real values would match by accident (e.g. a 2-letter name inside an arena name). */
const MIN_LEAK_LENGTH = 3;

type Json = unknown;

/**
 * Replaces player names, PrimaryIds and club names by stable fakes, by field rather than by text,
 * so escapes in names and names that are common words can't corrupt or slip past it. Bots
 * (shared id `Unknown|0|0`, public names) and the default Blue/Orange team names stay.
 */
export function createAnonymiser() {
  const names = new Map<string, string>();
  const ids = new Map<string, string>();
  const teams = new Map<string, string>();
  const botNames = new Set<string>();

  // "" stays "": a blank Scorer is what marks a replay's duplicate GoalScored.
  const fakeName = (real: string) => {
    if (real === "" || botNames.has(real)) return real;
    let fake = names.get(real);
    if (fake === undefined) names.set(real, (fake = `Player ${String(names.size + 1)}`));
    return fake;
  };
  const fakeId = (real: string) => {
    if (real === "" || real === BOT_ID) return real;
    let fake = ids.get(real);
    if (fake === undefined) {
      const platform = real.split("|")[0] ?? "Unknown";
      ids.set(real, (fake = `${platform}|anon${String(ids.size + 1)}|0`));
    }
    return fake;
  };
  const fakeTeam = (real: string) => {
    if (DEFAULT_TEAM_NAMES.has(real) || real === "") return real;
    let fake = teams.get(real);
    if (fake === undefined) teams.set(real, (fake = `Club ${String(teams.size + 1)}`));
    return fake;
  };

  function walk(value: Json, parentKey: string): Json {
    if (Array.isArray(value)) return value.map((v) => walk(v, parentKey));
    if (typeof value !== "object" || value === null) return value;
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== "string") out[k] = walk(v, k);
      else if (k === "PrimaryId") out[k] = fakeId(v);
      else if (k === "Winner" || (k === "Name" && parentKey === "Teams")) out[k] = fakeTeam(v);
      else if (k === "Name" || k === "PlayerName") out[k] = fakeName(v);
      else out[k] = v;
    }
    return out;
  }

  return {
    /** Records bot names, so a bot named only by `Name` elsewhere (BallHit, Statfeed) keeps it. */
    learn(data: Data): void {
      const players = Array.isArray(data.Players) ? (data.Players as { Name?: unknown; PrimaryId?: unknown }[]) : [];
      for (const p of [...players, { Name: data.PlayerName, PrimaryId: data.PrimaryId }]) {
        if (p.PrimaryId === BOT_ID && typeof p.Name === "string") botNames.add(p.Name);
      }
    },
    anonymise: (data: Data) => walk(data, "") as Data,
    realValues: () => [...names.keys(), ...ids.keys(), ...teams.keys()],
  };
}

/** Real values still present anywhere in `data`'s strings. */
export function leaks(data: Json, realValues: readonly string[]): string[] {
  const strings: string[] = [];
  const collect = (v: Json): void => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "object" && v !== null) Object.values(v).forEach(collect);
  };
  collect(data);
  return realValues.filter((r) => r.length >= MIN_LEAK_LENGTH && strings.some((s) => s.includes(r)));
}

async function* windowLines(path: string, from: number, to: number) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const parsed = parseCaptureLine(line);
    if (!parsed) continue;
    const { t, raw } = parsed;
    if (t < from) continue;
    if (t > to) break;
    yield { t, raw };
  }
}

async function main(): Promise<void> {
  const [capture, fromIso, toIso, name] = process.argv.slice(2);
  if (!capture || !fromIso || !toIso || !name) {
    console.error("usage: bun run scripts/make-fixture.ts <capture.ndjson> <fromISO> <toISO> <name>");
    process.exit(2);
  }
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const anon = createAnonymiser();
  for await (const { raw } of windowLines(capture, from, to)) {
    const parsed = parseFrame(raw);
    if (parsed.ok) anon.learn(parsed.ev.data);
  }

  const sampler = createUpdateStateSampler<{ t: number; event: string; data: Data }>(FIXTURE_STATE_INTERVAL_MS);
  const loadoutSeen = new Set<string>();
  const out: string[] = [];
  const counts = { lines: 0, unparsed: 0 };
  const emit = (l: { t: number; event: string; data: Data }) => {
    const players = l.data.Players;
    const data = anon.anonymise(Array.isArray(players) ? { ...l.data, Players: stripRepeatLoadouts(players, loadoutSeen) } : l.data);
    const found = leaks(data, anon.realValues());
    if (found.length > 0) throw new Error(`leak in ${l.event} at t=${String(l.t)} (${String(found.length)} values)`);
    out.push(JSON.stringify({ t: l.t, raw: JSON.stringify({ Event: l.event, Data: JSON.stringify(data) }) }));
  };
  for await (const { t, raw } of windowLines(capture, from, to)) {
    counts.lines++;
    const parsed = parseFrame(raw);
    // Dropped rather than copied: an unparsed line can't be anonymised.
    if (!parsed.ok) {
      counts.unparsed++;
      continue;
    }
    const line = { t, event: parsed.ev.name, data: parsed.ev.data };
    if (NO_HELD_STATE.has(line.event)) {
      sampler.flush();
      emit(line);
    } else {
      sampler.offer(line).forEach(emit);
    }
  }
  const held = sampler.flush();
  if (held) emit(held);

  const dir = fileURLToPath(new URL("../test/fixtures", import.meta.url));
  const path = join(dir, `${name}.ndjson`);
  writeFileSync(path, `${out.join("\n")}\n`);
  const total = readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
  console.log(`${path}: ${String(out.length)} of ${String(counts.lines)} lines, ${String(counts.unparsed)} unparsed dropped, fixtures total ${(total / 1e6).toFixed(2)} MB`);
  if (total > MAX_FIXTURES_BYTES) {
    console.error(`test/fixtures is over ${String(MAX_FIXTURES_BYTES / 1024 / 1024)} MB`);
    process.exit(1);
  }
}

if (import.meta.main) await main();
