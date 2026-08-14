import { evaluate } from "@/domain/capability";
import { isIssuable } from "@/domain/state-machines";
import { uuidv7 } from "@/lib/uuidv7";
import { firearmBySerial, subjectFor, type IndexedDayPack } from "./daypack";
import type { LocalParticipation } from "./checkin";

/**
 * ISSUING EQUIPMENT AT THE DESK — §6.4.
 *
 *   "Issue equipment — Firearm by serial and ammunition by quantity, written as
 *    custody and ammunition rows against the participation. WORKS OFFLINE."
 *
 * Steps 10 and 11 of docs/M1_offline_acceptance.md, which recorded them as not
 * yet buildable: "The waiver, equipment-issue and score-capture workflows are M5
 * and M7. Their writes are defined and replay-tested (src/sync/operations.ts) and
 * the queue that carries them is complete, but there is no screen that
 * originates them."
 *
 * This is the half that was missing. The writes were already defined, already
 * parsed and already proven idempotent over two deliveries; what did not exist
 * was anything that built one.
 *
 * The sentence quoted above is from a superseded revision of that document and is
 * kept because it states the problem exactly. Two of its three workflows are now
 * closed — this file, and src/offline/waiver.ts for the waiver. Score capture
 * remains M7.
 *
 * ===========================================================================
 * THE SAME SHAPE AS src/offline/checkin.ts, ON PURPOSE
 *
 * Pure. It builds records and returns them. It does not touch IndexedDB, does
 * not touch the outbox, and does not know what a device is. That is what makes
 * the §4 permission call and the §3.4 custody shape assertable in a unit test
 * rather than only on hardware with a firearm in hand.
 *
 * ===========================================================================
 * WHY THE FIREARM CHECK HAPPENS HERE AND AGAIN AT THE LANE
 *
 * §4.2 lists MAY_USE_OWN_FIREARM as evaluated at "check-in and lane", and §6.5
 * gives the lane its own Pair screen. Both call the same capability service with
 * the same subject, so they cannot disagree — and the desk one exists because an
 * officer handing over a firearm at the counter should not discover at the bay
 * that the shooter's licence expired last month, with the firearm already out of
 * the rack and logged as issued.
 */

export type EquipmentRefusal = {
  readonly reason: string;
  readonly remedy: string | null;
};

export type QueuedWrite = {
  readonly id: string;
  readonly operation:
    | "custody_events.create"
    | "ammunition_issues.create"
    | "ammunition_issues.reconcile"
    | "audit_log.create";
  readonly payload: unknown;
};

export type EquipmentResult<T> =
  | { readonly ok: true; readonly writes: T }
  | { readonly ok: false; readonly refusal: EquipmentRefusal };

export type IssueContext = {
  /** §10. Null is no longer acceptable here — see src/offline/officer.ts. */
  readonly actorStaffId: string | null;
  readonly now: Date;
  readonly sessionId: string;
  /** §4.3: set when an officer is overriding a block with a recorded reason. */
  readonly override: { readonly reason: string } | null;
};

/* ============================================================================
   FIREARMS — §3.4
   ========================================================================= */

export type FirearmIssueWrites = {
  readonly custodyEventId: string;
  readonly firearmId: string;
  readonly serialNumber: string;
  readonly queue: readonly QueuedWrite[];
};

/**
 * Issue a firearm to a shooter, by serial.
 *
 * By serial rather than by id because that is what is stamped on the thing in
 * the officer's hand. §6.5's Pair screen does the same, and the pack indexes
 * both — `firearmBySerial` exists for exactly this.
 */
export function buildFirearmIssue(
  indexed: IndexedDayPack,
  input: {
    readonly serialNumber: string;
    readonly participation: LocalParticipation;
  },
  context: IssueContext,
): EquipmentResult<FirearmIssueWrites> {
  const firearm = firearmBySerial(indexed, input.serialNumber);

  if (!firearm) {
    return refuse(
      `No firearm with serial ${input.serialNumber} is on this device's register.`,
      "Check the serial, or sync while there is a connection.",
    );
  }

  /* §3.4: status is DERIVED from custody events and is the sole answer to where
     a firearm is. `isIssuable` is the same mapping the database applies in
     drizzle/0002 — a firearm already issued, off site, or decommissioned cannot
     be handed to somebody else. */
  if (!isIssuable(firearm.status)) {
    return refuse(
      `${firearm.serialNumber} is ${describeStatus(firearm.status)}.`,
      firearm.status === "issued"
        ? "It is already out. Return it before issuing it again."
        : "Choose another firearm.",
    );
  }

  const subject = subjectFor(indexed, input.participation.personId);
  if (!subject) {
    return refuse(
      "This device does not have that shooter on file.",
      "Sync while there is a connection.",
    );
  }

  /* §4 MAY_USE_OWN_FIREARM. A club firearm returns allowed and the capability
     service says why in its own comment: whether this shooter may use it is a
     question of discipline and competency, which MAY_SHOOT_DISCIPLINE answers. */
  const decision = evaluate(subject, {
    capability: "MAY_USE_OWN_FIREARM",
    now: context.now,
    firearm: {
      id: firearm.id,
      serialNumber: firearm.serialNumber,
      calibre: firearm.calibre,
      ownership: firearm.ownership,
      ownerPersonId: firearm.ownerPersonId,
      status: firearm.status,
    },
  });

  if (!decision.allowed) {
    /* §4.3: an officer may override where the block permits it, and the reason
       is recorded. A block that is not overridable is not negotiable here —
       `MAY_USE_OWN_FIREARM` refuses a guest on a member's firearm and §12 wants
       that on the dashboard if it is ever forced. */
    if (!context.override || !decision.overridable) {
      return refuse(decision.reason.message, decision.remedy);
    }
  }

  const custodyEventId = uuidv7();

  const queue: QueuedWrite[] = [
    {
      id: custodyEventId,
      operation: "custody_events.create",
      payload: {
        firearmId: firearm.id,
        eventType: "issued",
        occurredAt: context.now.toISOString(),
        /* §3.4: "who it went to or came from". The shooter, not the officer —
           the officer is `actorStaffId` on the envelope. */
        counterpartyPersonId: input.participation.personId,
        sessionId: context.sessionId,
        correctsEventId: null,
        note: null,
      },
    },
  ];

  if (context.override) {
    queue.push(
      auditOverride({
        action: "custody.issue",
        entityId: custodyEventId,
        reason: context.override.reason,
        blocked: decision.allowed ? null : decision.reason.message,
        now: context.now,
      }),
    );
  }

  return {
    ok: true,
    writes: {
      custodyEventId,
      firearmId: firearm.id,
      serialNumber: firearm.serialNumber,
      queue,
    },
  };
}

/**
 * Take a firearm back.
 *
 * §3.4: "custody_events is append-only and is the sole source of truth for where
 * any firearm is." A return is therefore not an edit to the issue — it is a new
 * event pointing the other way, and `firearms.status` follows it by trigger.
 *
 * No capability check. Returning a firearm to the rack is always permitted and
 * always desirable; a system that could refuse it would be a system that could
 * leave a firearm logged as out because a licence expired during the session.
 */
export function buildFirearmReturn(
  input: {
    readonly firearmId: string;
    readonly serialNumber: string;
    readonly fromPersonId: string;
  },
  context: IssueContext,
): FirearmIssueWrites {
  const custodyEventId = uuidv7();

  return {
    custodyEventId,
    firearmId: input.firearmId,
    serialNumber: input.serialNumber,
    queue: [
      {
        id: custodyEventId,
        operation: "custody_events.create",
        payload: {
          firearmId: input.firearmId,
          eventType: "returned",
          occurredAt: context.now.toISOString(),
          counterpartyPersonId: input.fromPersonId,
          sessionId: context.sessionId,
          correctsEventId: null,
          note: null,
        },
      },
    ],
  };
}

/* ============================================================================
   AMMUNITION — §3.4
   ========================================================================= */

export type AmmunitionIssueWrites = {
  readonly issueId: string;
  readonly lotId: string;
  readonly qtyIssued: number;
  readonly queue: readonly QueuedWrite[];
};

/**
 * Issue rounds against a participation.
 *
 * §3.4: "Reconciled per participation, not per day. qty_issued must equal
 * qty_fired plus qty_returned at reconciliation." The reconciliation is session
 * close; this is the issue, and it deliberately leaves `qtyFired` and
 * `qtyReturned` unset — src/sync/operations.ts notes that setting them is the
 * one UPDATE migration 0002 permits, and it belongs to close rather than here.
 */
export function buildAmmunitionIssue(
  indexed: IndexedDayPack,
  input: {
    readonly lotId: string;
    readonly participation: LocalParticipation;
    readonly qtyIssued: number;
  },
  context: IssueContext,
): EquipmentResult<AmmunitionIssueWrites> {
  const lot = indexed.pack.ammunitionLots.find((row) => row.id === input.lotId);

  if (!lot) {
    return refuse(
      "That ammunition lot is not on this device's register.",
      "Sync while there is a connection.",
    );
  }

  if (!Number.isInteger(input.qtyIssued) || input.qtyIssued <= 0) {
    return refuse(
      "Enter how many rounds are being issued.",
      null,
    );
  }

  /* The pack's remaining count is a snapshot and this desk may have issued
     against the lot since. Refusing outright on a stale number would stop an
     officer issuing rounds that are physically in the tin in front of them — so
     this warns by refusing only when the pack says there are none at all, and
     the server's own arithmetic guard in drizzle/0002 is what actually protects
     the lot from going negative. */
  if (lot.quantityRemaining <= 0) {
    return refuse(
      `This device shows lot ${lot.calibre} as empty.`,
      "Choose another lot, or sync to refresh the counts.",
    );
  }

  const issueId = uuidv7();

  const queue: QueuedWrite[] = [
    {
      id: issueId,
      operation: "ammunition_issues.create",
      payload: {
        lotId: lot.id,
        participationId: input.participation.id,
        qtyIssued: input.qtyIssued,
        issuedAt: context.now.toISOString(),
      },
    },
  ];

  if (context.override) {
    queue.push(
      auditOverride({
        action: "ammunition.issue",
        entityId: issueId,
        reason: context.override.reason,
        blocked: null,
        now: context.now,
      }),
    );
  }

  return {
    ok: true,
    writes: { issueId, lotId: lot.id, qtyIssued: input.qtyIssued, queue },
  };
}

/**
 * Count rounds back in. §3.4's reconciliation, at session close.
 *
 * The arithmetic is checked so the officer hears it in English at the desk
 * rather than as a constraint violation from Postgres a minute later — the
 * database still enforces it (drizzle/0002) and this is the sentence.
 *
 * Deliberately permits a count that does not balance to be REFUSED here but
 * still stored locally by the caller: `SessionStore.reconcileAmmunition` accepts
 * it, because an officer mid-count should be able to write down what they have
 * so far. What must not happen is an unbalanced count reaching the server as
 * though it were final — so this refuses, and the close guard in
 * src/offline/close.ts keeps the session open until it adds up.
 */
export function buildAmmunitionReconcile(
  input: {
    readonly issueId: string;
    readonly qtyIssued: number;
    readonly qtyFired: number;
    readonly qtyReturned: number;
  },
): EquipmentResult<{ readonly queue: readonly QueuedWrite[] }> {
  const { qtyIssued, qtyFired, qtyReturned } = input;

  if (
    !Number.isInteger(qtyFired) ||
    !Number.isInteger(qtyReturned) ||
    qtyFired < 0 ||
    qtyReturned < 0
  ) {
    return refuse("Enter both counts as whole numbers of rounds.", null);
  }

  const accounted = qtyFired + qtyReturned;

  if (accounted !== qtyIssued) {
    /* §3.4: "qty_issued must equal qty_fired plus qty_returned." Named both
       ways round, because an officer who is out by five needs to know whether
       they are looking for rounds or have counted some twice. */
    return refuse(
      accounted < qtyIssued
        ? `${qtyIssued - accounted} of ${qtyIssued} rounds are unaccounted for.`
        : `That is ${accounted - qtyIssued} more rounds than were issued.`,
      "Count again, or record the difference as an incident.",
    );
  }

  return {
    ok: true,
    writes: {
      queue: [
        {
          id: uuidv7(),
          operation: "ammunition_issues.reconcile",
          payload: { issueId: input.issueId, qtyFired, qtyReturned },
        },
      ],
    },
  };
}

/* ============================================================================
   SHARED
   ========================================================================= */

const refuse = <T>(reason: string, remedy: string | null): EquipmentResult<T> => ({
  ok: false,
  refusal: { reason, remedy },
});

/** §3.6: "An override is permitted but never silent." */
function auditOverride(input: {
  action: string;
  entityId: string;
  reason: string;
  blocked: string | null;
  now: Date;
}): QueuedWrite {
  return {
    id: uuidv7(),
    operation: "audit_log.create",
    payload: {
      action: input.action,
      entityType: "custody_event",
      entityId: input.entityId,
      before: input.blocked ? { blocked: input.blocked } : null,
      after: null,
      isOverride: true,
      overrideReason: input.reason,
      occurredAt: input.now.toISOString(),
    },
  };
}

/** A firearm's status, in words an officer would use. */
function describeStatus(status: string): string {
  switch (status) {
    case "issued":
      return "already issued to someone";
    case "off_site":
      return "off site";
    case "in_storage":
      return "in the cabinet";
    case "at_service":
      return "away for service";
    case "decommissioned":
      return "decommissioned";
    default:
      return status;
  }
}
