import Dexie, { type EntityTable } from "dexie";
import type { CreateOrderInput, OrderSummary } from "@aevo/contracts";

export interface OfflineCatalogProduct {
  id: string;
  storeId: string;
  name: string;
  sku?: string | null | undefined;
  category: string;
  priceMinor: number;
  available: boolean;
  updatedAt: string;
}

export interface OfflineDraftOrder {
  id: string; // client uuid
  storeId: string;
  orderType: string;
  tableName?: string | undefined;
  customerName?: string | undefined;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    subtotalMinor: number;
    notes?: string | undefined;
  }>;
  totalMinor: number;
  updatedAt: string;
}

export interface OfflineQueueOrder {
  id: string; // client idempotency key
  storeId: string;
  idempotencyKey: string;
  orderInput: CreateOrderInput;
  syncStatus: "PENDING" | "SYNCING" | "SYNCED" | "FAILED";
  retryCount: number;
  lastError?: string | undefined;
  createdAt: string;
  syncedAt?: string | undefined;
}

export class AevoPosOfflineDatabase extends Dexie {
  products!: EntityTable<OfflineCatalogProduct, "id">;
  draftOrders!: EntityTable<OfflineDraftOrder, "id">;
  syncQueue!: EntityTable<OfflineQueueOrder, "id">;

  constructor(dbName = "AevoPosOfflineDB", options?: { indexedDB?: any; IDBKeyRange?: any }) {
    super(dbName, options);
    this.version(1).stores({
      products: "id, storeId, category, name, available",
      draftOrders: "id, storeId, updatedAt",
      syncQueue: "id, storeId, syncStatus, createdAt"
    });
  }
}

export const offlineDb = new AevoPosOfflineDatabase();

/**
 * Enqueue an order created while offline or during intermittent connectivity.
 */
export async function queueOfflineOrder(
  storeId: string,
  orderInput: CreateOrderInput,
  idempotencyKey?: string,
  database: AevoPosOfflineDatabase = offlineDb
): Promise<string> {
  const key = idempotencyKey || `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await database.syncQueue.put({
    id: key,
    storeId,
    idempotencyKey: key,
    orderInput,
    syncStatus: "PENDING",
    retryCount: 0,
    createdAt: new Date().toISOString()
  });

  return key;
}

/**
 * Processes queued offline orders and syncs them to Aevo API.
 */
export async function processOfflineQueue(
  apiSyncFn: (order: CreateOrderInput, idempotencyKey: string) => Promise<OrderSummary>,
  database: AevoPosOfflineDatabase = offlineDb
): Promise<{ processed: number; failed: number }> {
  const pendingOrders = await database.syncQueue
    .where("syncStatus")
    .equals("PENDING")
    .toArray();

  let processed = 0;
  let failed = 0;

  for (const item of pendingOrders) {
    try {
      await database.syncQueue.update(item.id, { syncStatus: "SYNCING" });
      await apiSyncFn(item.orderInput, item.idempotencyKey);
      await database.syncQueue.update(item.id, {
        syncStatus: "SYNCED",
        syncedAt: new Date().toISOString()
      });
      processed++;
    } catch (err) {
      failed++;
      await database.syncQueue.update(item.id, {
        syncStatus: "FAILED",
        retryCount: item.retryCount + 1,
        lastError: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return { processed, failed };
}
