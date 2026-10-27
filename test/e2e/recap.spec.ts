// The recap against the rich seed: the current session is one won match; last month holds a
// 26-match session, a private-only one and two sessions on one day; the month before, one.
// Runs before shell.spec.ts in the same worker, so the seed is as written (no replay yet).
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const THEMES = ["carbon", "slate", "oled"] as const;
const bug = (page: Page, name: string) => page.getByRole("img", { name, exact: true });
const prev = (page: Page) => page.getByRole("link", { name: "Previous session" });
const picker = (page: Page) => page.getByRole("button", { name: /^Recap: / });
/** At `key`, with its detail on screen (the URL changes before the page does). */
const at = async (page: Page, key: string) => {
  await expect(page).toHaveURL(new RegExp(`/recap/${key}$`));
  await expect(page.locator(`[data-session="${key}"]`)).toHaveCount(1);
};

// The browser logs any 404 response as a console error; the unknown session's is the expected one.
const NOT_FOUND = /^Failed to load resource: .* 404 .*\/api\/sessions\/no-such-session\?/;

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !NOT_FOUND.test(e))).toEqual([]);
});

test("/recap opens the latest session; ‹ steps back through the days, with 2nd of 2 on a shared day", async ({ page }) => {
  await page.goto("/recap");
  await expect(page).toHaveURL(/\/recap\/e2e-seed-won$/);
  await expect(bug(page, "1 win, 0 losses")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next session" })).toBeDisabled();

  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-second$/);
  await expect(picker(page)).toContainText("2nd of 2 that day");
  await expect(bug(page, "0 wins, 1 loss")).toBeVisible();

  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a$/);
  await expect(picker(page)).toContainText("1st of 2 that day");
  await expect(bug(page, "1 win, 1 loss")).toBeVisible();
  // The second match failed a check: its card says so.
  await expect(page.getByRole("listitem", { name: /^Match 2, .*flagged/ })).toBeVisible();

  // Everything leaves the private-only session out, so the 26-match day comes next.
  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00$/);
  await expect(page.getByRole("listitem", { name: /^Match 26,/ })).toBeVisible();
  await expect(page.locator("ol").filter({ has: page.getByRole("listitem", { name: /^Match 26,/ }) })).toHaveClass(/dense/);
});

test("« » step by month to the nearest session there; the ends are disabled", async ({ page }) => {
  await page.goto("/recap/e2e-seed-won");
  await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
  // The previous month's newest session.
  await page.getByRole("link", { name: "Previous month" }).click();
  await at(page, "e2e-second");
  // Focus a load took from the control used goes to the picker, the h1 naming the session.
  await expect(picker(page)).toBeFocused();
  await page.getByRole("link", { name: "Previous month" }).click();
  await at(page, "e2e-old");
  await expect(picker(page)).toBeFocused();
  await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous session" })).toBeDisabled();
  // The next month's first session.
  await page.getByRole("link", { name: "Next month" }).click();
  await at(page, "e2e-long-00");
  await page.getByRole("link", { name: "Next month" }).click();
  await at(page, "e2e-seed-won");
});

test("at 320px a two-digit scorebug fits without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/recap/e2e-long-00");
  await expect(page.getByRole("img", { name: "17 wins, 9 losses" })).toBeVisible();
  // A string expression: the root tsconfig has no DOM lib for a page-side function.
  expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBe(0);
});

test("the picker lists the open session's month, focused on its row; Escape, a step, Back close it", async ({ page }) => {
  await page.goto("/recap/e2e-second");
  await picker(page).click();
  await expect(picker(page)).toHaveAttribute("aria-expanded", "true");
  const list = page.locator(`[id="${String(await picker(page).getAttribute("aria-controls"))}"]`);
  // Everything leaves the private session out: last month's three sessions, newest first.
  await expect(list.getByRole("link")).toHaveCount(3);
  await expect(list.locator("a[aria-current=true]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveAttribute("aria-expanded", "false");
  await expect(picker(page)).toBeFocused();

  // Picking the open session's own row keeps focus on the picker.
  await picker(page).click();
  await list.locator("a[aria-current=true]").press("Enter");
  await expect(picker(page)).toBeFocused();

  // Picking a row goes there and hands focus back to the picker.
  await picker(page).click();
  await list.getByRole("link").last().click();
  await at(page, "e2e-long-00");
  await expect(picker(page)).toBeFocused();

  // A step closes it, and so does Back; coming Forward again doesn't reopen it.
  await picker(page).click();
  await prev(page).click();
  await at(page, "e2e-old");
  await expect(picker(page)).toHaveAttribute("aria-expanded", "false");
  await picker(page).click();
  await page.goBack();
  await at(page, "e2e-long-00");
  await expect(picker(page)).toHaveAttribute("aria-expanded", "false");
  // Back to a cached session leaves focus on the picker it was on.
  await expect(picker(page)).toBeFocused();
  await page.goForward();
  await at(page, "e2e-old");
  await expect(picker(page)).toHaveAttribute("aria-expanded", "false");
});

test("the playlist filter: in the URL, only what was played, and notes when nothing is under it", async ({ page }) => {
  await page.goto("/recap/e2e-first-a");
  const select = page.getByLabel("Playlist");
  await select.selectOption("11");
  await expect(page).toHaveURL(/\/recap\/e2e-first-a\?filter=11$/);
  await expect(bug(page, "1 win, 1 loss")).toBeVisible();
  // A filter change hands focus back to the filter; Back to a cached entry leaves it there.
  await expect(select).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a$/);
  await expect(select).toBeFocused();

  await page.goto("/recap?filter=private");
  await expect(page).toHaveURL(/\/recap\/e2e-private\?filter=private$/);
  await expect(bug(page, "1 win, 0 losses")).toBeVisible();

  await page.goto("/recap/e2e-seed-won?filter=private");
  await expect(page.getByText("No matches under this filter in this session.")).toBeVisible();

  await page.goto("/recap?filter=17");
  await expect(page.getByText("No matches under this filter yet.")).toBeVisible();

  await page.goto("/recap/no-such-session");
  await expect(page.getByText("This session isn't here any more.")).toBeVisible();
});

test("axe: the recap, its picker open, and its states in every theme", async ({ page }) => {
  for (const path of ["/recap/e2e-long-00", "/recap/e2e-seed-won?filter=private", "/recap?filter=17", "/recap/no-such-session"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path === "/recap/e2e-long-00") {
      await picker(page).click();
      await expect(page.locator("a[aria-current=true]")).toBeFocused();
    }
    for (const theme of THEMES) {
      // A string expression: the root tsconfig has no DOM lib for a page-side function.
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});
