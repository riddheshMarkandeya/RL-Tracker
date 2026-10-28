// The Settings tables' writes: a season row and an answer to "is this you?". Shared with the web
// form, so the browser refuses what the server would.
import { z } from "zod";
import { dayParam, wholeId } from "./params";

export const SEASON_NAME_MAX = 20;

/** A season as `POST /api/seasons` takes it, in the query string. */
export const seasonInput = z.object({
  name: z.string().trim().min(1).max(SEASON_NAME_MAX),
  start: dayParam,
});
export type SeasonInput = z.infer<typeof seasonInput>;

/** What an id can be set to. No `pending`: a guess can't be un-answered. */
export const idStatus = z.enum(["confirmed", "rejected"]);
export type IdAnswer = z.infer<typeof idStatus>;

export const idStatusParams = z.object({ id: z.string().min(1), status: idStatus });

/** A season row's `:id` in the path. */
export const seasonIdParams = z.object({ id: wholeId });
