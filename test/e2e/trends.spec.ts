// The Trends page against the rich seed: 33 matches at today, last month and the month before. Its
// checks don't depend on the run's date: every quick pick shows its title line and then either the
// stats or the empty-period note, and last month is reached from the current month's strip cell.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const THEMES = ["carbon", "slate", "oled"] as const;
const title = (page: Page) => page.getByRole("heading", { level: 2 });
const tiles = (page: Page) => page.getByRole("group", { name: "Metric to chart" });
const emptyPeriod = (page: Page) => page.getByText("No matches in this period with these filters.");
/** Stats and tiles, or the empty-period note, once the period has loaded. */
const loaded = (page: Page) => expect(tiles(page).or(emptyPeriod(page))).toBeVisible();

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("every quick pick shows its title line, pressed, then its stats or the empty-period note", async ({ page }) => {
  await page.goto("/trends");
  const picks = page.getByRole("group", { name: "Quick periods" });
  await expect(picks.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Last 7 days", "Last 30 days", "This week", "Last week", "This year", "All time"]) {
    await picks.getByRole("button", { name }).click();
    await expect(picks.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    await expect(title(page)).toHaveText(name);
    await loaded(page);
  }
  await expect(page.getByText(/nothing earlier/)).toBeVisible();
});

test("the current month's strip cell, then ‹, reaches last month with its stats and the ⚑ note", async ({ page }) => {
  await page.goto("/trends");
  const strip = page.getByRole("group", { name: /^Seasons and months of / });
  // Later months are disabled, so the last enabled month is the current one.
  await strip.getByRole("button", { name: /^[A-Z][a-z]{2}$/ }).and(page.locator(":enabled")).last().click();
  await expect(page).toHaveURL(/kind=month/);
  await page.getByRole("button", { name: "Earlier month" }).click();
  await expect(page.getByText(/^⚑ includes 1 match you left early/)).toBeVisible();
  await expect(page.getByText(/\d+ matches · \d+ sessions/)).toBeVisible();
  await expect(tiles(page)).toBeVisible();
  // The month pressed on the strip follows the period.
  await expect(strip.locator("[aria-pressed=true]")).toHaveCount(1);
});

test("a tile selects the metric in the URL", async ({ page }) => {
  await page.goto("/trends?kind=all");
  await tiles(page).getByRole("button", { name: /^Saves \/ game/ }).click();
  await expect(page).toHaveURL(/metric=saves/);
  await expect(tiles(page).getByRole("button", { name: /^Saves \/ game/ })).toHaveAttribute("aria-pressed", "true");
  await expect(tiles(page).getByRole("button", { name: /^Win %/ })).toHaveAttribute("aria-pressed", "false");
});

test("at 320px the page has no sideways scroll; only the strip scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/trends?kind=all");
  await loaded(page);
  // A string expression: the root tsconfig has no DOM lib for a page-side function.
  expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBe(0);
});

test("axe: Trends in every theme has no violations", async ({ page }) => {
  for (const path of ["/trends", "/trends?kind=all"]) {
    await page.goto(path);
    await loaded(page);
    for (const theme of THEMES) {
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});
