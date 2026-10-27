import { describe, expect, expectTypeOf, test } from "vitest";
import { aggregate, type Aggregate, type MyMatch } from "../aggregate";
import { aggregateSchema, type AggregateWire, type MyMatchWire } from "./responses";

describe("response schemas", () => {
  test("the query logic's types are the wire types, so neither drifts", () => {
    expectTypeOf<Aggregate>().toEqualTypeOf<AggregateWire>();
    expectTypeOf<MyMatch>().toEqualTypeOf<MyMatchWire>();
  });

  test("an empty aggregate (all nulls) parses", () => {
    expect(aggregateSchema.parse(aggregate([]))).toEqual(aggregate([]));
  });
});
