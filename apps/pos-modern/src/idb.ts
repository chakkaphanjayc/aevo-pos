import type { Cart } from '@aevo/ordering';

const databaseName = 'aevo-pos-modern';
const storeName = 'drafts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
}

export async function loadDraft(storeId: string): Promise<Cart | null> {
  try {
    const database = await openDatabase();
    return await new Promise<Cart | null>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(storeId);
      request.onsuccess = () => resolve((request.result as Cart | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Draft could not be loaded'));
    });
  } catch {
    return null;
  }
}

export async function saveDraft(storeId: string, cart: Cart): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(storeName, 'readwrite').objectStore(storeName).put(cart, storeId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Draft could not be saved'));
    });
  } catch {
    // A browser cache is an enhancement; the server remains authoritative.
  }
}
