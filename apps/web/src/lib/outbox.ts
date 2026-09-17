import type { CreateOrderInput, OrderSummary } from "@aevo/contracts";
import { apiWithIdempotency, ApiError } from "./api";
import { openIndexedDb, OUTBOX_STORE } from "./idb-cache";

export type OutboxEntryType = "CREATE_ORDER" | "PAYMENT" | "TRANSITION";
export type OutboxStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";

export interface OutboxEntry {
  id: string; // client UUID & Idempotency-Key
  type: OutboxEntryType;
  storeId: string;
  orderId?: string; // target order UUID (server UUID or temporary client UUID)
  payload: Record<string, unknown>;
  createdAt: number;
  syncedAt?: number;
  status: OutboxStatus;
  retryCount: number;
  errorMessage?: string;
}

const changeListeners = new Set<() => void>();

export function subscribeOutboxChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notifyChange(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  }
}

export async function saveOutboxEntry(entry: OutboxEntry): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.put(entry);
    req.onsuccess = () => {
      notifyChange();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as OutboxEntry[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingOutboxEntries(): Promise<OutboxEntry[]> {
  const all = await getAllOutboxEntries();
  return all
    .filter((e) => e.status === "PENDING" || e.status === "SYNCING")
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateOutboxEntry(entry: OutboxEntry): Promise<void> {
  await saveOutboxEntry(entry);
}

export async function removeOutboxEntry(id: string): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.delete(id);
    req.onsuccess = () => {
      notifyChange();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSyncedOutboxEntries(): Promise<void> {
  const all = await getAllOutboxEntries();
  const synced = all.filter((e) => e.status === "SYNCED");
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    for (const entry of synced) {
      store.delete(entry.id);
    }
    tx.oncomplete = () => {
      notifyChange();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Enqueue a 3-step offline cash checkout:
 * 1. CREATE_ORDER
 * 2. PAYMENT (CASH)
 * 3. TRANSITION (CONFIRMED)
 */
export async function queueOfflineCashOrder(
  storeId: string,
  orderInput: CreateOrderInput,
  cashReceivedMinor: number
): Promise<{ temporaryOrderId: string; temporaryOrderNumber: string; outboxIds: string[] }> {
  const now = Date.now();
  const temporaryOrderId = `offline-${crypto.randomUUID()}`;
  const temporaryOrderNumber = `OFFLINE-${now.toString().slice(-6)}`;

  const orderEntryId = crypto.randomUUID();
  const paymentEntryId = crypto.randomUUID();
  const transitionEntryId = crypto.randomUUID();

  const createEntry: OutboxEntry = {
    id: orderEntryId,
    type: "CREATE_ORDER",
    storeId,
    orderId: temporaryOrderId,
    payload: {
      ...orderInput,
      temporaryOrderId,
      temporaryOrderNumber
    } as unknown as Record<string, unknown>,
    createdAt: now,
    status: "PENDING",
    retryCount: 0
  };

  const paymentEntry: OutboxEntry = {
    id: paymentEntryId,
    type: "PAYMENT",
    storeId,
    orderId: temporaryOrderId,
    payload: {
      storeId,
      method: "CASH",
      amountMinor: cashReceivedMinor,
      temporaryOrderId
    },
    createdAt: now + 1,
    status: "PENDING",
    retryCount: 0
  };

  const transitionEntry: OutboxEntry = {
    id: transitionEntryId,
    type: "TRANSITION",
    storeId,
    orderId: temporaryOrderId,
    payload: {
      storeId,
      toStatus: "CONFIRMED",
      expectedStatus: "PAID",
      temporaryOrderId
    },
    createdAt: now + 2,
    status: "PENDING",
    retryCount: 0
  };

  await saveOutboxEntry(createEntry);
  await saveOutboxEntry(paymentEntry);
  await saveOutboxEntry(transitionEntry);

  return {
    temporaryOrderId,
    temporaryOrderNumber,
    outboxIds: [orderEntryId, paymentEntryId, transitionEntryId]
  };
}

let isSyncing = false;
// Maps temporary client order IDs to server-assigned real order IDs and summaries
const resolvedOrders = new Map<string, OrderSummary>();

/**
 * Synchronize all pending outbox entries with the server in chronological order.
 */
export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  if (isSyncing) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  isSyncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const pending = await getPendingOutboxEntries();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    for (const entry of pending) {
      entry.status = "SYNCING";
      await updateOutboxEntry(entry);

      try {
        if (entry.type === "CREATE_ORDER") {
          const res = await apiWithIdempotency<{ order: OrderSummary }>(
            "/api/orders",
            "POST",
            entry.payload,
            entry.id
          );
          if (entry.orderId) {
            resolvedOrders.set(entry.orderId, res.order);
          }
          entry.status = "SYNCED";
          entry.syncedAt = Date.now();
          await updateOutboxEntry(entry);
          synced++;
        } else if (entry.type === "PAYMENT") {
          const rawId =
            (entry.orderId && resolvedOrders.get(entry.orderId)?.id) ||
            (typeof entry.payload.temporaryOrderId === "string" &&
              resolvedOrders.get(entry.payload.temporaryOrderId)?.id) ||
            entry.orderId;
          const targetOrderId = typeof rawId === "string" ? rawId : undefined;

          if (!targetOrderId || targetOrderId.startsWith("offline-")) {
            throw new Error("Order creation has not completed yet");
          }

          const { temporaryOrderId: _, ...body } = entry.payload;
          await apiWithIdempotency<{ order: OrderSummary }>(
            `/api/orders/${targetOrderId}/payments`,
            "POST",
            body,
            entry.id
          );
          entry.status = "SYNCED";
          entry.syncedAt = Date.now();
          await updateOutboxEntry(entry);
          synced++;
        } else if (entry.type === "TRANSITION") {
          const rawId =
            (entry.orderId && resolvedOrders.get(entry.orderId)?.id) ||
            (typeof entry.payload.temporaryOrderId === "string" &&
              resolvedOrders.get(entry.payload.temporaryOrderId)?.id) ||
            entry.orderId;
          const targetOrderId = typeof rawId === "string" ? rawId : undefined;

          if (!targetOrderId || targetOrderId.startsWith("offline-")) {
            throw new Error("Order creation has not completed yet");
          }

          const { temporaryOrderId: _, ...body } = entry.payload;
          await apiWithIdempotency<{ order: OrderSummary }>(
            `/api/orders/${targetOrderId}/transition`,
            "POST",
            body,
            entry.id
          );
          entry.status = "SYNCED";
          entry.syncedAt = Date.now();
          await updateOutboxEntry(entry);
          synced++;
        }
      } catch (error) {
        entry.retryCount++;
        if (error instanceof ApiError && error.status === 0) {
          // Network error: pause syncing, revert to PENDING
          entry.status = "PENDING";
          await updateOutboxEntry(entry);
          break; // Stop further requests while offline
        } else if (error instanceof ApiError && error.status === 409) {
          // 409 Conflict: idempotency key already completed on server
          entry.status = "SYNCED";
          entry.syncedAt = Date.now();
          await updateOutboxEntry(entry);
          synced++;
        } else {
          entry.status = "FAILED";
          entry.errorMessage = error instanceof Error ? error.message : String(error);
          await updateOutboxEntry(entry);
          failed++;
        }
      }
    }
  } finally {
    isSyncing = false;
  }

  return { synced, failed };
}
