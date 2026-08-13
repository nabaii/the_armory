import { eq } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type Written } from "./record";

/**
 * QUALIFICATIONS — the club's competency record (§3.1).
 *
 *   "Club competency. Distinct from licences."
 *
 * The schema states the distinction and it is the reason this is a separate
 * module rather than a column on `licences`: "A licence is the state's
 * permission to own a firearm. A qualification is the club's judgement that this
 * person may shoot this discipline unsupervised. They expire independently and
 * gate different capabilities — conflating them would let a licence renewal
 * silently re-grant a competency nobody reassessed."
 *
 * ===========================================================================
 * WHY THERE IS NO REVOKE
 *
 * §5 gives licences a state machine and gives qualifications none, and that
 * asymmetry is real rather than an omission. A licence is a document with
 * states the state assigns. A qualification is an assessment: it happened, on a
 * date, by a named officer, and it either has run out or it has not.
 *
 * So a qualification is not transitioned — it is superseded. Reassessing writes
 * a NEW row, and `qualificationBlock` in src/domain/capability/index.ts already
 * reads them as a set, taking any live one as sufficient and reporting the
 * longest-lasting expired one when none is live. Withdrawing a competency is
 * `expiresAt` set to now, which leaves the original assessment standing as the
 * historical fact it is.
 *
 * That matches §1.2 rule 3's shape — nothing is edited, a correction is a new
 * row — without needing the append-only trigger, because nothing here is ever
 * usefully updated in the first place.
 */

export type QualificationResult = {
  readonly qualificationId: string;
  readonly personId: string;
  readonly discipline: string;
};

export async function recordQualification(
  tx: ArmoryTx,
  draft: {
    readonly id?: string;
    readonly personId: string;
    readonly discipline: string;
    readonly level: string;
    /** §10: a named person. The whole value of the record is who judged. */
    readonly assessedByStaffId: string;
    readonly assessedAt: Date;
    readonly expiresAt: Date | null;
  },
): Promise<Written<QualificationResult>> {
  if (draft.expiresAt && draft.expiresAt <= draft.assessedAt) {
    return refused({
      code: "EXPIRES_BEFORE_ASSESSMENT",
      message: "That expiry falls on or before the assessment date.",
    });
  }

  const qualificationId = draft.id ?? uuidv7();

  const inserted = await tx
    .insert(schema.qualifications)
    .values({
      id: qualificationId,
      personId: draft.personId,
      discipline: draft.discipline,
      level: draft.level,
      assessedByStaffId: draft.assessedByStaffId,
      assessedAt: draft.assessedAt,
      expiresAt: draft.expiresAt,
    })
    .onConflictDoNothing({ target: schema.qualifications.id })
    .returning({ id: schema.qualifications.id });

  const result = {
    qualificationId,
    personId: draft.personId,
    discipline: draft.discipline,
  };

  if (inserted.length === 0) return applied(result);

  return applied(result, [
    {
      action: "qualification.record",
      entityType: "qualification",
      entityId: qualificationId,
      after: {
        personId: draft.personId,
        discipline: draft.discipline,
        level: draft.level,
        assessedByStaffId: draft.assessedByStaffId,
        expiresAt: draft.expiresAt?.toISOString() ?? null,
      },
    },
  ]);
}

/**
 * Withdraw a competency by ending it now.
 *
 * Not a delete and not a status change — see the header. The assessment stays on
 * file as something that happened; what changes is that it no longer covers
 * today. An officer who withdraws a sign-off owes a reason, and §3.6 treats that
 * as an override because it takes a capability away from a member who had it.
 */
export async function withdrawQualification(
  tx: ArmoryTx,
  input: {
    readonly qualificationId: string;
    readonly reason: string;
    readonly occurredAt: Date;
  },
): Promise<Written<{ readonly qualificationId: string }>> {
  const [qualification] = await tx
    .select({
      id: schema.qualifications.id,
      personId: schema.qualifications.personId,
      discipline: schema.qualifications.discipline,
      expiresAt: schema.qualifications.expiresAt,
    })
    .from(schema.qualifications)
    .where(eq(schema.qualifications.id, input.qualificationId))
    .limit(1);

  if (!qualification) {
    return refused({
      code: "NO_SUCH_QUALIFICATION",
      message: "That sign-off is not on file.",
    });
  }

  if (input.reason.trim().length < 12) {
    /* The same bar as `applyOverride` in src/domain/capability/index.ts, and for
       the same stated reason: "a mandatory field that accepts 'ok' is not
       mandatory." */
    return refused({
      code: "REASON_TOO_SHORT",
      message:
        "Withdrawing a sign-off needs a reason a founder can read tomorrow morning and understand without asking anyone.",
    });
  }

  if (qualification.expiresAt && qualification.expiresAt <= input.occurredAt) {
    return applied({ qualificationId: qualification.id });
  }

  await tx
    .update(schema.qualifications)
    .set({ expiresAt: input.occurredAt, updatedAt: input.occurredAt })
    .where(eq(schema.qualifications.id, qualification.id));

  return applied({ qualificationId: qualification.id }, [
    {
      action: "qualification.withdraw",
      entityType: "qualification",
      entityId: qualification.id,
      before: {
        expiresAt: qualification.expiresAt?.toISOString() ?? null,
        discipline: qualification.discipline,
      },
      after: { expiresAt: input.occurredAt.toISOString() },
      override: { reason: input.reason.trim() },
    },
  ]);
}
