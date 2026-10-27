// The recap with no matches at all: its own worker and stack, seeded empty.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test.use({ seed: "empty" });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("an empty history says there's not enough data yet, under any filter", async ({ page }) => {
  for (const path of ["/recap", "/recap?filter=ranked"]) {
    await page.goto(path);
    await expect(page.getByText(/^Not enough data yet\./)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Recap" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  }
});
