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
  await expect(page).toHaveURL(new RegExp(`/recap/${key}(\\?filter=everything)?$`));
  await expect(page.locator(`[data-session="${key}"]`)).toHaveCount(1);
};

// The browser logs any 404 response as a console error; the unknown session's and match's are the expected ones,
// as is the reroll failure the remarks test fakes.
const NOT_FOUND = /^Failed to load resource: .* (404 .*\/api\/(sessions\/no-such-session\?|matches\/no-such-match\))|500 .*\/remarks\/reroll\?)/;
const rail = (page: Page) => page.getByRole("navigation", { name: "Matches" });
const numbersTab = (page: Page) => page.getByRole("link", { name: "Matches & numbers" });
const scoreboardLoaded = (page: Page) => expect(page.getByRole("rowheader", { name: /\(you\)/ })).toBeVisible();

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !NOT_FOUND.test(e))).toEqual([]);
});

test("/recap opens the latest session; ‹ steps back through the days, with 2nd of 2 on a shared day", async ({ page }) => {
  await page.goto("/recap");
  await expect(page).toHaveURL(/\/recap\/e2e-seed-won(\?filter=everything)?$/);
  await expect(bug(page, "1 win, 0 losses")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next session" })).toBeDisabled();

  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-second(\?filter=everything)?$/);
  await expect(picker(page)).toContainText("2nd of 2 that day");
  await expect(bug(page, "0 wins, 1 loss")).toBeVisible();

  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a(\?filter=everything)?$/);
  await expect(picker(page)).toContainText("1st of 2 that day");
  await expect(bug(page, "2 wins, 2 losses")).toBeVisible();
  // The second match failed a check: its card says so.
  await expect(page.getByRole("link", { name: /^Match 2, .*flagged: a data check failed$/ })).toBeVisible();

  // Everything leaves the private-only session out, so the 26-match day comes next.
  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00(\?filter=everything)?$/);
  await expect(page.getByRole("link", { name: /^Match 26,/ })).toBeVisible();
  await expect(page.locator("ol").filter({ has: page.getByRole("link", { name: /^Match 26,/ }) })).toHaveClass(/dense/);
});

test("remarks: a revisit shows the same lines; ↻ picks new ones, which stick", async ({ page }) => {
  const again = page.getByRole("button", { name: "Another remark" });
  const mood = page.locator("p").filter({ has: again });
  const moodText = async () => (await mood.innerText()).replace("↻", "").trim();
  await page.goto("/recap/e2e-seed-won");
  await expect(again).toBeVisible();
  const first = await moodText();
  expect(first.length).toBeGreaterThan(0);

  await page.reload();
  await expect(again).toBeVisible();
  expect(await moodText()).toBe(first);

  await again.click();
  await expect(mood).not.toContainText(first);
  await expect(again).toBeFocused();
  const rolled = await moodText();
  await page.reload();
  await expect(again).toBeVisible();
  expect(await moodText()).toBe(rolled);

  // A failed reroll keeps the lines and offers a retry, which works once the server answers.
  await page.route("**/remarks/reroll?*", (route) => route.fulfill({ status: 500, json: { error: "internal" } }), { times: 1 });
  await again.click();
  await expect(page.getByText("Couldn't re-roll")).toBeVisible();
  expect(await moodText()).toContain(rolled);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn't re-roll")).toHaveCount(0);
  await expect(mood).not.toContainText(rolled);
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

test("the long session's Overview: per game, what stood out, by playlist, the goal map, extras", async ({ page }) => {
  await page.goto("/recap/e2e-long-00");
  const section = (name: string) => page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });

  const perGame = section("Per game vs your 30-day average");
  await expect(perGame.getByRole("listitem")).toHaveCount(6);
  await expect(perGame.getByRole("listitem").filter({ hasText: "Goals" })).toContainText("1.12 /game");
  await expect(perGame.getByRole("listitem").filter({ hasText: "Goals" })).toContainText("up 12% vs 30-day avg");
  await expect(perGame.getByRole("listitem").filter({ hasText: "Goals" })).toContainText("29 total");
  await expect(perGame.getByRole("listitem").filter({ hasText: "Score" })).toContainText("≈ 30-day avg");
  // A zero average has no fair ratio, so saves (none, then and now) show no comparison.
  await expect(perGame.getByRole("listitem").filter({ hasText: "Saves" })).not.toContainText("avg");

  // Every other stat matches the baseline's one match, so only goals stood out.
  const stood = section("What stood out");
  await expect(stood.getByRole("listitem")).toHaveCount(1);
  await expect(stood).toContainText("1.12 goals per game");
  await expect(stood).toContainText("up 12% vs 30-day avg (1)");

  const byPlaylist = section("By playlist");
  await expect(byPlaylist.getByRole("row")).toHaveCount(3);
  await expect(byPlaylist.getByRole("row", { name: /Ranked Doubles/ })).toContainText("1–0");

  const goals = section("Where the goals came from");
  await expect(goals.getByRole("group", { name: "Where 29 goals for and 26 against came from" })).toBeVisible();
  await expect(goals).toContainText("Scored · 29");
  await expect(goals).toContainText("2 close · 26 mid · 1 long");
  await expect(goals).toContainText("Conceded · 26 · 1 aerial");
  await expect(goals).toContainText("1 close · 25 mid · 0 long");
  await expect(goals).toContainText("You scored 29 of the team's 29.");

  const extras = section("Extras");
  await expect(extras.getByRole("listitem").filter({ hasText: "Hardest shot" })).toContainText("102 km/h");
  await expect(extras.getByRole("listitem").filter({ hasText: "Fastest goal" })).toContainText("120 km/h");
  await expect(extras.getByRole("listitem").filter({ hasText: "Crossbar hits" })).toContainText("26");
  await expect(extras.getByRole("listitem").filter({ hasText: "Supersonic" })).toContainText("10%");
  await expect(extras.getByRole("heading", { name: "Highlights" })).toBeVisible();
  await expect(extras.getByRole("listitem").filter({ hasText: "Hat tricks" })).toContainText("1");
});

test("one playlist: no By playlist; no baseline: no What stood out and no ▲▼", async ({ page }) => {
  await page.goto("/recap/e2e-first-a");
  await expect(page.getByRole("heading", { name: "What stood out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By playlist" })).toHaveCount(0);

  await page.goto("/recap/e2e-old");
  await expect(page.getByRole("heading", { name: "Per game", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What stood out" })).toHaveCount(0);
  await expect(page.getByText(/30-day avg/)).toHaveCount(0);
});

test("at 320px a two-digit scorebug and the full Overview fit without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/recap/e2e-long-00");
  await expect(page.getByRole("img", { name: "17 wins, 9 losses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Highlights" })).toBeVisible();
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
  await expect(bug(page, "2 wins, 2 losses")).toBeVisible();
  // A filter change hands focus back to the filter; Back to a cached entry leaves it there.
  await expect(select).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a(\?filter=everything)?$/);
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

test("Matches & numbers: every match with totals in a capped box; a row opens its match", async ({ page }) => {
  await page.goto("/recap/e2e-long-00");
  await numbersTab(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00\/matches(\?filter=everything)?$/);
  await expect(numbersTab(page)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Every match · 26 matches · 17–9" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(26);
  // # Time Playlist Result | Score G …: the totals row's goals are the Overview's 29.
  await expect(table.locator("tfoot td").nth(1)).toHaveText("29");
  await expect(table.locator("thead th").first()).toHaveCSS("position", "sticky");
  await expect(table.locator("tfoot th")).toHaveCSS("position", "sticky");

  // A row opens its match; focus goes to that match in the side list, which keeps it in view.
  await page.getByRole("link", { name: /^Match 26,/ }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00\/match\/e2e-long-25(\?filter=everything)?$/);
  const open = rail(page).locator("[aria-current=page]");
  await expect(open).toBeFocused();
  await expect(numbersTab(page)).toHaveAttribute("aria-current", "true");
  const box = await rail(page).boundingBox();
  const row = await open.boundingBox();
  expect(box && row && row.y >= box.y && row.y + row.height <= box.y + box.height).toBe(true);

  // Another match from the list keeps focus on it; All matches goes back, focus to its tab.
  await rail(page).getByRole("link", { name: /^Match 2,/ }).click();
  await expect(page).toHaveURL(/\/match\/e2e-long-01(\?filter=everything)?$/);
  await expect(rail(page).getByRole("link", { name: /^Match 2,/ })).toBeFocused();
  await rail(page).getByRole("link", { name: /All matches/ }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00\/matches(\?filter=everything)?$/);
  await expect(numbersTab(page)).toBeFocused();

  // A step to another session stays on Matches & numbers.
  await prev(page).click();
  await expect(page).toHaveURL(/\/recap\/e2e-old\/matches(\?filter=everything)?$/);
});

test("the match page: header, scoreboard, the match's goal map and extras", async ({ page }) => {
  await page.goto("/recap/e2e-long-00/match/e2e-long-01");
  await expect(page.getByRole("heading", { name: /^Match 2: win 4–1$/ })).toBeVisible();
  await expect(page.getByText("MVP", { exact: true })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await scoreboardLoaded(page);
  await expect(page.getByRole("heading", { name: "Your team · won" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opponents · lost" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /\(you\)/ })).toHaveText("Epic|me|0 (you)");
  await expect(page.getByRole("group", { name: "Where 4 goals for and 1 against came from" })).toBeVisible();
  const mine = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your match", exact: true }) });
  await expect(mine.getByRole("listitem").filter({ hasText: "Hat tricks" })).toContainText("1");
  await expect(mine.getByRole("listitem").filter({ hasText: "Fastest goal" })).toContainText("120 km/h");
});

test("flags: the note says why, worded by how the match counted", async ({ page }) => {
  await page.goto("/recap/e2e-first-a/match/e2e-first-c");
  await expect(page.getByRole("note")).toHaveText("You left before the end — counted as a loss.");
  await expect(rail(page).getByRole("link", { name: /^Match 3, .*flagged: you left early$/ })).toBeVisible();

  await rail(page).getByRole("link", { name: /^Match 4,/ }).click();
  await expect(page.getByRole("note")).toHaveText("MVP inferred: no MVP award fired, so it went to the top score on the winning team.");
  await expect(page.getByText("MVP (inferred)")).toBeVisible();

  await rail(page).getByRole("link", { name: /^Match 2,/ }).click();
  await expect(page.getByRole("note")).toHaveText("A data check failed on this match, so some numbers may be off.");

  await rail(page).getByRole("link", { name: /^Match 1,/ }).click();
  await expect(page.getByRole("note")).toHaveCount(0);

  await numbersTab(page).click();
  await expect(page.getByRole("table").getByText("⚑")).toHaveCount(3);
});

test("links: a match card and a goal dot open their match", async ({ page }) => {
  await page.goto("/recap/e2e-long-00");
  await page.getByRole("link", { name: /^Match 2,/ }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00\/match\/e2e-long-01(\?filter=everything)?$/);
  await scoreboardLoaded(page);

  await page.goBack();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00(\?filter=everything)?$/);
  // The last mark is drawn on top: the seed's goals share a spot, and the first is covered.
  const dot = page.locator("svg a").last();
  await expect(dot).toHaveAttribute("tabindex", "-1");
  await dot.click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00\/match\/e2e-long-\d\d(\?filter=everything)?$/);
  await expect(rail(page)).toBeVisible();
});

test("a match outside the view: under another filter, in another session, or gone", async ({ page }) => {
  // Only match 3 is on Ranked Doubles.
  await page.goto("/recap/e2e-long-00/match/e2e-long-05?filter=11");
  await expect(page.getByRole("heading", { name: "This match isn't in this view." })).toBeVisible();
  await page.getByRole("link", { name: "Show it under every playlist" }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-long-00\/match\/e2e-long-05(\?filter=everything)?$/);
  await expect(page.getByRole("heading", { name: /^Match 6:/ })).toBeVisible();

  await page.goto("/recap/e2e-long-00/match/e2e-first-c");
  await page.getByRole("link", { name: "Open it in its own session" }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a\/match\/e2e-first-c(\?filter=everything)?$/);
  await expect(page.getByRole("note")).toBeVisible();

  await page.goto("/recap/e2e-long-00/match/no-such-match");
  await expect(page.getByRole("heading", { name: "This match isn't here any more." })).toBeVisible();
});

test("at 320px the new pages fit without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/recap/e2e-long-00/matches", "/recap/e2e-long-00/match/e2e-long-01"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path.includes("/match/")) await scoreboardLoaded(page);
    else await expect(page.getByRole("table")).toBeVisible();
    expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), path).toBe(0);
  }
});

test("axe: the recap, its picker open, and its states in every theme", async ({ page }) => {
  const paths = [
    "/recap/e2e-long-00",
    "/recap/e2e-long-00/matches",
    "/recap/e2e-long-00/match/e2e-long-01",
    "/recap/e2e-first-a/match/e2e-first-c",
    "/recap/e2e-old",
    "/recap/e2e-seed-won?filter=private",
    "/recap?filter=17",
    "/recap/no-such-session",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path === "/recap/e2e-long-00") {
      await picker(page).click();
      await expect(page.locator("a[aria-current=true]")).toBeFocused();
    }
    if (path.includes("/match/")) await scoreboardLoaded(page);
    for (const theme of THEMES) {
      // A string expression: the root tsconfig has no DOM lib for a page-side function.
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});
