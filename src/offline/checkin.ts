import { uuidv7 } from "@/lib/uuidv7";
import type { IndexedDayPack, PackArrival } from "./daypack";

/**
 * CHECKING SOMEBODY IN, OFFLINE — §6.4, §8.2, §7.
 *
 * The write half of the Today screen. src/offline/today.ts decides whether a person
 * MAY be checked in; this builds the records that say they were.
 *
 * ===========================================================================
 * ONE ACTION, TWO APPEND-ONLY ROWS
 *
 * A check-in is a participation (§3.3) and an audit entry (§3.6: "Every custody
 * event, score, waiver, admission, guest authorisation, block and override"). They
 * are two rows because they answer two different questions — who was on the premises,
 * and who let them on — and §3.6 wants the second one even when the first was
 * unremarkable.
 *
 * They are NOT one transaction, and they do not need to be. Both are idempotent
 * inserts keyed by a client-generated UUIDv7 (§7), both go through the outbox in
 * order, and the outbox retries anything that did not land. If the power fails
 * between enqueueing the two, the queue holds whichever was written and the other
 * is rebuilt from local state on the next check-in attempt — the participation is
 * the record that matters and it is written first.
 *
 * ===========================================================================
 * WHY THE TIER IS COPIED IN AND NOT REFERENCED
 *
 * §3.3: "tier_snapshot records the tier as at the visit — never join to the live
 * tier for historical reporting."
 *
 * The desk has the tier in the day pack, so it writes it. The reason is that a tier
 * is a permission matrix the club edits: raise the guest allowance in March and
 * every February visit would retroactively have been made under the new rule. A
 * snapshot is what makes last season's report still true.
 *
 * ===========================================================================
 * THIS FILE IS PURE
 *
 * It builds records and returns them. It does not write to IndexedDB, does not touch
 * the outbox and does not know what a device is. That is what makes the shape of a
 * check-in — including the §10 attribution and the §3.3 snapshot — assertable in a
 * unit test rather than only on hardware.
 */

/** A participation as it lives on the device before the server has seen it. */
export type LocalParticipation = {
  /** UUIDv7, generated here. The primary key the row will have on the server. */
  id: string;
  sessionId: string;
  personId: string;
  role: PackArrival["role"];
  hostPersonId: string | null;
  laneId: string | null;
  /** §3.3. The tier as it stood at the visit. */
  tierSnapshot: unknown;
  checkedInAt: string;
  /**
   * When the officer opened the sheet on somebody already at the desk —
   * Management §11.4, and the clock on the club's fifteen-second promise.
   *
   * Null where the caller did not measure. The check-in completes either way,
   * because a measurement that can refuse a member at the counter would matter
   * more than the thing it measures — which is how instrumentation gets
   * switched off.
   */
  arrivalAt: string | null;
  checkedInByStaffId: string | null;
  checkedOutAt: string | null;
};

/** What the caller enqueues, in this order. */
export type CheckInWrites = {
  participation: LocalParticipation;
  queue: readonly {
    id: string;
    operation: "participations.checkin" | "audit_log.create";
    payload: unknown;
  }[];
};

export type CheckInRefusal = {
  reason: string;
  remedy: string | null;
};

export type CheckInResult =
  | { ok: true; writes: CheckInWrites }
  | { ok: false; refusal: CheckInRefusal };

export type CheckInContext = {
  /** The officer on shift. §10: "Every staff action attributable to a named person." */
  actorStaffId: string | null;
  /** Device clock. Recorded as the domain time; the server adds its own (§2). */
  now: Date;
  /** Set when the officer is letting an `attention` row through. §4.3. */
  override: { reason: string } | null;
  /** Assigned at check-in. §6.4: "checked in with a lane assigned." */
  laneId: string | null;
  /**
   * When this person presented at the desk — Management §11.4.
   *
   * The officer opening the sheet is the closest thing the console has to that
   * moment, and it is close enough: the sheet opens because somebody is
   * standing there. Optional so no existing caller is broken, and so a caller
   * that genuinely cannot measure says so by omission rather than by passing a
   * time it invented.
   */
  arrivalAt?: Date | null;
};

/**
 * Build the records for one check-in.
 *
 * Refuses rather than throws when the pack cannot support the write, because the
 * caller is a button on a desk and the officer needs a sentence.
 */
export function buildCheckIn(
  indexed: IndexedDayPack,
  arrival: PackArrival,
  context: CheckInContext,
): CheckInResult {
  /**
   * A check-in belongs to a session, and M1 cannot open one offline.
   *
   * `sessions` is in neither of §8.2's two classes, so it has no offline strategy
   * yet — opening one is a staff action against club capacity and belongs with the
   * desk in M5. The day pack carries `sessionId` on an arrival whose session is
   * already open, which is enough for §8.5's workflow: the session is opened while
   * online and the range then loses its uplink.
   *
   * Refused with a sentence rather than left to fail as a foreign key violation
   * twenty minutes later in the queue.
   */
  if (!arrival.sessionId) {
    return {
      ok: false,
      refusal: {
        reason: "There is no open session for this booking on this device.",
        remedy: "Open today's session while the tablet has a connection.",
      },
    };
  }

  /* §3.3: "host_person_id required when role is guest_shooter." Checked here so the
     officer is told at the desk rather than by the server tomorrow. The same rule is
     in src/sync/operations.ts and in the database — three places, because this is the
     record that says an unaccompanied stranger was on a live range. */
  if (arrival.role === "guest_shooter" && !arrival.hostPersonId) {
    return {
      ok: false,
      refusal: {
        reason: "A guest cannot be checked in without recording who is hosting them.",
        remedy: "Choose the member bringing this guest.",
      },
    };
  }

  const membership = indexed.membershipByPersonId.get(arrival.personId);
  const tier = membership ? indexed.tierById.get(membership.tierId) : undefined;

  const participation: LocalParticipation = {
    id: uuidv7(),
    sessionId: arrival.sessionId,
    personId: arrival.personId,
    role: arrival.role,
    hostPersonId: arrival.hostPersonId,
    laneId: context.laneId,
    /* Null for a guest, who has no tier — §3.1 makes a guest a state of a person,
       and inventing a tier snapshot for one would put a permission matrix in the
       record of somebody who was never subject to it. */
    tierSnapshot: tier ?? null,
    checkedInAt: context.now.toISOString(),
    /* Never after the completion. A tablet woken from sleep can produce a
       start later than its own finish, and a negative duration is clock skew
       rather than a fast check-in — `checkInClock` discards those, but a value
       that cannot be wrong is better than one that has to be filtered. */
    arrivalAt:
      context.arrivalAt && context.arrivalAt <= context.now
        ? context.arrivalAt.toISOString()
        : null,
    checkedInByStaffId: context.actorStaffId,
    checkedOutAt: null,
  };

  return {
    ok: true,
    writes: {
      participation,
      queue: [
        {
          /* The record's id IS the queue item's id. §7 — a replay is an insert on a
             key that already exists, so the server remembers nothing about the first
             delivery. See src/offline/outbox/outbox.ts. */
          id: participation.id,
          operation: "participations.checkin",
          payload: {
            sessionId: participation.sessionId,
            personId: participation.personId,
            role: participation.role,
            hostPersonId: participation.hostPersonId,
            laneId: participation.laneId,
            tierSnapshot: participation.tierSnapshot,
            checkedInAt: participation.checkedInAt,
            arrivalAt: participation.arrivalAt,
          },
        },
        {
          id: uuidv7(),
          operation: "audit_log.create",
          payload: {
            action: context.override ? "check_in_override" : "check_in",
            entityType: "participation",
            entityId: participation.id,
            occurredAt: participation.checkedInAt,
            /* §3.6: "An override is permitted but never silent — override_reason is
               mandatory when present." §4.3 adds that it "appears on the founder's
               dashboard the same day", which is what makes this row worth queueing
               ahead of the officer going home. */
            isOverride: context.override !== null,
            overrideReason: context.override?.reason ?? null,
            after: {
              personId: participation.personId,
              role: participation.role,
              hostPersonId: participation.hostPersonId,
              laneId: participation.laneId,
            },
          },
        },
      ],
    },
  };
}

/**
 * Who is on the premises, from local participations.
 *
 * This is what makes §12.1's host-presence rule survive a power cut: the guest's row
 * clears because the host is in this set, and the host is in this set because their
 * check-in is on disk — not because the server was asked.
 */
export const presentPersonIds = (
  participations: readonly LocalParticipation[],
): ReadonlySet<string> =>
  new Set(
    participations
      .filter((participation) => participation.checkedOutAt === null)
      .map((participation) => participation.personId),
  );
