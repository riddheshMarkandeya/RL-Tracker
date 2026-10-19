import { defineConfig } from "vitest/config";

export default defineConfig({
  // forks: the threads pool is the one reported to hang under Bun.
  test: { pool: "forks" },
});
