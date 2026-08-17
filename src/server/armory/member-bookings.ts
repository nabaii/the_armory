import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { BookingStatus, BookingType } from "@/domain/enums";

/**
 * THE MEMBER'S OWN BOOKINGS — Members Portal §6.1's next-booking card, and the
 * booking detail at §7.2.
 *
 *   "Next booking | Date, time, discipline, lane, companions. Inline: add a
 *    guest, change, cancel."
 *
 * ===========================================================================
 * COMPANIONS ARE NAMED, NEVER COUNTED
 *
 * §10 is explicit about hosting — "Named, never counted" — and the card obeys
 * it. "You and 2 others" is the version that is easier to build and it is the
 * version that makes the club feel like a booking system: the member is not
 * bringing a quantity, they are bringing Ada and Tunde, and the card that says
 * so is the one worth opening.
 *
 * A guest who has not finished their link is a different fact from a guest who
 * has, and §14 puts abandonment on the risk register: "flagged to the host,
 * never to the guest. Escalating at forty-eight and twelve hours." So the
 * invitation's status travels with the name rather than being flattened away.
 *
 * ===========================================================================
 * ONLY CONFIRMED AND ONLY FUTURE
 *
 * A draft is a booking somebody started and did not finish. It holds no lane
 * capacity (see the header of bookings.ts) and it is not a commitment, so it is
 * not what "your next booking" means — a card promising a session that the
 * member never confirmed is the club telling them something untrue about their
 * own week.
 */

export type BookingCompanion = {
  readonly personId: string;
  readonly name: string;
  readonly isGuest: boolean;
  /** Null for a member. §14's abandonment flag, for a guest. */
  readonly invitationStatus: string | null;
};

export type MemberBooking = {
  readonly id: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly discipline: string | null;
  readonly bookingType: BookingType;
  readonly companions: readonly BookingCompanion[];
  /** How many people in total, host included. Availability's `positions`. */
  readonly partySize: number;
};

export async function upcomingBookingsFor(
  db: ArmoryReader,
  input: {
    readonly membershipId: string;
    readonly personId: string;
    readonly from: Date;
    readonly limit?: number;
  },
): Promise<MemberBooking[]> {
  const bookings = await db
    .select({
      id: schema.bookings.id,
      slotStart: schema.bookings.slotStart,
      slotEnd: schema.bookings.slotEnd,
      discipline: schema.bookings.discipline,
      bookingType: schema.bookings.bookingType,
    })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMembershipId, input.membershipId),
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.slotEnd, input.from),
      ),
    )
    .orderBy(asc(schema.bookings.slotStart))
    .limit(input.limit ?? 5);

  if (bookings.length === 0) return [];

  const participants = await db
    .select({
      bookingId: schema.bookingParticipants.bookingId,
      personId: schema.bookingParticipants.personId,
      role: schema.bookingParticipants.role,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      invitationStatus: schema.guestInvitations.status,
    })
    .from(schema.bookingParticipants)
    .innerJoin(schema.people, eq(schema.people.id, schema.bookingParticipants.personId))
    .leftJoin(
      schema.guestInvitations,
      eq(schema.guestInvitations.id, schema.bookingParticipants.guestInvitationId),
    )
    .where(
      inArray(
        schema.bookingParticipants.bookingId,
        bookings.map((booking) => booking.id),
      ),
    );

  return bookings.map((booking) => {
    const rows = participants.filter((row) => row.bookingId === booking.id);

    return {
      ...booking,
      partySize: rows.length,
      companions: rows
        /* The host is a participant in their own booking — they are shooting,
           not supervising — so they are counted in the party and excluded from
           the companions. A card reading "with Ada" is the fact; "with you and
           Ada" is the same fact said twice. */
        .filter((row) => row.personId !== input.personId)
        .map((row) => ({
          personId: row.personId,
          name: `${row.firstName} ${row.lastName}`,
          isGuest: row.role === "guest_shooter",
          invitationStatus: row.invitationStatus ?? null,
        })),
    };
  });
}

/**
 * One booking, and only if it is this member's.
 *
 * ===========================================================================
 * THE MEMBERSHIP IS IN THE WHERE CLAUSE, NOT IN A CHECK AFTERWARDS
 *
 * This is the read behind the booking detail screen and behind cancellation,
 * which means it is the read that decides whether one member can act on
 * another's booking. Written as a lookup by id followed by an `if` comparing
 * the owner, that decision lives in whoever remembers to write the `if` — and
 * the invitation cancel path in `hosting.ts` is the proof that somebody does
 * not: it took an id from a form, cancelled it, and never asked whose it was.
 *
 * Scoping the QUERY makes the wrong answer unreachable rather than merely
 * discouraged. A booking belonging to somebody else does not come back as a row
 * this caller has to be trusted to reject; it does not come back at all, and
 * every surface built on this inherits that for free.
 *
 * Status is deliberately not filtered. The detail screen has to be able to say
 * "this was cancelled" — a cancelled booking that vanishes into a not-found
 * page tells a member who just cancelled it that something went wrong.
 */
export async function memberBookingById(
  db: ArmoryReader,
  input: {
    readonly bookingId: string;
    readonly membershipId: string;
    readonly personId: string;
  },
): Promise<(MemberBooking & { readonly status: BookingStatus }) | null> {
  const [booking] = await db
    .select({
      id: schema.bookings.id,
      slotStart: schema.bookings.slotStart,
      slotEnd: schema.bookings.slotEnd,
      discipline: schema.bookings.discipline,
      bookingType: schema.bookings.bookingType,
      status: schema.bookings.status,
    })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.id, input.bookingId),
        /* The whole point. See the header. */
        eq(schema.bookings.hostMembershipId, input.membershipId),
      ),
    )
    .limit(1);

  if (!booking) return null;

  const rows = await db
    .select({
      personId: schema.bookingParticipants.personId,
      role: schema.bookingParticipants.role,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      invitationStatus: schema.guestInvitations.status,
    })
    .from(schema.bookingParticipants)
    .innerJoin(schema.people, eq(schema.people.id, schema.bookingParticipants.personId))
    .leftJoin(
      schema.guestInvitations,
      eq(schema.guestInvitations.id, schema.bookingParticipants.guestInvitationId),
    )
    .where(eq(schema.bookingParticipants.bookingId, booking.id));

  return {
    ...booking,
    partySize: rows.length,
    companions: rows
      .filter((row) => row.personId !== input.personId)
      .map((row) => ({
        personId: row.personId,
        name: `${row.firstName} ${row.lastName}`,
        isGuest: row.role === "guest_shooter",
        invitationStatus: row.invitationStatus ?? null,
      })),
  };
}

/** The one card §6.1 asks for. Null when the member has nothing booked. */
export async function nextBookingFor(
  db: ArmoryReader,
  input: { readonly membershipId: string; readonly personId: string; readonly now: Date },
): Promise<MemberBooking | null> {
  const [next] = await upcomingBookingsFor(db, {
    membershipId: input.membershipId,
    personId: input.personId,
    from: input.now,
    limit: 1,
  });

  return next ?? null;
}

/**
 * §10's Today card: "an upcoming booking with no guests attached and allowance
 * remaining. Suggestive, dismissible, and never repeated for the same booking."
 *
 * Returns the booking to prompt about, or null. The allowance half of the
 * condition is the CALLER's — this module does not read an allowance, because
 * whether a member may host is a permission and P1 puts that in one place.
 */
export function bookingWorthHosting(
  bookings: readonly MemberBooking[],
): MemberBooking | null {
  return (
    bookings.find(
      (booking) =>
        booking.companions.length === 0 &&
        /* A spectator booking is somebody watching. Suggesting they bring a
           guest to watch with them is a prompt for a thing the club has not
           thought about, so the prompt stays on the bookings where hosting is
           unambiguously what the club wants more of. */
        booking.bookingType !== "spectate",
    ) ?? null
  );
}

/**
 * Whether this booking is still the member's to change.
 *
 * A past booking is history and a cancelled one is gone. Exposed as a function
 * because the booking detail screen and the Today card must agree — a card
 * offering "cancel" on a session that started an hour ago is an offer the
 * server will refuse, which teaches a member not to trust the buttons.
 */
export const isAmendable = (booking: MemberBooking, now: Date): boolean =>
  booking.slotStart > now;

/** Confirmed bookings this member holds — MAY_BOOK's concurrent limit. */
export async function heldBookingCount(
  db: ArmoryReader,
  input: { readonly membershipId: string; readonly from: Date },
): Promise<number> {
  const rows = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMembershipId, input.membershipId),
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.slotEnd, input.from),
        /* Belt and braces against a status list that grows: anything that is
           not an active commitment must not count against the member's limit. */
        ne(schema.bookings.status, "cancelled"),
      ),
    );

  return rows.length;
}
