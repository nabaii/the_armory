import { eq } from "drizzle-orm";
import { schema } from "@/db/armory/client";
import { capacityFor } from "@/domain/availability";
import type { BookingEvent } from "@/domain/state-machines";
import { applyBookingEvent } from "@/server/armory/bookings";
import {
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";

/**
 * POST /api/bookings/:id — §5's booking machine.
 *
 *   "draft → confirmed → completed | cancelled | no_show. Cancellation releases
 *    allowance and lane capacity. NO_SHOW SET BY THE END-OF-DAY CLOSE, NOT
 *    MANUALLY."
 *
 * `mark_no_show` is accepted here and carries `source: "end_of_day_close"`,
 * which the transition checks and refuses when it is anything else. The endpoint
 * does not expose a way to say otherwise — a client cannot claim a different
 * source, so the guard in state-machines.ts cannot be talked round.
 *
 * That reads like belt and braces and is not: §6.4's End of day screen is the
 * caller, and the reason §5 restricts it is that a no-show has consequences for
 * a member's record. An officer marking one by hand at four in the afternoon,
 * before the member has arrived, is the failure being designed against.
 *
 * ===========================================================================
 * CAPACITY IS RESOLVED HERE AND CHECKED INSIDE THE TRANSACTION
 *
 * The lanes are read before the write and the total is passed in, but the
 * comparison against existing bookings happens inside `applyBookingEvent` —
 * against the same snapshot as the write. Comparing out here would be the same
 * mistake §8.3 names for allowances: a count that was true a moment ago.
 */

export const dynamic = "force-dynamic";

const EVENTS = ["confirm", "cancel", "complete", "mark_no_show"] as const;
type EventName = (typeof EVENTS)[number];

const isEvent = (value: unknown): value is EventName =>
  typeof value === "string" && (EVENTS as readonly string[]).includes(value);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { event } = write.envelope.payload;
  if (!isEvent(event)) {
    return malformed(`A booking event is one of: ${EVENTS.join(", ")}.`);
  }

  const domainEvent: BookingEvent =
    event === "mark_no_show"
      ? { type: "mark_no_show", source: "end_of_day_close" }
      : { type: event };

  return handleWrite(
    { envelope: write.envelope, operation: `bookings.${event}`, staff: auth.staff },
    async (tx) => {
      let capacity: number | undefined;

      if (event === "confirm") {
        const [booking] = await tx
          .select({ discipline: schema.bookings.discipline })
          .from(schema.bookings)
          .where(eq(schema.bookings.id, id))
          .limit(1);

        /* A booking with no discipline touches no firing line — §7.4's `table`
           and `spectate` — so there is no lane capacity to compute and none is
           passed. `applyBookingEvent` skips the check for the same reason. */
        if (booking?.discipline) {
          const discipline = booking.discipline;

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
      }

      return applyBookingEvent(tx, {
        bookingId: id,
        event: domainEvent,
        occurredAt: new Date(),
        capacity,
      });
    },
  );
}
