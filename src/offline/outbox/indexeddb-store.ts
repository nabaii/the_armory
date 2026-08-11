import type { OutboxItem, OutboxStore } from "./outbox";

/**
 * INDEXEDDB OUTBOX STORE — the durable one.
 *
 * §2: "IndexedDB, via a wrapper of the team's choosing. Survives tab close,
 * app close, device restart and power loss."
 *
 * ===========================================================================
 * WHY NO LIBRARY
 *
 * The obvious move is idb or Dexie. This is deliberately neither, for reasons
 * specific to what this store holds:
 *
 *   · It is about 120 lines. The wrapper libraries are chiefly a promise
 *     adapter over an event API, and that is the part below that is easiest
 *     to get right and easiest to read.
 *   · §2 puts a one-second cold-start budget on the desk with no network. The
 *     shell is downloaded on Nigerian mobile data and this is on the critical
 *     path of every launch.
 *   · This is the last copy of records that may not exist anywhere else — a
 *     custody event written during a power cut lives here and nowhere. The
 *     upgrade and error handling of that store is worth reading in full
 *     rather than inheriting.
 *
 * ===========================================================================
 * DURABILITY IS NOT AUTOMATIC
 *
 * Two things below are easy to omit and both cost data:
 *
 *   · `durability: "strict"` on the write transaction. Chromium defaults
 *     IndexedDB writes to "relaxed", which lets the browser acknowledge a
 *     transaction before the OS has flushed it. On a mains-powered laptop that
 *     distinction is theoretical. In a building where §1.1 says "power and
 *     internet are unreliable", it is precisely the failure §8.5 tests for by
 *     pulling the plug mid-session.
 *
 *   · Persistent storage. Without it the browser may evict the whole origin's
 *     storage under pressure, taking the queue with it and asking nobody. The
 *     desk requests persistence on boot; see `requestPersistence()`.
 */

const DB_NAME = "armory-outbox";
const DB_VERSION = 1;
const ITEMS = "items";
const META = "meta";

/** Dates do not survive a structured clone into a keyed store as Dates in all
 *  engines' older versions, and a string is unambiguous — so they are stored
 *  as ISO and rehydrated on the way out, in one place. */
type StoredItem = Omit<OutboxItem, "createdAt" | "nextAttemptAt"> & {
  createdAt: string;
  nextAttemptAt: string | null;
};

const toStored = (item: OutboxItem): StoredItem => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  nextAttemptAt: item.nextAttemptAt ? item.nextAttemptAt.toISOString() : null,
});

const fromStored = (row: StoredItem): OutboxItem => ({
  ...row,
  createdAt: new Date(row.createdAt),
  nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt) : null,
});

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDbOutboxStore implements OutboxStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ITEMS)) {
          /* Keyed by the record's own UUIDv7. Because v7 sorts by creation
             time, a plain key cursor walks the queue in delivery order with
             no secondary index to maintain. */
          db.createObjectStore(ITEMS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        /* A second tab running a newer version needs this one to let go, or
           its upgrade blocks forever and that tab silently stops syncing. */
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("The outbox is open in another tab and cannot upgrade."));
    });

    return this.db;
  }

  private async tx(
    storeName: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> {
    const db = await this.open();
    /* See the durability note in the header. Older engines ignore the option
       rather than throwing, so no feature test is needed. */
    const transaction = db.transaction(
      storeName,
      mode,
      mode === "readwrite" ? { durability: "strict" } : undefined,
    );
    return transaction.objectStore(storeName);
  }

  async put(item: OutboxItem): Promise<void> {
    const store = await this.tx(ITEMS, "readwrite");
    await promisify(store.put(toStored(item)));
  }

  async get(id: string): Promise<OutboxItem | null> {
    const store = await this.tx(ITEMS, "readonly");
    const row = await promisify<StoredItem | undefined>(store.get(id));
    return row ? fromStored(row) : null;
  }

  async all(): Promise<OutboxItem[]> {
    const store = await this.tx(ITEMS, "readonly");
    const rows = await promisify<StoredItem[]>(store.getAll());
    return rows.map(fromStored);
  }

  async remove(id: string): Promise<void> {
    const store = await this.tx(ITEMS, "readwrite");
    await promisify(store.delete(id));
  }

  async getLastSyncAt(): Promise<Date | null> {
    const store = await this.tx(META, "readonly");
    const value = await promisify<string | undefined>(store.get("lastSyncAt"));
    return value ? new Date(value) : null;
  }

  async setLastSyncAt(at: Date): Promise<void> {
    const store = await this.tx(META, "readwrite");
    await promisify(store.put(at.toISOString(), "lastSyncAt"));
  }

  /**
   * §10, device revocation: "a lost or stolen tablet can be revoked
   * server-side, and its cached day pack rendered unusable on next launch."
   *
   * This is the outbox half of that wipe. It is destructive and unrecoverable
   * by design — that is the point of revocation — so it is a named method
   * rather than something a cleanup path could reach by accident.
   *
   * Anything still queued is lost with it. That is the correct trade for a
   * tablet that is no longer in the club's possession, and it is why the
   * server-side reconciliation in §8.3 exists.
   */
  async wipe(): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction([ITEMS, META], "readwrite", {
      durability: "strict",
    });
    await Promise.all([
      promisify(transaction.objectStore(ITEMS).clear()),
      promisify(transaction.objectStore(META).clear()),
    ]);
  }
}

/**
 * Ask the browser not to evict this origin's storage.
 *
 * Without this, IndexedDB is "best effort": under storage pressure the browser
 * may clear the whole origin, which on this device means the day pack and the
 * outbox. Chrome grants persistence to installed PWAs without a prompt, which
 * is one of the practical reasons §2 asks for an installable application
 * rather than a bookmark.
 *
 * Returns whether the storage is now persistent. The desk should show a
 * warning if it is not, because on that device the offline guarantee §8 makes
 * is not one the browser has agreed to.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
