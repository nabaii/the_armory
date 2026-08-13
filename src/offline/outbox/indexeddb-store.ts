import { LazyDatabase, promisify, transact } from "../db";
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
 *   · It is about 100 lines over the shared helpers in src/offline/db.ts. The
 *     wrapper libraries are chiefly a promise adapter over an event API, and
 *     that is the part that is easiest to get right and easiest to read.
 *   · §2 puts a one-second cold-start budget on the desk with no network. The
 *     shell is downloaded on Nigerian mobile data and this is on the critical
 *     path of every launch.
 *   · This is the last copy of records that may not exist anywhere else — a
 *     custody event written during a power cut lives here and nowhere. The
 *     upgrade and error handling of that store is worth reading in full
 *     rather than inheriting.
 *
 * The connection, the durability setting and the promise adapter live in
 * src/offline/db.ts, which is the only module allowed to call `indexedDB.open`.
 * That is what keeps §10's wipe list from falling behind the schema — see the
 * header there.
 */

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

export class IndexedDbOutboxStore implements OutboxStore {
  private readonly db = new LazyDatabase("armory-outbox", DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(ITEMS)) {
      /* Keyed by the record's own UUIDv7. Because v7 sorts by creation time, a
         plain key cursor walks the queue in delivery order with no secondary
         index to maintain. */
      db.createObjectStore(ITEMS, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(META)) {
      db.createObjectStore(META);
    }
  });

  private tx(
    storeName: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> {
    return this.db.store(storeName, mode);
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
    const db = await this.db.open();
    const transaction = transact(db, [ITEMS, META], "readwrite");
    await Promise.all([
      promisify(transaction.objectStore(ITEMS).clear()),
      promisify(transaction.objectStore(META).clear()),
    ]);
  }
}
