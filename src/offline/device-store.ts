import type { DeviceSurface } from "@/domain/enums";
import { LazyDatabase, promisify } from "./db";
import type { DeviceClock, DeviceRegistration } from "./device";

/**
 * DEVICE REGISTRATION AND THE DEVICE CLOCK ON DISK — §3.1, §10.
 *
 * Two records, both tiny, both load-bearing at launch:
 *
 *   · The registration. §3.1: "Desk and lane surfaces load only on a registered,
 *     unrevoked device." With no network this local copy is the only evidence
 *     that is true, which is why §10's bounded grace period exists.
 *
 *   · The clock high-water mark. See the header of src/offline/device.ts: the
 *     grace period is measured in elapsed time, and the only clock available
 *     offline is a setting on a tablet that may be in the wrong hands. The mark
 *     is what stops that setting being used to extend the bound.
 *
 * Kept in a separate database from the day pack rather than a second store
 * inside it, for one reason: they have different lifetimes. A pack is discarded
 * and replaced daily; a registration survives until the founder revokes it. A
 * bug in pack handling that clears the wrong store must not be able to
 * de-register the desk in the middle of a shift.
 */

const DB_VERSION = 1;
const RECORDS = "records";

const REGISTRATION = "registration";
const CLOCK_HIGH_WATER = "clockHighWater";
const TOKEN = "token";

/** Dates are stored as ISO strings for the reason given in the outbox store. */
type StoredRegistration = {
  deviceId: string;
  label: string;
  surface: DeviceSurface;
  registeredAt: string;
  lastVerifiedAt: string;
};

export class DeviceStore {
  private readonly db = new LazyDatabase("armory-device", DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(RECORDS)) {
      db.createObjectStore(RECORDS);
    }
  });

  async saveRegistration(registration: DeviceRegistration): Promise<void> {
    const stored: StoredRegistration = {
      deviceId: registration.deviceId,
      label: registration.label,
      surface: registration.surface,
      registeredAt: registration.registeredAt.toISOString(),
      lastVerifiedAt: registration.lastVerifiedAt.toISOString(),
    };

    const store = await this.db.store(RECORDS, "readwrite");
    await promisify(store.put(stored, REGISTRATION));
  }

  async loadRegistration(): Promise<DeviceRegistration | null> {
    const store = await this.db.store(RECORDS, "readonly");
    const row = await promisify<StoredRegistration | undefined>(
      store.get(REGISTRATION),
    );
    if (!row) return null;

    return {
      deviceId: row.deviceId,
      label: row.label,
      surface: row.surface,
      registeredAt: new Date(row.registeredAt),
      lastVerifiedAt: new Date(row.lastVerifiedAt),
    };
  }

  /**
   * The device's bearer token. See drizzle/0003_device_tokens.sql.
   *
   * The plaintext lives in exactly two places: on screen once when the founder
   * registers the tablet, and here. The server holds only a hash.
   *
   * In IndexedDB rather than `localStorage` for one reason that matters: §10's wipe
   * is a list of databases, and a credential kept outside that list is a credential
   * revocation does not destroy. `wipeLocalState` clears web storage too, but only
   * as belt and braces — the thing that guarantees the token is gone is that it is
   * inside `armory-device`.
   */
  async saveToken(token: string): Promise<void> {
    const store = await this.db.store(RECORDS, "readwrite");
    await promisify(store.put(token, TOKEN));
  }

  async loadToken(): Promise<string | null> {
    const store = await this.db.store(RECORDS, "readonly");
    const token = await promisify<string | undefined>(store.get(TOKEN));
    return token ?? null;
  }

  /**
   * Record that the server confirmed this device, just now.
   *
   * §10's grace period counts from `lastVerifiedAt`, so this is what keeps a
   * device that syncs daily from ever approaching the bound. Called on every
   * successful sync, not only on registration.
   */
  async markVerified(at: Date): Promise<void> {
    const existing = await this.loadRegistration();
    if (!existing) return;
    await this.saveRegistration({ ...existing, lastVerifiedAt: at });
  }

  /**
   * Advance the high-water mark and return the clock to decide trust against.
   *
   * Called once per launch, before `evaluateDeviceTrust`. The mark only ever
   * moves forward: a device whose date has been wound back reads its own
   * previous, later mark and is measured against that instead.
   *
   * Returns the value now on disk, which is what the trust decision must see —
   * returning the pre-stamp value would be equivalent today (`effectiveNow`
   * takes the later of the two) and would silently stop being equivalent if that
   * function ever changed.
   */
  async stampClock(now: Date): Promise<DeviceClock> {
    const store = await this.db.store(RECORDS, "readwrite");
    const previous = await promisify<string | undefined>(
      store.get(CLOCK_HIGH_WATER),
    );

    const previousAt = previous ? new Date(previous) : null;
    const highWaterAt =
      previousAt && previousAt.getTime() > now.getTime() ? previousAt : now;

    /* Written on every launch, including when it does not move, so that a
       device which is opened daily keeps a mark that tracks real time. The write
       is one small record on a `durability: "strict"` transaction — cheap enough
       to sit inside §2's one-second budget, and the guarantee is worthless if it
       is only recorded sometimes. */
    await promisify(store.put(highWaterAt.toISOString(), CLOCK_HIGH_WATER));

    return { now, highWaterAt };
  }

  /** The mark without advancing it. For diagnostics and tests. */
  async readClockHighWater(): Promise<Date | null> {
    const store = await this.db.store(RECORDS, "readonly");
    const value = await promisify<string | undefined>(
      store.get(CLOCK_HIGH_WATER),
    );
    return value ? new Date(value) : null;
  }
}
