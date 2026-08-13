import { eq } from "drizzle-orm";
import { schema } from "@/db/armory/client";
import {
  UNCONFIGURED_AVAILABILITY,
  availableSlots,
  emptyReason,
} from "@/domain/availability";
import { bookedSlotsFrom } from "@/server/armory/bookings";
import { handleRead, malformed, requireStaff } from "@/server/armory/http";

/**
 * GET /api/availability?discipline=…&days=… — §6.2 "Book a session".
 *
 *   "Availability computed from lanes, hours, officer coverage and existing
 *    bookings — never a manually maintained calendar."
 *
 * A read, so no receipt and no audit — nothing happened. The computation is
 * src/domain/availability.ts and is pure; this route's whole job is to fetch the
 * four inputs and hand them over.
 *
 * ===========================================================================
 * THE POLICY IS NOT YET LOADED FROM ANYWHERE
 *
 * §14 lists "lanes per discipline, session length, opening hours" as blocking
 * this endpoint, and it has not landed. `UNCONFIGURED_AVAILABILITY` publishes no
 * opening hours, so this returns an empty list and a sentence saying the club has
 * not published them.
 *
 * That is the intended behaviour for now and it is why `emptyReason` exists: a
 * member sees an explanation rather than a blank week, and nobody can mistake an
 * unconfigured system for a fully booked one. When the founder settles §14 the
 * change is to load a policy here — the computation and its tests do not move.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  /* Staff-only for now. The member-facing portal read needs a MEMBER session,
     which is the leagues auth rather than a staff one — wiring those together is
     the portal work, and exposing this unauthenticated in the meantime would
     publish the club's occupancy to anyone who asked. */
  const auth = await requireStaff(request, { atLeast: "read_only" });
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const discipline = url.searchParams.get("discipline");
  if (!discipline) {
    return malformed("Ask for a discipline: ?discipline=pistol");
  }

  const days = Math.min(
    Math.max(Number(url.searchParams.get("days") ?? "14"), 1),
    60,
  );

  return handleRead("availability.query", async (tx) => {
    const lanes = await tx
      .select({
        id: schema.lanes.id,
        discipline: schema.lanes.discipline,
        status: schema.lanes.status,
        positionCapacity: schema.lanes.positionCapacity,
      })
      .from(schema.lanes)
      .where(eq(schema.lanes.discipline, discipline));

    const now = new Date();
    const policy = UNCONFIGURED_AVAILABILITY;

    const booked = await bookedSlotsFrom(tx, { from: now, discipline });

    const slots = availableSlots({
      policy,
      lanes,
      booked,
      discipline,
      now,
      days,
    });

    return {
      discipline,
      slots: slots.map((slot) => ({
        id: slot.id,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        capacity: slot.capacity,
        taken: slot.taken,
        free: slot.free,
      })),
      /* §4.3's rule applied to an empty list. Null when there is nothing wrong
         and the week is simply full. */
      reason: slots.length === 0 ? emptyReason(policy, lanes, discipline) : null,
    };
  });
}
