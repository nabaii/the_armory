import { LazyDatabase, promisify } from "./db";
import type { LocalParticipation } from "./checkin";

/**
 * TODAY'S WORK ON DISK — §3.3, §8.4, §8.5.
 *
 * Participations written at the desk, and the officer who is on shift.
 *
 * ===========================================================================
 * WHY THIS IS NOT JUST THE OUTBOX
 *
 * A queued participation is already durable — it is in `armory-outbox` waiting to be
 * sent, and the outbox survives power loss. So a second copy here looks redundant,
 * and the reason it is not is what §8.5 tests:
 *
 *   "Restore power. Reopen. Every record must be present."
 *
 * The outbox is a QUEUE. Its items are removed once delivered and pruned once old,
 * and its state machine is about delivery — pending, inflight, done, quarantined. It
 * is the wrong thing to read to answer "who is on the premises right now", because
 * the answer must not change when a record is successfully sent.
 *
 * Reading presence from the queue would mean a guest's row silently re-blocking the
 * moment their host's check-in finished syncing, which is §12.1 failing in the most
 * confusing way available: it worked, then it stopped working, because something
 * went right.
 *
 * So: the outbox owns delivery, this owns what is true on the premises. Both are
 * written from one action and both survive the plug being pulled.
 *
 * ===========================================================================
 * KEYED BY THE RECORD'S OWN ID
 *
 * Same UUIDv7 the server row will have (§7), so re-recording the same check-in
 * overwrites rather than duplicates — the local store inherits the idempotency the
 * endpoint has, and a double-tap on the check-in button cannot put two people on one
 * lane.
 */

const DB_VERSION = 1;
const PARTICIPATIONS = "participations";
const SHIFT = "shift";

/** The officer working the desk. §10: "Every staff action attributable to a named person." */
export type Shift = {
  staffId: string;
  displayName: string;
  startedAt: string;
};

export class SessionStore {
  private readonly db = new LazyDatabase("armory-session", DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(PARTICIPATIONS)) {
      /* In-line key: the participation's own id. See the header. */
      db.createObjectStore(PARTICIPATIONS, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(SHIFT)) {
      db.createObjectStore(SHIFT);
    }
  });

  async recordParticipation(participation: LocalParticipation): Promise<void> {
    const store = await this.db.store(PARTICIPATIONS, "readwrite");
    await promisify(store.put(participation));
  }

  async participations(): Promise<LocalParticipation[]> {
    const store = await this.db.store(PARTICIPATIONS, "readonly");
    return promisify<LocalParticipation[]>(store.getAll());
  }

  /**
   * Discard participations from days already closed out.
   *
   * Only ones whose id is below the cutoff AND which have been checked out, so a
   * session left open overnight — which happens, and is what §6.4's end-of-day screen
   * exists to catch — is never quietly forgotten by a cleanup pass. §8.4's rule about
   * the queue applies here for the same reason: nothing a human has not resolved is
   * removed by a background process.
   */
  async pruneClosed(before: Date): Promise<number> {
    const all = await this.participations();
    let removed = 0;

    for (const participation of all) {
      if (participation.checkedOutAt === null) continue;
      if (new Date(participation.checkedInAt).getTime() >= before.getTime()) continue;

      const store = await this.db.store(PARTICIPATIONS, "readwrite");
      await promisify(store.delete(participation.id));
      removed += 1;
    }

    return removed;
  }

  async startShift(shift: Shift): Promise<void> {
    const store = await this.db.store(SHIFT, "readwrite");
    await promisify(store.put(shift, "current"));
  }

  async currentShift(): Promise<Shift | null> {
    const store = await this.db.store(SHIFT, "readonly");
    const shift = await promisify<Shift | undefined>(store.get("current"));
    return shift ?? null;
  }

  async endShift(): Promise<void> {
    const store = await this.db.store(SHIFT, "readwrite");
    await promisify(store.delete("current"));
  }
}
