import { expect, test } from "vitest";
import { confirmStep, type ConfirmState } from "./confirm";

test("the two-step: ask, confirm, send, a done note, back to idle", () => {
  let s: ConfirmState = "idle";
  s = confirmStep(s, "ask");
  expect(s).toBe("confirming");
  s = confirmStep(s, "confirm");
  expect(s).toBe("sending");
  expect(confirmStep(s, "sent")).toBe("done");
  expect(confirmStep(s, "failed")).toBe("failed");
  expect(confirmStep("done", "timeout")).toBe("idle");
});

test("cancel and the timeout both revert an unanswered confirm", () => {
  expect(confirmStep("confirming", "cancel")).toBe("idle");
  expect(confirmStep("confirming", "timeout")).toBe("idle");
});

test("the failure note clears on its timeout or a new ask", () => {
  expect(confirmStep("failed", "timeout")).toBe("idle");
  expect(confirmStep("failed", "ask")).toBe("confirming");
});

test("a new ask also clears the done note", () => {
  expect(confirmStep("done", "ask")).toBe("confirming");
});

test("events that don't apply leave the state alone", () => {
  expect(confirmStep("idle", "confirm")).toBe("idle");
  expect(confirmStep("sending", "cancel")).toBe("sending");
  expect(confirmStep("sending", "timeout")).toBe("sending");
  expect(confirmStep("sending", "ask")).toBe("sending");
});
