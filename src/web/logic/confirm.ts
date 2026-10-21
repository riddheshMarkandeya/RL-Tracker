// The header's two-step buttons (Start new session, Quit): the first click asks, the second sends.

// "done" and "failed" are short-lived notes after a send; each clears on its timeout.
export type ConfirmState = "idle" | "confirming" | "sending" | "done" | "failed";
export type ConfirmEvent = "ask" | "confirm" | "cancel" | "timeout" | "sent" | "failed";

export function confirmStep(state: ConfirmState, event: ConfirmEvent): ConfirmState {
  switch (state) {
    case "idle":
      return event === "ask" ? "confirming" : state;
    case "confirming":
      if (event === "confirm") return "sending";
      return event === "cancel" || event === "timeout" ? "idle" : state;
    case "sending":
      if (event === "sent") return "done";
      return event === "failed" ? "failed" : state;
    case "done":
    case "failed":
      if (event === "ask") return "confirming";
      return event === "timeout" ? "idle" : state;
  }
}
