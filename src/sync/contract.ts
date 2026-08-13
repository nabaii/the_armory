import type { DayPack } from "@/offline/daypack";

/**
 * THE SYNC WIRE CONTRACT — §7, §8.
 *
 * Three endpoints, named in §7: `GET /sync/daypack`, `POST /sync/push`,
 * `GET /sync/pull`. This module is the only description of what crosses between
 * a tablet and the server, imported by both sides so the two cannot drift.
 *
 * ===========================================================================
 * WHY PUSH CARRIES ONE RECORD AND NOT A BATCH
 *
 * A batch endpoint is the obvious efficiency, and it is the wrong shape for this
 * queue. §8.4 requires the outbox to be ORDERED, and src/offline/outbox/outbox.ts
 * explains why that ordering is strict rather than best-effort: queued records
 * reference each other, so an ammunition issue delivered before the participation
 * it was issued against is a foreign key violation on a record that was perfectly
 * valid.
 *
 * A batch either preserves that ordering — in which case it is a sequence of
 * single writes in one envelope, and a partial failure has to be reported
 * per-item anyway — or it does not, and the ordering guarantee is gone. The
 * volumes make the trade easy: a full session is on the order of twenty rows, not
 * twenty thousand, and forty rounds of ammunition is one row with a quantity.
 *
 * ===========================================================================
 * WHY REJECTIONS ARE HTTP STATUS CODES AND NOT A FIELD
 *
 * src/offline/outbox/policy.ts turns four failure kinds into four different fates
 * for a queued record, and that distinction is the difference between a lost
 * afternoon and a stuck queue. The endpoint has to make the kind unambiguous:
 *
 *   200/201  applied, or already present — the replay case, §7
 *   400/409  `rejected` — the server understood and refused; surfaced, never retried
 *   401/403  `unauthorised` — held, queue pauses, nothing quarantined
 *   5xx      `server_error` — retried with backoff, then quarantined
 *   no reply `unreachable` — retried indefinitely
 *
 * Returning 200 with `{ ok: false }` would collapse all four into one, and the
 * queue would retry a malformed payload forever.
 */

/* ---------------------------------------------------------------------------
   PUSH — §7's idempotent, attributed write
   -------------------------------------------------------------------------- */

/**
 * The append-only writes a desk or lane device can originate offline.
 *
 * Exactly §8.2's append-only class, restricted to what §8.5's acceptance
 * workflow needs: "check in a member and a guest, sign a waiver, issue a
 * serialised firearm and forty rounds, record two scores."
 *
 * Two deliberate absences, both refused with a sentence rather than left to fail
 * as a database error:
 *
 *   · The SERVER-AUTHORITATIVE class — bookings, allowances, memberships. §8.2
 *     gives those a different strategy ("server holds truth. Local edits are
 *     re-applied on reconnection and may be rejected") which needs the
 *     reconciliation and override machinery of §8.3, and that arrives with M4. A
 *     write silently accepted into the wrong class is how the allowance race in
 *     §8.3 becomes a data loss instead of an exception.
 *
 *   · INCIDENTS. Append-only and genuinely offline-first (§6.5: "always available
 *     offline"), and absent for a plainer reason than the others: there is no lane
 *     surface to originate one yet. That arrives with M7.
 *
 *     Technically it is ready. An incident is two rows — `incidents` and the
 *     `incident_persons` join — and the management system holds a pooled connection
 *     with real transactions (src/db/armory/client.ts), so both inserts go in one
 *     transaction with `onConflictDoNothing` on each and the pair is idempotent.
 *     Adding it is a parser and a case in the writer, not a design problem.
 *
 *     Until the lane screen exists, an incident cannot be recorded offline. That is a
 *     known gap and not a silent one — see docs/M1_offline_acceptance.md.
 */
export const PUSH_OPERATIONS = [
  "participations.checkin",
  "waiver_signatures.create",
  "custody_events.create",
  "ammunition_issues.create",
  "rounds.create",
  "audit_log.create",
] as const;

export type PushOperation = (typeof PUSH_OPERATIONS)[number];

export const isPushOperation = (value: unknown): value is PushOperation =>
  typeof value === "string" &&
  (PUSH_OPERATIONS as readonly string[]).includes(value);

/**
 * One queued write, on the wire.
 *
 * `id` is the record's primary key, generated on the tablet (§2: "Offline-created
 * records must not require a server round trip to obtain an identity"). It is
 * what makes the write idempotent: a replay is an insert on a key that already
 * exists, so the server needs to remember nothing about the first delivery.
 */
export type PushRequest = {
  /** Client-generated UUIDv7. The identity of the row this becomes. §7. */
  id: string;
  operation: PushOperation;
  /** Shape depends on `operation`. Validated server-side; never trusted. */
  payload: unknown;

  /* §7: ATTRIBUTED. Every write records actor, device, and both timestamps. */
  deviceId: string;
  actorStaffId: string | null;
  /**
   * What the DEVICE believed the time was when the record was made.
   *
   * §2: "Client-generated timestamps are recorded alongside server receipt time,
   * never instead of it." The server stores this as the domain time — when the
   * firearm actually left the rack — and its own clock as `recorded_at`. A
   * custody event written during a power cut and pushed the next morning must
   * read as having happened during the power cut.
   */
  clientRecordedAt: string;
};

export type PushResponse = {
  /**
   * `applied` on the first delivery, `duplicate` on any replay of the same id.
   *
   * Both are successes and the outbox treats them identically. The distinction is
   * reported because §8.5 requires proof that "every record must reach the server
   * exactly once" — a run whose second delivery reports `duplicate` is that
   * proof, and one that reports `applied` twice is the defect.
   */
  outcome: "applied" | "duplicate";
  /** Server receipt time. */
  recordedAt: string;
};

/** A refusal. One sentence, for an officer — §4.3, §8.2. */
export type SyncError = {
  reason: string;
  remedy: string | null;
};

/* ---------------------------------------------------------------------------
   DAY PACK — §8.1
   -------------------------------------------------------------------------- */

export type DayPackResponse = {
  pack: DayPack;
  /** Fingerprint of this pack, for the conditional refresh. See `PullRequest`. */
  etag: string;
  /**
   * The server's verdict on the requesting device, delivered with the pack.
   *
   * Folded into this response rather than given its own endpoint because they are
   * needed at the same moment and a tablet on a bad link should not have to make
   * two requests to open. `revoked: true` is what triggers §10's wipe; anything
   * else that fails to arrive leaves the device on its bounded grace period.
   *
   * `id` is here because a tablet has to know which device it IS, not merely that
   * it is one: §7 requires every write to be attributed, and the outbox carries
   * `deviceId` on each queued record. The device learns it from the server in
   * exchange for its token rather than being configured with it, which means the
   * token is the only thing anybody has to type at a desk and the id cannot be
   * mistyped into misattributing a custody event.
   */
  device: {
    id: string;
    revoked: boolean;
    label: string;
    surface: "desk" | "lane";
  };
};

/* ---------------------------------------------------------------------------
   PULL — the continuous refresh
   -------------------------------------------------------------------------- */

/**
 * §8.1 asks for the pack to be "refreshed continuously while online", and §7
 * names `GET /sync/pull` alongside `GET /sync/daypack`. This is that refresh.
 *
 * ===========================================================================
 * WHY IT RETURNS A WHOLE PACK AND NOT A LIST OF CHANGES
 *
 * The design this obviously wants is a cursor over a change feed: give me
 * everything the server has decided since id X. That was the first shape of this
 * endpoint and it was wrong for two reasons that are worth recording, because it
 * will be proposed again.
 *
 * There is nothing to cursor over. A cursor needs a total order over changes,
 * which the append-only tables have — they are keyed by UUIDv7, and v7 sorts by
 * creation time — and the server-authoritative tables do not. Bookings,
 * memberships and allowances are UPDATED in place; `updated_at` is not a total
 * order and two rows touched in the same transaction can share it. Delivering a
 * cursor over those means building a change log first, and a change log is a
 * schema commitment §14 has not made.
 *
 * And the increment is not worth having at this size. §2.1 puts staging at a
 * hundred members; a whole pack for a club that size is a few hundred kilobytes,
 * and the refresh is conditional — `If-None-Match` against the pack's fingerprint
 * means an unchanged club costs one 304 and no body at all. A delta protocol
 * would spend real complexity, and a class of consistency bug the day pack does
 * not have, to save bytes on a request that usually transfers none.
 *
 * So pull is daypack with a fingerprint. When there is a change log — M4 brings
 * bookings and allowances, which is when in-place updates start mattering — this
 * is where the cursor goes, and the shape above is the one to restore.
 */
export type PullRequest = {
  deviceId: string;
  /**
   * The fingerprint of the pack this device already holds, from a previous
   * response. Sent as `If-None-Match`; absent on a first pull.
   */
  etag: string | null;
};

export type PullResponse =
  /** Nothing has changed. No pack in the body — this is the common case. */
  | { changed: false; device: { revoked: boolean } }
  /** Something changed; here is the whole pack and its new fingerprint. */
  | { changed: true; etag: string; pack: DayPack; device: { revoked: boolean } };
