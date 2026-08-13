import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type Written } from "./record";

/**
 * WAIVERS — versioning and signature.
 *
 *   §3.1 waiver_versions:   "Exactly one active version at a time."
 *   §3.1 waiver_signatures: "APPEND-ONLY. No update, no delete. A resignature
 *                            is a new row."
 *
 * ===========================================================================
 * PUBLISHING A VERSION IS THE MOST DISRUPTIVE WRITE IN THE SYSTEM
 *
 * This is worth stating loudly because nothing in the schema hints at it.
 *
 * The capability service treats a signature against any version other than the
 * active one as `waiverSuperseded` — see src/domain/capability/index.ts, which
 * says plainly: "signing version 3 does not accept version 4." So the moment a
 * new version becomes active, EVERY MEMBER OF THE CLUB is blocked at the desk
 * until they sign again. One UPDATE, and tomorrow morning every arrival fails
 * §4's MAY_ATTEND.
 *
 * That is the correct behaviour — it is what a waiver is for, and a club that
 * silently honoured signatures against superseded terms would have no usable
 * evidence of anything. But it must never be a surprise, so `publishWaiverVersion`
 * refuses to be called blind: it counts who it is about to block and returns
 * that number, and the count goes into the audit row. §4.3's rule that a member
 * must never first learn of a problem at the desk cannot be honoured by a club
 * that did not itself know.
 *
 * The one-active rule is enforced underneath all of this by the partial unique
 * index `waiver_versions_one_active` in drizzle/0002. The deactivate-then-
 * activate below is ordered to satisfy it rather than to fight it, and both
 * statements are in the caller's transaction — a half-applied publish would
 * leave the club with either no active waiver or two.
 */

/* ============================================================================
   PUBLISHING
   ========================================================================= */

export type PublishResult = {
  readonly waiverVersionId: string;
  readonly version: string;
  readonly supersededVersionId: string | null;
  /**
   * How many people held a current signature a moment ago and now do not.
   * Every one of them is blocked at the desk until they sign again.
   */
  readonly signaturesSuperseded: number;
};

export async function publishWaiverVersion(
  tx: ArmoryTx,
  draft: {
    readonly id?: string;
    readonly version: string;
    readonly body: string;
    readonly effectiveFrom: Date;
    /**
     * The caller's acknowledgement of how many members this will block. It must
     * match what the count actually is, so a publish written against a stale
     * preview refuses rather than surprising the club by an order of magnitude.
     * Null skips the check — for the first version, when there is nobody to
     * block and no preview to have taken.
     */
    readonly acknowledgedImpact: number | null;
  },
): Promise<Written<PublishResult>> {
  if (draft.body.trim().length === 0) {
    return refused({
      code: "EMPTY_BODY",
      message: "A waiver version needs its text. This is the document people sign.",
    });
  }

  const [current] = await tx
    .select({
      id: schema.waiverVersions.id,
      version: schema.waiverVersions.version,
    })
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.isActive, true))
    .limit(1);

  const impact = current ? await countCurrentSignatories(tx, current.id) : 0;

  if (draft.acknowledgedImpact !== null && draft.acknowledgedImpact !== impact) {
    return refused({
      code: "IMPACT_CHANGED",
      message:
        `This will supersede ${impact} current signature${impact === 1 ? "" : "s"}, ` +
        `not ${draft.acknowledgedImpact}. Every one of those members must sign again ` +
        "before they can be checked in. Review and publish again.",
    });
  }

  const waiverVersionId = draft.id ?? uuidv7();

  /* Deactivate first. The partial unique index permits exactly one row with
     is_active = true, so activating before deactivating would collide — and
     inside a transaction that collision is a rollback of the whole publish. */
  if (current) {
    await tx
      .update(schema.waiverVersions)
      .set({ isActive: false, updatedAt: draft.effectiveFrom })
      .where(eq(schema.waiverVersions.id, current.id));
  }

  const inserted = await tx
    .insert(schema.waiverVersions)
    .values({
      id: waiverVersionId,
      version: draft.version,
      body: draft.body,
      effectiveFrom: draft.effectiveFrom,
      isActive: true,
    })
    .onConflictDoNothing({ target: schema.waiverVersions.id })
    .returning({ id: schema.waiverVersions.id });

  if (inserted.length === 0) {
    return refused({
      code: "ALREADY_PUBLISHED",
      message: "That waiver version has already been published.",
    });
  }

  return applied(
    {
      waiverVersionId,
      version: draft.version,
      supersededVersionId: current?.id ?? null,
      signaturesSuperseded: impact,
    },
    [
      {
        action: "waiver.publish",
        entityType: "waiver_version",
        entityId: waiverVersionId,
        before: current ? { version: current.version, id: current.id } : null,
        after: {
          version: draft.version,
          signaturesSuperseded: impact,
        },
      },
    ],
  );
}

/**
 * How many distinct people hold a signature against this version.
 *
 * Distinct people, not rows: a resignature is a new row (§3.1), so someone who
 * has signed the same version twice is one member to warn, not two.
 */
async function countCurrentSignatories(
  tx: ArmoryTx,
  waiverVersionId: string,
): Promise<number> {
  const [row] = await tx
    .select({
      count: sql<number>`count(distinct ${schema.waiverSignatures.personId})::int`,
    })
    .from(schema.waiverSignatures)
    .where(eq(schema.waiverSignatures.waiverVersionId, waiverVersionId));

  return row?.count ?? 0;
}

/**
 * The active version, for the capability service's `WaiverContext`.
 *
 * Returns null when the club has never published one, and the callers treat
 * that as "no waiver required" rather than "everybody blocked" — consistent
 * with `waiverValidityDays: null` failing open in
 * src/domain/capability/index.ts, and for the same reason: refusing every member
 * at the door over a document the club has not written is a worse failure than
 * admitting them under terms nobody has drafted yet.
 */
export async function activeWaiverVersion(
  tx: ArmoryTx,
): Promise<{ id: string; version: string } | null> {
  const [row] = await tx
    .select({
      id: schema.waiverVersions.id,
      version: schema.waiverVersions.version,
    })
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.isActive, true))
    .limit(1);

  return row ?? null;
}

/* ============================================================================
   SIGNING — append-only (§3.1)
   ========================================================================= */

export type SignatureResult = {
  readonly signatureId: string;
  readonly waiverVersionId: string;
  readonly created: boolean;
};

/**
 * Record a signature.
 *
 * Server-originated: this is the portal's "My documents" path and, from M4, the
 * guest link (§6.3). The desk's offline path writes the identical row through
 * the outbox — `waiver_signatures.sign` in src/sync/operations.ts — because a
 * waiver signed on a tablet with no network must not wait for a server.
 *
 * Both paths are idempotent the same way and it is the way §8.2 prescribes for
 * this class: the row's primary key is the client-generated UUIDv7, so a replay
 * is an upsert that changes nothing. No receipt is needed and none is taken.
 */
export async function signWaiver(
  tx: ArmoryTx,
  input: {
    readonly id: string;
    readonly personId: string;
    readonly waiverVersionId: string;
    readonly signatureImageUrl: string | null;
    readonly signedAt: Date;
    readonly deviceId: string | null;
  },
): Promise<Written<SignatureResult>> {
  const active = await activeWaiverVersion(tx);

  if (!active) {
    return refused({
      code: "NO_ACTIVE_WAIVER",
      message: "The club has not published a waiver to sign.",
    });
  }

  /* Signing anything but the active version produces a row that grants nothing
     — the capability service would read it as `waiverSuperseded` the moment it
     was written. Refusing is kinder than accepting a signature that will fail
     silently at the desk tomorrow, in front of a guest.

     The realistic cause is a stale screen: a member opened the waiver, the
     founder published a new version, and the member signed the one they were
     shown. The remedy is to reload, so the message says so. */
  if (input.waiverVersionId !== active.id) {
    return refused({
      code: "WAIVER_SUPERSEDED",
      message:
        `The club is now on waiver version ${active.version}. Reload and sign that one — ` +
        "the version on your screen has been replaced.",
    });
  }

  const inserted = await tx
    .insert(schema.waiverSignatures)
    .values({
      id: input.id,
      personId: input.personId,
      waiverVersionId: input.waiverVersionId,
      signatureImageUrl: input.signatureImageUrl,
      signedAt: input.signedAt,
      deviceId: input.deviceId,
    })
    .onConflictDoNothing({ target: schema.waiverSignatures.id })
    .returning({ id: schema.waiverSignatures.id });

  const created = inserted.length > 0;

  return applied(
    {
      signatureId: input.id,
      waiverVersionId: input.waiverVersionId,
      created,
    },
    created
      ? [
          {
            action: "waiver.sign",
            entityType: "waiver_signature",
            entityId: input.id,
            after: {
              personId: input.personId,
              waiverVersionId: input.waiverVersionId,
              signedAt: input.signedAt.toISOString(),
            },
          },
        ]
      : [],
  );
}

/**
 * Whether this person's most recent signature accepts the active version.
 *
 * The shape "My documents" (§6.2) and Person detail (§6.4) both need. Returns
 * the signature so the screen can say WHEN, which is the difference between
 * "you have signed" and a sentence a member can act on.
 */
export async function waiverStandingFor(
  tx: ArmoryTx,
  personId: string,
): Promise<{
  active: { id: string; version: string } | null;
  signed: { waiverVersionId: string; signedAt: Date } | null;
  isCurrent: boolean;
}> {
  const active = await activeWaiverVersion(tx);

  const [signature] = await tx
    .select({
      waiverVersionId: schema.waiverSignatures.waiverVersionId,
      signedAt: schema.waiverSignatures.signedAt,
    })
    .from(schema.waiverSignatures)
    .where(
      and(
        eq(schema.waiverSignatures.personId, personId),
        isNotNull(schema.waiverSignatures.signedAt),
      ),
    )
    /* Most recent by the signing clock, not by id. The id is a UUIDv7 and so is
       time-ordered by GENERATION, which for an offline signature is the moment
       the tablet minted it — not necessarily the order the club signed things
       in once a queue has drained out of order. */
    .orderBy(sql`${schema.waiverSignatures.signedAt} desc`)
    .limit(1);

  return {
    active,
    signed: signature
      ? {
          waiverVersionId: signature.waiverVersionId,
          signedAt: signature.signedAt,
        }
      : null,
    isCurrent: Boolean(
      active && signature && signature.waiverVersionId === active.id,
    ),
  };
}
