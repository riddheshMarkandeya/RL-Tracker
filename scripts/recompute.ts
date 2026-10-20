// Rebuilds every match record from raw.db. Safe while the tracker runs.
// `bun run recompute`; RLTRACKER_DATA_DIR picks another data dir.
import { log } from "../src/server/log";
import { recomputeAll } from "../src/server/records/recompute";
import { openStorage } from "../src/server/storage";

const storage = openStorage();
try {
  const { written, skipped, failed, ms } = recomputeAll({ raw: storage.raw, tracker: storage.tracker, logger: log });
  console.table({ written, ...skipped, failed });
  console.log(`recomputed in ${String(ms)} ms${failed ? "; see the log for recompute_failed" : ""}`);
  if (failed) process.exitCode = 1;
} finally {
  storage.close();
}
