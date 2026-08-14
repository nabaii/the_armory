import { LazyDatabase, promisify } from "./db";
import type { LocalAmmunitionIssue, LocalIssue } from "./close";
import type { LocalParticipation } from "./checkin";
import type { LocalWaiverSignature } from "./waiver";
import type { LocalRound } from "./relay";
import type { LocalIncident } from "./incident";

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

/**
 * Version 4 — rounds and incidents, so §8.5's step 12 and §6.5's incident
 * survive the cut. Version 3 added waiver signatures, so step 9 did.
 * Version 2 added the two stores the equipment workflow needs and dropped the
 * placeholder shift. See the notes below each.
 */
const DB_VERSION = 4;
const PARTICIPATIONS = "participations";
const FIREARM_ISSUES = "firearmIssues";
const AMMUNITION_ISSUES = "ammunitionIssues";
const WAIVER_SIGNATURES = "waiverSignatures";
const ROUNDS = "rounds";
const INCIDENTS = "incidents";
/** Version 1 only. Deleted on upgrade — see "the officer is not kept here". */
const SHIFT = "shift";

/* ============================================================================
   THE OFFICER IS NOT KEPT HERE.

   This store held a `Shift` through M1 — a staff id, a name and a start time,
   with nothing to verify any of it against, because M1 had no officer sign-in.
   It was a placeholder and it was always read as `shift?.staffId ?? null`.

   M5 replaced it with the real thing: src/offline/officer.ts holds the shift and
   the verifier that authenticates it, and src/offline/officer-store.ts persists
   it inside `armory-device`.

   The placeholder was REMOVED rather than left in place, because two stores
   answering "who is working the desk" is exactly the divergence this codebase
   keeps warning about — and the copy that drifts is always the one that names
   somebody who is not there. A custody event is not a record worth having if it
   might name the wrong person.

   `armory-device` rather than here is also the right home for a reason beyond
   tidiness: §10's revocation wipes a named list of databases, and a verifier for
   an officer's PIN must be inside one of them.
   ========================================================================= */

export class SessionStore {
  private readonly db = new LazyDatabase("armory-session", DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(PARTICIPATIONS)) {
      /* In-line key: the participation's own id. See the header. */
      db.createObjectStore(PARTICIPATIONS, { keyPath: "id" });
    }
    /**
     * §6.4's equipment issue, kept locally because it must work offline.
     *
     * Both are keyed by the record's own UUIDv7 — the same key the server row
     * will have (§7) — so re-recording an issue overwrites rather than
     * duplicates, exactly as participations do.
     *
     * They are here rather than derived from the outbox because the two answer
     * different questions. The outbox knows what has not been SENT; these know
     * what HAPPENED. A firearm issued and successfully synced has left the
     * outbox and is still in somebody's hands, and the session close guard
     * (§6.4) has to know that.
     */
    if (!db.objectStoreNames.contains(FIREARM_ISSUES)) {
      db.createObjectStore(FIREARM_ISSUES, { keyPath: "custodyEventId" });
    }
    if (!db.objectStoreNames.contains(AMMUNITION_ISSUES)) {
      db.createObjectStore(AMMUNITION_ISSUES, { keyPath: "issueId" });
    }

    /**
     * §6.4's waiver, signed at the desk with no network.
     *
     * Two things live in one record here. The signature itself is what makes a
     * waiver block clear without a reload (§12.1's shape, applied to §3.1's
     * rule) and what makes step 9 of §8.5's protocol still be there after the
     * power comes back. The captured mark rides in the same row because it is
     * the only copy in existence until there is somewhere to upload it, and a
     * second store would be a second thing to remember to keep.
     *
     * Keyed by the signature's own UUIDv7 — the key the server row will have
     * (§7) and the key the stored image is named for. See src/offline/waiver.ts.
     */
    if (!db.objectStoreNames.contains(WAIVER_SIGNATURES)) {
      db.createObjectStore(WAIVER_SIGNATURES, { keyPath: "id" });
    }

    /**
     * §6.5's scores and incidents — M7.
     *
     * Both here for the reason every other store here is: the outbox knows what
     * has not been SENT, and this knows what HAPPENED. A score that synced
     * successfully has left the queue and is still the reason the relay shows a
     * shooter with two cards; an incident that synced is still the thing the
     * officer wants to re-read before they go home.
     *
     * §8.5 step 12 is the harder requirement. "Record two scores, then pull the
     * power mid-session… every record must be present." A score held only in
     * the outbox would still be present, but the lane would have forgotten it,
     * and an officer who cannot see the card they just entered will enter it
     * again. Two rows on a leagues table, from one card.
     */
    if (!db.objectStoreNames.contains(ROUNDS)) {
      db.createObjectStore(ROUNDS, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(INCIDENTS)) {
      db.createObjectStore(INCIDENTS, { keyPath: "id" });
    }

    /* Dropped. It held the M1 placeholder shift and nothing writes to it now;
       this version bump is the one that had another reason to exist. */
    if (db.objectStoreNames.contains(SHIFT)) {
      db.deleteObjectStore(SHIFT);
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
  /* --------------------------------------------------------------- FIREARMS */

  async recordFirearmIssue(issue: LocalIssue): Promise<void> {
    const store = await this.db.store(FIREARM_ISSUES, "readwrite");
    await promisify(store.put(issue));
  }

  async firearmIssues(): Promise<LocalIssue[]> {
    const store = await this.db.store(FIREARM_ISSUES, "readonly");
    return promisify<LocalIssue[]>(store.getAll());
  }

  /**
   * Mark a firearm as back on the rack.
   *
   * The RETURN is itself a custody event on the queue (§3.4 — the log is the
   * sole source of truth for where a firearm is). This only updates the desk's
   * local view so the close guard stops listing it, and so an officer does not
   * see a firearm reported as out while they are holding it.
   */
  async markFirearmReturned(custodyEventId: string, at: Date): Promise<void> {
    const store = await this.db.store(FIREARM_ISSUES, "readwrite");
    const existing = await promisify<LocalIssue | undefined>(
      store.get(custodyEventId),
    );
    if (!existing) return;

    const write = await this.db.store(FIREARM_ISSUES, "readwrite");
    await promisify(
      write.put({ ...existing, returnedAt: at.toISOString() }),
    );
  }

  /* ------------------------------------------------------------ AMMUNITION */

  async recordAmmunitionIssue(issue: LocalAmmunitionIssue): Promise<void> {
    const store = await this.db.store(AMMUNITION_ISSUES, "readwrite");
    await promisify(store.put(issue));
  }

  async ammunitionIssues(): Promise<LocalAmmunitionIssue[]> {
    const store = await this.db.store(AMMUNITION_ISSUES, "readonly");
    return promisify<LocalAmmunitionIssue[]>(store.getAll());
  }

  /**
   * §3.4: "qty_issued must equal qty_fired plus qty_returned at reconciliation."
   *
   * The arithmetic is not checked here — `closeStateFor` in src/offline/close.ts
   * does it, and the database enforces it in drizzle/0002. Storing an
   * unbalanced reconciliation locally is correct: the officer is mid-count, and
   * a store that refused would make them do the arithmetic in their head before
   * they were allowed to write anything down.
   */
  async reconcileAmmunition(
    issueId: string,
    counts: { qtyFired: number; qtyReturned: number },
  ): Promise<void> {
    const store = await this.db.store(AMMUNITION_ISSUES, "readonly");
    const existing = await promisify<LocalAmmunitionIssue | undefined>(
      store.get(issueId),
    );
    if (!existing) return;

    const write = await this.db.store(AMMUNITION_ISSUES, "readwrite");
    await promisify(write.put({ ...existing, ...counts }));
  }

  /* --------------------------------------------------------------- WAIVERS */

  async recordWaiverSignature(signature: LocalWaiverSignature): Promise<void> {
    const store = await this.db.store(WAIVER_SIGNATURES, "readwrite");
    await promisify(store.put(signature));
  }

  /**
   * Every signature this device has taken.
   *
   * Read at boot alongside participations, for the same reason and at the same
   * cost: the waiver block on a Today row must clear from local state, and it
   * must still be cleared after the tablet has been rebooted.
   *
   * Nothing prunes these. `pruneClosed` below drops participations from days
   * already closed out, and applying the same treatment here would delete the
   * only copy of a signature image the server has never received — which is the
   * silent loss the rule under `pruneClosed` already refuses to commit: nothing a
   * human has not resolved is removed by a background process. They are a few
   * kilobytes each and a handful a day; the uploader that eventually sends them
   * is the thing entitled to clear them.
   */
  async waiverSignatures(): Promise<LocalWaiverSignature[]> {
    const store = await this.db.store(WAIVER_SIGNATURES, "readonly");
    return promisify<LocalWaiverSignature[]>(store.getAll());
  }

  /* ------------------------------------------------------- SCORES — §6.5 */

  async recordRound(round: LocalRound): Promise<void> {
    const store = await this.db.store(ROUNDS, "readwrite");
    await promisify(store.put(round));
  }

  /**
   * Every card this device has taken.
   *
   * Not pruned, for the same reason waiver signatures are not: until the queue
   * has drained, this is a copy of a record that exists nowhere else, and §8.4's
   * rule holds — nothing a human has not resolved is removed by a background
   * process. A card is a few dozen bytes.
   */
  async rounds(): Promise<LocalRound[]> {
    const store = await this.db.store(ROUNDS, "readonly");
    return promisify<LocalRound[]>(store.getAll());
  }

  /* ---------------------------------------------------- INCIDENTS — §6.5 */

  async recordIncident(incident: LocalIncident): Promise<void> {
    const store = await this.db.store(INCIDENTS, "readwrite");
    await promisify(store.put(incident));
  }

  async incidents(): Promise<LocalIncident[]> {
    const store = await this.db.store(INCIDENTS, "readonly");
    return promisify<LocalIncident[]>(store.getAll());
  }

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



}
