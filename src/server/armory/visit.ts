import { eq } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import { toDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { applyInvitationEvent, invitationForToken } from "./invitations";
import { createPerson } from "./people";
import { applied, refused, type Written } from "./record";
import { activeWaiverVersion, signWaiver } from "./waivers";

/**
 * COMPLETING A GUEST LINK — §6.3, the highest-stakes screen in the build.
 *
 *   "Acceptance: personal details, emergency contact, date of birth and a
 *    signed waiver, completed end to end in under two minutes on a mid-range
 *    Android over throttled 3G, with NO ACCOUNT CREATION AND NO PASSWORD."
 *
 * Four writes, one transaction:
 *
 *   1. the person record (§3.1 — a guest is a state of a person)
 *   2. their waiver signature (§3.1 — append-only)
 *   3. the invitation moves to `completed` (§5)
 *   4. the guest is attached to the host's booking as a `guest_shooter`
 *
 * Partial application is the specific failure to avoid: a person with no waiver
 * is someone the desk will refuse at the door having already taken their details
 * (§4 GUEST_MAY_ATTEND fails on `waiverMissing`), and an invitation marked
 * complete without a person behind it is a guest the club believes is coming and
 * cannot name.
 *
 * ===========================================================================
 * THE PERSON IS CREATED WITHOUT AN ACCOUNT, AND THAT IS THE POINT
 *
 * §6.3's "no account creation and no password" is not a convenience — it is the
 * conversion mechanism. §3.1 already makes it possible: "applicant, guest and
 * member are states, not separate tables", so a guest is a `people` row with no
 * membership. If they later apply (§6.2 "Sponsor an application"), the same row
 * gains a membership. Nothing migrates and no history is lost, which is what
 * makes §6.6's "guest-to-application conversion" measurable at all.
 *
 * ===========================================================================
 * WHY THE INVITATION IS RE-READ INSIDE THE TRANSACTION
 *
 * The page resolved the token to render the form. Between that render and this
 * submission the host may have cancelled, or the link may have expired — on a
 * 3G connection that gap is minutes, not milliseconds. Re-reading here means the
 * check that matters happens against the same snapshot as the write.
 */

export type VisitDetails = {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly dateOfBirth: Date;
  readonly emergencyContactName: string;
  readonly emergencyContactPhone: string;
};

export type VisitResult = {
  readonly personId: string;
  readonly invitationId: string;
};

/** The youngest the club will register without treating it as a special case. */
const MINIMUM_AGE_YEARS = 18;

export async function completeVisit(
  tx: ArmoryTx,
  input: {
    readonly token: string;
    readonly details: VisitDetails;
    readonly now: Date;
    /** Client-generated, so a resubmission on a bad connection is one person. */
    readonly personId: string;
    readonly signatureId: string;
  },
): Promise<Written<VisitResult>> {
  const invitation = await invitationForToken(tx, input.token);

  if (!invitation) {
    return refused({
      code: "NO_SUCH_INVITATION",
      message: "This link is not one the club recognises.",
    });
  }

  if (invitation.expiresAt <= input.now) {
    return refused({
      code: "INVITATION_EXPIRED",
      message: `This link has expired. Ask ${invitation.hostName} to send you another.`,
    });
  }

  if (invitation.status === "cancelled") {
    return refused({
      code: "INVITATION_CANCELLED",
      message: `${invitation.hostName} cancelled this visit.`,
    });
  }

  if (invitation.status === "attended") {
    return refused({
      code: "ALREADY_ATTENDED",
      message: "You have already visited on this invitation.",
    });
  }

  const age = yearsBetween(input.details.dateOfBirth, input.now);
  if (age < MINIMUM_AGE_YEARS) {
    /* Checked here rather than only in the browser, because this is the one
       fact on the form that the club's licence depends on and the browser is
       the guest's. The sentence names the rule rather than the field, so
       somebody entering a parent's booking is not left guessing. */
    return refused({
      code: "UNDER_AGE",
      message: `Shooters must be ${MINIMUM_AGE_YEARS} or over. Call the club if you are booking for someone else.`,
    });
  }

  /* ------------------------------------------------------------------ PERSON */

  const person = await createPerson(tx, {
    id: invitation.guestPersonId ?? input.personId,
    firstName: input.details.firstName,
    lastName: input.details.lastName,
    phone: input.details.phone,
    email: input.details.email,
    dateOfBirth: input.details.dateOfBirth,
    address: null,
    emergencyContactName: input.details.emergencyContactName,
    emergencyContactPhone: input.details.emergencyContactPhone,
  });

  if (person.outcome === "refused") return person as Written<VisitResult>;

  const personId = person.result.personId;

  /* A guest who has visited before is already on file, and §3.2's
     `guest_visit_summary` counts "across all hosts, not per host" precisely so
     that person is recognisable. `createPerson` is idempotent on the id, so a
     returning guest whose phone already exists lands on their existing row —
     and the details they just typed do not overwrite it, because the club's
     record of a person is not edited by whoever holds a link to them. */

  await tx
    .update(schema.guestInvitations)
    .set({ guestPersonId: personId })
    .where(eq(schema.guestInvitations.id, invitation.invitationId));

  /* ------------------------------------------------------------------ WAIVER */

  const active = await activeWaiverVersion(tx);
  if (!active) {
    return refused({
      code: "NO_ACTIVE_WAIVER",
      message:
        "The club has not published its waiver yet. Call the club — they will sort this out at the door.",
    });
  }

  const signature = await signWaiver(tx, {
    id: input.signatureId,
    personId,
    waiverVersionId: active.id,
    signatureImageUrl: null,
    signedAt: input.now,
    deviceId: null,
  });

  if (signature.outcome === "refused") return signature as Written<VisitResult>;

  /* -------------------------------------------------------------- INVITATION */

  const completed = await applyInvitationEvent(tx, {
    invitationId: invitation.invitationId,
    event: { type: "complete" },
    occurredAt: input.now,
  });

  if (completed.outcome === "refused") return completed as Written<VisitResult>;

  /* ------------------------------------------------------------- PARTICIPANT */

  if (invitation.bookingId) {
    /* §3.3: "Every guest_shooter must carry a guest_invitation_id." Written
       here rather than when the host named them, because until now there was no
       person to attach — the host invited a phone number, not a record. */
    await tx
      .insert(schema.bookingParticipants)
      .values({
        id: uuidv7(),
        bookingId: invitation.bookingId,
        personId,
        role: "guest_shooter",
        guestInvitationId: invitation.invitationId,
      })
      .onConflictDoNothing();
  }

  return applied(
    { personId, invitationId: invitation.invitationId },
    [
      {
        action: "visit.complete",
        entityType: "guest_invitation",
        entityId: invitation.invitationId,
        after: {
          personId,
          bookingId: invitation.bookingId,
          waiverVersionId: active.id,
          dateOfBirth: toDateColumn(input.details.dateOfBirth),
        },
      },
    ],
  );
}

/** Whole years between two dates. */
function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const month = to.getUTCMonth() - from.getUTCMonth();
  if (month < 0 || (month === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years;
}
