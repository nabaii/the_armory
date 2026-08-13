import { eq } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import { toDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type Written } from "./record";

/**
 * PEOPLE — one row per human (§3.1).
 *
 *   "applicant, guest and member are states, not separate tables. This is the
 *    single most consequential shape decision in the model."
 *
 * Which means this module is small on purpose. There is no `createMember` and no
 * `convertGuest`: admission changes what rows point AT a person, and never moves
 * the person. A guest who joins is the same row with a membership attached.
 *
 * ===========================================================================
 * WHAT IS NOT HERE
 *
 * Walk-in enrolment. §6.4 is explicit: "Explicitly not present: walk-in
 * enrolment. There is no path at the desk to create a person who was not
 * authorised in advance. If an officer needs one, the answer is a booking, not
 * a form."
 *
 * So `createPerson` exists for the portal and the guest link — surfaces where
 * someone enters their OWN data before arrival (§1.2 rule 1) — and the desk
 * never calls it. That is a property of which surfaces import this module, and
 * it is the reason there is no person-creation operation in
 * src/sync/contract.ts for the outbox to carry.
 */

export type PersonDraft = {
  readonly id?: string;
  readonly firstName: string;
  readonly lastName: string;
  /** E.164. The account identifier — §3.1 makes the phone unique, not the email. */
  readonly phone: string;
  readonly email: string | null;
  readonly dateOfBirth: Date | null;
  readonly address: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
};

export async function createPerson(
  tx: ArmoryTx,
  draft: PersonDraft,
): Promise<Written<{ readonly personId: string; readonly created: boolean }>> {
  const phone = draft.phone.trim();

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    /* §3.1: "phone unique, E.164." Checked here rather than trusted from a form
       because this column is the account identifier and the OTP destination —
       a number stored in local format is a person who can never sign in, and
       the failure appears weeks later at the worst moment. */
    return refused({
      code: "PHONE_NOT_E164",
      message:
        "That phone number needs its country code, like +234 801 234 5678.",
    });
  }

  const personId = draft.id ?? uuidv7();

  const inserted = await tx
    .insert(schema.people)
    .values({
      id: personId,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      phone,
      email: draft.email?.trim() || null,
      dateOfBirth: draft.dateOfBirth ? toDateColumn(draft.dateOfBirth) : null,
      address: draft.address,
      emergencyContactName: draft.emergencyContactName,
      emergencyContactPhone: draft.emergencyContactPhone,
    })
    .onConflictDoNothing({ target: schema.people.id })
    .returning({ id: schema.people.id });

  if (inserted.length === 0) {
    /* Replayed (§7). The id is the client's, so this is the same person, not a
       collision — and returning the id rather than an error is what lets a guest
       who taps "submit" twice on a bad connection reach the same record. */
    return applied({ personId, created: false });
  }

  return applied({ personId, created: true }, [
    {
      action: "person.create",
      entityType: "person",
      entityId: personId,
      after: { firstName: draft.firstName, lastName: draft.lastName },
      /* Phone, address, date of birth and emergency contact are deliberately
         not audited. §10 calls this "a concentration of sensitive personal
         data"; copying it into an append-only table that can never be corrected
         or erased would put it permanently beyond the reach of the deletion
         path the same section requires. The audit records THAT a person was
         created and by whom, which is what an audit is for. */
    },
  ]);
}

/* ============================================================================
   §10 — "A guest who does not join has provided data for a single visit. A
   defined retention position is required from counsel; build the deletion path
   now."
   ========================================================================= */

/**
 * Erase a person's identifying data in place.
 *
 * Anonymisation rather than DELETE, and the schema comment on `anonymisedAt`
 * says why: "participations, custody events and incidents reference it and those
 * are append-only by law and by §3." A row that a regulator may ask about cannot
 * be removed to satisfy a retention policy, so the identity is emptied and the
 * skeleton stays.
 *
 * What survives is deliberate: the person id, so the custody log still resolves;
 * the fact and time of erasure; and nothing else. What goes is everything §10
 * lists as sensitive — name, phone, email, date of birth, address, emergency
 * contact, photograph.
 *
 * §14 records the retention POSITION as still open with counsel. This is the
 * mechanism, not the policy: how long before this runs, and against whom, is
 * the club's decision to make and this function's caller to schedule.
 */
export async function anonymisePerson(
  tx: ArmoryTx,
  input: { readonly personId: string; readonly occurredAt: Date },
): Promise<Written<{ readonly personId: string }>> {
  const [person] = await tx
    .select({
      id: schema.people.id,
      anonymisedAt: schema.people.anonymisedAt,
    })
    .from(schema.people)
    .where(eq(schema.people.id, input.personId))
    .limit(1);

  if (!person) {
    return refused({
      code: "NO_SUCH_PERSON",
      message: "That person is not on file.",
    });
  }

  if (person.anonymisedAt) {
    return applied({ personId: person.id });
  }

  const [membership] = await tx
    .select({ id: schema.memberships.id, status: schema.memberships.status })
    .from(schema.memberships)
    .where(eq(schema.memberships.personId, person.id))
    .limit(1);

  /* A member is not a guest who did not join, and erasing one would leave the
     club unable to name the holder of a live membership — or of a firearm on
     the register. §10's retention question is about the guest who visited once;
     it is not a licence to empty the roster. */
  if (membership && membership.status !== "resigned") {
    return refused({
      code: "HAS_LIVE_MEMBERSHIP",
      message:
        "This person holds a membership. End the membership first; a live member's record is not erased.",
    });
  }

  await tx
    .update(schema.people)
    .set({
      firstName: "Erased",
      lastName: "Record",
      /* The phone column is unique and NOT NULL, so it cannot simply be emptied
         — two erased people would collide. The id is already unique and is not
         itself identifying once the rest is gone. */
      phone: `erased:${person.id}`,
      email: null,
      dateOfBirth: null,
      photoUrl: null,
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      notes: null,
      anonymisedAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    .where(eq(schema.people.id, person.id));

  return applied({ personId: person.id }, [
    {
      action: "person.anonymise",
      entityType: "person",
      entityId: person.id,
      /* No `before`. Recording what was erased, in an append-only table, would
         defeat the erasure — and audit_log is one of the tables §3.6 makes
         permanently immutable. */
      after: { anonymisedAt: input.occurredAt.toISOString() },
    },
  ]);
}
