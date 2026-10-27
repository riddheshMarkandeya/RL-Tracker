import { useSyncExternalStore } from "react";
import { REQUEST_HEADER, SHUTDOWN_HEADER } from "../../shared/constants";
import { post } from "../api";
import { live } from "../events/live";
import { ConfirmButton } from "./ConfirmButton";
import { useCurrentSession } from "../queries";

/** Why neither action can reach the tracker now, if so. A string snapshot, so a status event alone doesn't re-render. */
function useOffline(): string | undefined {
  return useSyncExternalStore(live.subscribe, () => {
    const { link, stopped } = live.get();
    if (stopped) return "Tracker stopped";
    if (link === "connecting") return "Connecting…";
    return link === "open" ? undefined : "Tracker not running";
  });
}

export function StartSessionButton() {
  const { data: session } = useCurrentSession();
  const offline = useOffline();
  return (
    <ConfirmButton
      label="Start new session"
      question="Start new session?"
      failText="Couldn't start a new session"
      doneText="New session started"
      disabledReason={offline ?? (session ? undefined : "No session in progress")}
      // The tracker's session_break event refetches the session in every tab, this one included.
      onConfirm={async () => { await post("/api/sessions/break", { [REQUEST_HEADER]: "1" }); }}
    />
  );
}

export function QuitButton() {
  const offline = useOffline();
  return (
    <ConfirmButton
      label="Quit"
      question="Quit the tracker? Recording stops."
      failText="Couldn't quit the tracker"
      disabledReason={offline}
      onConfirm={async () => {
        await post("/api/shutdown", { [SHUTDOWN_HEADER]: "1" });
        live.set({ stopped: true });
      }}
    />
  );
}
