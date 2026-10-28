// The my_ids rows as the Settings page shows them, and the answer to "is this you?". Readers count
// every id that isn't rejected as you at query time, so a status change re-labels every match.
import { platformOf } from "../shared/platforms";
import type { IdRow } from "../shared/schemas/responses";
import type { IdAnswer } from "../shared/schemas/tables";
import type { Db } from "./db/sqlite";
import type { Logger } from "./log";

const C = "ids";

type Stored = Omit<IdRow, "platform">;

export function createIds({ tracker, logger }: { tracker: Db; logger: Logger }) {
  // The list is read on every refetch, so each unknown prefix is warned about once per run.
  const warned = new Set<string>();

  function list(): IdRow[] {
    const rows = tracker.all<Stored>("SELECT primary_id AS primaryId, name, status FROM my_ids ORDER BY added_at, primary_id");
    return rows.map((r) => {
      const platform = platformOf(r.primaryId);
      if (!platform.known && !warned.has(platform.name)) {
        warned.add(platform.name);
        logger.warn(C, "unknown_platform", { prefix: platform.name });
      }
      return { ...r, platform: platform.name };
    });
  }

  /** The whole list after the change, or null for an id that isn't in my_ids. */
  function setStatus(id: string, status: IdAnswer): IdRow[] | null {
    const from = tracker.get<{ status: string }>("SELECT status FROM my_ids WHERE primary_id = ?", id)?.status;
    if (from === undefined) {
      logger.warn(C, "unknown_id", { id });
      return null;
    }
    tracker.run("UPDATE my_ids SET status = ? WHERE primary_id = ?", status, id);
    logger.info(C, "status", { id, from, to: status });
    return list();
  }

  return { list, setStatus };
}
