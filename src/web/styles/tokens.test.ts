import { describe, expect, test } from "vitest";
import css from "./tokens.css?raw";

const THEMES = ["carbon", "slate", "oled"];
const THEME_TOKENS = ["page", "surf", "surf2", "line", "grid", "ink", "ink2", "muted", "accent"];

function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[[\]]/g, "\\$&");
  const body = new RegExp(`(?:^|\\s)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`no block ${selector}`);
  const tokens = new Map<string, string>();
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);?/g)) tokens.set(m[1] ?? "", (m[2] ?? "").trim());
  return tokens;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme tokens", () => {
  test("the contrast helper matches known WCAG ratios", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  test("every theme defines the same tokens", () => {
    for (const theme of THEMES) expect([...block(`:root[data-theme=${theme}]`).keys()].sort()).toEqual([...THEME_TOKENS].sort());
  });

  test("the shared tokens live on :root", () => {
    expect([...block(":root").keys()]).toEqual(expect.arrayContaining(["blue", "orange", "win", "loss", "up", "down", "flag", "r", "s1", "s6"]));
  });

  describe.each(THEMES)("%s contrast", (theme) => {
    const t = block(`:root[data-theme=${theme}]`);
    const get = (k: string) => t.get(k) ?? "";
    test.each([["ink", "page"], ["ink", "surf"], ["ink", "surf2"], ["ink2", "page"], ["ink2", "surf"], ["ink2", "surf2"], ["muted", "surf"]])(
      "%s on %s is at least 4.5:1",
      (fg, bg) => {
        expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
      },
    );
    test("accent on surf is at least 3:1", () => {
      expect(contrast(get("accent"), get("surf"))).toBeGreaterThanOrEqual(3);
    });
  });
});
