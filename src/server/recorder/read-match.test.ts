import { expect, test, vi } from "vitest";
import { readMatch } from "./read-match";
import type { StoredEvent } from "./store";

vi.mock("./extras", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./extras")>()),
  computeExtras: () => {
    throw new TypeError("boom");
  },
}));

test("a throw in the extras leaves the base summary, with the extras null and flagged", () => {
  const events: StoredEvent[] = [{ seq: 0, ts: 0, name: "RoundStarted", data: {} }];
  const { summary, failures } = readMatch({ matchEvents: () => events }, "G", "destroyed");
  expect(summary.guid).toBe("G");
  expect(summary.extras).toBeNull();
  expect(failures.find((f) => f.id === "extras_computed")?.detail).toMatch(/TypeError: boom/);
  expect(summary.flags).toContain("extras_computed");
});
