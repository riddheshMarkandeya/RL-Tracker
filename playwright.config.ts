import { defineConfig } from "@playwright/test";

// No webServer: the `stack` fixture starts the real tracker against a seeded temp data dir.
export default defineConfig({
  testDir: "test/e2e",
  // One stack, one one-shot replay.
  workers: 1,
  retries: 0,
  reporter: "list",
  // The installed Chrome: nothing to download. Reduced motion turns the theme's colour transitions
  // off, so axe measures contrast on the final colours, not mid-transition ones.
  use: { channel: "chrome", trace: "retain-on-failure", contextOptions: { reducedMotion: "reduce" } },
});
