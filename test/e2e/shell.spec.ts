// The web shell against the real tracker: seeded with one won match (chip 1–0), then a replay of
// the completed fixture, which the camera player loses (chip 1–1). Serial: the replay is one-shot.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

const THEMES = ["carbon", "slate", "oled"] as const;
const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });
const chip = (page: Page) => page.getByText(/^This session: /);

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("before the match: redirect, live status, chip, navigation, deep link, not found", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/recap$/);
  await expect(status(page, "connected")).toBeVisible();
  await expect(chip(page)).toHaveText("This session: 1–0");

  for (const name of ["Trends", "Settings", "Recap"]) {
    const link = page.getByRole("link", { name, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
  }

  // A reload on a deep link is the tracker's static fallback serving the app.
  await page.goto("/trends");
  await page.reload();
  await expect(page.getByRole("link", { name: "Trends", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/no-such-page");
  await expect(page.getByText("There's no page here.")).toBeVisible();
});

test("axe: every page in every theme has no violations", async ({ page }) => {
  for (const path of ["/recap", "/trends", "/settings", "/no-such-page"]) {
    await page.goto(path);
    await expect(status(page, "connected")).toBeVisible();
    for (const theme of THEMES) {
      // A string expression: the root tsconfig has no DOM lib for a page-side function.
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});

test("the replay: status follows the match and the chip updates without a reload", async ({ page, stack }) => {
  await page.goto("/recap");
  await expect(status(page, "connected")).toBeVisible();
  await expect(chip(page)).toHaveText("This session: 1–0");
  stack.go();
  await expect(status(page, "recording match")).toBeVisible({ timeout: 10_000 });
  await expect(status(page, "connected")).toBeVisible({ timeout: 20_000 });
  await expect(chip(page)).toHaveText("This session: 1–1");
});

test("Start new session: confirm, then the chip is gone and the button unavailable", async ({ page }) => {
  await page.goto("/recap");
  await expect(chip(page)).toHaveText("This session: 1–1");
  const button = page.getByRole("button", { name: "Start new session" });
  await button.click();
  await page.getByRole("group", { name: "Start new session?" }).getByRole("button", { name: "Yes" }).click();
  await expect(chip(page)).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-disabled", "true");
});
