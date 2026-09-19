import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, test, beforeEach } from "bun:test";
import {
  AevoPosOfflineDatabase,
  queueOfflineOrder,
  processOfflineQueue
} from "../src/lib/offline-db";
import type { CreateOrderInput, OrderSummary } from "@aevo/contracts";

describe("AevoPosOfflineDatabase (Dexie)", () => {
  let db: AevoPosOfflineDatabase;

  beforeEach(async () => {
    // Unique in-memory db name per test
    db = new AevoPosOfflineDatabase(`test-db-${Date.now()}-${Math.random()}`, {
      indexedDB,
      IDBKeyRange
    });
    await db.open();
  });

  test("caches and queries offline catalog products", async () => {
    await db.products.bulkPut([
      {
        id: "prod-1",
        storeId: "store-1",
        name: "Iced Latte",
        category: "Coffee",
        priceMinor: 6500,
        available: true,
        updatedAt: new Date().toISOString()
      },
      {
        id: "prod-2",
        storeId: "store-1",
        name: "Matcha Latte",
        category: "Tea",
        priceMinor: 7500,
        available: true,
        updatedAt: new Date().toISOString()
      }
    ]);

    const coffeeItems = await db.products
      .where("category")
      .equals("Coffee")
      .toArray();

    expect(coffeeItems).toHaveLength(1);
    expect(coffeeItems[0].name).toBe("Iced Latte");
    expect(coffeeItems[0].priceMinor).toBe(6500);
  });

  test("stores and updates draft orders", async () => {
    await db.draftOrders.put({
      id: "draft-1",
      storeId: "store-1",
      orderType: "POS",
      tableName: "T-01",
      customerName: "Khun Somchai",
      items: [
        {
          productId: "prod-1",
          productName: "Iced Latte",
          quantity: 2,
          unitPriceMinor: 6500,
          subtotalMinor: 13000
        }
      ],
      totalMinor: 13000,
      updatedAt: new Date().toISOString()
    });

    const draft = await db.draftOrders.get("draft-1");
    expect(draft).toBeDefined();
    expect(draft?.customerName).toBe("Khun Somchai");
    expect(draft?.items).toHaveLength(1);
    expect(draft?.totalMinor).toBe(13000);
  });

  test("enqueues order to syncQueue with queueOfflineOrder", async () => {
    const input: CreateOrderInput = {
      storeId: "store-1",
      orderType: "POS",
      channel: "POS",
      fulfillmentType: "TAKEAWAY",
      currency: "THB",
      items: [
        {
          productId: "prod-1",
          quantity: 1,
          modifierIds: []
        }
      ]
    };

    const queuedId = await queueOfflineOrder("store-1", input, "idem-offline-test-1", db);
    expect(queuedId).toBe("idem-offline-test-1");

    const queued = await db.syncQueue.get("idem-offline-test-1");
    expect(queued).toBeDefined();
    expect(queued?.syncStatus).toBe("PENDING");
    expect(queued?.retryCount).toBe(0);
    expect(queued?.orderInput.storeId).toBe("store-1");
  });

  test("processOfflineQueue syncs pending orders and handles errors", async () => {
    const order1: CreateOrderInput = {
      storeId: "store-1",
      orderType: "POS",
      channel: "POS",
      fulfillmentType: "TAKEAWAY",
      currency: "THB",
      items: [{ productId: "prod-1", quantity: 1, modifierIds: [] }]
    };

    const order2: CreateOrderInput = {
      storeId: "store-1",
      orderType: "POS",
      channel: "POS",
      fulfillmentType: "TAKEAWAY",
      currency: "THB",
      items: [{ productId: "prod-2", quantity: 1, modifierIds: [] }]
    };

    await queueOfflineOrder("store-1", order1, "order-ok-1", db);
    await queueOfflineOrder("store-1", order2, "order-fail-2", db);

    const mockSyncFn = async (input: CreateOrderInput, idempotencyKey: string): Promise<OrderSummary> => {
      if (idempotencyKey === "order-fail-2") {
        throw new Error("Network timeout while syncing to server");
      }
      return {
        id: "server-ord-123",
        orderNumber: "ORD-001",
        organizationId: "org-1",
        storeId: input.storeId,
        orderType: "POS",
        status: "COMPLETED",
        channel: "POS",
        fulfillmentType: "TAKEAWAY",
        currency: "THB",
        subtotalMinor: 6500,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 6500,
        paymentStatus: "PAID",
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    };

    const result = await processOfflineQueue(mockSyncFn, db);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);

    const synced = await db.syncQueue.get("order-ok-1");
    expect(synced?.syncStatus).toBe("SYNCED");
    expect(synced?.syncedAt).toBeDefined();

    const failed = await db.syncQueue.get("order-fail-2");
    expect(failed?.syncStatus).toBe("FAILED");
    expect(failed?.retryCount).toBe(1);
    expect(failed?.lastError).toContain("Network timeout");
  });
});
