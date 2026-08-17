"use server";

/**
 * BOOK A SESSION, AND INVITE A GUEST — §6.2.
 *
 *   Book a session: "Availability computed from lanes, hours, officer coverage
 *     and existing bookings — never a manually maintained calendar. NAMING A
 *     GUEST CALLS MAY_HOST BEFORE THE BOOKING CAN BE CONFIRMED. Allowance shown
 *     before and after."
 *
 *   Invite a guest: "Creates the invitation, sends the link over WhatsApp,
 *     DECREMENTS ALLOWANCE INSIDE THE SAME TRANSACTION AS THE BOOKING WRITE.
 *     Cancelling returns it."
 *
 * Server actions rather than route handlers, for the reason
 * src/app/actions/intake.ts already gives: field errors survive a submission
 * without JavaScript, and nothing the member typed is lost. The management API
 * under /api/* exists for the desk and for machines; these two are forms.
 *
 * ===========================================================================
 * MAY_HOST IS CALLED HERE AND AGAIN AT THE DESK
 *
 * §4.2 lists MAY_HOST as "Booking, and again at check-in", and
 * src/domain/capability/index.ts explains why: "the facts change in between. An
 * allowance is consumed by another booking; a guest already on the premises
 * fills the concurrent slot. A single check at booking time would authorise a
 * guest the club can no longer host by the time they arrive."
 *
 * This is the first of those two calls. It is the one that matters commercially,
 * because §12 requires the overage price to be shown HERE — "Overage offered in
 * the portal with the price shown. Never discovered at the desk."
 */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { evaluate } from "@/domain/capability";
import { uuidv7 } from "@/lib/uuidv7";
import { log } from "@/server/log";
import { applyInvitationEvent, issueInvitation } from "@/server/armory/invitations";
import { getArmoryDb, schema } from "@/db/armory/client";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { record } from "@/server/armory/record";
import { PostgresRecordStore } from "@/server/armory/postgres-store";

import { overagePriceLabel } from "@/server/armory/overage";

import type { HostingState } from "@/lib/hosting-state";

const store = new PostgresRecordStore();

/* ============================================================================
   INVITE A GUEST
   ========================================================================= */

export async function inviteGuest(
  _previous: HostingState,
  form: FormData,
): Promise<HostingState> {
  const resolution = await resolveArmoryMember();
  if (resolution.state !== "member") {
    return { ok: false, formError: signedOutMessage(resolution.state) };
  }

  const member = resolution.member;
  const bookingId = String(form.get("bookingId") ?? "") || null;
  const overageAccepted = form.get("overageAccepted") === "yes";

  /* §4 MAY_HOST — the first of the two calls §4.2 requires. The overage answer
     is passed in, because §4.2 fails "only when the allowance is exhausted AND
     overage is declined": an accepted overage is a sale, not a block. */
  const decision = evaluate(member.subject, {
    capability: "MAY_HOST",
    now: new Date(),
    allowance: {
      includedQuota: member.allowance.includedQuota,
      usedCount: member.allowance.usedCount,
      overagePriceLabel: overagePriceLabel(),
    },
    overageAccepted,
    guestsInSession: 0,
  });

  if (!decision.allowed) {
    /* §12: "Overage offered in the portal WITH THE PRICE SHOWN. Never
       discovered at the desk." So an exhausted allowance is not an error — it
       is an offer, and the screen re-renders with the price and a confirm. */
    if (decision.reason.code === "ALLOWANCE_EXHAUSTED" && !overageAccepted) {
      return {
        ok: false,
        formError: decision.reason.message,
        overagePrompt: {
          priceLabel: overagePriceLabel() ?? "the guest rate",
          guestNumber: member.allowance.usedCount + 1,
        },
      };
    }

    return { ok: false, formError: decision.reason.message };
  }

  const requestId = String(form.get("requestId") ?? uuidv7());

  try {
    const outcome = await record(
      store,
      {
        requestId,
        operation: "invitations.issue",
        actor: { staffUserId: null, deviceId: null },
        occurredAt: new Date(),
      },
      async (tx) => {
        /* §6.2: the allowance moves INSIDE this transaction, with the
           invitation. §8.3 is the reason and allowances.ts carries the full
           argument for why one statement rather than a read and a write. */
        const issued = await issueInvitation(tx, {
          hostMembershipId: member.membershipId,
          hostPersonId: member.personId,
          hostStartedOn: member.startedOn,
          guestAllowanceAnnual: member.tier.guestAllowanceAnnual,
          bookingId,
          guestPersonId: null,
          overageAccepted,
          now: new Date(),
          source: "portal",
        });

        /* No participant row is written here. The guest has no person record
           yet — they are a phone number until they open the link (§6.3) — and
           §3.3 requires a participation to name a person. The row is written
           when they complete the form; see completeVisit in
           src/server/armory/visit.ts, which attaches them to this booking. */
        return issued;
      },
    );

    if (outcome.status === "refused") {
      return { ok: false, formError: outcome.refusal.message };
    }

    const result = outcome.result;

    revalidatePath("/portal");

    /* §9: the link goes out over WhatsApp — "This is the primary channel, not a
       fallback for email" — and that integration is M8's queued, retried,
       template-versioned sender. Until it exists the link is shown to the host
       to pass on, which is honest and is what a member would do anyway if a
       message failed to arrive. */
    return {
      ok: true,
      message: `${visitUrl(result.token)}`,
      ...(result.isChargeable
        ? {
            overagePrompt: {
              priceLabel: overagePriceLabel() ?? "the guest rate",
              guestNumber: result.usedCount,
            },
          }
        : {}),
    };
  } catch (error) {
    log.error("hosting.invite.failed", {
      membershipId: member.membershipId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      formError: "We could not create that invitation just now. Try again in a moment.",
    };
  }
}

/* ============================================================================
   CANCEL — §5: "Cancelling returns it."
   ========================================================================= */

export async function cancelInvitation(
  _previous: HostingState,
  form: FormData,
): Promise<HostingState> {
  const resolution = await resolveArmoryMember();
  if (resolution.state !== "member") {
    return { ok: false, formError: signedOutMessage(resolution.state) };
  }

  const invitationId = String(form.get("invitationId") ?? "");
  if (!invitationId) return { ok: false, formError: "Choose an invitation to cancel." };

  /**
   * WHOSE INVITATION IS THIS?
   *
   * It did not ask. The id arrives in a form post from a browser, so it is
   * whatever the sender typed, and `applyInvitationEvent` reads the invitation
   * by id and never compares its `hostMembershipId` to the caller — it cannot,
   * because it is also the desk's function and an officer acting at the counter
   * has staff authority and only the id.
   *
   * The consequence was that any signed-in member could cancel any other
   * member's guest by supplying that guest's invitation id: the host would lose
   * a guest they had invited, the guest's link would stop working, and the
   * allowance would move on somebody else's say-so. Nothing in the receipt
   * would look wrong, because the operation itself is legitimate.
   *
   * Found while building the booking cancel next door, which needed the same
   * guarantee and got it by scoping the READ — see `memberBookingById`. This
   * path cannot be rewritten that way without reshaping `applyInvitationEvent`,
   * so it asks the question explicitly, before it acts, in the same request.
   */
  const [owned] = await getArmoryDb()
    .select({ id: schema.guestInvitations.id })
    .from(schema.guestInvitations)
    .where(
      and(
        eq(schema.guestInvitations.id, invitationId),
        eq(schema.guestInvitations.hostMembershipId, resolution.member.membershipId),
      ),
    )
    .limit(1);

  /* The same answer a made-up id gets. Distinguishing "not yours" from "no such
     invitation" would confirm to somebody probing ids that one exists. */
  if (!owned) {
    return { ok: false, formError: "That invitation is not on your file." };
  }

  const outcome = await record(
    store,
    {
      requestId: String(form.get("requestId") ?? uuidv7()),
      operation: "invitations.cancel",
      actor: { staffUserId: null, deviceId: null },
      occurredAt: new Date(),
    },
    (tx) =>
      applyInvitationEvent(tx, {
        invitationId,
        event: { type: "cancel" },
        occurredAt: new Date(),
      }),
  );

  if (outcome.status === "refused") {
    return { ok: false, formError: outcome.refusal.message };
  }

  revalidatePath("/portal");
  return { ok: true, message: "Cancelled. That guest visit is back on your allowance." };
}

/* ============================================================================
   HELPERS
   ========================================================================= */

function visitUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/visit/${token}`;
}

function signedOutMessage(state: string): string {
  switch (state) {
    case "no_membership":
      return "Your account is not a membership yet. Apply from the club page and the founder will review it.";
    case "not_linked":
      return "This account is not linked to a club membership. Call the club and they will connect it.";
    default:
      return "Sign in again to book.";
  }
}

