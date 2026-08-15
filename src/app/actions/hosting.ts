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

import { revalidatePath } from "next/cache";
import { getArmoryDb, schema } from "@/db/armory/client";
import { evaluate } from "@/domain/capability";
import { capacityFor } from "@/domain/availability";
import { format, fromStorage } from "@/lib/money";
import { uuidv7 } from "@/lib/uuidv7";
import { log } from "@/server/log";
import { applyBookingEvent, draftBooking } from "@/server/armory/bookings";
import { applyInvitationEvent, issueInvitation } from "@/server/armory/invitations";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { record } from "@/server/armory/record";
import { PostgresRecordStore } from "@/server/armory/postgres-store";
import { and, eq, gte } from "drizzle-orm";

import type { HostingState } from "@/lib/hosting-state";

const store = new PostgresRecordStore();

/* ============================================================================
   BOOK A SESSION
   ========================================================================= */

export async function bookSession(
  _previous: HostingState,
  form: FormData,
): Promise<HostingState> {
  const resolution = await resolveArmoryMember();
  if (resolution.state !== "member") {
    return { ok: false, formError: signedOutMessage(resolution.state) };
  }

  const member = resolution.member;
  const slotStartRaw = String(form.get("slotStart") ?? "");
  const discipline = String(form.get("discipline") ?? "");

  if (!slotStartRaw || !discipline) {
    return { ok: false, formError: "Choose a session before booking." };
  }

  const slotStart = new Date(slotStartRaw);
  if (Number.isNaN(slotStart.getTime())) {
    return { ok: false, formError: "That session could not be read. Choose it again." };
  }

  /* §4 MAY_BOOK, evaluated by the same service the desk calls. The tier's
     horizon, its concurrent limit and its discipline access are all decided
     there — this action does not re-implement any of them. */
  const decision = evaluate(member.subject, {
    capability: "MAY_BOOK",
    now: new Date(),
    slotStart,
    discipline,
    heldBookings: await countHeldBookings(member.membershipId),
  });

  if (!decision.allowed) {
    return { ok: false, formError: decision.reason.message };
  }

  const requestId = String(form.get("requestId") ?? uuidv7());
  const slotEnd = new Date(String(form.get("slotEnd") ?? slotStart.toISOString()));

  try {
    const outcome = await record(
      store,
      {
        requestId,
        operation: "bookings.draft",
        actor: { staffUserId: null, deviceId: null },
        occurredAt: new Date(),
      },
      async (tx) => {
        const drafted = await draftBooking(tx, {
          hostMembershipId: member.membershipId,
          hostPersonId: member.personId,
          slotStart,
          slotEnd,
          discipline,
        });

        if (drafted.outcome === "refused") return drafted;

        /* Confirmed immediately when no guest is named. §5 keeps `draft` for
           the window in which a member is still adding guests; a solo booking
           has nothing to add and leaving it in draft would hold no lane and
           show up nowhere. */
        const lanes = await tx
          .select({
            id: schema.lanes.id,
            discipline: schema.lanes.discipline,
            status: schema.lanes.status,
            positionCapacity: schema.lanes.positionCapacity,
          })
          .from(schema.lanes)
          .where(eq(schema.lanes.discipline, discipline));

        return applyBookingEvent(tx, {
          bookingId: drafted.result.bookingId,
          event: { type: "confirm" },
          occurredAt: new Date(),
          capacity: capacityFor(lanes, discipline),
        });
      },
    );

    if (outcome.status === "refused") {
      return { ok: false, formError: outcome.refusal.message };
    }

    revalidatePath("/portal");
    return { ok: true, message: "Booked. You will find it on your portal home." };
  } catch (error) {
    log.error("hosting.book.failed", {
      membershipId: member.membershipId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      formError: "We could not book that just now. Try again in a moment.",
    };
  }
}

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

/**
 * §14: "Guest overage price — Blocks charging logic. Configurable, so not
 * structurally blocking. Needed by: Before M8."
 *
 * Not settled, so this returns null and the capability service says "the guest
 * rate" rather than inventing a number. §12 requires the price be SHOWN, and a
 * made-up figure shown to a member is worse than a vaguer sentence — they would
 * hold the club to it.
 */
function overagePriceLabel(): string | null {
  const kobo = process.env.GUEST_OVERAGE_KOBO;
  if (!kobo) return null;
  const parsed = fromStorage(kobo);
  return format(parsed);
}

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

/**
 * Bookings this member is currently holding.
 *
 * §4's MAY_BOOK compares this against the tier's `concurrentBookingsMax`, and
 * `Context` defines it as "Confirmed bookings this member already holds" —
 * CONCURRENT, not cumulative. Counting every booking they have ever made would
 * block a member permanently once they passed the limit, which is the kind of
 * bug that looks like the rule working until somebody has been a member for a
 * year.
 *
 * So: confirmed, and still ahead of them. A booking they have already shot is
 * not being held.
 */
async function countHeldBookings(membershipId: string): Promise<number> {
  const rows = await getArmoryDb()
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMembershipId, membershipId),
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.slotStart, new Date()),
      ),
    );

  return rows.length;
}
