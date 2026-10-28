// Shared by the share-card specs: opening the card, and measuring how its content fits.
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

export const shareButton = (page: Page) => page.getByRole("button", { name: "Share", exact: true });
export const shareDialog = (page: Page) => page.getByRole("dialog", { name: "Share this session" });

/** Opens the card and waits until it can be exported. */
export async function openCard(page: Page): Promise<void> {
  await shareButton(page).click();
  await expect(shareDialog(page)).toBeVisible();
  await expect(shareDialog(page).locator("[data-part=footer]")).toBeVisible();
  await expect(shareDialog(page).getByRole("button", { name: "Download PNG" })).toHaveAttribute("aria-disabled", "false");
}

export interface CardFit {
  /** Content past the card's own height; 0 when it fits. */
  overflow: number;
  /** Room between the footer and the card's inner bottom edge; negative when it runs over. */
  footerRoom: number;
  lineHeight: number;
  /** null without a name line. */
  nameCut: boolean | null;
  nameInside: boolean | null;
}

// A string expression: the root tsconfig has no DOM lib for a page-side function.
const MEASURE = `(() => {
  const card = document.querySelector("dialog[open] [data-part=footer]").closest("[role=img]");
  const box = card.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(card).paddingBottom);
  const part = (p) => card.querySelector("[data-part=" + p + "]");
  const name = part("name");
  return {
    overflow: card.scrollHeight - card.clientHeight,
    footerRoom: box.bottom - pad - part("footer").getBoundingClientRect().bottom,
    lineHeight: part("line").getBoundingClientRect().height,
    nameCut: name ? name.scrollWidth > name.clientWidth : null,
    nameInside: name ? name.getBoundingClientRect().right <= box.right - pad + 0.5 : null,
  };
})()`;

export const measureCard = (page: Page) => page.evaluate<CardFit>(MEASURE);

/** Lines of text in a tile's label. */
export const labelLines = (page: Page, tile: string) =>
  page.evaluate<number>(`(() => {
    const k = document.querySelector("dialog[open] [data-tile=${tile}] > :nth-child(2)");
    return Math.round(k.getBoundingClientRect().height / parseFloat(getComputedStyle(k).lineHeight));
  })()`);
