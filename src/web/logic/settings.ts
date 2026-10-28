// The Settings page's rules: when a section is at its defaults, what its reset sends, how a change
// goes out as the save's query string, and the rolling window's typed draft.
import { DEFAULT_SETTINGS, SETTINGS_SECTIONS, windowParam, type SectionId, type Settings, type SettingsPatch } from "../../shared/schemas/settings";

export const atDefaults = (s: Settings, section: SectionId): boolean => SETTINGS_SECTIONS[section].every((k) => s[k] === DEFAULT_SETTINGS[k]);

export const sectionDefaults = (section: SectionId): SettingsPatch => Object.fromEntries(SETTINGS_SECTIONS[section].map((k) => [k, DEFAULT_SETTINGS[k]]));

export const patchQuery = (patch: SettingsPatch): string => new URLSearchParams(Object.entries(patch).map(([k, v]) => [k, String(v)])).toString();

/** The theme kept in the browser too, so index.html can apply it before the first paint. index.html reads this key. */
export const THEME_KEY = "rlt-theme";

export function rememberTheme(theme: Settings["theme"]): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be blocked; the theme still applies once settings load, after a carbon first paint.
  }
}

export const WINDOW_ERROR = "Use a whole number from 5 to 100.";

export function parseWindow(draft: string): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = windowParam.safeParse(draft.trim());
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: WINDOW_ERROR };
}
