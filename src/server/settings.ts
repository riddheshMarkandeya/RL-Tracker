// The settings rows in tracker.db: one JSON value per key, a missing key at its default. A row
// that no longer parses falls back to its default and is logged, so it can't break the dashboard.
import { DEFAULT_SETTINGS, settingFields, type SettingKey, type Settings, type SettingsPatch } from "../shared/schemas/settings";
import type { Db } from "./db/sqlite";
import type { Logger } from "./log";

const C = "settings";

const isKey = (key: string): key is SettingKey => Object.hasOwn(settingFields, key);

export function createSettings({ tracker, logger }: { tracker: Db; logger: Logger }) {
  function get(): Settings {
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const { key, value } of tracker.all<{ key: string; value: string }>("SELECT key, value FROM settings ORDER BY key")) {
      if (!isKey(key)) {
        logger.warn(C, "bad_stored", { key, reason: "unknown_key" });
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(value);
      } catch {
        logger.warn(C, "bad_stored", { key, reason: "bad_json" });
        continue;
      }
      const parsed = settingFields[key].safeParse(raw);
      if (parsed.success) out[key] = parsed.data;
      else logger.warn(C, "bad_stored", { key, reason: "rejected" });
    }
    // Every key starts at its default and only takes a value its own schema passed.
    return out as Settings;
  }

  function save(changes: SettingsPatch): Settings {
    tracker.transaction(() => {
      for (const [key, value] of Object.entries(changes)) {
        tracker.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
      }
    });
    logger.info(C, "saved", { changes });
    return get();
  }

  return { get, save };
}

export type SettingsStore = ReturnType<typeof createSettings>;
