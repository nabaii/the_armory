import { and, eq, isNull, sql } from "drizzle-orm";
import type { ArmoryReader, ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  dueForErasure,
  mayErase,
  redactionFor,
  UNSET_RETENTION,
  type ErasureSubject,
  type RetentionPolicy,
} from "@/domain/erasure";
import { applied, refused, type Written } from "./record";

/**
 * ERASING A PERSON — §10's guest data requirement, §11 M10.
 *
 * The policy is in src/domain/erasure.ts and is tested there, including the
 * guard that fails if a column is ever added to `people` without a decision
 * about whether erasure clears it. This module assembles the facts that policy
 * needs and performs the write.
 *
 * ===========================================================================
 * THE WRITE IS ONE UPDATE, AND EVERYTHING ELSE IS LEFT ALONE
 *
 * No participation is touched, no custody event, no round, no waiver
 * signature. Most of them could not be touched — drizzle/0002 rejects UPDATE
 * and DELETE on the append-only tables — and the ones that could are left alone
 * on purpose: §3.4's log names a counterparty, and after this write that
 * counterparty is a person nobody can identify, which is the whole design.
 *
 * ===========================================================================
 * WHAT IS NOT ERASED, AND HAS TO BE ERASED SOMEWHERE ELSE
 *
 * `photo_url` and any licence `document_url` are cleared from the database
 * here. THE OBJECTS THEY POINT AT ARE NOT DELETED, because there is no object
 * storage configured yet (see docs/M10_security_review.md).
 *
 * That is a real gap and it is stated rather than hidden: after this runs, the
 * club's database holds no photograph URL and the bucket — when there is one —
 * still holds the photograph. Whoever wires up object storage owns closing it,
 * and `erasedObjectKeys` below returns exactly what they will need to delete so
 * the list does not have to be reconstructed later from a table that no longer
 * has the URLs in it.
 */

/* ============================================================================
   ASSEMBLING THE FACTS
   ========================================================================= */

/**
 * Everything `mayErase` needs, for one person.
 *
 * Five small queries rather than one join, because a join across memberships,
 * custody events, firearms, charges and participations multiplies rows and the
 * counts silently become products of each other. At one person per call the
 * round trips are free.
 */
export async function erasureSubject(
  tx: ArmoryReader,
  personId: string,
): Promise<ErasureSubject | null> {
  const [person] = await tx
    .select({
      id: schema.people.id,
      anonymisedAt: schema.people.anonymisedAt,
    })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  if (!person) return null;

  const [membership] = await tx
    .select({ status: schema.memberships.status })
    .from(schema.memberships)
    .where(eq(schema.memberships.personId, personId))
    .limit(1);

  /**
   * Firearms recorded as issued to them and not returned.
   *
   * Derived from the custody log rather than from `firearms.status`, and the
   * distinction matters: `status` says a firearm is issued, not to whom. §3.4
   * makes the log the sole source of truth for where a firearm is, and "where"
   * includes whose hands.
   *
   * The latest event per firearm decides. An `issued` event naming this person
   * that nothing later supersedes is a firearm still out to them.
   */
  const [outstanding] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(
      sql`(
        SELECT DISTINCT ON (ce.firearm_id)
               ce.firearm_id, ce.event_type, ce.counterparty_person_id
          FROM armory.custody_events ce
         ORDER BY ce.firearm_id, ce.occurred_at DESC, ce.recorded_at DESC
      ) AS latest`,
    )
    .where(
      sql`latest.event_type = 'issued' AND latest.counterparty_person_id = ${personId}`,
    );

  const [owned] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.firearms)
    .where(
      and(
        eq(schema.firearms.ownerPersonId, personId),
        /* A decommissioned firearm is not a live holding. */
        sql`${schema.firearms.status} <> 'decommissioned'`,
      ),
    );

  const [money] = await tx
    .select({
      outstandingKobo: sql<number>`COALESCE(SUM(${schema.charges.totalKobo}), 0)::int`,
    })
    .from(schema.charges)
    .where(
      and(
        eq(schema.charges.payerPersonId, personId),
        eq(schema.charges.isSettled, false),
      ),
    );

  const [visit] = await tx
    .select({ lastVisitAt: sql<Date | null>`MAX(${schema.participations.checkedInAt})` })
    .from(schema.participations)
    .where(eq(schema.participations.personId, personId));

  return {
    personId,
    membershipStatus: membership?.status ?? null,
    anonymisedAt: person.anonymisedAt,
    outstandingKobo: money?.outstandingKobo ?? 0,
    unreturnedFirearms: outstanding?.count ?? 0,
    lastVisitAt: visit?.lastVisitAt ? new Date(visit.lastVisitAt) : null,
    ownsRegisteredFirearm: (owned?.count ?? 0) > 0,
  };
}

/* ============================================================================
   THE WRITE
   ========================================================================= */

export type ErasureResult = {
  readonly personId: string;
  readonly alreadyErased: boolean;
  /**
   * Objects that still have to be deleted from storage. See the header.
   *
   * Empty until object storage exists. Returned rather than logged so the
   * caller can act on it the day it does.
   */
  readonly orphanedObjects: readonly string[];
};

export async function erasePerson(
  tx: ArmoryTx,
  input: {
    readonly personId: string;
    /** Why, in the founder's words. §3.6 — never silent. */
    readonly reason: string;
    readonly now: Date;
  },
): Promise<Written<ErasureResult>> {
  const reason = input.reason.trim();

  if (reason === "") {
    return refused({
      code: "ERASURE_NEEDS_REASON",
      message: "Say why this record is being erased.",
    });
  }

  const subject = await erasureSubject(tx, input.personId);

  if (!subject) {
    return refused({
      code: "NO_SUCH_PERSON",
      message: "That person is not on the club's records.",
    });
  }

  const decision = mayErase(subject);

  if (!decision.allowed) {
    return refused({
      code: decision.refusal.code,
      message: decision.refusal.remedy
        ? `${decision.refusal.message} ${decision.refusal.remedy}`
        : decision.refusal.message,
    });
  }

  if (decision.alreadyErased) {
    return applied({
      personId: input.personId,
      alreadyErased: true,
      orphanedObjects: [],
    });
  }

  /* Collected BEFORE the update, because the update is what destroys them. */
  const orphanedObjects = await erasedObjectKeys(tx, input.personId);

  const redaction = redactionFor(input.personId);

  await tx
    .update(schema.people)
    .set({
      ...redaction,
      anonymisedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.people.id, input.personId),
        /* Idempotent under concurrency: two simultaneous requests cannot each
           write a different `anonymised_at`, and the second changes nothing. */
        isNull(schema.people.anonymisedAt),
      ),
    );

  /**
   * Licence documents lose their URL too.
   *
   * §10 makes a licence scan the most restricted thing the club holds —
   * "readable only by the founder role" — so a person who has been erased must
   * not leave one addressable. The licence ROW stays, because a firearm on the
   * register references it and §3.4 forbids the register disagreeing with
   * itself.
   */
  await tx
    .update(schema.licences)
    .set({ documentUrl: null, updatedAt: input.now })
    .where(eq(schema.licences.personId, input.personId));

  return applied(
    {
      personId: input.personId,
      alreadyErased: false,
      orphanedObjects,
    },
    [
      {
        action: "person.erase",
        entityType: "person",
        entityId: input.personId,
        /**
         * The audit row records the ERASURE, and deliberately not the data.
         *
         * `audit_log` is append-only and cannot be redacted (drizzle/0002), so
         * a `before` containing the person's name and address would move the
         * data out of a table the club can erase and into one it never can —
         * an erasure that leaves a perfect copy behind, in the log that proves
         * the erasure happened.
         *
         * What is kept is what an audit needs: that it happened, when, why, and
         * enough about their standing to show the guards were satisfied.
         */
        before: {
          membershipStatus: subject.membershipStatus,
          outstandingKobo: subject.outstandingKobo,
          lastVisitAt: subject.lastVisitAt?.toISOString() ?? null,
        },
        after: { anonymisedAt: input.now.toISOString() },
        override: { reason },
      },
    ],
  );
}

/**
 * Object-storage keys this person's erasure orphans.
 *
 * Read before the redaction runs, because afterwards the URLs are gone and this
 * list could only be reconstructed from a backup — which is to say, not at all.
 *
 * Returns an empty list today: no object storage is configured, so `photo_url`
 * and `document_url` hold whatever a future integration puts there and are
 * currently null throughout. The function exists so that the day storage lands,
 * the erasure path already produces the list and nobody has to remember it was
 * missing.
 */
export async function erasedObjectKeys(
  tx: ArmoryReader,
  personId: string,
): Promise<string[]> {
  const [person] = await tx
    .select({ photoUrl: schema.people.photoUrl })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  const licences = await tx
    .select({ documentUrl: schema.licences.documentUrl })
    .from(schema.licences)
    .where(eq(schema.licences.personId, personId));

  return [
    person?.photoUrl,
    ...licences.map((licence) => licence.documentUrl),
  ].filter((value): value is string => typeof value === "string" && value !== "");
}

/* ============================================================================
   THE SWEEP — §10's retention position
   ========================================================================= */

/**
 * The club's retention policy, from `club_settings`.
 *
 * Null until counsel answers, and null means the sweep finds nobody. See
 * `dueForErasure`: an automatic erasure schedule nobody agreed is the one
 * mistake in this file that cannot be undone.
 */
export async function retentionPolicy(
  tx: ArmoryReader,
): Promise<RetentionPolicy> {
  const [settings] = await tx
    .select({ guestRetentionDays: schema.clubSettings.guestRetentionDays })
    .from(schema.clubSettings)
    .limit(1);

  return settings
    ? { guestRetentionDays: settings.guestRetentionDays }
    : UNSET_RETENTION;
}

/**
 * Everybody past the retention period, without erasing them.
 *
 * Reports, and does not act. §10 asks for the path to exist; it does not ask
 * for a job that quietly destroys records on a schedule, and the difference
 * matters while §14's answer is outstanding. A founder reads this list and
 * erases, or the club schedules `erasePerson` over it once counsel has signed
 * off on the period.
 *
 * The candidate set is people with no live membership. Everyone else is
 * excluded by `mayErase` anyway; narrowing the query first keeps the scan off
 * the whole roster.
 */
export async function dueForErasureReport(
  tx: ArmoryReader,
  now: Date,
): Promise<readonly ErasureSubject[]> {
  const policy = await retentionPolicy(tx);
  if (policy.guestRetentionDays === null) return [];

  const candidates = await tx
    .select({ id: schema.people.id })
    .from(schema.people)
    .leftJoin(
      schema.memberships,
      eq(schema.memberships.personId, schema.people.id),
    )
    .where(
      and(
        isNull(schema.people.anonymisedAt),
        sql`(${schema.memberships.status} IS NULL
             OR ${schema.memberships.status} IN ('lapsed', 'resigned'))`,
      ),
    );

  const subjects: ErasureSubject[] = [];

  for (const candidate of candidates) {
    const subject = await erasureSubject(tx, candidate.id);
    if (subject) subjects.push(subject);
  }

  return dueForErasure(subjects, policy, now);
}
