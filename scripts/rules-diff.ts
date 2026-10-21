// Recomputes every stored match under the working tree's rules into a scratch DB and reports what
// would change. The data dir gets only `rules/diff_*` log lines and the empty WAL side files a
// read-only open leaves. `bun run rules-diff`; RLTRACKER_DATA_DIR picks another data dir.
import { log } from "../src/server/log";
import { dataDir } from "../src/server/paths";
import { formatReport, runRulesDiff } from "../src/server/records/rules-diff";

const dir = dataDir();
try {
  const report = runRulesDiff({ dir, logger: log });
  console.log(`rules-diff against ${dir}`);
  console.log(formatReport(report));
  if (report.recompute.failed) process.exitCode = 1;
} catch (err) {
  console.error(`rules-diff failed against ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
