import { LazyDatabase, promisify } from "./db";
import type { OfficerShift } from "./officer";

/**
 * THE OFFICER'S SHIFT ON DISK — §10.
 *
 * One record, and it is the most sensitive thing this application stores
 * locally: a verifier for a six-digit PIN belonging to a named member of staff.
 *
 * ===========================================================================
 * WHY IT LIVES IN `armory-device` AND NOT IN A DATABASE OF ITS OWN
 *
 * Because §10's revocation must destroy it.
 *
 * `wipeLocalState` in src/offline/revoke.ts deletes a named list of databases —
 * `armory-daypack`, `armory-device`, `armory-outbox` — and
 * docs/M1_offline_acceptance.md step 29 checks that list on hardware. A fourth
 * database would need adding to both, and the failure mode of forgetting is
 * silent: a revoked tablet that has been wiped, looks wiped, and still holds a
 * verifier for an officer's PIN.
 *
 * Putting it inside a database revocation ALREADY destroys means the guarantee
 * holds by construction rather than by remembering.
 *
 * The device store's own header argues the opposite way for the day pack —
 * separate lifetimes, so separate databases. The distinction is real: a pack is
 * replaced daily and a registration is not. A shift shares the registration's
 * lifetime exactly, because both are answers to "may this tablet be used, and by
 * whom", and both must vanish at the same instant.
 */

const DB_VERSION = 1;
const RECORDS = "records";
const SHIFT = "shift";

/** Dates as ISO strings, for the reason given in the outbox store. */
type StoredShift = {
  staffUserId: string;
  displayName: string;
  role: string;
  salt: string;
  verifier: string;
  unlockedAt: string;
  expiresAt: string;
  failedAttempts: number;
};

export class OfficerStore {
  private readonly db = new LazyDatabase("armory-device", DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(RECORDS)) {
      db.createObjectStore(RECORDS);
    }
  });

  async save(shift: OfficerShift): Promise<void> {
    const stored: StoredShift = {
      staffUserId: shift.staffUserId,
      displayName: shift.displayName,
      role: shift.role,
      salt: shift.salt,
      verifier: shift.verifier,
      unlockedAt: shift.unlockedAt.toISOString(),
      expiresAt: shift.expiresAt.toISOString(),
      failedAttempts: shift.failedAttempts,
    };

    const store = await this.db.store(RECORDS, "readwrite");
    await promisify(store.put(stored, SHIFT));
  }

  async load(): Promise<OfficerShift | null> {
    const store = await this.db.store(RECORDS, "readonly");
    const row = await promisify<StoredShift | undefined>(store.get(SHIFT));
    if (!row) return null;

    return {
      staffUserId: row.staffUserId,
      displayName: row.displayName,
      role: row.role,
      salt: row.salt,
      verifier: row.verifier,
      unlockedAt: new Date(row.unlockedAt),
      expiresAt: new Date(row.expiresAt),
      failedAttempts: row.failedAttempts,
    };
  }

  /**
   * End the shift and destroy the verifier.
   *
   * Called when the officer signs out, when the shift expires, and when the
   * local attempt limit is spent. In every one of those cases the verifier has
   * stopped being useful and has not stopped being sensitive.
   */
  async clear(): Promise<void> {
    const store = await this.db.store(RECORDS, "readwrite");
    await promisify(store.delete(SHIFT));
  }
}
