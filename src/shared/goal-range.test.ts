import { describe, expect, test } from "vitest";
import { goalRange } from "./goal-range";

describe("goalRange", () => {
  test.each([
    [0, "close"],
    [2559, "close"],
    [2560, "mid"],
    [5119, "mid"],
    [5120, "long"],
    [9000, "long"],
  ] as const)("%d uu is %s", (distance, range) => {
    expect(goalRange(distance)).toBe(range);
  });
});
