import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { ArmoryReader, ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { BookingStatus } from "@/domain/enums";
import { bookingTransition, type BookingEvent } from "@/domain/state-machines";
import { toDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { releaseAllowance } from "./allowances";
import { applied, refused, type AuditDraft, type Written } from "./record";

/**
 * BOOKINGS — §3.3, §5, §6.2.
 *
 *   §5:   "draft → confirmed → completed | cancelled | no_show. Cancellation
 *          releases allowance and lane capacity. no_show set by the end-of-day
 *          close, not manually."
 *   §6.2: "Naming a guest calls MAY_HOST before the booking can be confirmed.
 *          Allowance shown before and after."
 *
 * ===========================================================================
 * WHY A BOOKING STARTS AS A DRAFT
 *
 * §5 could have started at `confirmed` and did not, and the reason is the guest.
 *
 * Naming a guest issues an invitation, which consumes allowance (§8.3), which
 * may cost the member money (§12). None of that should happen while they are
 * still choosing a slot. So `draft` is the state in which a booking is being
 * assembled — participants added, allowance checked, the price of an overage
 * shown — and `confirm` is the single moment it becomes a commitment the club
 * and the member both hold.
 *
 * A draft holds no lane capacity. Two members can hold drafts on the last slot;
 * only one can confirm it. That is deliberate: holding capacity for an
 * unfinished form would let one member with a browser tab open block a Saturday
 * evening for everybody else.
 *
 * ===========================================================================
 * CAPACITY IS CHECKED AT CONFIRM, NOT AT DRAFT
 *
 * And it is checked against the same snapshot as the write, inside the caller's
 * transaction, for the reason §8.3 gives about allowances: a count taken outside
 * and passed in is a count that was true a moment ago.
 */

export type BookingResult = {
  readonly bookingId: string;
  readonly status: BookingStatus;
};

/* ============================================================================
   DRAFTING
   ========================================================================= */

export async function draftBooking(
  tx: ArmoryTx,
  input: {
    readonly id?: string;
    readonly hostMembershipId: string;
    readonly hostPersonId: string;
    readonly slotStart: Date;
    readonly slotEnd: Date;
    readonly discipline: string;
  },
): Promise<Written<BookingResult>> {
  if (input.slotEnd <= input.slotStart) {
    return refused({
      code: "EMPTY_SLOT",
      message: "That session has no length.",
    });
  }

  const bookingId = input.id ?? uuidv7();

  const inserted = await tx
    .insert(schema.bookings)
    .values({
      id: bookingId,
      hostMembershipId: input.hostMembershipId,
      bookingDate: toDateColumn(input.slotStart),
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      discipline: input.discipline,
      status: "draft",
    })
    .onConflictDoNothing({ target: schema.bookings.id })
    .returning({ id: schema.bookings.id });

  if (inserted.length === 0) return applied({ bookingId, status: "draft" });

  /* §3.3: "Only a member may hold a booking." The host is a participant in
     their own booking — they are shooting, not supervising — and Today reads
     participants rather than the booking's host column to build its arrivals. */
  await tx
    .insert(schema.bookingParticipants)
    .values({
      id: uuidv7(),
      bookingId,
      personId: input.hostPersonId,
      role: "member_shooter",
      guestInvitationId: null,
    })
    .onConflictDoNothing();

  return applied({ bookingId, status: "draft" }, [
    {
      action: "booking.draft",
      entityType: "booking",
      entityId: bookingId,
      after: {
        hostMembershipId: input.hostMembershipId,
        slotStart: input.slotStart.toISOString(),
        discipline: input.discipline,
      },
    },
  ]);
}

/**
 * Add a guest to a draft booking.
 *
 * §3.3: "Every guest_shooter must carry a guest_invitation_id." The invitation
 * must therefore exist first — `issueInvitation` in invitations.ts — and this
 * function links it. Splitting them that way is what keeps §8.3's allowance
 * write in one transaction with the invitation rather than with the booking.
 */
export async function addGuestToBooking(
  tx: ArmoryTx,
  input: {
    readonly bookingId: string;
    readonly guestPersonId: string;
    readonly invitationId: string;
  },
): Promise<Written<{ readonly bookingId: string }>> {
  const [booking] = await tx
    .select({ id: schema.bookings.id, status: schema.bookings.status })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, input.bookingId))
    .limit(1);

  if (!booking) {
    return refused({
      code: "NO_SUCH_BOOKING",
      message: "That booking is not on file.",
    });
  }

  if (booking.status !== "draft" && booking.status !== "confirmed") {
    return refused({
      code: "BOOKING_CLOSED",
      message: "That booking has been through the range or was cancelled.",
    });
  }

  await tx
    .insert(schema.bookingParticipants)
    .values({
      id: uuidv7(),
      bookingId: input.bookingId,
      personId: input.guestPersonId,
      role: "guest_shooter",
      guestInvitationId: input.invitationId,
    })
    .onConflictDoNothing();

  return applied({ bookingId: input.bookingId }, [
    {
      action: "booking.add_guest",
      entityType: "booking",
      entityId: input.bookingId,
      after: {
        guestPersonId: input.guestPersonId,
        invitationId: input.invitationId,
      },
    },
  ]);
}

/* ============================================================================
   TRANSITIONS
   ========================================================================= */

export async function applyBookingEvent(
  tx: ArmoryTx,
  input: {
    readonly bookingId: string;
    readonly event: BookingEvent;
    readonly occurredAt: Date;
    /** Positions available for this discipline and slot. Checked on confirm. */
    readonly capacity?: number;
  },
): Promise<Written<BookingResult>> {
  const [booking] = await tx
    .select({
      id: schema.bookings.id,
      hostMembershipId: schema.bookings.hostMembershipId,
      status: schema.bookings.status,
      slotStart: schema.bookings.slotStart,
      slotEnd: schema.bookings.slotEnd,
      discipline: schema.bookings.discipline,
    })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, input.bookingId))
    .limit(1);

  if (!booking) {
    return refused({
      code: "NO_SUCH_BOOKING",
      message: "That booking is not on file.",
    });
  }

  /* §5: cancellation releases one allowance per invitation still holding one.
     Counted before the transition, because the transition needs the number to
     emit the right number of effects — a loop that released one would leak a
     guest slot per cancellation for the life of the club. */
  const heldAllowances = await countHeldInvitations(tx, booking.id);

  const transition = bookingTransition(booking.status, input.event, {
    id: booking.id,
    hostMembershipId: booking.hostMembershipId,
    heldAllowances,
  });

  if (!transition.ok) {
    return refused({ code: transition.code, message: transition.message }, [
      {
        action: `booking.${input.event.type}`,
        entityType: "booking",
        entityId: booking.id,
        before: { status: booking.status },
      },
    ]);
  }

  /* Capacity, checked here rather than in the pure transition because it is a
     fact about the range at this instant and the transition has no database.
     Only on confirm: cancelling a booking on a full slot must always work. */
  if (input.event.type === "confirm" && input.capacity !== undefined) {
    const positions = await countParticipants(tx, booking.id);
    const taken = await positionsTakenInSlot(tx, {
      discipline: booking.discipline,
      slotStart: booking.slotStart,
      slotEnd: booking.slotEnd,
      excludeBookingId: booking.id,
    });

    if (taken + positions > input.capacity) {
      return refused(
        {
          code: "SLOT_FULL",
          message:
            positions === 1
              ? "That session filled up while you were booking. Choose another time."
              : `There is not room for ${positions} on that session any more. Choose another time.`,
        },
        [
          {
            action: "booking.confirm",
            entityType: "booking",
            entityId: booking.id,
            before: { status: booking.status },
            after: { taken, positions, capacity: input.capacity },
          },
        ],
      );
    }
  }

  const audit: AuditDraft[] = [
    {
      action: `booking.${input.event.type}`,
      entityType: "booking",
      entityId: booking.id,
      before: { status: booking.status },
      after: { status: transition.to },
    },
  ];

  await tx
    .update(schema.bookings)
    .set({
      status: transition.to,
      updatedAt: input.occurredAt,
      ...(transition.to === "cancelled" ? { cancelledAt: input.occurredAt } : {}),
    })
    .where(eq(schema.bookings.id, booking.id));

  for (const effect of transition.effects) {
    if (effect.kind === "release_allowance") {
      const [allowance] = await tx
        .select({ id: schema.hostAllowances.id })
        .from(schema.hostAllowances)
        .where(eq(schema.hostAllowances.membershipId, effect.membershipId))
        .orderBy(schema.hostAllowances.periodStart)
        .limit(1);

      if (allowance) await releaseAllowance(tx, allowance.id);
    }
    /* `release_lane_capacity` needs no write. Capacity is DERIVED from
       confirmed bookings (src/domain/availability.ts) rather than held in a
       counter, so a cancelled booking releases its lane by no longer being
       confirmed. A counter would be a second source of truth for the same fact,
       and §6.2 forbids exactly that: "never a manually maintained calendar." */
  }

  /* The invitations attached to a cancelled booking are cancelled too. Their
     allowance was released above by the booking's own effects, so the event
     here is a status move only — cancelling each invitation individually would
     release the same allowance twice. */
  if (transition.to === "cancelled") {
    await tx
      .update(schema.guestInvitations)
      .set({ status: "cancelled", cancelledAt: input.occurredAt })
      .where(
        and(
          eq(schema.guestInvitations.bookingId, booking.id),
          inArray(schema.guestInvitations.status, [
            "issued",
            "opened",
            "completed",
          ]),
        ),
      );
  }

  return applied({ bookingId: booking.id, status: transition.to }, audit);
}

/* ============================================================================
   COUNTING
   ========================================================================= */

async function countParticipants(
  tx: ArmoryTx,
  bookingId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.bookingParticipants)
    .where(eq(schema.bookingParticipants.bookingId, bookingId));

  return row?.count ?? 0;
}

/** Invitations against this booking that are still holding an allowance. */
async function countHeldInvitations(
  tx: ArmoryTx,
  bookingId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.guestInvitations)
    .where(
      and(
        eq(schema.guestInvitations.bookingId, bookingId),
        /* The same three states §5 says return allowance. `attended` is
           terminal and keeps it — the guest came. */
        inArray(schema.guestInvitations.status, ["issued", "opened", "completed"]),
      ),
    );

  return row?.count ?? 0;
}

/**
 * Firing positions already committed on a slot.
 *
 * Confirmed bookings only. A draft holds nothing — see the header — so two
 * members may be assembling bookings for the same last slot and the first to
 * confirm gets it.
 */
async function positionsTakenInSlot(
  tx: ArmoryTx,
  input: {
    discipline: string;
    slotStart: Date;
    slotEnd: Date;
    excludeBookingId: string;
  },
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.bookingParticipants)
    .innerJoin(
      schema.bookings,
      eq(schema.bookings.id, schema.bookingParticipants.bookingId),
    )
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        eq(schema.bookings.discipline, input.discipline),
        sql`${schema.bookings.id} <> ${input.excludeBookingId}`,
        /* Half-open overlap, matching `overlaps` in availability.ts. A booking
           ending at 18:00 does not collide with a slot starting at 18:00. */
        sql`${schema.bookings.slotStart} < ${input.slotEnd}`,
        sql`${schema.bookings.slotEnd} > ${input.slotStart}`,
      ),
    );

  return row?.count ?? 0;
}

/**
 * Bookings in a window, for the availability query (§6.2).
 *
 * Confirmed only, for the same reason as above, and with the participant count
 * per booking — availability counts PEOPLE, not bookings. A member bringing two
 * guests takes three positions, and counting bookings is how a range ends up
 * double-booked on a Saturday.
 */
export async function bookedSlotsFrom(
  tx: ArmoryReader,
  input: { readonly from: Date; readonly discipline: string },
): Promise<
  { slotStart: Date; slotEnd: Date; discipline: string; positions: number }[]
> {
  return tx
    .select({
      slotStart: schema.bookings.slotStart,
      slotEnd: schema.bookings.slotEnd,
      discipline: schema.bookings.discipline,
      positions: sql<number>`count(${schema.bookingParticipants.id})::int`,
    })
    .from(schema.bookings)
    .leftJoin(
      schema.bookingParticipants,
      eq(schema.bookingParticipants.bookingId, schema.bookings.id),
    )
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        eq(schema.bookings.discipline, input.discipline),
        gte(schema.bookings.slotStart, input.from),
      ),
    )
    .groupBy(
      schema.bookings.id,
      schema.bookings.slotStart,
      schema.bookings.slotEnd,
      schema.bookings.discipline,
    );
}
