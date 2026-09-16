import { expect, test } from "bun:test";
import { allowedOrderTransitions, assertOrderTransition, canTransitionOrder, InvalidOrderTransitionError } from "../src";

test("order lifecycle only permits explicit transitions", () => {
  expect(canTransitionOrder("DRAFT", "PENDING_PAYMENT")).toBeTrue();
  expect(canTransitionOrder("PREPARING", "PARTIALLY_READY")).toBeTrue();
  expect(canTransitionOrder("DRAFT", "READY")).toBeFalse();
  expect(allowedOrderTransitions("COMPLETED")).toEqual(["PARTIALLY_REFUNDED", "REFUNDED"]);
  expect(() => assertOrderTransition("PAID", "DRAFT")).toThrow(InvalidOrderTransitionError);
});

test("ready event is reachable from both full and partial preparation", () => {
  expect(canTransitionOrder("PREPARING", "READY")).toBeTrue();
  expect(canTransitionOrder("PARTIALLY_READY", "READY")).toBeTrue();
});
