import { describe, expect, test } from "vitest";
import { platformOf } from "./platforms";

describe("platformOf", () => {
  test("the prefixes the captures show", () => {
    expect(platformOf("Epic|8f3c2a|0")).toEqual({ name: "Epic", known: true });
    expect(platformOf("Steam|76561198000000000|0")).toEqual({ name: "Steam", known: true });
    expect(platformOf("PS4|1234567890|0")).toEqual({ name: "PlayStation", known: true });
    expect(platformOf("XboxOne|2535400000000000|0")).toEqual({ name: "Xbox", known: true });
  });

  test("PS5 and Switch, not seen yet", () => {
    expect(platformOf("PS5|1|0")).toEqual({ name: "PlayStation", known: true });
    expect(platformOf("Switch|1|0")).toEqual({ name: "Switch", known: true });
  });

  test("any other prefix shows as itself; no `|` at all is the whole id", () => {
    expect(platformOf("Tesla|1|0")).toEqual({ name: "Tesla", known: false });
    expect(platformOf("loner")).toEqual({ name: "loner", known: false });
    expect(platformOf("constructor|1|0")).toEqual({ name: "constructor", known: false });
  });
});
