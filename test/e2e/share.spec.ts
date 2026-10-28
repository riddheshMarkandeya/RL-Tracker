// The share card against the rich seed: its current session is one won match.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { measureCard, openCard, shareButton, shareDialog } from "./share-card";

const THEMES = ["carbon", "slate", "oled"] as const;
// The one 404 a test brings about on purpose; only that test lets it through.
let expected: RegExp | null = null;
const NOT_FOUND = (path: string) => new RegExp(`^Failed to load resource: .* 404 .*\\/api\\/${path}`);

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !expected?.test(e))).toEqual([]);
  expected = null;
});

/** The page's `[rlt] <event>` warnings, from now on. */
const warnings = (page: Page, event: string) => {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning" && msg.text().startsWith(`[rlt] ${event}`)) seen.push(msg.text());
  });
  return seen;
};

/** Stands in for the clipboard, so a test never touches the machine's real one: `write` keeps the
 * PNG on `window.__clip`, or rejects as a denied permission would. */
const stubClipboard = (page: Page, deny: boolean) =>
  page.addInitScript(`navigator.clipboard.write = ${deny
    ? `() => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"))`
    : `async (items) => { window.__clip = await items[0].getType("image/png"); }`};`);

test("the card opens on the session with its name, record and tiles, fits, and passes axe in every theme", async ({ page }) => {
  await page.goto("/recap/e2e-seed-won");
  await expect(shareButton(page)).toHaveAttribute("aria-haspopup", "dialog");
  await openCard(page);
  const dialog = shareDialog(page);
  await expect(dialog.getByRole("img", { name: "1 win, 0 losses" })).toBeVisible();
  await expect(dialog.locator("[data-part=name]")).toHaveText("Epic|me|0");
  // The default filter gets no pill.
  await expect(dialog.locator("[data-part=pill]")).toHaveCount(0);
  // The seed's player hit the woodwork and scored no aerial goal: crossbar hits fill the 8th tile.
  await expect(dialog.locator("[data-tile]")).toHaveCount(8);
  await expect(dialog.locator("[data-tile=woodwork]")).toContainText("Crossbar hits");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

  const fit = await measureCard(page);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.footerRoom).toBeGreaterThanOrEqual(0);
  // One match leaves the line the card's spare height.
  expect(fit.lineHeight).toBeGreaterThan(48);

  for (const theme of THEMES) {
    await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
    const { violations } = await new AxeBuilder({ page }).include("dialog[open]").analyze();
    expect(violations.map((v) => `${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
  }
});

test("Download saves a 1080×1440 PNG named for the session's start and filter", async ({ page }) => {
  await page.goto("/recap/e2e-seed-won?filter=13");
  await openCard(page);
  const [download] = await Promise.all([page.waitForEvent("download"), shareDialog(page).getByRole("button", { name: "Download PNG" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^rl-session-\d{4}-\d{2}-\d{2}-\d{4}-ranked-standard\.png$/);
  const png = readFileSync(await download.path());
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  // IHDR's width and height, big-endian, right after the chunk's type.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1440]);
  await expect(shareDialog(page).getByText("Saved")).toBeVisible();
});

test("Copy hands the clipboard a 1080×1440 PNG", async ({ page }) => {
  await stubClipboard(page, false);
  await page.goto("/recap/e2e-seed-won");
  await openCard(page);
  await shareDialog(page).getByRole("button", { name: "Copy image" }).click();
  await expect(shareDialog(page).getByText("Copied")).toBeVisible();
  expect(await page.evaluate(`(async () => {
    const bmp = await createImageBitmap(window.__clip);
    return [window.__clip.type, bmp.width, bmp.height];
  })()`)).toEqual(["image/png", 1080, 1440]);
});

test("a refused copy says so, points to Download, and warns which step failed", async ({ page }) => {
  const warned = warnings(page, "share/export_failed");
  await stubClipboard(page, true);
  await page.goto("/recap/e2e-seed-won");
  await openCard(page);
  const copy = shareDialog(page).getByRole("button", { name: "Copy image" });
  await copy.click();
  await expect(shareDialog(page).getByText("Couldn't copy, try Download")).toBeVisible();
  await expect(copy).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => warned.length).toBe(1);
});

test("without the match detail the card leaves the name out and warns", async ({ page }) => {
  expected = NOT_FOUND("matches/e2e-seed-won");
  const warned = warnings(page, "share/no_name");
  // A 404, not a 5xx: queries retry a 5xx, and either way the name is missing.
  await page.route("**/api/matches/*", (route) => route.fulfill({ status: 404, json: { error: "not_found" } }));
  await page.goto("/recap/e2e-seed-won");
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=name]")).toHaveCount(0);
  await expect.poll(() => warned.length).toBe(1);
});

test("without the remarks the card still opens, leaves the mood out, and warns", async ({ page }) => {
  expected = NOT_FOUND("sessions/[^/]+/remarks");
  const warned = warnings(page, "share/no_mood");
  await page.route("**/api/sessions/*/remarks?*", (route) => route.fulfill({ status: 404, json: { error: "not_found" } }));
  await page.goto("/recap/e2e-seed-won");
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=footer]")).toBeVisible();
  await expect(shareDialog(page).locator("[data-part=mood]")).toHaveCount(0);
  await expect.poll(() => warned.length).toBe(1);
});

test("the pill follows the filter; Escape or the backdrop closes the card, and focus returns to Share", async ({ page }) => {
  await page.goto("/recap/e2e-seed-won?filter=ranked");
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=pill]")).toHaveText("All ranked");
  await page.keyboard.press("Escape");
  await expect(shareDialog(page)).toBeHidden();
  await expect(shareButton(page)).toBeFocused();

  await page.goto("/recap/e2e-seed-won?filter=13");
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=pill]")).toHaveText("Ranked Standard");
  await page.mouse.click(5, 5);
  await expect(shareDialog(page)).toBeHidden();
});

test("at 320px the page keeps its width, and the card keeps its size inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/recap/e2e-seed-won");
  await openCard(page);
  expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBe(0);
  await expect(shareDialog(page).getByRole("img", { name: /^1 win/ })).toHaveJSProperty("offsetWidth", 360);
});
