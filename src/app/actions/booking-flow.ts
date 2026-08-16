"use server";

/**
 * PLACE A BOOKING — Members Portal §7.4.
 *
 *   "Step 5 — Confirm | Summary, any overage as a line item | CAPACITY AT
 *    COMMIT, NOT AT RENDER."
 *   "Step 4 — Who | Host allowance, ATOMICALLY, SERVER-SIDE."
 *
 * ===========================================================================
 * THE WHOLE BOOKING IS ONE TRANSACTION, AND THAT IS THE POINT
 *
 * §14 opens its risk register with the failure this file exists to prevent:
 *
 *   "Allowance double-spend — two bookings created near-simultaneously each
 *    spend the last guest place. Both confirm. A member is turned away at the
 *    door with a guest beside them — the outcome Revision 2 names as
 *    unaffordable. Required control: atomic decrement with a constraint at the
 *    DATABASE level. Not an application-layer check."
 *
 * So the draft, every invitation and the confirmation happen inside a single
 * `record()` transaction. The allowance is decremented by `consumeAllowance`,
 * which is one statement with its guard in the WHERE clause (see allowances.ts
 * for the full argument), and lane capacity is re-counted inside the same
 * transaction at the moment of the confirm rather than read when the page
 * rendered.
 *
 * A member who assembled a booking while somebody else took the last place gets
 * a sentence and their choices back. They do not get a confirmation for a lane
 * that is not there.
 *
 * ===========================================================================
 * WHY THERE IS NO PERSISTED DRAFT BETWEEN STEPS
 *
 * The obvious shape is: step 4 writes a draft and issues the invitations, step
 * 5 confirms it. It was rejected, because an abandoned draft would hold the
 * member's guest allowance until somebody cancelled it, and the person who
 * closed the tab is not going to. The club would then owe a sweep, and a sweep
 * that releases allowances is a job that can release one twice.
 *
 * Instead the flow's local state carries the companions to the confirm step —
 * §13.2 permits exactly that, "the booking flow's local state" — and nothing is
 * written until the member commits. Nothing to abandon, nothing to sweep.
 *
 * ===========================================================================
 * ON THE OVERAGE
 *
 * §7.4: "The charge appears once, at confirmation, as a line item. It is not
 * confirmed twice, not warned about in advance." The confirm step shows the
 * line; submitting it IS the acceptance, so `overageAccepted` is true on the
 * one path that reaches this action. A second are-you-sure would be the second
 * confirmation §7.4 forbids, and it is the one that makes a member invite fewer
 * people.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import {
  availableSlots,
  availableTables,
  capacityFor,
  findSlot,
  usesLane,
} from "@/domain/availability";
import { evaluate } from "@/domain/capability";
import { BOOKING_TYPES, type BookingType } from "@/domain/enums";
import { addDays } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { routes } from "@/lib/site";
import { log } from "@/server/log";
import { applyBookingEvent, draftBooking } from "@/server/armory/bookings";
import { issueInvitation } from "@/server/armory/invitations";
import {
  bookedInWindow,
  clubAvailabilityPolicy,
  clubLanes,
} from "@/server/armory/club-policy";
import { heldBookingCount } from "@/server/armory/member-bookings";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { record } from "@/server/armory/record";
import { PostgresRecordStore } from "@/server/armory/postgres-store";
import type { BookingFlowState } from "@/lib/booking-flow-state";

const store = new PostgresRecordStore();

/** How many companions one booking may name here. */
const MAX_COMPANIONS = 6;

/**
 * How far the re-derived grid projects.
 *
 * Matches the window the booking flow renders. A tier's own horizon narrows it
 * further inside MAY_BOOK — this only has to be wide enough to contain any slot
 * the member could have been shown.
 */
const GRID_DAYS = 14;

export async function placeBooking(
  _previous: BookingFlowState,
  form: FormData,
): Promise<BookingFlowState> {
  const resolution = await resolveArmoryMember();
  if (resolution.state !== "member") {
    return {
      ok: false,
      formError: "Booking is for members. Sign in with your member account.",
    };
  }

  const member = resolution.member;
  const now = new Date();

  /* ---- What the member chose ---------------------------------------------- */

  const bookingType = readBookingType(form.get("bookingType"));
  if (!bookingType) {
    return { ok: false, formError: "Choose what the booking is for." };
  }

  const rawDiscipline = String(form.get("discipline") ?? "").trim();
  const discipline = usesLane(bookingType) ? rawDiscipline || null : null;

  if (usesLane(bookingType) && !discipline) {
    return { ok: false, formError: "Choose which line you are shooting." };
  }

  /**
   * ===========================================================================
   * THE BOOKING IS SLOT-BASED, AND THIS IS WHERE THAT IS TRUE RATHER THAN SAID
   *
   * Founder decision, 16 August 2026: "make the booking system slot-based".
   *
   * The form posts a slot id and the times that go with it. This re-derives the
   * grid from the club's own hours and requires the posted id to be ON it. The
   * times are then taken FROM the derived slot and the posted ones are
   * discarded, so a hidden input is genuinely a reference rather than an
   * authorisation — which is what the old comment claimed and the old code did
   * not do. It read `slotStart` and `slotEnd` straight off the form.
   *
   * What that allowed, before this: a booking at 03:40 on a day the club is
   * shut, a six-hour booking, or one landing inside another's turnaround. None
   * of it was reachable through the interface, and all of it was reachable with
   * a form post — against the one table whose whole job is to say who is on
   * which lane when.
   *
   * It also makes the 15-minute buffer real. A grid is only a promise about the
   * range's day if nothing can be written between its slots.
   */
  const [policy, lanes, booked] = await Promise.all([
    clubAvailabilityPolicy(getArmoryDb()),
    clubLanes(getArmoryDb()),
    bookedInWindow(getArmoryDb(), { from: now, to: addDays(now, GRID_DAYS) }),
  ]);

  const grid = usesLane(bookingType)
    ? availableSlots({
        policy,
        lanes,
        booked,
        discipline: discipline ?? "",
        now,
        days: GRID_DAYS,
      })
    : availableTables({ policy, booked, now, days: GRID_DAYS });

  const chosen = findSlot(grid, String(form.get("slotId") ?? ""));

  if (!chosen) {
    /* Every reason this fails is the same to the member: the thing they picked
       is not on offer any more. Distinguishing "you tampered with the form"
       from "somebody took it while you were typing" would tell an attacker
       something and would tell an honest member nothing they can act on. */
    return {
      ok: false,
      formError: "That session is no longer available. Choose another time.",
    };
  }

  const slotStart = chosen.start;
  const slotEnd = chosen.end;

  const companions = readCompanions(form);
  if (companions.length > MAX_COMPANIONS) {
    return {
      ok: false,
      formError: `You can name up to ${MAX_COMPANIONS} people on one booking. Call the club for a larger group.`,
    };
  }

  /* ---- §4, twice, before anything is written ----------------------------- */

  /**
   * MAY_BOOK. The tier's horizon, its concurrent limit and its discipline
   * access are all decided by the capability service — this action does not
   * re-implement any of them, and P1 is the reason.
   *
   * A booking that uses no lane still passes through MAY_BOOK: the horizon and
   * the concurrent limit apply to a table as much as to a firing point, and a
   * lapsed membership does not become bookable because the member only wants
   * dinner. The discipline it is evaluated against is the member's own first
   * accessible line, which is the only argument that makes sense for a booking
   * with no line — a fabricated one would fail `DISCIPLINE_NOT_IN_TIER` and
   * refuse the member for a reason that is not true of them.
   */
  const decision = evaluate(member.subject, {
    capability: "MAY_BOOK",
    now,
    slotStart,
    discipline: discipline ?? member.tier.disciplineAccess[0] ?? "",
    heldBookings: await heldBookingCount(getArmoryDb(), {
      membershipId: member.membershipId,
      from: now,
    }),
  });

  if (!decision.allowed) {
    return { ok: false, formError: decision.reason.message };
  }

  /**
   * MAY_HOST, once, for the whole party.
   *
   * §4.2 fails "only when the allowance is exhausted AND overage is declined",
   * and reaching this action IS the acceptance — see the header. So the check
   * here is for the refusals that acceptance cannot clear: a tier that may not
   * host at all, and the concurrent-guests limit.
   */
  const guests = companions.length;

  if (guests > 0) {
    const hosting = evaluate(member.subject, {
      capability: "MAY_HOST",
      now,
      allowance: {
        includedQuota: member.allowance.includedQuota,
        usedCount: member.allowance.usedCount,
        overagePriceLabel: null,
      },
      overageAccepted: true,
      guestsInSession: guests - 1,
    });

    if (!hosting.allowed) {
      return { ok: false, formError: hosting.reason.message };
    }
  }

  /* ---- One transaction ---------------------------------------------------- */

  const requestId = String(form.get("requestId") ?? uuidv7());
  let bookingId: string | null = null;

  try {
    const outcome = await record(
      store,
      {
        requestId,
        operation: "bookings.place",
        actor: { staffUserId: null, deviceId: null },
        occurredAt: now,
      },
      async (tx) => {
        const drafted = await draftBooking(tx, {
          hostMembershipId: member.membershipId,
          hostPersonId: member.personId,
          slotStart,
          slotEnd,
          discipline,
          bookingType,
        });

        if (drafted.outcome === "refused") return drafted;
        bookingId = drafted.result.bookingId;

        /* §8.3: the allowance moves inside this transaction, with the
           invitation. One statement per guest, each with its guard in the
           WHERE clause, so two devices cannot spend the same last place. */
        for (const companion of companions) {
          const issued = await issueInvitation(tx, {
            hostMembershipId: member.membershipId,
            hostPersonId: member.personId,
            hostStartedOn: member.startedOn,
            guestAllowanceAnnual: member.tier.guestAllowanceAnnual,
            bookingId: drafted.result.bookingId,
            /* No person record yet. A guest is a name and a number until they
               open their link and complete it themselves — §6.3. */
            guestPersonId: null,
            overageAccepted: true,
            now,
            source: "portal",
          });

          if (issued.outcome === "refused") return issued;

          void companion;
        }

        /* Capacity at COMMIT, not at render. Re-counted inside this
           transaction against the same snapshot as the write. */
        let capacity: number | undefined;

        if (discipline) {
          const lanes = await tx
            .select({
              id: schema.lanes.id,
              discipline: schema.lanes.discipline,
              status: schema.lanes.status,
              positionCapacity: schema.lanes.positionCapacity,
            })
            .from(schema.lanes)
            .where(eq(schema.lanes.discipline, discipline));

          capacity = capacityFor(lanes, discipline);
        }

        return applyBookingEvent(tx, {
          bookingId: drafted.result.bookingId,
          event: { type: "confirm" },
          occurredAt: now,
          capacity,
        });
      },
    );

    if (outcome.status === "refused") {
      return { ok: false, formError: outcome.refusal.message };
    }
  } catch (error) {
    log.error("booking.place.failed", {
      membershipId: member.membershipId,
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      formError: "We could not book that just now. Try again in a moment.",
    };
  }

  revalidatePath(routes.portal);
  revalidatePath(routes.portalBook);

  /**
   * Straight to Today, which is where the booking now lives.
   *
   * A confirmation screen was considered and rejected: it is a page whose only
   * content is a sentence the next screen already says better, and it puts one
   * more tap between the member and the card that actually holds their booking.
   */
  redirect(routes.portal);
}

/* ============================================================================
   READING THE FORM
   ========================================================================= */

/** Narrows to the four §7.4 types, rejecting anything else outright. */
function readBookingType(raw: FormDataEntryValue | null): BookingType | null {
  const value = String(raw ?? "");
  return (BOOKING_TYPES as readonly string[]).includes(value)
    ? (value as BookingType)
    : null;
}

/**
 * The named companions.
 *
 * §10: "Named, never counted." The form posts parallel `companionName` and
 * `companionPhone` entries, and a row with no name is dropped rather than
 * rejected — an empty extra field is a member who added a row and changed their
 * mind, not an error worth stopping the booking for.
 */
function readCompanions(form: FormData): { name: string; phone: string }[] {
  const names = form.getAll("companionName").map((value) => String(value).trim());
  const phones = form.getAll("companionPhone").map((value) => String(value).trim());

  return names
    .map((name, index) => ({ name, phone: phones[index] ?? "" }))
    .filter((companion) => companion.name.length > 0);
}
