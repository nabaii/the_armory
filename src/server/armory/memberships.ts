import { and, eq, lt } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { MembershipStatus } from "@/domain/enums";
import {
  membershipTransition,
  type MembershipEvent,
} from "@/domain/state-machines";
import { toDateColumn } from "@/lib/time";
import { applied, refused, type AuditDraft, type Written } from "./record";

/**
 * MEMBERSHIP — §5's state machine, given a database.
 *
 *   §5: "Implement these as explicit transitions with guards. Do not allow
 *        status to be set by direct assignment from a form."
 *
 * That sentence is the whole design of this file. `membershipTransition` in
 * src/domain/state-machines.ts is the guard and it is pure — it takes a status
 * and an event and returns either a new status or a refusal with a sentence.
 * Nothing here re-decides anything it decides. This module's only jobs are to
 * read the current status, hand it to the transition, and apply whatever the
 * transition returns — including its effects, in the same transaction.
 *
 * ===========================================================================
 * THE CASCADE IS THE REASON THIS NEEDS A TRANSACTION
 *
 * §5: "A Partner membership cannot outlive its principal."
 *
 * src/domain/state-machines.ts states what goes wrong when that is not applied,
 * and it is worth repeating because the failure is silent: "a principal
 * resigns, their partner's membership is never touched, and the club carries a
 * full member who pays nothing and whom no report flags — for as long as nobody
 * happens to look."
 *
 * So a resignation is at minimum two writes, and a partial application is worse
 * than none: a principal marked resigned with a partner still active is exactly
 * the state above, now with a record saying it was done deliberately. Both
 * writes commit together or neither does, which is why every function here takes
 * an `ArmoryTx` rather than a connection.
 *
 * ===========================================================================
 * WHY THE CASCADE RE-ENTERS THE TRANSITION
 *
 * The attached memberships are not simply set to the principal's new status.
 * Each is put through `membershipTransition` with a `principal_ended` event,
 * which decides for itself — a partner who has already resigned stays resigned
 * rather than being dragged back to lapsed. Reaching into the table and
 * assigning a status would be the direct assignment §5 forbids, and it would be
 * the same mistake whether a form or another transition made it.
 */

export type MembershipResult = {
  readonly membershipId: string;
  readonly from: MembershipStatus;
  readonly to: MembershipStatus;
  /** Attached memberships §5's cascade moved, if any. */
  readonly cascaded: readonly {
    readonly membershipId: string;
    readonly to: MembershipStatus;
  }[];
};

type MembershipRow = {
  id: string;
  personId: string;
  status: MembershipStatus;
  principalMembershipId: string | null;
};

/**
 * Apply an event to a membership.
 *
 * Returns a `Written` for the envelope in record.ts, so the caller gets §7's
 * idempotency and §3.6's audit without this file knowing about either.
 */
export async function applyMembershipEvent(
  tx: ArmoryTx,
  input: {
    readonly membershipId: string;
    readonly event: MembershipEvent;
    readonly occurredAt: Date;
  },
): Promise<Written<MembershipResult>> {
  const membership = await loadMembership(tx, input.membershipId);

  if (!membership) {
    return refused({
      code: "NO_SUCH_MEMBERSHIP",
      message: "That membership is not on file.",
    });
  }

  const transition = membershipTransition(membership.status, input.event, {
    id: membership.id,
    isAttached: membership.principalMembershipId !== null,
  });

  if (!transition.ok) {
    /* §3.6 wants the block in the log. The audit row carries the status the
       guard actually saw, which is the one fact a founder reading it tomorrow
       cannot reconstruct — the row has moved on by then. */
    return refused({ code: transition.code, message: transition.message }, [
      {
        action: `membership.${input.event.type}`,
        entityType: "membership",
        entityId: membership.id,
        before: { status: membership.status },
      },
    ]);
  }

  const audit: AuditDraft[] = [
    {
      action: `membership.${input.event.type}`,
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status },
      after: { status: transition.to },
      ...overrideOf(input.event),
    },
  ];

  await writeStatus(tx, membership.id, transition.to, input.occurredAt);

  const cascaded = transition.effects.some(
    (effect) => effect.kind === "cascade_to_attached_memberships",
  )
    ? await cascade(tx, membership.id, input.occurredAt, audit)
    : [];

  return applied(
    {
      membershipId: membership.id,
      from: membership.status,
      to: transition.to,
      cascaded,
    },
    audit,
  );
}

/**
 * §5's Partner rule, applied to every membership attached to this one.
 *
 * Each attached membership goes through the transition rather than being
 * assigned. A partner already resigned stays resigned; a live one lapses.
 */
async function cascade(
  tx: ArmoryTx,
  principalId: string,
  occurredAt: Date,
  audit: AuditDraft[],
): Promise<{ membershipId: string; to: MembershipStatus }[]> {
  const attached = await tx
    .select({
      id: schema.memberships.id,
      status: schema.memberships.status,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.principalMembershipId, principalId));

  const moved: { membershipId: string; to: MembershipStatus }[] = [];

  for (const partner of attached) {
    const transition = membershipTransition(
      partner.status,
      { type: "principal_ended" },
      { id: partner.id, isAttached: true },
    );

    /* A refusal here is not an error to surface. `principal_ended` refuses only
       for a membership that is not attached, and this query selected on the
       attachment — so the branch is unreachable rather than tolerated, and
       skipping is the safe reading if it ever becomes reachable. */
    if (!transition.ok) continue;
    if (transition.to === partner.status) continue;

    await writeStatus(tx, partner.id, transition.to, occurredAt);

    audit.push({
      action: "membership.principal_ended",
      entityType: "membership",
      entityId: partner.id,
      before: { status: partner.status },
      after: { status: transition.to, principalMembershipId: principalId },
    });

    moved.push({ membershipId: partner.id, to: transition.to });
  }

  return moved;
}

/**
 * Write the status and the dates that go with it.
 *
 * `endedOn` is set on the terminal statuses because the capability service reads
 * it for the lapse message — src/domain/capability/index.ts uses
 * `endedOn ?? renewsOn` to tell a member when their membership ended, and a null
 * there produces a sentence with a hole in it.
 */
async function writeStatus(
  tx: ArmoryTx,
  membershipId: string,
  to: MembershipStatus,
  occurredAt: Date,
): Promise<void> {
  const ends = to === "lapsed" || to === "resigned";

  await tx
    .update(schema.memberships)
    .set({
      status: to,
      updatedAt: occurredAt,
      ...(ends ? { endedOn: toDateColumn(occurredAt) } : {}),
      /* Reinstatement clears the ending. A membership that came back with an
         `endedOn` still set reads as ended to every report that filters on it. */
      ...(to === "active" ? { endedOn: null } : {}),
    })
    .where(eq(schema.memberships.id, membershipId));
}

/** §3.6: an override is never silent. Lifts the reason out of the event. */
function overrideOf(event: MembershipEvent): Pick<AuditDraft, "override"> {
  return event.type === "suspend" ? { override: { reason: event.reason } } : {};
}

async function loadMembership(
  tx: ArmoryTx,
  membershipId: string,
): Promise<MembershipRow | null> {
  const [row] = await tx
    .select({
      id: schema.memberships.id,
      personId: schema.memberships.personId,
      status: schema.memberships.status,
      principalMembershipId: schema.memberships.principalMembershipId,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.id, membershipId))
    .limit(1);

  return row ?? null;
}

/* ============================================================================
   THE RENEWAL SWEEP — §5: "lapsed (renewal missed)"
   ========================================================================= */

/**
 * Lapse every active membership whose renewal date has passed.
 *
 * A sweep rather than a check at read time, for the same reason licences have
 * one: the status is what reports, exports and the founder's lapse list (§6.6)
 * read, and a status that is only correct when someone happens to evaluate a
 * capability is not a system of record.
 *
 * The capability service does not depend on this having run — it compares dates
 * itself, so a member whose renewal passed an hour ago is already blocked. The
 * sweep exists so the COLUMN agrees with the clock, not so the rule works.
 *
 * Returns the memberships it moved, so the caller can put each through the
 * notice ladder in src/domain/notices.ts.
 */
export async function lapseOverdueMemberships(
  tx: ArmoryTx,
  now: Date,
): Promise<Written<{ readonly lapsed: readonly string[] }>> {
  /* Compared date to date, not instant to instant. `renews_on` is a DATE column
     and a member renewing "on the 14th" means the whole Lagos day — a
     comparison that treats it as midnight UTC lapses every member an hour
     early, every time, for the rest of the club's life. `toDateColumn` is
     `lagosDateKey`, so "today" here is today in Lagos. */
  const today = toDateColumn(now);

  const due = await tx
    .select({
      id: schema.memberships.id,
      status: schema.memberships.status,
      renewsOn: schema.memberships.renewsOn,
      principalMembershipId: schema.memberships.principalMembershipId,
    })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.status, "active"),
        lt(schema.memberships.renewsOn, today),
      ),
    );

  const lapsed: string[] = [];
  const audit: AuditDraft[] = [];

  for (const membership of due) {
    const transition = membershipTransition(
      membership.status,
      { type: "renewal_missed" },
      {
        id: membership.id,
        isAttached: membership.principalMembershipId !== null,
      },
    );
    if (!transition.ok) continue;

    await writeStatus(tx, membership.id, transition.to, now);

    audit.push({
      action: "membership.renewal_missed",
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status, renewsOn: membership.renewsOn },
      after: { status: transition.to },
    });

    await cascade(tx, membership.id, now, audit);
    lapsed.push(membership.id);
  }

  return applied({ lapsed }, audit);
}
