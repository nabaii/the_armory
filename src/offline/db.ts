/* Type-only, deliberately. revoke.ts imports `closeLocalDatabases` from here, so
   a value import would make a runtime cycle between the two modules; the name
   list is only ever needed in type space. */
import type { LOCAL_DATABASES } from "./revoke";

/**
 * LOCAL DATABASES — the one place IndexedDB is opened.
 *
 * Build Specification §2: "IndexedDB, via a wrapper of the team's choosing.
 * Survives tab close, app close, device restart and power loss."
 *
 * ===========================================================================
 * WHY EVERY OPEN GOES THROUGH HERE
 *
 * src/offline/revoke.ts holds `LOCAL_DATABASES` and asks a human to remember
 * something:
 *
 *   "The failure mode this file exists to prevent is a partial wipe: someone
 *    adds a fifth local store in six months, revocation keeps returning
 *    success, and nobody notices that the new store is never cleared."
 *
 * A comment cannot prevent that. This module can: `openLocalDatabase` accepts a
 * `LocalDatabaseName`, and that type is derived from the wipe list itself. A
 * database that revocation does not know how to destroy is not a value this
 * function will accept, so §10's wipe cannot fall behind the schema without the
 * build failing first.
 *
 * The rule that keeps it true is narrow and testable: `indexedDB.open` appears
 * in this file and nowhere else in the application. See the tripwire in
 * db.test.ts.
 *
 * ===========================================================================
 * DURABILITY IS NOT AUTOMATIC
 *
 * Two things below are easy to omit and both cost data on the device §8.5
 * describes:
 *
 *   · `durability: "strict"` on write transactions. Chromium defaults IndexedDB
 *     writes to "relaxed", which lets the browser acknowledge a transaction
 *     before the OS has flushed it. On a mains-powered laptop that distinction
 *     is theoretical. In a building where §1.1 says "power and internet are
 *     unreliable" it is exactly the failure §8.5 tests for by pulling the plug.
 *
 *   · Persistent storage. Without it the browser may evict this origin under
 *     pressure, taking the day pack and the outbox with it and asking nobody.
 *     See `requestPersistence`.
 */

/** A database revocation knows how to destroy. See §10 and revoke.ts. */
export type LocalDatabaseName = (typeof LOCAL_DATABASES)[number];

/**
 * Open one of this application's databases.
 *
 * `upgrade` runs inside the version-change transaction and must create every
 * object store it needs, guarding each with `objectStoreNames.contains` so that
 * upgrading from any earlier version converges on the same schema.
 */
export function openLocalDatabase(
  name: LocalDatabaseName,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = () => upgrade(request.result);

    request.onsuccess = () => {
      const db = request.result;
      /* A second tab running a newer version needs this one to let go, or its
         upgrade blocks forever and that tab silently stops working. */
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error(`${name} is open in another tab and cannot upgrade.`));
  });
}

/** Promise adapter for the IndexedDB event API. */
export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * A transaction with the durability this system needs on writes.
 *
 * Reads are left at the engine default; there is nothing to flush.
 */
export function transact(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(
    stores,
    mode,
    /* Older engines ignore the option rather than throwing, so no feature test
       is needed. */
    mode === "readwrite" ? { durability: "strict" } : undefined,
  );
}

/**
 * Every connection this page has opened.
 *
 * Kept because `indexedDB.deleteDatabase` cannot complete while a connection is
 * open: it fires `blocked` and waits. §10's wipe therefore has to close the
 * stores before it can destroy them, and revoke.ts treats a blocked delete as a
 * failure — correctly, since a wipe that did not happen must never report that
 * it did. Without this registry the wipe would reliably fail on the one device
 * it exists for, because the desk is holding all three databases open.
 *
 * The `onversionchange` handler in `openLocalDatabase` is a backstop for the
 * same problem across tabs. This is the deterministic path for this one.
 */
const connections = new Set<LazyDatabase>();

/**
 * Close every open connection, so §10's wipe is not blocked by this page.
 *
 * The stores reopen on next use, which is what makes this safe to call from a
 * revocation path that may find nothing to revoke.
 */
export async function closeLocalDatabases(): Promise<void> {
  for (const database of connections) {
    await database.close();
  }
}

/**
 * A cached, lazily opened connection.
 *
 * Each store below holds one of these rather than opening per call: opening is
 * asynchronous and the desk's Today screen has a one-second cold-start budget
 * (§2, §6.4), which a fresh open on every read would spend on handshakes.
 */
export class LazyDatabase {
  private connection: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly name: LocalDatabaseName,
    private readonly version: number,
    private readonly upgrade: (db: IDBDatabase) => void,
  ) {
    connections.add(this);
  }

  open(): Promise<IDBDatabase> {
    if (!this.connection) {
      this.connection = openLocalDatabase(
        this.name,
        this.version,
        this.upgrade,
      ).catch((error: unknown) => {
        /* Do not cache a failed open. A tablet that failed once because another
           tab held an upgrade must be able to succeed on the next attempt
           rather than staying broken until it is restarted. */
        this.connection = null;
        throw error;
      });
    }
    return this.connection;
  }

  /**
   * Close the connection and drop the handle.
   *
   * The next call to `open` reconnects. A failed close is swallowed: this runs
   * on the revocation path, where the goal is to stop blocking the delete, and
   * a database that cannot be closed is a database `deleteDatabase` will report
   * on directly.
   */
  async close(): Promise<void> {
    const pending = this.connection;
    this.connection = null;
    if (!pending) return;
    try {
      (await pending).close();
    } catch {
      /* Nothing to close. */
    }
  }

  async store(
    name: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> {
    const db = await this.open();
    return transact(db, name, mode).objectStore(name);
  }
}

/**
 * Ask the browser not to evict this origin's storage.
 *
 * Without this, IndexedDB is "best effort": under storage pressure the browser
 * may clear the whole origin, which on a club tablet means the day pack and
 * every queued custody event. Chrome grants persistence to installed PWAs
 * without a prompt, which is one of the practical reasons §2 asks for an
 * installable application rather than a bookmark.
 *
 * Returns whether the storage is now persistent. The desk shows a warning when
 * it is not, because on that device the guarantee §8 makes is not one the
 * browser has agreed to.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
