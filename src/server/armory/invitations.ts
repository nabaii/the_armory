import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ArmoryReader, ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { InvitationStatus } from "@/domain/enums";
import {
  invitationTransition,
  type InvitationEvent,
} from "@/domain/state-machines";
import { guestOverageCharge } from "@/domain/charges";
import { kobo, type Kobo } from "@/lib/money";
import { uuidv7 } from "@/lib/uuidv7";
import { hashDeviceToken } from "@/server/sync/device-auth";
import {
  consumeAllowance,
  ensureAllowancePeriod,
  overageException,
  releaseAllowance,
} from "./allowances";
import { raiseCharge } from "./money";
import { applied, refused, type AuditDraft, type Written } from "./record";

/**
 * GUEST INVITATIONS — §3.2, §5, §6.2.
 *
 *   §6.2 "Invite a guest": "Creates the invitation, sends the link over
 *         WhatsApp, DECREMENTS ALLOWANCE INSIDE THE SAME TRANSACTION AS THE
 *         BOOKING WRITE. Cancelling returns it."
 *
 * The capitalised half is §8.3's resolution and the whole reason this function
 * takes a transaction handle. An invitation that exists without its allowance
 * having moved is a free guest visit; an allowance that moved without an
 * invitation is a visit the member paid for and never received. Both are silent.
 *
 * ===========================================================================
 * THE TOKEN IS A BEARER CREDENTIAL FOR A FORM THAT COLLECTS A DATE OF BIRTH
 *
 * §3.2: "unique, single-use, expiring." Stored hashed, exactly like the device
 * token in 0003 and for the reason the schema already gives: the raw token
 * exists only in the WhatsApp message, and a database dump must not hand anyone
 * a working link.
 *
 * §10 adds rate limiting "on the guest token endpoint", which belongs at the
 * route rather than here — but the shape of the credential is decided here, and
 * 256 bits from a CSPRNG is what makes the rate limit a backstop rather than the
 * only defence.
 */

/** How long a guest link stands before it expires. §3.2: "expiring". */
const INVITATION_HOURS = 72;

export type InvitationResult = {
  readonly invitationId: string;
  /** Plaintext, returned ONCE. Only the hash is stored. */
  readonly token: string;
  readonly expiresAt: Date;
  /** §12: the price must be shown before this is accepted, never after. */
  readonly isChargeable: boolean;
  readonly usedCount: number;
  readonly includedQuota: number;
};

/**
 * Issue an invitation and move the host's allowance, atomically.
 *
 * `overageAccepted` is the member's answer to §12's "Overage offered in the
 * portal with the price shown". It is NOT a permission check — MAY_HOST has
 * already run in the portal and refused unless the member accepted. It is
 * carried here so the allowance write can record the visit as chargeable, and so
 * that a caller which skipped MAY_HOST cannot silently bill somebody.
 */
export async function issueInvitation(
  tx: ArmoryTx,
  input: {
    readonly id?: string;
    readonly hostMembershipId: string;
    readonly hostPersonId: string;
    readonly hostStartedOn: Date;
    readonly guestAllowanceAnnual: number;
    readonly bookingId: string | null;
    readonly guestPersonId: string | null;
    readonly overageAccepted: boolean;
    readonly now: Date;
    /** §8.3: an offline authorisation at the desk is an explicit override. */
    readonly source: "portal" | "desk_override";
  },
): Promise<Written<InvitationResult>> {
  const allowance = await ensureAllowancePeriod(tx, {
    membershipId: input.hostMembershipId,
    startedOn: input.hostStartedOn,
    guestAllowanceAnnual: input.guestAllowanceAnnual,
    now: input.now,
  });

  /* The one refusal in this file, and it is not about capacity — it is about
     consent. Going past the quota costs the member money (§12), and a member
     who has not been shown the price must not be billed because a client forgot
     to ask. The desk override is exempt: §8.3 says the visit stands. */
  if (
    allowance.usedCount >= allowance.includedQuota &&
    !input.overageAccepted &&
    input.source !== "desk_override"
  ) {
    return refused({
      code: "OVERAGE_NOT_ACCEPTED",
      message: `That is guest ${allowance.usedCount + 1} of an included ${allowance.includedQuota}. Accept the overage charge to go ahead.`,
    });
  }

  const consumed = await consumeAllowance(tx, allowance.id);

  const invitationId = input.id ?? uuidv7();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(input.now.getTime() + INVITATION_HOURS * 3_600_000);

  const inserted = await tx
    .insert(schema.guestInvitations)
    .values({
      id: invitationId,
      hostMembershipId: input.hostMembershipId,
      guestPersonId: input.guestPersonId,
      bookingId: input.bookingId,
      tokenHash: await hashDeviceToken(token),
      expiresAt,
      status: "issued",
      issuedAt: input.now,
      isChargeable: !consumed.withinQuota,
    })
    .onConflictDoNothing({ target: schema.guestInvitations.id })
    .returning({ id: schema.guestInvitations.id });

  if (inserted.length === 0) {
    /* A replay that got past the receipt — the caller reused an invitation id
       without a matching requestId. The allowance has already been consumed
       above, so it must be given back: otherwise a retried invitation costs the
       member a guest visit for a link they already have. */
    await releaseAllowance(tx, allowance.id);

    return refused({
      code: "ALREADY_ISSUED",
      message: "That invitation has already been sent.",
    });
  }

  const audit: AuditDraft[] = [
    {
      action: "invitation.issue",
      entityType: "guest_invitation",
      entityId: invitationId,
      after: {
        hostMembershipId: input.hostMembershipId,
        bookingId: input.bookingId,
        isChargeable: !consumed.withinQuota,
        usedCount: consumed.usedCount,
        includedQuota: consumed.includedQuota,
      },
    },
  ];

  if (!consumed.withinQuota) {
    audit.push(
      overageException({
        membershipId: input.hostMembershipId,
        hostPersonId: input.hostPersonId,
        result: consumed,
        source: input.source,
      }),
    );
  }

  return applied(
    {
      invitationId,
      token,
      expiresAt,
      isChargeable: !consumed.withinQuota,
      usedCount: consumed.usedCount,
      includedQuota: consumed.includedQuota,
    },
    audit,
  );
}

/* ============================================================================
   THE LIFECYCLE — §5
   ========================================================================= */

export type InvitationTransitionResult = {
  readonly invitationId: string;
  readonly from: InvitationStatus;
  readonly to: InvitationStatus;
  readonly allowanceReturned: boolean;
};

/**
 * Apply an event to an invitation, honouring §5's allowance effects.
 *
 *   "issued → opened → completed → attended. issued | opened | completed →
 *    cancelled (returns allowance) | expired. ATTENDED IS TERMINAL AND DOES NOT
 *    RETURN ALLOWANCE."
 *
 * The last sentence is the one worth guarding: a guest who came used the slot,
 * and returning the allowance afterwards would let a member host indefinitely by
 * cancelling after every visit. The transition already refuses it; this layer
 * applies whatever the transition returns and never second-guesses it.
 */
export async function applyInvitationEvent(
  tx: ArmoryTx,
  input: {
    readonly invitationId: string;
    readonly event: InvitationEvent;
    readonly occurredAt: Date;
  },
): Promise<Written<InvitationTransitionResult>> {
  const [invitation] = await tx
    .select({
      id: schema.guestInvitations.id,
      hostMembershipId: schema.guestInvitations.hostMembershipId,
      status: schema.guestInvitations.status,
      expiresAt: schema.guestInvitations.expiresAt,
      /* §11 M8's host-pays enforcement reads both. Selected here rather than in
         a second query because the charge is raised inside this transaction and
         a re-read would be a second chance for the two to disagree. */
      isChargeable: schema.guestInvitations.isChargeable,
      guestPersonId: schema.guestInvitations.guestPersonId,
    })
    .from(schema.guestInvitations)
    .where(eq(schema.guestInvitations.id, input.invitationId))
    .limit(1);

  if (!invitation) {
    return refused({
      code: "NO_SUCH_INVITATION",
      message: "That invitation is not on file.",
    });
  }

  const transition = invitationTransition(invitation.status, input.event, {
    hostMembershipId: invitation.hostMembershipId,
  });

  if (!transition.ok) {
    return refused({ code: transition.code, message: transition.message }, [
      {
        action: `invitation.${input.event.type}`,
        entityType: "guest_invitation",
        entityId: invitation.id,
        before: { status: invitation.status },
      },
    ]);
  }

  await tx
    .update(schema.guestInvitations)
    .set({
      status: transition.to,
      updatedAt: input.occurredAt,
      ...timestampFor(input.event.type, input.occurredAt),
    })
    .where(eq(schema.guestInvitations.id, invitation.id));

  let allowanceReturned = false;

  for (const effect of transition.effects) {
    if (effect.kind === "release_allowance") {
      const allowance = await currentAllowanceId(tx, invitation.hostMembershipId);
      if (allowance) {
        await releaseAllowance(tx, allowance);
        allowanceReturned = true;
      }
    }
  }

  const audit: AuditDraft[] = [
    {
      action: `invitation.${input.event.type}`,
      entityType: "guest_invitation",
      entityId: invitation.id,
      before: { status: invitation.status },
      after: { status: transition.to, allowanceReturned },
    },
  ];

  /**
   * §11 M8's "host-pays enforcement", at the one moment it is correct.
   *
   * ===========================================================================
   * WHY THE CHARGE IS RAISED ON ATTENDANCE AND NOT ON ISSUE
   *
   * The allowance moves when the invitation is issued (§3.2), and the obvious
   * reading is that the charge should move with it. It should not, and the
   * reason is in §5: "issued | opened | completed → cancelled (RETURNS
   * ALLOWANCE)".
   *
   * A charge raised at issue would therefore have to be reversed on every
   * cancellation, and a member's statement would fill with charges and credits
   * for guests who never came — the club billing and un-billing somebody for a
   * Saturday that did not happen. The first time a member queries one of those,
   * the club is explaining its own bookkeeping instead of taking a booking.
   *
   * `attended` is terminal and returns nothing (§5), so a charge raised here
   * never needs reversing. It is also the moment §8.3 describes: "the visit
   * stands — the guest is already on the premises — and the overage is charged
   * to the host."
   *
   * ===========================================================================
   * THE PRICE IS CONFIGURATION, AND ITS ABSENCE IS NOT A FAILURE
   *
   * §14 lists the guest overage price as open, and explicitly not blocking:
   * "Configurable, so not structurally blocking." Until it is set there is no
   * price to charge, and this raises nothing rather than guessing one.
   *
   * The visit is not refused for it and the audit entry is already written by
   * `issueInvitation` — so a club that opens before the price is set has a
   * complete record of who owes for what, and can raise the charges when the
   * number lands. Blocking a guest at the door over an unset configuration
   * value would be this system doing exactly what §1.2 rule 5 forbids.
   */
  if (transition.to === "attended" && invitation.isChargeable) {
    const price = await overagePriceKobo(tx);

    if (price !== null) {
      const guestName = await nameOf(tx, invitation.guestPersonId);
      const hostPersonId = await hostPersonOf(tx, invitation.hostMembershipId);

      if (hostPersonId) {
        const charge = await raiseCharge(
          tx,
          guestOverageCharge({
            /* §3.5, §1.2 rule 5. The HOST. `guestOverageCharge` has no
               parameter that could carry the guest's person id — the guest's
               NAME is all it takes, and only so the line reads. */
            hostPersonId,
            guestName,
            invitationId: invitation.id,
            visits: 1,
            priceKobo: price,
          }),
        );

        audit.push(...charge.audit);
      }
    }
  }

  return applied(
    {
      invitationId: invitation.id,
      from: invitation.status,
      to: transition.to,
      allowanceReturned,
    },
    audit,
  );
}

/**
 * The club's guest overage price, or null while §14 leaves it unset.
 *
 * Read from the club settings row rather than a constant, because §14 makes it
 * "configurable, so not structurally blocking" — a price in code is a price
 * that needs a deploy on the afternoon the founder decides.
 */
async function overagePriceKobo(tx: ArmoryTx): Promise<Kobo | null> {
  const [row] = await tx
    .select({ guestOveragePriceKobo: schema.clubSettings.guestOveragePriceKobo })
    .from(schema.clubSettings)
    .limit(1);

  return row?.guestOveragePriceKobo ? kobo(row.guestOveragePriceKobo) : null;
}

/** Who holds the membership. §3.1 — a membership belongs to one person. */
async function hostPersonOf(
  tx: ArmoryTx,
  membershipId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ personId: schema.memberships.personId })
    .from(schema.memberships)
    .where(eq(schema.memberships.id, membershipId))
    .limit(1);

  return row?.personId ?? null;
}

/**
 * A guest's name for the charge line, or a usable stand-in.
 *
 * A completed invitation always has a guest person (§3.2's flow creates one),
 * and a desk override may not. "A guest" on a statement is poor; a statement
 * that failed to render because a name was missing is worse.
 */
async function nameOf(
  tx: ArmoryTx,
  personId: string | null,
): Promise<string> {
  if (!personId) return "a guest";

  const [row] = await tx
    .select({
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  return row ? `${row.firstName} ${row.lastName}` : "a guest";
}

/** Which timestamp column an event stamps. §3.2 keeps one per state. */
function timestampFor(
  event: InvitationEvent["type"],
  at: Date,
): Record<string, Date> {
  switch (event) {
    case "open":
      return { openedAt: at };
    case "complete":
      return { completedAt: at };
    case "cancel":
      return { cancelledAt: at };
    case "attend":
    case "expire":
      /* `attended` and `expired` have no column of their own in §3.2 — the
         status carries them and `updated_at` carries the moment. Inventing
         columns the specification does not list would put this schema out of
         step with the document the club reviews it against. */
      return {};
  }
}

async function currentAllowanceId(
  tx: ArmoryTx,
  membershipId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.hostAllowances.id })
    .from(schema.hostAllowances)
    .where(eq(schema.hostAllowances.membershipId, membershipId))
    .orderBy(schema.hostAllowances.periodStart)
    .limit(1);

  return row?.id ?? null;
}

/* ============================================================================
   THE GUEST LINK — §6.3
   ========================================================================= */

export type InvitationForGuest = {
  readonly invitationId: string;
  readonly hostName: string;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly bookingId: string | null;
  readonly guestPersonId: string | null;
};

/**
 * Resolve a raw token from a guest link.
 *
 * §6.3 calls this "the highest-stakes screen in the build… opened once, in a
 * car, by someone slightly nervous about shooting for the first time." So the
 * lookup is by hash and the failure is quiet: a guest whose link has expired
 * gets a sentence, never a stack trace and never a login.
 *
 * Returns the invitation whatever its status, including expired and cancelled,
 * so the screen can say WHICH — "this link has expired, ask Ada to send another"
 * is a different message from "this link is not valid", and the guest can act on
 * only one of them.
 */
export async function invitationForToken(
  tx: ArmoryReader,
  token: string,
): Promise<InvitationForGuest | null> {
  const [row] = await tx
    .select({
      id: schema.guestInvitations.id,
      status: schema.guestInvitations.status,
      expiresAt: schema.guestInvitations.expiresAt,
      bookingId: schema.guestInvitations.bookingId,
      guestPersonId: schema.guestInvitations.guestPersonId,
      hostFirstName: schema.people.firstName,
      hostLastName: schema.people.lastName,
    })
    .from(schema.guestInvitations)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.guestInvitations.hostMembershipId),
    )
    .innerJoin(schema.people, eq(schema.people.id, schema.memberships.personId))
    .where(eq(schema.guestInvitations.tokenHash, await hashDeviceToken(token)))
    .limit(1);

  if (!row) return null;

  return {
    invitationId: row.id,
    /* First name only. The guest knows who invited them and does not need the
       member's full identity; §10 calls this data "a concentration of sensitive
       personal data" and the guest link is the least authenticated surface in
       the system — it is opened by whoever holds the URL. */
    hostName: row.hostFirstName,
    status: row.status,
    expiresAt: row.expiresAt,
    bookingId: row.bookingId,
    guestPersonId: row.guestPersonId,
  };
}
