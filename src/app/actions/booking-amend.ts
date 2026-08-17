"use server";

import { revalidatePath } from "next/cache";
import { uuidv7 } from "@/lib/uuidv7";
import { getArmoryDb } from "@/db/armory/client";
import { applyBookingEvent } from "@/server/armory/bookings";
import { isAmendable, memberBookingById } from "@/server/armory/member-bookings";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { record } from "@/server/armory/record";
import { PostgresRecordStore } from "@/server/armory/postgres-store";
import type { BookingAmendState } from "@/lib/booking-amend-state";
import { routes } from "@/lib/site";

/**
 * CANCELLING A BOOKING — Members Portal §6.1's "inline: add a guest, change,
 * cancel", the third of which had no way in.
 *
 * ============================================================================
 * THE SERVER SIDE OF THIS WAS ALREADY BUILT
 *
 * `applyBookingEvent` has handled `{ type: "cancel" }` since M11 and does the
 * hard parts: it releases one guest allowance per invitation still holding one,
 * stamps `cancelledAt`, releases the lane by no longer counting toward the
 * slot, and cancels the invitations attached to the booking. It is careful to
 * succeed on a full slot, because a member who cannot cancel a session they
 * cannot attend is a member who simply does not turn up.
 *
 * What was missing was any route a member could take to reach it. Today's card
 * rendered a button reading "Change or cancel" that linked to the Diary — the
 * club's week, with no booking of theirs on it and nothing to cancel. This is
 * the missing half.
 *
 * ============================================================================
 * WHO IS ASKING — AND THE BUG NEXT DOOR THAT MADE THIS EXPLICIT
 *
 * `applyBookingEvent` is the DESK's function. It takes a booking id and asks no
 * questions about the caller, correctly: an officer cancelling at the counter
 * is acting under staff authority, and the id is all they have.
 *
 * A member-facing action cannot inherit that. The id arrives in a form post
 * from a browser, so it is whatever the sender typed. `cancelInvitation` in
 * hosting.ts made exactly this mistake — it read an invitation id from a form,
 * passed it straight to `applyInvitationEvent`, and never asked whose
 * invitation it was, which let any signed-in member cancel any other member's
 * guest by id.
 *
 * So ownership is established by READING, not by comparing.
 * `memberBookingById` scopes the query to the caller's membership, and a
 * booking belonging to somebody else does not come back at all. The read
 * happens inside the same transaction as the write, so the answer cannot go
 * stale between the check and the act.
 *
 * ============================================================================
 * THE NOTICE PERIOD IS THE CLUB'S TO SET, AND IT HAS NOT SET ONE
 *
 * `isAmendable` is the existing rule and it is the whole rule: a booking is the
 * member's to change until it starts. No cut-off, no penalty window.
 *
 * That is deliberately NOT invented here. `AvailabilityPolicy.leadTimeMinutes`
 * exists and is tempting, and it answers a different question — the least
 * notice the club accepts to TAKE a booking, which has nothing to say about
 * giving one back. Reusing it would put a number in front of members that
 * nobody at the club had chosen, which is the failure `UNCONFIGURED_
 * AVAILABILITY` was written to prevent for opening hours.
 *
 * When the club settles a cancellation window this is where it goes, alongside
 * whatever refund rule attaches to it. Until then the honest behaviour is the
 * permissive one: a member who cannot come should always be able to say so,
 * because the alternative is a held lane and a no-show.
 *
 * ============================================================================
 * NOTHING IS TOLD TO ANYBODY, AND THE SCREEN SAYS SO
 *
 * The cancel releases the guests' invitations — their links stop working. No
 * message reaches them, because this system sends no messages on cancellation
 * and there is no code here that pretends otherwise.
 *
 * P5 is why that has to be visible rather than quietly true: the failure being
 * avoided is a guest arriving at the National Stadium for a session that no
 * longer exists. The member is the only one who can prevent it, so the
 * confirmation tells them their guests have not been told. See the detail
 * screen.
 */

const store = new PostgresRecordStore();

export async function cancelBooking(
  _previous: BookingAmendState,
  form: FormData,
): Promise<BookingAmendState> {
  const resolution = await resolveArmoryMember();
  if (resolution.state !== "member") {
    return { ok: false, formError: signedOutMessage(resolution.state) };
  }

  const bookingId = String(form.get("bookingId") ?? "");
  if (!bookingId) {
    return { ok: false, formError: "Choose a booking to cancel." };
  }

  const now = new Date();

  /* Scoped to this membership. A booking that is not theirs reads as absent —
     the same answer a made-up id gets, which is the only answer that does not
     confirm to a prober that some other member's booking exists. */
  const booking = await memberBookingById(getArmoryDb(), {
    bookingId,
    membershipId: resolution.member.membershipId,
    personId: resolution.member.personId,
  });

  if (!booking) {
    return { ok: false, formError: "That booking is not on your file." };
  }

  if (booking.status === "cancelled") {
    /* Not an error. A member who taps cancel twice, or comes back to a page
       they left open, has got what they wanted. */
    return { ok: true, message: "That booking was already cancelled." };
  }

  if (!isAmendable(booking, now)) {
    return {
      ok: false,
      formError:
        "That session has already started. Speak to the club and they will sort it out at the desk.",
    };
  }

  const outcome = await record(
    store,
    {
      requestId: String(form.get("requestId") ?? uuidv7()),
      operation: "bookings.cancel",
      /* No staff and no device: this is the member acting for themselves, from
         their own phone. The receipt records that, which is what makes a
         member-initiated cancellation distinguishable from a desk one. */
      actor: { staffUserId: null, deviceId: null },
      occurredAt: now,
    },
    (tx) =>
      applyBookingEvent(tx, {
        bookingId: booking.id,
        event: { type: "cancel" },
        occurredAt: now,
      }),
  );

  if (outcome.status === "refused") {
    return { ok: false, formError: outcome.refusal.message };
  }

  revalidatePath(routes.portal);
  revalidatePath(routes.portalBook);
  revalidatePath(routes.portalBooking(booking.id));

  return {
    ok: true,
    message:
      booking.companions.length > 0
        ? "Cancelled. The lane is released and your guests' links have stopped working — the club does not message them, so tell them yourself."
        : "Cancelled. The lane is released.",
  };
}

/** The same three sentences the hosting actions use, for the same three states. */
function signedOutMessage(state: string): string {
  switch (state) {
    case "no_membership":
      return "Your account is not a membership yet. Apply from the club page and the founder will review it.";
    case "not_linked":
      return "This account is not linked to a club membership. Call the club and they will connect it.";
    default:
      return "Sign in again to change a booking.";
  }
}
