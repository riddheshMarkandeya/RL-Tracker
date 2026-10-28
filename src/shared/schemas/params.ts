// Query parameters as the API accepts them. They check what the query logic trusts: a day is a
// real `YYYY-MM-DD`, a number is a whole number, a filter is one the logic knows.
import { z } from "zod";
import type { PeriodSpec } from "../periods";
import type { PlaylistFilter } from "../playlist-filter";
import { ROLLING_WINDOW } from "../trends";
import { groupFilter, windowParam } from "./settings";

const wholeId = z.string().regex(/^\d{1,9}$/).transform(Number);

/** `everything | ranked | casual | extra | private | <playlist id>`, everything when left out. */
export const filterParam = z
  .union([groupFilter, wholeId.transform((playlist) => ({ playlist }))])
  .default("everything") satisfies z.ZodType<PlaylistFilter, string | undefined>;

// From 1000 on: Date maps years 0-99 onto 1900-1999, so an early day would land in the wrong century.
export const dayParam = z.iso.date().refine((day) => day >= "1000-01-01", "year before 1000");

// From 1000 on: Date maps years 0-99 onto 1900-1999.
export const playedDaysParams = z.object({
  year: z.string().regex(/^[1-9]\d{3}$/).transform(Number),
  filter: filterParam,
});

export const filterOnly = z.object({ filter: filterParam });

export const sessionsParams = z
  .object({ filter: filterParam, from: dayParam, to: dayParam })
  .refine((p) => p.from <= p.to, { message: "from after to", path: ["to"] });

export const monthsParams = z.object({ filter: filterParam, before: dayParam });

// The Trends rolling window: the page sends its setting, so the cached period is keyed by it.
const common = { filter: filterParam, window: windowParam.default(ROLLING_WINDOW) };

export const periodParams = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.enum(["day", "week", "month", "year"]), day: dayParam, ...common }),
    z.object({ kind: z.literal("season"), season: wholeId, ...common }),
    z.object({ kind: z.enum(["last7", "last30", "this_year", "all"]), ...common }),
  ])
  .transform((p): { spec: PeriodSpec; filter: PlaylistFilter; window: number } => {
    switch (p.kind) {
      case "season":
        return { spec: { kind: "season", id: p.season }, filter: p.filter, window: p.window };
      case "day":
      case "week":
      case "month":
      case "year":
        return { spec: { kind: p.kind, day: p.day }, filter: p.filter, window: p.window };
      default:
        return { spec: { kind: p.kind }, filter: p.filter, window: p.window };
    }
  });
