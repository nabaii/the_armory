import { eq, inArray, sql } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { ApplicationStatus } from "@/domain/enums";
import {
  DEFAULT_ROSTER_POLICY,
  nextPosition,
  renumber,
  rosterStanding,
  type RosterPolicy,
  type RosterStanding,
} from "@/domain/roster";
import {
  applicationTransition,
  type ApplicationEvent,
} from "@/domain/state-machines";
import { toDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type AuditDraft, type Written } from "./record";

/**
 * ADMISSION — §5's application machine, the roster cap, and onboarding.
 *
 *   §1.1: "Membership is by application and admission, not purchase. The roster
 *          has a hard cap; a waitlist sits behind it."
 *   §5:   "submitted → under_review → admitted | waitlisted | declined.
 *          waitlisted → admitted | withdrawn. Any → withdrawn. Admission
 *          requires roster headroom or an explicit founder override."
 *   §12:  "Roster at cap, application admitted → Blocked, or admitted only with
 *          explicit founder override recorded."
 *
 * ===========================================================================
 * ADMISSION IS THE MOST CONSEQUENTIAL WRITE IN THE SYSTEM
 *
 * Not the most dangerous — publishing a waiver version is that (see waivers.ts)
 * — but the least reversible. A member cannot be un-admitted. The club can
 * suspend them, and it can decline to renew them, and neither of those is the
 * same as the seat never having been given away.
 *
 * Which is why three separate things must happen atomically or not at all:
 *
 *   1. the application moves to `admitted`
 *   2. a membership is issued, consuming a member number from a sequence §3.1
 *      says is "unique, sequential, NEVER REUSED"
 *   3. the waitlist entry closes and the queue behind it renumbers
 *
 * A partial application of those is a specific, nasty failure. Step 1 without
 * step 2 is an admitted applicant with no membership, invisible to the roster
 * count — so the next admission sees headroom that does not exist. Step 2
 * without step 3 leaves someone on the waitlist who has already joined.
 *
 * ===========================================================================
 * WHY THE HEADROOM IS COMPUTED INSIDE THE TRANSACTION
 *
 * `applicationTransition` takes `rosterHeadroom` as a number, which means
 * somebody has to count. Counting outside the transaction and passing the
 * result in would reintroduce §8.3's named defect in a new place: two founders
 * on two devices, both reading one free seat, both admitting.
 *
 * So the count happens here, against the same snapshot as the write. It is not
 * a `SELECT … FOR UPDATE` because there is no single row to lock — the cap is a
 * property of a whole table — and the honest mitigation is that this is a
 * two-person club and the audit records the override when it happens. If the
 * founder ever admits from two devices simultaneously, `overCap` on the
 * dashboard is what surfaces it.
 */

/* ============================================================================
   INTAKE — §6.1 and §6.2
   ========================================================================= */

export type ApplicationDraft = {
  readonly id?: string;
  readonly personId: string;
  /**
   * §6.1: the public site writes `club`. §6.2: a member putting a former guest
   * forward writes `member`, and §6.6 makes the difference the club's whole
   * conversion metric — "guest-to-application conversion; admissions by host".
   */
  readonly sponsorType: "club" | "member";
  readonly sponsorMembershipId: string | null;
  readonly requestedTierId: string | null;
};

export async function submitApplication(
  tx: ArmoryTx,
  draft: ApplicationDraft,
): Promise<Written<{ readonly applicationId: string }>> {
  if (draft.sponsorType === "member" && !draft.sponsorMembershipId) {
    /* A sponsored application with no sponsor is the conversion metric silently
       losing its attribution — §6.6's "admissions by host" would undercount and
       nothing would look broken. */
    return refused({
      code: "NO_SPONSOR",
      message: "A sponsored application needs the member who is putting them forward.",
    });
  }

  /* One live application per person. Re-applying while a decision is pending
     produces two rows racing to admit the same human, and §3.1's one-row-per-
     human rule would be honoured in `people` and broken everywhere downstream. */
  const [existing] = await tx
    .select({ id: schema.applications.id, status: schema.applications.status })
    .from(schema.applications)
    .where(
      sql`${schema.applications.personId} = ${draft.personId}
          and ${schema.applications.status} in ('submitted', 'under_review', 'waitlisted')`,
    )
    .limit(1);

  if (existing) {
    return refused({
      code: "ALREADY_APPLIED",
      message: "This person already has an application in progress.",
    });
  }

  const applicationId = draft.id ?? uuidv7();

  const inserted = await tx
    .insert(schema.applications)
    .values({
      id: applicationId,
      personId: draft.personId,
      sponsorType: draft.sponsorType,
      sponsorMembershipId: draft.sponsorMembershipId,
      requestedTierId: draft.requestedTierId,
      status: "submitted",
    })
    .onConflictDoNothing({ target: schema.applications.id })
    .returning({ id: schema.applications.id });

  if (inserted.length === 0) return applied({ applicationId });

  return applied({ applicationId }, [
    {
      action: "application.submit",
      entityType: "application",
      entityId: applicationId,
      after: {
        personId: draft.personId,
        sponsorType: draft.sponsorType,
        sponsorMembershipId: draft.sponsorMembershipId,
      },
    },
  ]);
}

/* ============================================================================
   DECISIONS
   ========================================================================= */

export type AdmissionResult = {
  readonly applicationId: string;
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;
  /** Set when the decision issued a membership. §5's `issue_membership`. */
  readonly membershipId: string | null;
  readonly memberNumber: number | null;
  /** The roster as it stood when the decision was taken. For the audit. */
  readonly standing: RosterStanding;
};

export type DecisionInput = {
  readonly applicationId: string;
  readonly event: ApplicationEvent;
  readonly occurredAt: Date;
  readonly policy?: RosterPolicy;
  /**
   * The tier to issue on admission, when the application requested none. A
   * membership needs one — §3.1 makes `tier_id` NOT NULL, and the capability
   * service treats a membership without a tier as no membership at all.
   */
  readonly fallbackTierId?: string;
};

export async function decideApplication(
  tx: ArmoryTx,
  input: DecisionInput,
): Promise<Written<AdmissionResult>> {
  const policy = input.policy ?? DEFAULT_ROSTER_POLICY;

  const [application] = await tx
    .select({
      id: schema.applications.id,
      personId: schema.applications.personId,
      status: schema.applications.status,
      requestedTierId: schema.applications.requestedTierId,
      sponsorMembershipId: schema.applications.sponsorMembershipId,
    })
    .from(schema.applications)
    .where(eq(schema.applications.id, input.applicationId))
    .limit(1);

  if (!application) {
    return refused({
      code: "NO_SUCH_APPLICATION",
      message: "That application is not on file.",
    });
  }

  const standing = await currentStanding(tx, policy);

  /* §5's guard needs a number. A null cap means the founder has not set one
     (§14), and this is where that has to become a decision rather than a
     silence: admitting freely would make the cap §1.1 calls "hard" advisory,
     and refusing everything would stop the club admitting anyone at all before
     the number lands.

     Treated as headroom, with the absence recorded on the audit row. The club
     can admit; the log says the cap was unset when it did. Refusing would be
     the safer-looking choice and the wrong one — a system that cannot admit its
     founding members because a configuration value is missing is not protecting
     anything. */
  const headroom = standing.headroom ?? 1;

  const event: ApplicationEvent =
    input.event.type === "admit"
      ? { ...input.event, rosterHeadroom: headroom }
      : input.event;

  const transition = applicationTransition(application.status, event);

  if (!transition.ok) {
    return refused({ code: transition.code, message: transition.message }, [
      {
        action: `application.${input.event.type}`,
        entityType: "application",
        entityId: application.id,
        before: { status: application.status },
        after: { rosterOccupied: standing.occupied, rosterCap: standing.cap },
      },
    ]);
  }

  const override =
    event.type === "admit" ? event.founderOverride : undefined;

  const audit: AuditDraft[] = [
    {
      action: `application.${input.event.type}`,
      entityType: "application",
      entityId: application.id,
      before: { status: application.status },
      after: {
        status: transition.to,
        rosterOccupied: standing.occupied,
        rosterCap: standing.cap,
        /* Recorded explicitly so a founder reading the log later can tell an
           admission taken with headroom from one taken while the cap was
           simply unknown. Those are different decisions. */
        capWasUnset: standing.cap === null,
      },
      ...(override ? { override: { reason: override.reason } } : {}),
    },
  ];

  await tx
    .update(schema.applications)
    .set({
      status: transition.to,
      decidedAt: input.occurredAt,
      decidedByStaffId: decidedBy(input.event),
      updatedAt: input.occurredAt,
    })
    .where(eq(schema.applications.id, application.id));

  let membershipId: string | null = null;
  let memberNumber: number | null = null;

  for (const effect of transition.effects) {
    if (effect.kind === "issue_membership") {
      const issued = await issueMembership(tx, {
        personId: application.personId,
        tierId: application.requestedTierId ?? input.fallbackTierId ?? null,
        occurredAt: input.occurredAt,
      });

      if (!issued.ok) {
        return refused({ code: issued.code, message: issued.message }, audit);
      }

      membershipId = issued.membershipId;
      memberNumber = issued.memberNumber;

      audit.push({
        action: "membership.issue",
        entityType: "membership",
        entityId: issued.membershipId,
        after: {
          personId: application.personId,
          memberNumber: issued.memberNumber,
          status: "pending",
          applicationId: application.id,
        },
      });
    }

    if (effect.kind === "close_waitlist_entry") {
      await closeWaitlistEntry(tx, application.id, input.occurredAt, audit);
    }
  }

  /* Waitlisting is the one decision that ADDS to the queue rather than removing
     from it, and §3.1 is emphatic that the position is server-side. */
  if (transition.to === "waitlisted") {
    await addToWaitlist(tx, application.id, input.occurredAt, audit);
  }

  return applied(
    {
      applicationId: application.id,
      from: application.status,
      to: transition.to,
      membershipId,
      memberNumber,
      standing,
    },
    audit,
  );
}

/** The staff id the event carries, where it carries one. §3.1's `decided_by`. */
function decidedBy(event: ApplicationEvent): string | null {
  return event.type === "admit" && event.founderOverride
    ? event.founderOverride.staffUserId
    : null;
}

/* ============================================================================
   ONBOARDING — §11 M3: "onboarding"
   ========================================================================= */

type IssueResult =
  | { ok: true; membershipId: string; memberNumber: number }
  | { ok: false; code: string; message: string };

/**
 * Issue a membership for an admitted applicant.
 *
 * It starts `pending`, not `active`. §5: "pending → active (on payment)". The
 * club has admitted them; they have not yet paid, and a membership that went
 * live on admission would let someone shoot on a promise. `payment_received`
 * through applyMembershipEvent in memberships.ts is what activates it, and the
 * Paystack webhook (§9) is what calls that.
 *
 * `member_number` is deliberately NOT set here. §3.1 requires it "unique,
 * sequential, never reused" and 0002 attaches a Postgres sequence as the column
 * default for the reason recorded in that migration: MAX()+1 races, and a
 * reissued member number is a permanent ambiguity in the custody log. So the
 * insert omits the column and reads back what the sequence gave.
 */
async function issueMembership(
  tx: ArmoryTx,
  input: {
    personId: string;
    tierId: string | null;
    occurredAt: Date;
  },
): Promise<IssueResult> {
  if (!input.tierId) {
    /* §3.1 makes tier_id NOT NULL, and the capability service reads a
       membership without a tier as no membership — the member would be admitted
       and then blocked at the door for having no membership, which is the worst
       possible first visit. */
    return {
      ok: false,
      code: "NO_TIER",
      message:
        "This application names no tier. Choose the tier to admit them on before deciding.",
    };
  }

  /* Someone admitted twice. The transition guard prevents it from `admitted`,
     but a second application for the same person could reach here. */
  const [existing] = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      sql`${schema.memberships.personId} = ${input.personId}
          and ${schema.memberships.status} in ('pending', 'active', 'suspended')`,
    )
    .limit(1);

  if (existing) {
    return {
      ok: false,
      code: "ALREADY_A_MEMBER",
      message: "This person already holds a membership.",
    };
  }

  const membershipId = uuidv7();

  const [row] = await tx
    .insert(schema.memberships)
    .values({
      id: membershipId,
      personId: input.personId,
      tierId: input.tierId,
      status: "pending",
      startedOn: toDateColumn(input.occurredAt),
    })
    .returning({ memberNumber: schema.memberships.memberNumber });

  return {
    ok: true,
    membershipId,
    memberNumber: row.memberNumber,
  };
}

/* ============================================================================
   THE WAITLIST — §3.1: "position maintained server-side."
   ========================================================================= */

async function addToWaitlist(
  tx: ArmoryTx,
  applicationId: string,
  occurredAt: Date,
  audit: AuditDraft[],
): Promise<void> {
  const entries = await liveWaitlist(tx);
  const position = nextPosition(entries);

  await tx
    .insert(schema.waitlistEntries)
    .values({
      id: uuidv7(),
      applicationId,
      position,
      addedAt: occurredAt,
      status: "waiting",
    })
    .onConflictDoNothing({ target: schema.waitlistEntries.applicationId });

  audit.push({
    action: "waitlist.add",
    entityType: "application",
    entityId: applicationId,
    after: { position },
  });
}

/**
 * Close an entry and close the gap behind it.
 *
 * The renumber is the part that matters. A member told they are fourth who
 * watches two people ahead of them join and remains fourth has been told
 * something untrue — and §1.1 makes the waitlist the club's visible promise
 * about fairness.
 */
async function closeWaitlistEntry(
  tx: ArmoryTx,
  applicationId: string,
  occurredAt: Date,
  audit: AuditDraft[],
): Promise<void> {
  await tx
    .update(schema.waitlistEntries)
    .set({ status: "admitted", updatedAt: occurredAt })
    .where(eq(schema.waitlistEntries.applicationId, applicationId));

  const remaining = await liveWaitlist(tx);

  for (const entry of renumber(remaining)) {
    await tx
      .update(schema.waitlistEntries)
      .set({ position: entry.position, updatedAt: occurredAt })
      .where(eq(schema.waitlistEntries.id, entry.id));
  }

  audit.push({
    action: "waitlist.close",
    entityType: "application",
    entityId: applicationId,
    after: { remaining: remaining.length },
  });
}

async function liveWaitlist(tx: ArmoryTx) {
  const rows = await tx
    .select({
      id: schema.waitlistEntries.id,
      position: schema.waitlistEntries.position,
      addedAt: schema.waitlistEntries.addedAt,
    })
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.status, "waiting"));

  return rows;
}

/* ============================================================================
   THE ROSTER COUNT
   ========================================================================= */

/**
 * The roster as it stands, inside the caller's transaction.
 *
 * Reads only what the policy needs — status and whether the membership is
 * attached — rather than whole rows, because this runs on every admission
 * decision and the count is over the entire roster.
 */
export async function currentStanding(
  tx: ArmoryTx,
  policy: RosterPolicy,
): Promise<RosterStanding> {
  const rows = await tx
    .select({
      status: schema.memberships.status,
      isAttached: sql<boolean>`${schema.memberships.principalMembershipId} is not null`,
    })
    .from(schema.memberships)
    .where(
      inArray(schema.memberships.status, ["pending", "active", "suspended"]),
    );

  return rosterStanding(
    rows.map((row) => ({ status: row.status, isAttached: row.isAttached })),
    policy,
  );
}

/** §6.6: "Roster against cap with waitlist depth." */
export async function waitlistDepth(tx: ArmoryTx): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.status, "waiting"));

  return row?.count ?? 0;
}
