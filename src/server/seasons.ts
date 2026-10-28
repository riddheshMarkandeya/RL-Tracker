// The seasons table's writes. The Stats API carries no season, so each new one is added by hand on
// the Settings page. Clashes are checked before writing (names case-insensitively, so `s25` clashes
// with `S25`); the UNIQUE constraints stay as the backstop.
import type { Season } from "../shared/periods";
import type { SeasonInput } from "../shared/schemas/tables";
import type { Db } from "./db/sqlite";
import type { Logger } from "./log";
import type { QueryReader } from "./query/read";

const C = "seasons";

export type SeasonWrite = { ok: true; seasons: Season[] } | { ok: false; error: "not_found" | "duplicate_name" | "duplicate_start" };

export function createSeasons({ tracker, reader, logger }: { tracker: Db; reader: QueryReader; logger: Logger }) {
  /** The clash with another season (not `id`), if any. */
  function clash({ name, start }: SeasonInput, id: number | null): SeasonWrite | null {
    const other = (sql: string, value: string) => tracker.get(`SELECT 1 FROM seasons WHERE ${sql} AND id IS NOT ?`, value, id) !== undefined;
    const field = other("name = ? COLLATE NOCASE", name) ? "name" : other("start_date = ?", start) ? "start" : null;
    if (field === null) return null;
    logger.warn(C, "conflict", { field });
    return { ok: false, error: field === "name" ? "duplicate_name" : "duplicate_start" };
  }

  const exists = (id: number) => tracker.get<Season>("SELECT id, name, start_date AS startDate FROM seasons WHERE id = ?", id);

  function notFound(id: number): SeasonWrite {
    logger.warn(C, "not_found", { id });
    return { ok: false, error: "not_found" };
  }

  function add(input: SeasonInput): SeasonWrite {
    return tracker.transaction(() => {
      const refused = clash(input, null);
      if (refused) return refused;
      const id = tracker.get<{ id: number }>("INSERT INTO seasons (name, start_date) VALUES (?, ?) RETURNING id", input.name, input.start)?.id;
      logger.info(C, "added", { id, name: input.name, start: input.start });
      return { ok: true, seasons: reader.readSeasons() };
    });
  }

  function edit(id: number, input: SeasonInput): SeasonWrite {
    return tracker.transaction(() => {
      if (!exists(id)) return notFound(id);
      const refused = clash(input, id);
      if (refused) return refused;
      tracker.run("UPDATE seasons SET name = ?, start_date = ? WHERE id = ?", input.name, input.start, id);
      logger.info(C, "edited", { id, name: input.name, start: input.start });
      return { ok: true, seasons: reader.readSeasons() };
    });
  }

  function remove(id: number): SeasonWrite {
    return tracker.transaction(() => {
      const season = exists(id);
      if (!season) return notFound(id);
      tracker.run("DELETE FROM seasons WHERE id = ?", id);
      logger.info(C, "deleted", { id, name: season.name, start: season.startDate });
      return { ok: true, seasons: reader.readSeasons() };
    });
  }

  return { add, edit, remove };
}
