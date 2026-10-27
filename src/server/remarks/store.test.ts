import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createPages } from "../api/pages";
import { createQueryReader } from "../query/read";
import { createRecordWriter } from "../records/save";
import { openStorage, type Storage } from "../storage";
import { memoryLogger, ME, record } from "../testing";
import { createRemarks } from "./store";

// Late night reads the local hour; UTC keeps the instants readable and every session midday.
const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = zone;
});

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rltracker-remarks-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', 1)", ME);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 10, 12);
/** The nth match of the session at T0, 10 minutes apart. */
const slot = (n: number) => T0 + n * 10 * MIN;

/** Cycles through fixed draws, so a re-pick would land on a different line than the last one. */
const cycling = () => {
  let i = 0;
  const draws = [0, 0.5, 0.99, 0.25, 0.75];
  return () => draws[i++ % draws.length] ?? 0;
};

function setup() {
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  const play = (guid: string, at: number, { won = true, events = {} }: { won?: boolean; events?: Record<string, number> } = {}) => {
    const statfeed = Object.entries({ Goal: 1, ...events }).map(([eventName, count]) => ({ playerKey: ME, eventName, count }));
    writer.save(record(guid, at, { statfeed }, { endedAt: at + 5 * MIN, winnerTeamNum: won ? 0 : 1 }));
  };
  const logger = memoryLogger();
  const remarks = (now: number, rng = cycling()) => {
    const reader = createQueryReader({ tracker: storage.tracker, logger: memoryLogger() });
    return createRemarks({ tracker: storage.tracker, pages: createPages({ reader, now: () => now }), logger, now: () => now, rng });
  };
  const logged = (event: string) => logger.lines.filter((l) => l.event === event).map((l) => l.fields);
  const picked = () => logged("remark_picked");
  return { play, remarks, picked, logged };
}

describe("remarks store", () => {
  test("revisiting shows the same lines, with the quip's numbers filled from the session", () => {
    const { play, remarks, picked } = setup();
    for (let i = 0; i < 4; i++) play(`M${String(i)}`, slot(i), { events: i === 0 ? { HatTrick: 1 } : {} });
    const later = T0 + 2 * DAY;
    const first = remarks(later).get("M0", "everything");
    expect(first?.quip).toMatchObject({ trigger: "hat_trick", values: { n: 1 } });
    expect(first?.mood.band).toBe("great");
    expect(remarks(later + DAY).get("M0", "everything")).toEqual(first);
    expect(picked().map((f) => f.reason)).toEqual(["first"]);
  });

  test("each filter has its own pick; an unknown session or an empty filter has none", () => {
    const { play, remarks, picked } = setup();
    play("M0", slot(0));
    const r = remarks(T0 + DAY);
    expect(r.get("M0", "everything")).not.toBeNull();
    expect(r.get("M0", { playlist: 13 })).not.toBeNull();
    expect(r.get("M0", "casual")).toBeNull();
    expect(r.get("nope", "everything")).toBeNull();
    expect(picked().map((f) => f.filter)).toEqual(["everything", "13"]);
  });

  test("reroll changes both lines and the change sticks", () => {
    const { play, remarks, picked } = setup();
    play("M0", slot(0));
    play("M1", slot(1), { events: { HatTrick: 1 } });
    const r = remarks(T0 + DAY);
    const first = r.get("M0", "everything");
    const rolled = r.reroll("M0", "everything");
    expect(rolled?.mood.text).not.toBe(first?.mood.text);
    expect(rolled?.quip?.text).not.toBe(first?.quip?.text);
    expect(remarks(T0 + 2 * DAY).get("M0", "everything")).toEqual(rolled);
    expect(picked().map((f) => f.reason)).toEqual(["first", "reroll"]);
    expect(r.reroll("nope", "everything")).toBeNull();
  });

  test("lines shown in the last 10 sessions are avoided, older ones are fair game", () => {
    const { play, remarks, picked } = setup();
    const shown = (session: string, line: string, at: number) => storage.tracker.run("INSERT INTO remark_shown (line_id, session_key, shown_at) VALUES (?, ?, ?)", line, session, at);
    // 11 sessions before this one: S0 (outside the window) showed short-5, S1 short-4, the rest short-1..3.
    shown("S0", "short-5", 100);
    shown("S1", "short-4", 101);
    for (let s = 2; s <= 10; s++) shown(`S${String(s)}`, `short-${String((s % 3) + 1)}`, 100 + s);
    play("M0", slot(0));
    expect(remarks(T0 + DAY, () => 0).get("M0", "everything")?.mood.text).toBe("Blink and you'd miss it.");
    expect(picked()[0]).toMatchObject({ moodLine: "short-5", poolExhausted: false, recentCount: 4 });
  });

  test("a live session re-picks only what stopped fitting, and logs only the new line as shown", () => {
    const { play, remarks, picked } = setup();
    for (let i = 0; i < 3; i++) play(`M${String(i)}`, slot(i), { events: i === 0 ? { HatTrick: 1 } : {} });
    const live = (n: number) => slot(n) + 6 * MIN;
    const short = remarks(live(2)).get("M0", "everything");
    expect(short?.mood.band).toBe("short");
    play("M3", slot(3));
    const full = remarks(live(3)).get("M0", "everything");
    expect(full?.mood.band).toBe("great");
    expect(full?.quip).toEqual(short?.quip);
    const [, refit] = picked();
    expect(refit).toMatchObject({ reason: "refit", band: "great", trigger: "hat_trick" });
    expect(refit?.shown).toEqual([refit?.moodLine]);
  });

  test("a pick stored mid-session is re-fitted on the first view after the session, if matches came after it", () => {
    const { play, remarks, picked } = setup();
    for (let i = 0; i < 2; i++) play(`M${String(i)}`, slot(i));
    expect(remarks(slot(1) + 6 * MIN).get("M0", "everything")?.mood.band).toBe("short");
    for (let i = 2; i < 5; i++) play(`M${String(i)}`, slot(i)); // played with the recap closed
    expect(remarks(T0 + DAY).get("M0", "everything")?.mood.band).toBe("great");
    expect(remarks(T0 + 2 * DAY).get("M0", "everything")?.mood.band).toBe("great");
    expect(picked().map((f) => f.reason)).toEqual(["first", "refit"]);
  });

  test("a mid-session pick that still fits after the session is final from then on", () => {
    const { play, remarks, picked, logged } = setup();
    for (let i = 0; i < 4; i++) play(`M${String(i)}`, slot(i));
    const live = remarks(slot(3) + 6 * MIN).get("M0", "everything");
    expect(live?.mood.band).toBe("great");
    play("M4", slot(4)); // still great
    expect(remarks(T0 + DAY).get("M0", "everything")?.mood).toEqual(live?.mood);
    for (let i = 0; i < 6; i++) play(`B${String(i)}`, T0 - 5 * DAY + i * 10 * MIN); // a perfect baseline would make it usual
    expect(remarks(T0 + 2 * DAY).get("M0", "everything")?.mood).toEqual(live?.mood);
    expect(picked().map((f) => f.reason)).toEqual(["first"]);
    expect(logged("remark_final")).toEqual([{ sessionKey: "M0", filter: "everything", pickedAt: slot(3) + 6 * MIN, endedAt: slot(4) + 5 * MIN, at: T0 + DAY }]);
  });

  test("a finished session keeps its lines even when its band would change; the numbers follow the data", () => {
    const { play, remarks, picked } = setup();
    for (let i = 0; i < 3; i++) play(`M${String(i)}`, slot(i));
    const later = T0 + DAY;
    const before = remarks(later).get("M0", "everything");
    expect(before?.quip).toMatchObject({ trigger: "mvp_haul", values: { n: 3 } });
    play("M3", slot(3)); // a late import into the same session
    const after = remarks(later).get("M0", "everything");
    expect(after?.mood).toEqual(before?.mood);
    expect(after?.quip).toEqual({ ...before?.quip, values: { n: 4 } });
    expect(picked()).toHaveLength(1);
  });
});
