import { expect, test } from "bun:test";
import type { CreateOrderInput, SessionPrincipal } from "@aevo/contracts";
import { createOrder, transitionOrder, type Database, OrderValidationError } from "../src";

const principal: SessionPrincipal = {
  userId: "user-1",
  email: "owner@example.com",
  organizationId: "org-1",
  membershipId: "membership-1",
  role: "OWNER",
  permissions: ["order.create"]
};

const database = { client: {} as never, ping: async () => undefined, close: async () => undefined } as Database;

test("order creation rejects an empty cart before touching Supabase", async () => {
  const input = {
    storeId: "store-1",
    channel: "POS",
    fulfillmentType: "TAKEAWAY",
    items: []
  } as unknown as CreateOrderInput;
  await expect(createOrder(database, principal, input, "create-key-1")).rejects.toBeInstanceOf(OrderValidationError);
});

test("order creation requires an idempotency key", async () => {
  const input: CreateOrderInput = {
    storeId: "store-1",
    channel: "POS",
    fulfillmentType: "TAKEAWAY",
    items: [{ productId: "product-1", quantity: 1 }]
  };
  await expect(createOrder(database, principal, input, "")).rejects.toThrow("Idempotency-Key is required");
});

test("stale order transitions fail before a remote mutation", async () => {
  await expect(transitionOrder(database, principal, "order-1", {
    storeId: "store-1",
    expectedStatus: "PAID",
    toStatus: "DRAFT"
  }, "transition-key-1")).rejects.toThrow("Order cannot transition from PAID to DRAFT");
});
