// Imports captures into the data dir's raw.db through the recorder, with each file's own times, so
// later work packages can run on real sessions. Files are fed in the order given.
// `bun run scripts/import-capture.ts <file>...`; RLTRACKER_DATA_DIR picks another data dir.
import { readFileSync } from "node:fs";
import { log } from "../src/server/log";
import { feed, readCapture } from "../src/server/recorder/feed";
import { createRecorder } from "../src/server/recorder/recorder";
import type { MatchSummary } from "../src/server/recorder/summary";
import { openStorage } from "../src/server/storage";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: bun run scripts/import-capture.ts <file>...");
  process.exit(2);
}

const storage = openStorage();
try {
  // A guid already in raw.db would be reopened and its events stored twice.
  const existing = storage.raw.get<{ n: number }>("SELECT COUNT(*) AS n FROM events")?.n ?? 0;
  if (existing > 0) {
    console.error(`raw.db in ${storage.dir} already has ${String(existing)} events; import into an empty data dir (RLTRACKER_DATA_DIR)`);
    process.exit(1);
  }
  const summaries: MatchSummary[] = [];
  const recorder = createRecorder({ raw: storage.raw, logger: log, onMatchFinished: (s) => summaries.push(s) });
  for (const file of files) {
    const lines = readCapture(readFileSync(file, "utf8"));
    log.info("import", "file", { file, frames: lines.length });
    feed(recorder, lines);
    recorder.flush();
  }
  console.table(
    summaries.map((s) => ({
      guid: s.guid.slice(0, 8),
      start: new Date(s.startedAt).toISOString().slice(0, 16),
      end: s.endKind,
      via: s.closedVia,
      playlist: s.playlistId,
      score: s.score?.join("-") ?? "",
      winner: s.winnerTeamNum ?? "",
      mvp: s.mvp ? (s.mvp.key ? "yes" : "unresolved") : "",
      players: s.roster.length,
      flags: s.flags.join(" "),
    })),
  );
  const open = recorder.status().guid;
  console.log(`${String(summaries.length)} matches finished${open ? `; ${open.slice(0, 8)} is still open and closes at the next start` : ""}`);
} finally {
  storage.close();
}
