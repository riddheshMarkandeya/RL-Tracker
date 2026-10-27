// Playwright runs on Node; the stack (seeding, replay, tracker) runs under Bun as a child process.
// Ending its stdin is the teardown signal, so a runner that dies still stops the tracker.
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test as base } from "@playwright/test";

// Longer than the stack's own 30 s, so its "never became ready" message and tracker.log tail arrive first.
const READY_TIMEOUT_MS = 45_000;
// Longer than the stack's own worst case (a 10 s stop request, then 10 s for the tracker to exit).
const EXIT_TIMEOUT_MS = 30_000;

export interface Stack {
  url: string;
  dataDir: string;
  /** Releases the replay: the tracker starts receiving the completed match. */
  go: () => void;
}

/** What the stack's DB holds. A spec file picks one with `test.use({ seed })`, and gets its own worker and stack. */
export type Seed = "rich" | "empty";

export const test = base.extend<{ consoleErrors: string[] }, { stack: Stack; seed: Seed }>({
  seed: ["rich", { scope: "worker", option: true }],
  stack: [
    async ({ seed }, use) => {
      console.log(`[e2e] runner ${JSON.stringify({ node: process.versions.node, underBun: "bun" in process.versions })}`);
      const child = spawn("bun", ["run", join(import.meta.dirname, "stack.ts"), seed], { cwd: join(import.meta.dirname, "..", ".."), stdio: ["pipe", "pipe", "pipe"] });
      const output: string[] = [];
      const exited = new Promise<number | null>((resolve) => {
        // "close", not "exit": by then stdout/stderr have drained, so `output` has the stack's last lines.
        child.once("close", resolve);
        // A spawn failure (bun not on PATH) emits only "error".
        child.on("error", (err) => {
          output.push(`[e2e] could not start the stack: ${err.message}`);
          resolve(null);
        });
      });
      // A write to a stack that already died; `exited` reports that death.
      child.stdin.on("error", () => undefined);
      createInterface({ input: child.stderr }).on("line", (line) => {
        output.push(line);
        console.error(line);
      });
      const ready = new Promise<{ url: string; dataDir: string }>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error(`the e2e stack wasn't ready after ${String(READY_TIMEOUT_MS)} ms:\n${output.join("\n")}`)); }, READY_TIMEOUT_MS);
        void exited.then((code) => {
          clearTimeout(timer);
          reject(new Error(`the e2e stack exited (code ${String(code)}) before it was ready:\n${output.join("\n")}`));
        });
        createInterface({ input: child.stdout }).on("line", (line) => {
          output.push(line);
          console.log(line);
          if (!line.startsWith("ready ")) return;
          clearTimeout(timer);
          resolve(JSON.parse(line.slice("ready ".length)) as { url: string; dataDir: string });
        });
      });
      try {
        const { url, dataDir } = await ready;
        await use({ url, dataDir, go: () => child.stdin.write("go\n") });
      } finally {
        child.stdin.end();
        const code = await Promise.race([exited, new Promise<"timeout">((resolve) => setTimeout(() => { resolve("timeout"); }, EXIT_TIMEOUT_MS))]);
        if (code === "timeout") {
          console.error(`[e2e] the stack did not exit within ${String(EXIT_TIMEOUT_MS)} ms; killing it and the tracker`);
          // The whole tree (Windows taskkill): killing only the stack would leave its tracker running.
          if (child.pid !== undefined) {
            const kill = spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
            if (kill.status === 0) await exited;
            else {
              console.error(`[e2e] taskkill failed: ${kill.error?.message ?? `exit ${String(kill.status)}: ${String(kill.stderr).trim()}`}`);
              child.kill();
            }
          }
        }
      }
    },
    // Room for both the ready timeout and teardown; the default 30 s would cut setup short first.
    { scope: "worker", timeout: READY_TIMEOUT_MS + EXIT_TIMEOUT_MS + 15_000 },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.url);
  },
  /** Console errors and uncaught page errors. Auto, so it listens from the test's start even though
   * only afterEach asks for it. */
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`${msg.text()} (${msg.location().url})`);
      });
      page.on("pageerror", (err) => errors.push(err.message));
      await use(errors);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
