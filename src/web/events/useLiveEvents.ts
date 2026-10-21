import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribe } from "./client";
import { live } from "./live";

/** Feeds the events stream into the live store and keeps the query cache fresh. */
export function useLiveEvents(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribe((message) => {
        switch (message.type) {
          case "status":
            live.set({ status: message.data });
            break;
          case "link": {
            const wasDown = live.get().link === "down";
            const open = message.link === "open";
            // Open again means whatever this tab's Quit stopped is running again.
            live.set(open ? { link: "open", stopped: false } : { link: message.link });
            // Events sent while the stream was down are lost, and a query that failed on the
            // startup 503 stays failed under staleTime Infinity: refetch everything on reconnect.
            if (open && wasDown) void queryClient.invalidateQueries();
            break;
          }
          case "match_ended":
            void queryClient.invalidateQueries();
            break;
          case "session_break":
            void queryClient.invalidateQueries({ queryKey: ["sessions"] });
            break;
        }
      }),
    [queryClient],
  );
}
