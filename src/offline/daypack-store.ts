import {
  assertNoRestrictedFields,
  hydrate,
  type DayPack,
  type IndexedDayPack,
} from "./daypack";
import { LazyDatabase, promisify } from "./db";

/**
 * THE DAY PACK ON DISK — §8.1, §8.5.
 *
 *   §8.1: "On connection, each desk and lane device pulls and caches … Refreshed
 *          continuously while online; sufficient to run a full day alone."
 *   §2:   "Survives tab close, app close, device restart and power loss."
 *
 * src/offline/daypack.ts is the pack's shape and the pure functions over it.
 * This is the only thing that puts one on a tablet or takes one off it.
 *
 * ===========================================================================
 * ONE KEY, ONE VALUE, ONE TRANSACTION
 *
 * The whole pack is stored as a single value under a single key. The obvious
 * alternative — an object store per collection, people in one, firearms in
 * another — is how you would design this if it were a database. It is the wrong
 * shape here, and §8.5 is the reason:
 *
 *   "check in a member and a guest … then pull the power mid-session."
 *
 * A pack written across eleven stores can be interrupted halfway. What survives
 * is a device holding today's arrivals against last week's firearm register:
 * internally inconsistent, individually plausible, and impossible to detect from
 * the data. A single put is atomic — the power cut leaves either the previous
 * pack or the new one, and both are coherent.
 *
 * The cost is that a refresh rewrites the whole pack rather than a delta. For a
 * hundred-member club (§2.1) that is a few hundred kilobytes, which is cheaper
 * than the class of bug it removes.
 *
 * ===========================================================================
 * §10 IS ENFORCED AT THIS DOOR
 *
 * `assertNoRestrictedFields` runs in `save`, before anything reaches disk.
 *
 * The types in daypack.ts already make a licence scan unrepresentable, but a
 * pack arrives as JSON over the network and TypeScript is not present at
 * runtime. This function is the single place a pack can become durable, so it is
 * the only place the check has to be. A pack carrying a restricted field is
 * rejected and the previous pack is left intact — a desk working from yesterday
 * is a bad morning; a stolen tablet full of licence scans is a different order
 * of problem.
 */

const DB_VERSION = 1;
const PACK = "pack";

/** The single key. There is one pack on a device, never a history of them. */
const CURRENT = "current";

export class DayPackStore {
  private readonly db = new LazyDatabase("armory-daypack", DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(PACK)) {
      /* No keyPath: the pack is stored under an out-of-line constant key, so
         nothing in the pack's own shape can become its identity. */
      db.createObjectStore(PACK);
    }
  });

  /**
   * Replace the pack on this device.
   *
   * Throws if the pack carries a field §10 forbids on this surface, without
   * writing anything.
   */
  async save(pack: DayPack): Promise<void> {
    assertNoRestrictedFields(pack);

    const store = await this.db.store(PACK, "readwrite");
    await promisify(store.put(pack, CURRENT));
  }

  /** The stored pack, or null on a device that has never pulled one. */
  async load(): Promise<DayPack | null> {
    const store = await this.db.store(PACK, "readonly");
    const pack = await promisify<DayPack | undefined>(store.get(CURRENT));
    return pack ?? null;
  }

  /**
   * The stored pack, indexed for the Today screen.
   *
   * §6.4 gives that screen one second from cold with no network, and indexing is
   * what keeps the per-arrival capability evaluation out of a nested `.find()`.
   * See the indexing note in daypack.ts.
   */
  async loadIndexed(): Promise<IndexedDayPack | null> {
    const pack = await this.load();
    return pack ? hydrate(pack) : null;
  }

  /**
   * Forget the pack but keep the database.
   *
   * Distinct from revocation, which destroys the database entirely (§10). This
   * is for a device that is still trusted and whose data is merely too old to
   * work from — see `isDayPackUsable`.
   */
  async clear(): Promise<void> {
    const store = await this.db.store(PACK, "readwrite");
    await promisify(store.delete(CURRENT));
  }
}
