import { useQuery } from "@tanstack/react-query";
import { currentResponse } from "../../shared/schemas/responses";
import { getJson } from "../api";

/** The current session under "everything", for the header chip and the Start new session button. */
export function useCurrentSession() {
  return useQuery({
    queryKey: ["sessions", "current", "everything"],
    queryFn: () => getJson("/api/sessions/current?filter=everything", currentResponse),
    select: (data) => data.session,
  });
}
