import type { CatalogSnapshot } from "@aevo/contracts";

export const DB_NAME = "aevo-pos";
export const DB_VERSION = 1;
export const CATALOG_STORE = "catalog";
export const OUTBOX_STORE = "outbox";

export function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE);
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outboxStore = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        outboxStore.createIndex("status", "status", { unique: false });
        outboxStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheCatalog(storeId: string, snapshot: CatalogSnapshot): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_STORE);
    const req = store.put(snapshot, storeId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedCatalog(storeId: string): Promise<CatalogSnapshot | null> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, "readonly");
    const store = tx.objectStore(CATALOG_STORE);
    const req = store.get(storeId);
    req.onsuccess = () => resolve((req.result as CatalogSnapshot) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearCatalogCache(storeId: string): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_STORE);
    const req = store.delete(storeId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
