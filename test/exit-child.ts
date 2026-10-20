// A stand-in tracker for the supervisor's integration test: `exit-child.ts <counterFile> <codes>`.
// Each run exits with the next of the comma-separated codes, counting runs in the counter file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [counter = "", codeList = "0"] = process.argv.slice(2);
const run = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
writeFileSync(counter, String(run + 1));
const codes = codeList.split(",").map(Number);
process.exit(codes[Math.min(run, codes.length - 1)]);
