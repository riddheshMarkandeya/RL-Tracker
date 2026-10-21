// Regenerates the rule definitions doc and the constant pins from the rule registry, unless a
// rule's constants changed without a version bump. `bun run definitions`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pinsOf, renderDefinitions, unbumpedConstants, type Pins } from "../src/server/rules/definitions";
import { RULES } from "../src/server/rules/registry";

const root = join(import.meta.dirname, "..");
const pinsPath = join(root, "src", "server", "rules", "constant-pins.json");
if (!existsSync(pinsPath)) {
  console.error(`${pinsPath} is missing: restore it from git; a fresh one would accept unbumped constants.`);
  process.exit(1);
}
const pins = JSON.parse(readFileSync(pinsPath, "utf8")) as Pins;
const unbumped = unbumpedConstants(RULES, pins);
if (unbumped.length) {
  console.error(`constants changed or unlisted without a version bump: ${unbumped.join(", ")}. Bump each, then rerun.`);
  process.exit(1);
}
const docPath = join(root, "docs", "definitions.md");
writeFileSync(docPath, renderDefinitions(RULES));
writeFileSync(pinsPath, `${JSON.stringify(pinsOf(RULES), null, 2)}\n`);
console.log(`wrote ${docPath} and ${pinsPath} (${String(RULES.length)} rules)`);
