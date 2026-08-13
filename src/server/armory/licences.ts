import { and, eq, lt } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { LicenceStatus } from "@/domain/enums";
import { licenceTransition, type LicenceEvent } from "@/domain/state-machines";
import { toDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type AuditDraft, type Written } from "./record";

/**
 * LICENCES — §5's transitions, and the expiry M2 is named for.
 *
 *   §5:   "pending_review → verified → expired (by date) | revoked (staff
 *          action). Capability is live only while verified and unexpired."
 *   §3.1: "Capability activates only on verified."
 *
 * ===========================================================================
 * THE ONE THING THIS MODULE MUST NOT DO
 *
 * It must not be what decides whether a licence is live.
 *
 * `isLicenceLive` in src/domain/state-machines.ts already answers that, and the
 * capability service calls it rather than reading the status column, for the
 * reason stated there: "it is maintained by a sweep, and between the expiry date
 * and the sweep running the column says `verified` while the licence is not."
 *
 * So `expireOverdueLicences` below is bookkeeping, not enforcement. If it never
 * ran, a member with a licence that expired yesterday would still be refused
 * their own firearm at the desk — correctly, with the right sentence, offline,
 * because the desk compares the date. What the sweep buys is that the COLUMN
 * agrees with the clock, which is what the founder's expiry report (§6.6) and
 * every export read.
 *
 * Stating it the other way round, because it is the failure mode worth naming:
 * if enforcement depended on the sweep, a cron job that silently stopped would
 * quietly re-arm every expired licence in the club, and nothing would look
 * wrong until an audit.
 *
 * ===========================================================================
 * §10 AND THE DOCUMENT
 *
 * "Licence scans readable only by the founder role. Not by range officers. Not
 * on the desk or lane surfaces."
 *
 * `documentUrl` is written here and is deliberately absent from every read this
 * file offers, from `LicenceRow` in src/server/rows.ts, and therefore from the
 * day pack. A desk that never receives the key cannot leak it, which is a
 * stronger guarantee than a desk that receives it and is trusted not to render
 * it.
 */

export type LicenceResult = {
  readonly licenceId: string;
  readonly from: LicenceStatus;
  readonly to: LicenceStatus;
};

/* ============================================================================
   RECORDING A LICENCE — §6.2 "My documents: licence upload with expiry and
   verification state."
   ========================================================================= */

export type LicenceDraft = {
  readonly id?: string;
  readonly personId: string;
  readonly licenceNumber: string;
  readonly issuingAuthority: string;
  readonly calibres: readonly string[];
  readonly issuedOn: Date | null;
  readonly expiresOn: Date | null;
  /** Object storage key. Never a public URL (§10). */
  readonly documentUrl: string | null;
};

/**
 * Record a licence a member has uploaded.
 *
 * It lands as `pending_review` and grants nothing until an officer verifies it.
 * That is §3.1's rule and it is the entire point of the state: the club has been
 * SENT a document, which is not the same as someone having looked at it.
 *
 * The id is accepted from the caller so the portal can generate a UUIDv7 before
 * the upload and replay it safely (§7). It defaults here rather than being
 * required, because a licence recorded by an officer at a desk has no prior id
 * to carry.
 */
export async function recordLicence(
  tx: ArmoryTx,
  draft: LicenceDraft,
): Promise<Written<{ readonly licenceId: string }>> {
  if (draft.calibres.length === 0) {
    /* A licence covering no calibres would verify cleanly and then refuse every
       firearm the member owns, with `calibreOutsideLicence` — a sentence that
       sends them to the wrong problem entirely. */
    return refused({
      code: "NO_CALIBRES",
      message:
        "A licence needs at least one calibre listed, exactly as it appears on the document.",
    });
  }

  if (draft.expiresOn && draft.issuedOn && draft.expiresOn <= draft.issuedOn) {
    return refused({
      code: "EXPIRES_BEFORE_ISSUE",
      message: "That expiry date falls on or before the date of issue.",
    });
  }

  const licenceId = draft.id ?? uuidv7();

  const inserted = await tx
    .insert(schema.licences)
    .values({
      id: licenceId,
      personId: draft.personId,
      licenceNumber: draft.licenceNumber,
      issuingAuthority: draft.issuingAuthority,
      calibres: [...draft.calibres],
      issuedOn: draft.issuedOn ? toDateColumn(draft.issuedOn) : null,
      expiresOn: draft.expiresOn ? toDateColumn(draft.expiresOn) : null,
      documentUrl: draft.documentUrl,
      status: "pending_review",
    })
    /* §7. The caller's id is the idempotency, exactly as it is on the
       append-only path — a replayed upload is the same licence, not a second
       one that would trip the unique index on licence_number. */
    .onConflictDoNothing({ target: schema.licences.id })
    .returning({ id: schema.licences.id });

  if (inserted.length === 0) {
    return applied({ licenceId });
  }

  return applied({ licenceId }, [
    {
      action: "licence.record",
      entityType: "licence",
      entityId: licenceId,
      after: {
        personId: draft.personId,
        licenceNumber: draft.licenceNumber,
        status: "pending_review",
        expiresOn: draft.expiresOn ? toDateColumn(draft.expiresOn) : null,
        /* documentUrl is not audited. §10 keeps the key to the founder role and
           the audit log is read on the dashboard; there is no reason for a
           storage key to travel further than the column it lives in. */
      },
    },
  ]);
}

/* ============================================================================
   TRANSITIONS — verify, revoke, expire
   ========================================================================= */

export async function applyLicenceEvent(
  tx: ArmoryTx,
  input: {
    readonly licenceId: string;
    readonly event: LicenceEvent;
    readonly occurredAt: Date;
  },
): Promise<Written<LicenceResult>> {
  const [licence] = await tx
    .select({
      id: schema.licences.id,
      personId: schema.licences.personId,
      status: schema.licences.status,
      expiresOn: schema.licences.expiresOn,
    })
    .from(schema.licences)
    .where(eq(schema.licences.id, input.licenceId))
    .limit(1);

  if (!licence) {
    return refused({
      code: "NO_SUCH_LICENCE",
      message: "That licence is not on file.",
    });
  }

  const transition = licenceTransition(licence.status, input.event);

  if (!transition.ok) {
    return refused({ code: transition.code, message: transition.message }, [
      {
        action: `licence.${input.event.type}`,
        entityType: "licence",
        entityId: licence.id,
        before: { status: licence.status },
      },
    ]);
  }

  /* Verifying a licence that has already run out would set `verified` on a
     document the clock has overtaken. The sweep would correct it on its next
     run, but between those two moments the column would say the member may
     shoot their own firearm — and an officer reading the screen would believe
     it, because §3.1 told them verified means live. The guard belongs here
     rather than in the pure transition, which has no clock by design. */
  if (
    input.event.type === "verify" &&
    licence.expiresOn &&
    licence.expiresOn < toDateColumn(input.occurredAt)
  ) {
    return refused(
      {
        code: "ALREADY_EXPIRED",
        message: `That licence expired on ${licence.expiresOn}. Record the renewal instead.`,
      },
      [
        {
          action: "licence.verify",
          entityType: "licence",
          entityId: licence.id,
          before: { status: licence.status, expiresOn: licence.expiresOn },
        },
      ],
    );
  }

  await tx
    .update(schema.licences)
    .set({
      status: transition.to,
      updatedAt: input.occurredAt,
      ...(input.event.type === "verify"
        ? {
            verifiedByStaffId: input.event.staffUserId,
            verifiedAt: input.occurredAt,
          }
        : {}),
    })
    .where(eq(schema.licences.id, licence.id));

  return applied(
    { licenceId: licence.id, from: licence.status, to: transition.to },
    [
      {
        action: `licence.${input.event.type}`,
        entityType: "licence",
        entityId: licence.id,
        before: { status: licence.status },
        after: { status: transition.to, personId: licence.personId },
        ...(input.event.type === "revoke"
          ? { override: { reason: input.event.reason } }
          : {}),
      },
    ],
  );
}

/* ============================================================================
   THE SWEEP — §5: "expired (by date)"
   ========================================================================= */

/**
 * Move every verified licence whose expiry has passed to `expired`.
 *
 * Bookkeeping, not enforcement — see the header. `staffUserId` on the envelope's
 * attribution is null for this operation and that is the one place in the system
 * where null is permanently correct: §10 wants every staff action attributable
 * to a named person, and no person performs the passage of time. Naming the
 * founder here would be a false attribution in the column that exists to prevent
 * exactly that.
 */
export async function expireOverdueLicences(
  tx: ArmoryTx,
  now: Date,
): Promise<Written<{ readonly expired: readonly string[] }>> {
  const today = toDateColumn(now);

  const due = await tx
    .select({
      id: schema.licences.id,
      personId: schema.licences.personId,
      status: schema.licences.status,
      expiresOn: schema.licences.expiresOn,
    })
    .from(schema.licences)
    .where(
      and(
        eq(schema.licences.status, "verified"),
        lt(schema.licences.expiresOn, today),
      ),
    );

  const expired: string[] = [];
  const audit: AuditDraft[] = [];

  for (const licence of due) {
    const transition = licenceTransition(licence.status, { type: "expire" });
    if (!transition.ok) continue;

    await tx
      .update(schema.licences)
      .set({ status: transition.to, updatedAt: now })
      .where(eq(schema.licences.id, licence.id));

    audit.push({
      action: "licence.expire",
      entityType: "licence",
      entityId: licence.id,
      before: { status: licence.status, expiresOn: licence.expiresOn },
      after: { status: transition.to, personId: licence.personId },
    });

    expired.push(licence.id);
  }

  return applied({ expired }, audit);
}
