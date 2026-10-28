// Trends with 2 matches in all: its own worker and stack, seeded `few`.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test.use({ seed: "few" });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("under 20 matches in all, Trends says there's not enough data yet", async ({ page }) => {
  await page.goto("/trends");
  await expect(page.getByText(/^Not enough data yet\./)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Trends" })).toBeAttached();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
