import { describe, expect, test, beforeEach } from "bun:test";
import type { CatalogSnapshot, CreateOrderInput } from "@aevo/contracts";
import { cacheCatalog, getCachedCatalog, clearCatalogCache } from "../src/lib/idb-cache";
import {
  saveOutboxEntry,
  getAllOutboxEntries,
  getPendingOutboxEntries,
  removeOutboxEntry,
  clearSyncedOutboxEntries,
  queueOfflineCashOrder,
  type OutboxEntry
} from "../src/lib/outbox";

// In-memory IndexedDB mock for unit tests in Bun
class MockIDBDatabase {
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name)
  };
  private stores = new Map<string, Map<string, unknown>>();

  createObjectStore(name: string) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return {
      createIndex: () => {}
    };
  }

  transaction(storeName: string, _mode: string) {
    if (!this.stores.has(storeName)) {
      this.stores.set(storeName, new Map());
    }
    const map = this.stores.get(storeName)!;

    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null as ((err: unknown) => void) | null,
      objectStore: () => ({
        put: (value: unknown, key?: string) => {
          const actualKey = key ?? (value as { id?: string })?.id ?? "default";
          map.set(actualKey, JSON.parse(JSON.stringify(value)));
          const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
        get: (key: string) => {
          const val = map.get(key);
          const req = {
            result: val ? JSON.parse(JSON.stringify(val)) : undefined,
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null
          };
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
        getAll: () => {
          const vals = Array.from(map.values()).map((v) => JSON.parse(JSON.stringify(v)));
          const req = {
            result: vals,
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null
          };
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
        delete: (key: string) => {
          map.delete(key);
          const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
          queueMicrotask(() => {
            req.onsuccess?.();
            tx.oncomplete?.();
          });
          return req;
        }
      })
    };
    return tx;
  }
}

let mockDb: MockIDBDatabase;

beforeEach(() => {
  mockDb = new MockIDBDatabase();
  // Initialize default stores
  mockDb.createObjectStore("catalog");
  mockDb.createObjectStore("outbox");

  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req = {
        result: mockDb,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as ((ev: { target: { result: unknown } }) => void) | null
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: { result: mockDb } });
        req.onsuccess?.();
      });
      return req;
    }
  };
});

describe("idb-cache", () => {
  test("caches and retrieves catalog snapshot", async () => {
    const snapshot: CatalogSnapshot = {
      categories: [],
      products: [],
      modifierGroups: [],
      menus: [],
      productModifierGroups: []
    };

    await cacheCatalog("store-1", snapshot);
    const cached = await getCachedCatalog("store-1");
    expect(cached).not.toBeNull();
    expect(cached?.products).toEqual([]);

    await clearCatalogCache("store-1");
    const empty = await getCachedCatalog("store-1");
    expect(empty).toBeNull();
  });
});

describe("outbox", () => {
  test("saves and queries outbox entries", async () => {
    const entry: OutboxEntry = {
      id: "out-1",
      type: "CREATE_ORDER",
      storeId: "store-1",
      payload: { foo: "bar" },
      createdAt: Date.now(),
      status: "PENDING",
      retryCount: 0
    };

    await saveOutboxEntry(entry);
    const pending = await getPendingOutboxEntries();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe("out-1");

    await removeOutboxEntry("out-1");
    const afterRemove = await getAllOutboxEntries();
    expect(afterRemove.length).toBe(0);
  });

  test("enqueues 3-step offline cash order with temporary ID", async () => {
    const orderInput: CreateOrderInput = {
      storeId: "store-1",
      channel: "POS",
      fulfillmentType: "TAKEAWAY",
      items: [
        {
          productId: "prod-1",
          quantity: 1
        }
      ]
    };

    const res = await queueOfflineCashOrder("store-1", orderInput, 15000);
    expect(res.temporaryOrderId).toStartWith("offline-");
    expect(res.temporaryOrderNumber).toStartWith("OFFLINE-");
    expect(res.outboxIds.length).toBe(3);

    const pending = await getPendingOutboxEntries();
    expect(pending.length).toBe(3);
    expect(pending[0].type).toBe("CREATE_ORDER");
    expect(pending[1].type).toBe("PAYMENT");
    expect(pending[2].type).toBe("TRANSITION");
  });

  test("clears only synced entries", async () => {
    await saveOutboxEntry({
      id: "e-synced",
      type: "CREATE_ORDER",
      storeId: "store-1",
      payload: {},
      createdAt: 1,
      status: "SYNCED",
      retryCount: 0
    });
    await saveOutboxEntry({
      id: "e-pending",
      type: "CREATE_ORDER",
      storeId: "store-1",
      payload: {},
      createdAt: 2,
      status: "PENDING",
      retryCount: 0
    });

    await clearSyncedOutboxEntries();
    const remaining = await getAllOutboxEntries();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe("e-pending");
  });
});
