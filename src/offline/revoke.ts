/**
 * REVOCATION — making a lost tablet useless.
 *
 * Build Specification §10: "A lost or stolen tablet can be revoked
 * server-side, and its cached day pack rendered unusable on next launch."
 *
 * ===========================================================================
 * WHAT IS ACTUALLY ON THE DEVICE
 *
 * Worth listing, because "the cached day pack" undersells it. §8.1 says the
 * pack holds today's and tomorrow's expected arrivals, all active memberships
 * and tiers, every guest invitation in the window, the full firearm register,
 * ammunition balances, the active waiver, and the staff and device records.
 *
 * For a club whose own brief describes its membership as "a list of wealthy
 * Abuja residents and where they will be, and when", that is the entire
 * sensitive dataset, sitting in a building, on a device that can be carried
 * out of it. §10 is not a tidy-up requirement.
 *
 * ===========================================================================
 * ONE FUNCTION, FOUR STORES
 *
 * The failure mode this file exists to prevent is a partial wipe: someone adds
 * a fifth local store in six months, revocation keeps returning success, and
 * nobody notices that the new store is never cleared. So every piece of local
 * state is erased here, in one place, and `LOCAL_DATABASES` is the list that
 * has to be added to.
 *
 * It does NOT stop at the first failure. A browser that refuses to delete one
 * database must not prevent the other three being cleared — a partial wipe is
 * much better than none, and the caller is told what survived.
 */

/** Every IndexedDB database this application creates. Add to this list. */
export const LOCAL_DATABASES = [
  /** src/offline/outbox/indexeddb-store.ts */
  "armory-outbox",
  /** The day pack (§8.1). */
  "armory-daypack",
  /** Device registration (§3.1). */
  "armory-device",
] as const;

/** Cache API namespaces owned by the console shell. */
const CONSOLE_CACHE_PREFIX = "armory-console-";

export type WipeReport = {
  /** True only if every step succeeded. */
  complete: boolean;
  cleared: string[];
  failed: { name: string; error: string }[];
};

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(name));
    /* An open connection in another tab blocks deletion indefinitely. Treat
       it as a failure rather than hanging: the caller reports it, and the
       console refuses to open regardless — a blocked wipe must not read as a
       completed one. */
    request.onblocked = () =>
      reject(new Error(`${name} is open in another tab and could not be deleted`));
  });
}

/**
 * Erase everything this device holds and unregister the console worker.
 *
 * Irreversible, and deliberately so. Anything still queued in the outbox is
 * lost with it — which is the correct trade for a device no longer in the
 * club's possession, and is why §8.3's server-side reconciliation exists.
 */
export async function wipeLocalState(): Promise<WipeReport> {
  const cleared: string[] = [];
  const failed: { name: string; error: string }[] = [];

  const record = async (name: string, work: Promise<unknown>) => {
    try {
      await work;
      cleared.push(name);
    } catch (error) {
      failed.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  for (const name of LOCAL_DATABASES) {
    await record(name, deleteDatabase(name));
  }

  /* The console shell. The member shell's caches are left alone: they hold
     nothing personal by design (see public/sw.js) and this device may still be
     somebody's phone. */
  if (typeof caches !== "undefined") {
    await record(
      "console caches",
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CONSOLE_CACHE_PREFIX))
            .map((k) => caches.delete(k)),
        ),
      ),
    );
  }

  /* Tell the worker to drop its own caches and unregister, so the console
     cannot be cold-started offline to see what it last held. */
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    await record(
      "console service worker",
      navigator.serviceWorker
        .getRegistration("/console/")
        .then(async (registration) => {
          if (!registration) return;
          registration.active?.postMessage({ type: "ARMORY_REVOKE" });
          await registration.unregister();
        }),
    );
  }

  /* Session and local storage are not used for anything sensitive, but a
     revocation that left a staff name and a device label behind would still be
     a revocation that did not finish. */
  await record(
    "web storage",
    (async () => {
      globalThis.localStorage?.clear();
      globalThis.sessionStorage?.clear();
    })(),
  );

  return { complete: failed.length === 0, cleared, failed };
}

/**
 * What to show after a wipe.
 *
 * Written for whoever is holding the tablet, who may be a range officer
 * looking at a device the founder revoked an hour ago after a scare — not
 * necessarily a thief. It states the fact without accusing anyone, and gives
 * the one route back.
 */
export const REVOKED_MESSAGE = {
  heading: "This device has been signed out of the club's system.",
  body:
    "Everything it held has been removed. A founder can register it again " +
    "from the owner dashboard if it should still be in use.",
} as const;
