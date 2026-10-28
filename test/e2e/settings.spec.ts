// The Settings page against its own copy of the rich seed (the `settings` seed gets its own stack),
// so what it saves can't reach the other specs. Each test starts from the defaults.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openCard, shareDialog } from "./share-card";

test.use({ seed: "settings" });

const THEMES = ["carbon", "slate", "oled"] as const;
const DEFAULTS = "theme=carbon&clock=24h&speed=kmh&startPage=recap&recapFilter=everything&trendsFilter=ranked&rollingWindow=20&remarks=true&moodLine=true";
const HEADER = { "X-RLTracker-Request": "1" };
// The one failed save a test brings about on purpose.
const SAVE_FAILED = /^Failed to load resource: .* 500 .*\/api\/settings/;

const put = async (request: APIRequestContext, query: string) => {
  const res = await request.post(`/api/settings?${query}`, { headers: HEADER });
  expect(res.ok()).toBe(true);
};

test.beforeEach(async ({ request }) => {
  await put(request, DEFAULTS);
});

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !SAVE_FAILED.test(e))).toEqual([]);
});

const section = (page: Page, name: string) => page.getByRole("region", { name });
const row = (page: Page, label: string) => page.locator("[class*=row]").filter({ has: page.getByText(label, { exact: true }) });
const saved = (page: Page, label: string) => row(page, label).getByRole("status");
const again = (page: Page) => page.getByRole("button", { name: "Another remark" });

test("each setting saves, says so, and survives a reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Slate" }).click();
  await expect(saved(page, "Theme")).toHaveText("✓ Saved");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "slate");
  await page.getByRole("radio", { name: "12h" }).click();
  await expect(saved(page, "Clock")).toHaveText("✓ Saved");
  await page.getByRole("radio", { name: "mph" }).click();
  await expect(saved(page, "Speed")).toHaveText("✓ Saved");
  await page.getByRole("radio", { name: "Trends" }).click();
  await expect(saved(page, "Start page")).toHaveText("✓ Saved");
  await page.getByLabel("Recap playlist").selectOption("private");
  await expect(saved(page, "Recap playlist")).toHaveText("✓ Saved");
  await page.getByLabel("Trends playlist").selectOption("everything");
  await expect(saved(page, "Trends playlist")).toHaveText("✓ Saved");
  const window = page.getByLabel("Trends rolling window");
  await window.fill("35");
  await window.press("Enter");
  await expect(saved(page, "Trends rolling window")).toHaveText("✓ Saved");
  await expect(window).toBeFocused();
  await page.getByRole("switch", { name: "Mood line" }).click();
  await expect(saved(page, "Mood line")).toHaveText("✓ Saved");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "slate");
  await expect(page.getByRole("radio", { name: "Slate" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "12h" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "mph" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Trends" })).toBeChecked();
  await expect(page.getByLabel("Recap playlist")).toHaveValue("private");
  await expect(page.getByLabel("Trends playlist")).toHaveValue("everything");
  await expect(window).toHaveValue("35");
  await expect(page.getByRole("switch", { name: "Mood line" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Remarks" })).toBeChecked();
});

test("the theme reaches the share card", async ({ page, request }) => {
  await put(request, "theme=oled");
  await page.goto("/recap/e2e-seed-won");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "oled");
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=footer]")).toBeVisible();
  expect(await page.evaluate("getComputedStyle(document.querySelector('dialog[open] [data-part=footer]')).getPropertyValue('--page').trim()")).toBe("#000");
});

test("12h times and mph speeds on the recap", async ({ page, request }) => {
  await page.goto("/recap/e2e-long-00");
  const card = page.getByRole("link", { name: /^Match 1,/ }).first();
  await expect(card).not.toContainText(/\d:\d\d\s?[ap]\.?m/i);
  await put(request, "clock=12h&speed=mph");
  await page.reload();
  await expect(card).toContainText(/\d:\d\d\s?[ap]\.?m\.?/i);
  const extras = page.locator("section").filter({ has: page.getByRole("heading", { name: "Extras", exact: true }) });
  // 101.5 km/h; under 100, two places, as km/h has.
  await expect(extras.getByRole("listitem").filter({ hasText: "Hardest shot" })).toContainText("63.07 mph");
});

test("the start page and each page's default filter; a filter in the URL still wins", async ({ page, request }) => {
  await put(request, "startPage=trends&recapFilter=private&trendsFilter=everything");
  await page.goto("/");
  await expect(page).toHaveURL(/\/trends$/);
  await expect(page.getByLabel("Playlist")).toHaveValue("everything");
  await page.goto("/recap");
  await expect(page).toHaveURL(/\/recap\/e2e-private\?filter=private$/);
  await page.goto("/recap/e2e-first-a?filter=everything");
  await expect(page.getByLabel("Playlist")).toHaveValue("everything");
  await page.goto("/trends?filter=ranked");
  await expect(page.getByLabel("Playlist")).toHaveValue("ranked");
});

test("the rolling window: a new size reaches Trends; a bad one says why and sends nothing", async ({ page }) => {
  await page.goto("/settings");
  const window = page.getByLabel("Trends rolling window");
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/settings")) posts.push(r.url()); });
  await window.fill("4");
  await window.press("Enter");
  await expect(page.getByText("Use a whole number from 5 to 100.")).toBeVisible();
  await expect(window).toHaveAttribute("aria-invalid", "true");
  await window.press("Escape");
  await expect(window).toHaveValue("20");
  await expect(page.getByText("Use a whole number from 5 to 100.")).toHaveCount(0);
  expect(posts).toEqual([]);
  await window.fill("10");
  await window.blur();
  await expect(saved(page, "Trends rolling window")).toHaveText("✓ Saved");

  // Last month: two days with matches, so it opens By match.
  await page.goto("/trends");
  const strip = page.getByRole("group", { name: /^Seasons and months of / });
  await strip.getByRole("button", { name: /^[A-Z][a-z]{2}$/ }).and(page.locator(":enabled")).last().click();
  await page.getByRole("button", { name: "Earlier month" }).click();
  await expect(page.getByRole("heading", { level: 3, name: /^Win % · / })).toHaveText("Win % · rolling 10 matches");
  await expect(page.getByText(/so this shows a rolling average of 10 matches/)).toBeVisible();
});

test("remarks off hides the headline lines; mood off keeps the quip and ↻; mood off with no quip shows nothing", async ({ page, request }) => {
  await put(request, "remarks=false");
  await page.goto("/recap/e2e-long-00");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(again(page)).toHaveCount(0);

  const quip = { mood: { band: "good", text: "A steady night." }, quip: { trigger: "t", text: "You scored {n}.", values: { n: 3 } } };
  await page.route("**/api/sessions/*/remarks?*", (route) => route.fulfill({ json: quip }));
  await put(request, "remarks=true&moodLine=false");
  await page.reload();
  await expect(page.locator("p").filter({ has: again(page) })).toHaveText(/^You scored 3\./);
  await expect(page.getByText("A steady night.")).toHaveCount(0);

  await page.unroute("**/api/sessions/*/remarks?*");
  await page.route("**/api/sessions/*/remarks?*", (route) => route.fulfill({ json: { ...quip, quip: null } }));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(again(page)).toHaveCount(0);

  // The share card drops the mood line too.
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=mood]")).toHaveCount(0);
});

test("the mood line switch waits on remarks; its value is kept", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Remarks" }).click();
  await expect(page.getByRole("switch", { name: "Mood line" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Mood line" })).toBeChecked();
});

test("a failed save keeps the old value and offers Retry; a working Retry hands focus back", async ({ page }) => {
  await page.goto("/settings");
  let fail = true;
  await page.route("**/api/settings?*", (route) => (route.request().method() === "POST" && fail ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.continue()));
  await page.getByRole("radio", { name: "mph" }).click();
  const retry = row(page, "Speed").getByRole("button", { name: "Retry" });
  await expect(row(page, "Speed")).toContainText("Couldn't save");
  await expect(page.getByRole("radio", { name: "km/h" })).toBeChecked();
  fail = false;
  await retry.focus();
  await retry.press("Enter");
  await expect(saved(page, "Speed")).toHaveText("✓ Saved");
  await expect(page.getByRole("radio", { name: "mph" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "mph" })).toBeFocused();

  // The window field, too, goes back to the stored value.
  fail = true;
  const window = page.getByLabel("Trends rolling window");
  await window.fill("50");
  await window.press("Enter");
  await expect(row(page, "Trends rolling window")).toContainText("Couldn't save");
  await expect(window).toHaveValue("20");
});

test("reset puts a section back, reads Defaults, and focuses its heading", async ({ page, request }) => {
  await put(request, "clock=12h");
  await page.goto("/settings");
  const appearance = section(page, "Appearance");
  await appearance.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(appearance.locator("span", { hasText: /^Defaults$/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "24h" })).toBeChecked();
  await expect(page.getByRole("heading", { level: 2, name: "Appearance" })).toBeFocused();
  await expect(section(page, "Defaults").locator("span", { hasText: /^Defaults$/ })).toBeVisible();
});

test("passes axe in every theme, and fits at 320px", async ({ page, request }) => {
  for (const theme of THEMES) {
    await put(request, `theme=${theme}`);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("radio", { name: "Carbon" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations, theme).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Carbon" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});
