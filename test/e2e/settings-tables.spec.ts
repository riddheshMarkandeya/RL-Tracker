// Settings › You and Seasons, against the `tables` seed's own stack: the rich seed plus a pending
// guess per test that answers one, and a rejected id (none of them a player in any match). A pending
// guess can't be put back, so each test answers its own; afterEach puts ME and the rejected id back,
// the seeded seasons back, and deletes any season added after them.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { dayOf } from "../../src/shared/periods";
import { idsResponse, seasonsResponse } from "../../src/shared/schemas/responses";
import { ME } from "../../src/server/testing";
import { expect, test } from "./fixtures";

test.use({ seed: "tables" });

const HEADER = { "X-RLTracker-Request": "1" };
const SEED = [
  [1, "S22", "2026-03-11"],
  [2, "S23", "2026-06-09"],
  [3, "S24", "2026-09-23"],
] as const;
// The failures a test brings about on purpose.
const MEANT = /^Failed to load resource: .* (500|409) .*\/api\/(ids|seasons)/;

async function post(request: APIRequestContext, path: string) {
  const res = await request.post(path, { headers: HEADER });
  expect(res.ok(), path).toBe(true);
  return res;
}
const answer = (request: APIRequestContext, id: string, status: "confirmed" | "rejected") => post(request, `/api/ids?${new URLSearchParams({ id, status }).toString()}`);

test.afterEach(async ({ request, consoleErrors }) => {
  await answer(request, ME, "confirmed");
  await answer(request, "PS4|e2e-not-me|0", "rejected");
  await post(request, "/api/settings?theme=carbon");
  const { seasons } = seasonsResponse.parse(await (await request.get("/api/seasons")).json());
  for (const s of seasons) if (s.id > 3) await post(request, `/api/seasons/${String(s.id)}/delete`);
  for (const [id, name, start] of SEED) await post(request, `/api/seasons/${String(id)}?name=${name}&start=${start}`);
  expect(consoleErrors.filter((e) => !MEANT.test(e))).toEqual([]);
});

const section = (page: Page, name: string) => page.getByRole("region", { name });
const row = (page: Page, table: "You" | "Seasons", name: string) => section(page, table).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
const chip = (page: Page) => page.getByText(/^This session: /);

test.describe("You", () => {
  test("“That's me” on a guess: the row says You, ✓ Saved, and focus moves to “Not me”", async ({ page }) => {
    await page.goto("/settings");
    const guess = row(page, "You", "GuessYes");
    await expect(guess).toContainText("Waiting for you");
    await expect(guess).toContainText("Steam");
    await guess.getByRole("button", { name: "That's me" }).click();
    await expect(guess.getByRole("status")).toHaveText("✓ Saved");
    await expect(guess).not.toContainText("Waiting for you");
    await expect(guess.getByText("You", { exact: true })).toBeVisible();
    await expect(guess.getByRole("button", { name: "Not me" })).toBeFocused();
    await page.reload();
    await expect(row(page, "You", "GuessYes").getByRole("button")).toHaveText(["Not me"]);
  });

  test("“Not me” on your id empties the session's stats; “That's me” brings them back", async ({ page }) => {
    await page.goto("/settings");
    await expect(chip(page)).toHaveText("This session: 1–0");
    const me = row(page, "You", "me");
    await me.getByRole("button", { name: "Not me" }).click();
    await expect(me.getByText("Not you", { exact: true })).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(me.getByRole("button", { name: "That's me" })).toBeFocused();
    await me.getByRole("button", { name: "That's me" }).click();
    await expect(chip(page)).toHaveText("This session: 1–0");
  });

  test("a failed answer leaves the row and offers Retry; a working Retry focuses the button left", async ({ page }) => {
    await page.goto("/settings");
    let fail = true;
    await page.route("**/api/ids?*", (route) => (fail ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.continue()));
    const guess = row(page, "You", "GuessRetry");
    await guess.getByRole("button", { name: "Not me" }).click();
    await expect(guess).toContainText("Couldn't save");
    await expect(guess).toContainText("Waiting for you");
    await expect(guess.getByRole("button", { name: "Not me" })).toBeFocused();
    fail = false;
    const retry = guess.getByRole("button", { name: "Retry" });
    await retry.focus();
    await retry.press("Enter");
    await expect(guess.getByText("Not you", { exact: true })).toBeVisible();
    await expect(guess.getByRole("button", { name: "That's me" })).toBeFocused();
  });

  // Last in this group: it rejects every id, so the guesses above should already be answered.
  test("with every id rejected, a warning says the tracker will ask; the table still shows", async ({ page, request }) => {
    const { ids } = idsResponse.parse(await (await request.get("/api/ids")).json());
    const yours = ids.filter((r) => r.status !== "rejected");
    for (const r of yours) await answer(request, r.primaryId, "rejected");
    await page.goto("/settings");
    await expect(section(page, "You").getByText("No player is you yet. The tracker will ask after your next match.")).toBeVisible();
    await expect(row(page, "You", "me")).toContainText("Not you");
    for (const r of yours) if (r.status === "confirmed") await answer(request, r.primaryId, "confirmed");
  });
});

test.describe("Seasons", () => {
  const today = () => dayOf(Date.now());

  test("+ Add a season starting today: current, ✓ Saved, focus on its Edit, and on the Trends strip", async ({ page }) => {
    await page.goto("/settings");
    const add = section(page, "Seasons").getByRole("button", { name: "+ Add" });
    await add.click();
    const form = page.getByRole("form", { name: "New season" });
    await expect(form.getByLabel("Name")).toBeFocused();
    await expect(add).toBeDisabled();
    await form.getByLabel("Name").fill("E2E");
    await form.getByLabel("Starts").fill(today());
    await form.getByLabel("Starts").press("Enter");
    const added = row(page, "Seasons", "E2E");
    await expect(added.getByRole("status")).toHaveText("✓ Saved");
    await expect(added).toContainText("current");
    await expect(added).toContainText("still running");
    await expect(added.getByRole("button", { name: "Edit" })).toBeFocused();
    await expect(row(page, "Seasons", "S24")).not.toContainText("current");

    await page.goto("/trends");
    await expect(page.getByRole("group", { name: /^Seasons and months of / }).getByRole("button", { name: "E2E" })).toBeVisible();
  });

  test("an edit re-sorts the row by date, and focus follows it", async ({ page }) => {
    await page.goto("/settings");
    await row(page, "Seasons", "S22").getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("form", { name: "Edit season" });
    await expect(form.getByLabel("Name")).toBeFocused();
    await form.getByLabel("Starts").fill("2026-09-24");
    await form.getByRole("button", { name: "Save" }).click();
    const names = section(page, "Seasons").getByRole("listitem").locator("[class*=label] > span:first-child");
    await expect(names).toHaveText(["S23", "S24", "S22"]);
    await expect(row(page, "Seasons", "S22").getByRole("button", { name: "Edit" })).toBeFocused();
    await page.reload();
    await expect(names).toHaveText(["S23", "S24", "S22"]);
  });

  test("errors show under the row before sending; a 409 shows the same kind of text", async ({ page }) => {
    await page.goto("/settings");
    const posts: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/seasons")) posts.push(r.url()); });
    await row(page, "Seasons", "S23").getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("form", { name: "Edit season" });
    const name = form.getByLabel("Name");
    const start = form.getByLabel("Starts");
    await name.fill("  ");
    await name.press("Enter");
    await expect(form.getByText("Give it a name.")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await name.fill("s22");
    await start.fill("2026-09-23");
    await name.press("Enter");
    await expect(form.getByText("Another season is called S22.")).toBeVisible();
    await expect(form.getByText("S24 already starts on that day.")).toBeVisible();
    await name.fill("S23");
    await name.press("Enter");
    await expect(start).toBeFocused();
    await expect(start).toHaveAttribute("aria-invalid", "true");
    await start.fill("");
    await start.press("Enter");
    await expect(form.getByText("Pick a start date.")).toBeVisible();
    expect(posts).toEqual([]);

    await page.route("**/api/seasons/*", (route) => route.fulfill({ status: 409, json: { error: "duplicate_start" } }));
    await start.fill("2026-06-20");
    await start.press("Enter");
    await expect(form.getByText("Another season already starts on that day.")).toBeVisible();
    await expect(start).toBeFocused();
    await start.press("Escape");
    await expect(row(page, "Seasons", "S23").getByRole("button", { name: "Edit" })).toBeFocused();
    await expect(row(page, "Seasons", "S23")).toContainText(/9 Jun 2026|Jun 9, 2026/);
  });

  test("Delete removes the row, says ✓ Saved by the heading, and focuses the next row's Edit", async ({ page, request }) => {
    await post(request, "/api/seasons?name=Gone&start=2026-04-01");
    await page.goto("/settings");
    await row(page, "Seasons", "Gone").getByRole("button", { name: "Delete" }).click();
    await expect(row(page, "Seasons", "Gone")).toHaveCount(0);
    await expect(section(page, "Seasons").locator("[class*=head]").getByRole("status")).toHaveText("✓ Saved");
    await expect(row(page, "Seasons", "S23").getByRole("button", { name: "Edit" })).toBeFocused();
  });

  test("Esc on a new row removes it and focuses + Add", async ({ page }) => {
    await page.goto("/settings");
    const add = section(page, "Seasons").getByRole("button", { name: "+ Add" });
    await add.click();
    await page.getByRole("form", { name: "New season" }).getByLabel("Name").press("Escape");
    await expect(page.getByRole("form", { name: "New season" })).toHaveCount(0);
    await expect(add).toBeFocused();
    // The seasons' end dates: the day before the next start (in the browser's locale order).
    await expect(row(page, "Seasons", "S22")).toContainText(/(11 Mar 2026|Mar 11, 2026) – (8 Jun 2026|Jun 8, 2026)/);
  });
});

test("a section link jumps to the section and focuses its heading", async ({ page }) => {
  await page.goto("/settings");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "Seasons" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Seasons" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 2, name: "Seasons" })).toBeInViewport();
  await nav.getByRole("link", { name: "You" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "You" })).toBeFocused();
});

test("passes axe in every theme, with a row in edit and an error showing; fits at 320px with the top row", async ({ page, request }) => {
  for (const theme of ["carbon", "slate", "oled"]) {
    await post(request, `/api/settings?theme=${theme}`);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(row(page, "Seasons", "S22")).toBeVisible();
    await expect(row(page, "You", "me")).toBeVisible();
    await row(page, "Seasons", "S22").getByRole("button", { name: "Edit" }).click();
    await page.getByRole("form", { name: "Edit season" }).getByLabel("Name").fill("");
    await page.getByRole("form", { name: "Edit season" }).getByLabel("Name").press("Enter");
    await expect(page.getByText("Give it a name.")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations, theme).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings");
  await expect(row(page, "Seasons", "S22")).toBeVisible();
  await row(page, "Seasons", "S22").getByRole("button", { name: "Edit" }).click();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "Seasons" }).click();
  // The sticky row stays on screen above the heading it jumped to.
  await expect(nav).toBeInViewport();
  const [navBox, headBox] = [await nav.boundingBox(), await page.getByRole("heading", { level: 2, name: "Seasons" }).boundingBox()];
  expect(headBox && navBox && headBox.y >= navBox.y + navBox.height).toBe(true);
});
