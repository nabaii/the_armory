import { asc, eq, inArray } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  UNCONFIGURED_AVAILABILITY,
  type AvailabilityPolicy,
  type LaneInfo,
  type OpeningPeriod,
} from "@/domain/availability";

/**
 * THE CLUB'S OWN SETTINGS, AS AVAILABILITY NEEDS THEM — Members Portal §12.2.
 *
 *   "Opening hours — column, migration, founder screen. Unblocks the
 *    availability grid, the operating-rhythm feed, the red action."
 *
 * Until drizzle/0008 there was no column, and both callers of `availableSlots`
 * passed `UNCONFIGURED_AVAILABILITY` — a literal, in application code, meaning
 * "we do not know". This module is the other half of that migration: the read
 * that turns rows into the policy the pure computation takes.
 *
 * ===========================================================================
 * IT STILL RETURNS UNCONFIGURED, AND THAT IS THE POINT
 *
 * An empty `opening_hours` table produces exactly the policy the literal did.
 * Nothing about shipping this migration publishes a single hour of the club's
 * week, and no screen changes until somebody tells the system when the club is
 * open. P2 of the Members Portal specification is emphatic about why that is
 * correct rather than incomplete:
 *
 *   "A booking calendar with no opening hours renders one honest sentence and
 *    nothing bookable, no matter how much interface is built on top of it —
 *    and that is correct behaviour, not a defect to route around."
 *
 * ===========================================================================
 * THE DEFAULTS BELOW ARE NOT THE CLUB'S HOURS
 *
 * Two of the three settings fall back rather than refusing, and the direction
 * of each fallback was chosen by asking which mistake is visible.
 *
 *   sessionMinutes    NO fallback that produces slots. Null means the club has
 *                     not said how long a session is, and inventing an hour
 *                     would put a number in front of members that nobody
 *                     agreed. Null yields no slots and the honest sentence.
 *   leadTimeMinutes   Falls back to zero — no minimum notice. The permissive
 *                     direction, because the strict one silently refuses
 *                     bookings the club would have taken and nobody ever sees
 *                     it happen.
 *   tableCapacity     Passed through as null, which `availableTables` reads as
 *                     "not open yet". Never unlimited. See §7.4.
 */

/**
 * How long a session runs when the club has not said.
 *
 * Zero, so `availableSlots` returns nothing. Named rather than inlined so the
 * next person to read this file cannot mistake it for a duration the club
 * chose — it is the absence of one.
 */
const NO_SESSION_LENGTH = 0;

export async function clubAvailabilityPolicy(
  db: ArmoryReader,
): Promise<AvailabilityPolicy> {
  const [settings] = await db
    .select({
      sessionMinutes: schema.clubSettings.sessionMinutes,
      bookingLeadTimeMinutes: schema.clubSettings.bookingLeadTimeMinutes,
      turnaroundMinutes: schema.clubSettings.turnaroundMinutes,
      tableCapacity: schema.clubSettings.tableCapacity,
    })
    .from(schema.clubSettings)
    .limit(1);

  const periods = await db
    .select({
      weekday: schema.openingHours.weekday,
      opens: schema.openingHours.opensMinute,
      closes: schema.openingHours.closesMinute,
      staffed: schema.openingHours.staffed,
      label: schema.openingHours.label,
    })
    .from(schema.openingHours)
    .orderBy(asc(schema.openingHours.weekday), asc(schema.openingHours.opensMinute));

  /**
   * When the kitchen and bar serve — Management §7.1, finding F3.
   *
   * A second read rather than a join, because the two lists answer different
   * questions and neither constrains the other: the range's day and the
   * kitchen's day overlap without either owning the other. An empty result is
   * the club's current state and means no table slots, which `availableTables`
   * enforces and `emptyTableReason` explains.
   */
  const service = await db
    .select({
      weekday: schema.serviceHours.weekday,
      opens: schema.serviceHours.opensMinute,
      closes: schema.serviceHours.closesMinute,
      label: schema.serviceHours.label,
    })
    .from(schema.serviceHours)
    .orderBy(asc(schema.serviceHours.weekday), asc(schema.serviceHours.opensMinute));

  /* No settings row at all is the same state as a settings row with nothing in
     it. Both mean the club has not decided, and neither is an error. */
  if (!settings) return UNCONFIGURED_AVAILABILITY;

  const openingHours: OpeningPeriod[] = periods.map((row) => ({
    weekday: row.weekday,
    opens: row.opens,
    closes: row.closes,
    staffed: row.staffed,
    label: row.label,
  }));

  return {
    sessionMinutes: settings.sessionMinutes ?? NO_SESSION_LENGTH,
    /* Zero, not a guess. Back-to-back sessions is a coherent operating
       decision and is what the system did before the column existed — see the
       column's own note in the schema for why this one value is safe to
       default when none of its neighbours are. */
    turnaroundMinutes: settings.turnaroundMinutes ?? 0,
    leadTimeMinutes: settings.bookingLeadTimeMinutes ?? 0,
    tableCapacity: settings.tableCapacity,
    openingHours,
    /* Never falls back. An empty list means the club has not published kitchen
       hours, and the permissive reading of that — serve whenever the doors are
       open — is the one that sells a lunch nobody is cooking. */
    servicePeriods: service,
  };
}

/**
 * The club's week, whether or not anything is bookable.
 *
 * A separate read from the policy because the Diary's operating-rhythm feed
 * (§7.3) wants the hours even when `sessionMinutes` is unset — the club can
 * publish that it is open on Thursday evenings before it has decided how long a
 * lane booking runs, and a member is better served by "open 18:00–21:00, no
 * bookings yet" than by a blank week.
 */
export async function clubOpeningHours(
  db: ArmoryReader,
): Promise<OpeningPeriod[]> {
  const policy = await clubAvailabilityPolicy(db);
  return [...policy.openingHours];
}

/**
 * Every lane the club has, as availability sees it.
 *
 * Reads all statuses rather than filtering to `available` in SQL: §6.2's
 * `emptyReason` distinguishes "the club does not run this discipline" from
 * "every lane for it is down", and it can only do that if it is shown the
 * lanes that are down.
 */
export async function clubLanes(db: ArmoryReader): Promise<LaneInfo[]> {
  const rows = await db
    .select({
      id: schema.lanes.id,
      discipline: schema.lanes.discipline,
      status: schema.lanes.status,
      positionCapacity: schema.lanes.positionCapacity,
    })
    .from(schema.lanes)
    .orderBy(asc(schema.lanes.discipline), asc(schema.lanes.number));

  return rows;
}

/**
 * The disciplines a member may be offered, in a stable order.
 *
 * Derived from the lanes rather than from a list in code, for the reason §6.2
 * gives about calendars: a discipline the club has no lane for is a discipline
 * the club cannot deliver, and a booking flow that offered it would be taking
 * a booking against nothing.
 */
export async function clubDisciplines(db: ArmoryReader): Promise<string[]> {
  const lanes = await clubLanes(db);
  return [...new Set(lanes.map((lane) => lane.discipline))].sort();
}

/**
 * Bookings in a window, for BOTH capacity grids.
 *
 * Replaces the discipline-filtered read that served the old single-grid
 * calendar. §7.4 made one query per discipline wrong twice over: a table
 * booking has no discipline to filter on and would have been invisible, and the
 * table grid needs every booking in the window regardless of line.
 *
 * Confirmed only. A draft holds nothing — see the header of bookings.ts — so
 * two members may be assembling bookings for the same last slot and the first
 * to confirm gets it.
 */
export async function bookedInWindow(
  db: ArmoryReader,
  input: { readonly from: Date; readonly to: Date },
) {
  const rows = await db
    .select({
      id: schema.bookings.id,
      slotStart: schema.bookings.slotStart,
      slotEnd: schema.bookings.slotEnd,
      discipline: schema.bookings.discipline,
      bookingType: schema.bookings.bookingType,
      participantId: schema.bookingParticipants.id,
    })
    .from(schema.bookings)
    .leftJoin(
      schema.bookingParticipants,
      eq(schema.bookingParticipants.bookingId, schema.bookings.id),
    )
    .where(
      /* The window is half-open at both ends, matching `overlaps` in
         availability.ts: a booking ending exactly when the window opens is not
         in it. */
      inArray(schema.bookings.status, ["confirmed"]),
    );

  /* Grouped in TypeScript rather than in SQL because the count is over
     participants and the filter is over a time range that Drizzle expresses
     more legibly here than in a GROUP BY with two boundary conditions. The set
     is one club's bookings in one window — tens of rows, not thousands. */
  const byBooking = new Map<
    string,
    {
      slotStart: Date;
      slotEnd: Date;
      discipline: string | null;
      bookingType: (typeof rows)[number]["bookingType"];
      positions: number;
    }
  >();

  for (const row of rows) {
    if (row.slotStart >= input.to || row.slotEnd <= input.from) continue;

    const existing = byBooking.get(row.id);
    if (existing) {
      if (row.participantId) existing.positions += 1;
      continue;
    }

    byBooking.set(row.id, {
      slotStart: row.slotStart,
      slotEnd: row.slotEnd,
      discipline: row.discipline,
      bookingType: row.bookingType,
      positions: row.participantId ? 1 : 0,
    });
  }

  return [...byBooking.values()];
}
