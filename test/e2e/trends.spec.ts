// The Trends page against the rich seed: 33 matches at today, last month and the month before. Its
// checks don't depend on the run's date: every quick pick and stepper shows its title line and then
// either the tiles and charts or the empty-period note, and last month is reached from the current
// month's strip cell.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const THEMES = ["carbon", "slate", "oled"] as const;
const title = (page: Page) => page.getByRole("heading", { level: 2 });
const tiles = (page: Page) => page.getByRole("group", { name: "Metric to chart" });
const emptyPeriod = (page: Page) => page.getByText("No matches in this period with these filters.");
/** Stats and tiles, or the empty-period note, once the period has loaded. */
const loaded = (page: Page) => expect(tiles(page).or(emptyPeriod(page))).toBeVisible();
const bigChart = (page: Page) => page.getByRole("heading", { level: 3, name: /^Win % · / });
const wlChart = (page: Page) => page.getByRole("heading", { level: 3, name: /^Wins and losses · / });
/** Both charts, or the empty-period note. */
async function charted(page: Page) {
  await loaded(page);
  if (await emptyPeriod(page).isVisible()) return;
  await expect(bigChart(page)).toBeVisible();
  await expect(wlChart(page)).toBeVisible();
}
const strip = (page: Page) => page.getByRole("group", { name: /^Seasons and months of / });

/** Last month, from the current month's strip cell (later months are disabled) and ‹. */
async function lastMonth(page: Page) {
  await page.goto("/trends");
  await strip(page).getByRole("button", { name: /^[A-Z][a-z]{2}$/ }).and(page.locator(":enabled")).last().click();
  await expect(page).toHaveURL(/kind=month/);
  await page.getByRole("button", { name: "Earlier month" }).click();
  await loaded(page);
}

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
    await charted(page);
  }
  await expect(page.getByText(/nothing earlier/)).toBeVisible();
});

test("the current month's strip cell, then ‹, reaches last month with its stats and the ⚑ note", async ({ page }) => {
  await lastMonth(page);
  await expect(page.getByText(/^⚑ includes 1 match you left early/)).toBeVisible();
  await expect(page.getByText(/\d+ matches · \d+ sessions/)).toBeVisible();
  await expect(tiles(page)).toBeVisible();
  // The month pressed on the strip follows the period.
  await expect(strip(page).locator("[aria-pressed=true]")).toHaveCount(1);
});

test("the steppers: a week, a month and a season each show their title, then charts or the empty note", async ({ page }) => {
  await page.goto("/trends");
  await page.getByRole("group", { name: "Quick periods" }).getByRole("button", { name: "This week" }).click();
  await page.getByRole("button", { name: "Earlier week" }).click();
  await expect(title(page)).toHaveText("Last week");
  await charted(page);
  await lastMonth(page);
  await charted(page);
  await strip(page).getByRole("button", { name: "S24" }).click();
  await expect(title(page)).toHaveText("Season 24");
  await charted(page);
  await page.getByRole("button", { name: "Earlier season" }).click();
  await expect(title(page)).toHaveText("Season 23");
  await charted(page);
});

test("last month opens By match with the auto note; By date sticks until a quick pick", async ({ page }) => {
  await lastMonth(page);
  await expect(bigChart(page)).toHaveText("Win % · rolling 20 matches");
  await expect(page.getByText(/^Only 2 days with matches here, so this shows a rolling average of 20 matches/)).toBeVisible();
  const xAxis = page.getByRole("group", { name: "X axis" });
  await expect(xAxis.getByRole("button", { name: "By match" })).toHaveAttribute("aria-pressed", "true");
  await xAxis.getByRole("button", { name: "By date" }).click();
  await expect(page).toHaveURL(/x=date/);
  await expect(bigChart(page)).toHaveText("Win % · per day");
  await expect(page.getByText(/^Only 2 days/)).toHaveCount(0);
  await page.getByRole("group", { name: "Quick periods" }).getByRole("button", { name: "Last 30 days" }).click();
  await expect(page).not.toHaveURL(/x=/);
});

test("a day's W/L column opens that day's first session's recap under the filter", async ({ page }) => {
  await lastMonth(page);
  // Day 12 is the only 2–2 day last month.
  await page.getByRole("link", { name: /: 2 wins, 2 losses\. Open its recap\.$/ }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a\?filter=ranked$/);
  await expect(page.getByRole("img", { name: "2 wins, 2 losses" })).toContainText(/4 matches/i);
});

test("on all time a month's W/L column opens that month", async ({ page }) => {
  await page.goto("/trends?kind=all");
  await charted(page);
  const link = page.getByRole("link", { name: /Open that month\.$/ }).first();
  const month = (await link.getAttribute("aria-label"))?.split(":")[0] ?? "";
  await link.click();
  await expect(page).toHaveURL(/kind=month/);
  await expect(title(page)).toHaveText(month);
  await charted(page);
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
