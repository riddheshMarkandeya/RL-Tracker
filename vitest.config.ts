import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // forks: the threads pool is the one reported to hang under Bun.
  // css: without it a `?raw` CSS import is an empty string, and the theme token tests read one.
  // test/e2e is Playwright's; its *.spec.ts would match Vitest's default include.
  test: { pool: "forks", css: true, exclude: [...configDefaults.exclude, "test/e2e/**"] },
});
