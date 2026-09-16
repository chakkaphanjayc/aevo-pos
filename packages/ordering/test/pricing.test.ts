import { expect, test } from "bun:test";
import { calculateOrderTotals } from "../src";

test("pricing uses integer minor units and modifier quantities", () => {
  expect(calculateOrderTotals([
    { unitPriceMinor: 6500, quantity: 2, modifiers: [{ priceDeltaMinor: 2000 }, { priceDeltaMinor: 500, quantity: 2 }] },
    { unitPriceMinor: 3000, quantity: 1 }
  ])).toEqual({ subtotalMinor: 22000, discountMinor: 0, taxMinor: 0, totalMinor: 22000 });
});

test("discount cannot make an order negative", () => {
  expect(() => calculateOrderTotals([{ unitPriceMinor: 100, quantity: 1 }], 101)).toThrow("discountMinor cannot exceed subtotalMinor");
});
