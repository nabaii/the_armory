import type { BookingType } from "@/domain/enums";
import { lagosDateKey, lagosInstant, lagosParts } from "@/lib/time";

/**
 * AVAILABILITY — §6.2.
 *
 *   "Availability computed from lanes, hours, officer coverage and existing
 *    bookings — NEVER A MANUALLY MAINTAINED CALENDAR."
 *
 * The capitalised half is the requirement. A calendar somebody maintains by hand
 * is wrong the first time a lane goes into maintenance and nobody updates it,
 * and the club finds out when a member arrives to shoot on it. So every slot
 * this function returns is derived, and the derivation is the whole file.
 *
 * ===========================================================================
 * §14 LEAVES THREE OF THE FOUR INPUTS OPEN
 *
 * "Lanes per discipline, session length, opening hours — Blocks: availability
 * computation, roster cap. Needed by: Before M4."
 *
 * They have not landed. The same treatment as the roster cap in
 * src/domain/roster.ts: this file owns the computation and never the values.
 * They arrive as an `AvailabilityPolicy`, so settling §14 is configuration
 * rather than a change to how availability works.
 *
 * ===========================================================================
 * OFFICER COVERAGE IS DECLARED, NOT ROSTERED — AND THAT IS DELIBERATE
 *
 * §6.2 lists "officer coverage" as an input, which reads like a query against a
 * staff rota. There is no such table and there must not be one, because §13 puts
 * it out of scope in as many words:
 *
 *   "Range officer rostering — WhatsApp and a spreadsheet."
 *
 * Building a rota to satisfy §6.2 would be building the thing §13 says not to
 * build, and it would be the worst kind of scope creep: a second source of truth
 * for who is working, maintained by nobody, silently disagreeing with the
 * spreadsheet the club actually uses.
 *
 * So coverage is a property of an opening period — `staffed` below. The club
 * declares the hours it has an officer on the floor, which is a fact it already
 * knows and already writes down. When Phase 2 brings a rota, this field becomes
 * its projection and nothing else changes.
 */

/* ============================================================================
   THE POLICY — §14's open items
   ========================================================================= */

/** Minutes since Lagos midnight. 09:00 is 540. */
export type MinuteOfDay = number;

export const minuteOfDay = (hours: number, minutes = 0): MinuteOfDay =>
  hours * 60 + minutes;

/** A stretch of one weekday when the range is open. */
export type OpeningPeriod = {
  /** 0 = Sunday, matching Date#getDay. */
  readonly weekday: number;
  readonly opens: MinuteOfDay;
  readonly closes: MinuteOfDay;
  /**
   * Whether an officer is on the floor for this period. §13 keeps the rota out
   * of the system, so this is declared rather than derived — see the header.
   *
   * An unstaffed period yields NO slots. The club does not run a range without
   * an officer, and availability that offered one would be offering something
   * the club cannot deliver.
   */
  readonly staffed: boolean;
  /**
   * What the club calls this period — "Range and deck", "Deck and kitchen
   * only". Rendered by the Diary's operating-rhythm feed and never parsed.
   *
   * Optional because availability does not need it: an unnamed period is a
   * perfectly good period and the club should not have to write a label to
   * open on a Tuesday.
   */
  readonly label?: string | null;
};

export type AvailabilityPolicy = {
  /** §14. How long one booking occupies a lane. The MEMBER's time. */
  readonly sessionMinutes: number;
  /**
   * The club's turnaround between one session and the next, in minutes.
   *
   * ===========================================================================
   * THE SLOT GRID STEPS BY session + turnaround. A BOOKING STILL ENDS AT session.
   *
   * With a 60-minute session and a 15-minute buffer the club's day is
   * 09:00, 10:15, 11:30, 12:45 … and a member who takes the first of those has
   * a booking that ends at 10:00. The quarter hour after it is the range's:
   * clearing the line, resetting targets, one relay off and the next briefed.
   *
   * Folding the two into a single "slot length" was the obvious simplification
   * and it is wrong in a way that would surface at the desk. The booking record
   * would say the member had the lane until 10:15; the officer would be walking
   * them off at 10:00; and the one holding the phone would be right about what
   * they were sold. Two numbers, two owners.
   *
   * Zero is a coherent answer — back-to-back sessions — and is what every club
   * running this system had before the column existed.
   */
  readonly turnaroundMinutes: number;
  /** §14. */
  readonly openingHours: readonly OpeningPeriod[];
  /**
   * The least notice the club accepts. Distinct from a tier's booking horizon
   * (§4 MAY_BOOK), which is the far end of the same window and belongs to the
   * member rather than to the range.
   */
  readonly leadTimeMinutes: number;
  /**
   * Covers at the tables — Members Portal §7.4.
   *
   *   "Availability must model table capacity separately from lane capacity.
   *    A table-only booking consumes no lane."
   *
   * NULL MEANS THE CLUB HAS NOT COUNTED ITS COVERS, and that is treated as
   * "table bookings are not open yet" rather than as unlimited. Unlimited is
   * the tempting default and it is the one that sells a Friday evening the
   * kitchen cannot serve — the hospitality equivalent of double-booking a lane,
   * and exactly as embarrassing in front of a guest (P5).
   */
  readonly tableCapacity: number | null;
};

/**
 * A policy that produces nothing, and says why.
 *
 * The default is deliberately empty rather than a plausible-looking week. §14 is
 * unsettled, and a default of "nine to five, Monday to Saturday" would be a
 * guess that works — which is exactly how a guess survives into production and
 * becomes the club's opening hours by accident. An empty week produces no slots
 * and sends somebody to ask the founder.
 */
export const UNCONFIGURED_AVAILABILITY: AvailabilityPolicy = {
  sessionMinutes: 60,
  turnaroundMinutes: 0,
  openingHours: [],
  leadTimeMinutes: 60,
  tableCapacity: null,
};

/* ============================================================================
   THE INPUTS
   ========================================================================= */

export type LaneInfo = {
  readonly id: string;
  readonly discipline: string;
  /** §3.3: available | maintenance | closed. Only `available` yields capacity. */
  readonly status: "available" | "maintenance" | "closed";
  /** How many shooters this lane holds at once. */
  readonly positionCapacity: number;
};

/** An existing booking, as availability sees it. */
export type BookedSlot = {
  readonly slotStart: Date;
  readonly slotEnd: Date;
  /** Null where the booking touches no firing line — §7.4's table and spectate. */
  readonly discipline: string | null;
  readonly bookingType: BookingType;
  /**
   * How many PEOPLE this booking brings — the host plus their guests. Not one
   * per booking: a member bringing two guests takes three positions, and
   * counting bookings instead of people is how a range ends up double-booked on
   * a Saturday.
   *
   * What those people consume depends on the booking type. `occupancyOf` below
   * is the only place that mapping lives.
   */
  readonly positions: number;
};

/* ============================================================================
   WHAT A BOOKING CONSUMES — §7.4
   ========================================================================= */

/**
 * The two finite things a booking can take, per booking type.
 *
 * ===========================================================================
 * WHY THIS IS ONE FUNCTION AND NOT A CONDITION IN EACH QUERY
 *
 * There are three places that need to know what a `both` booking costs: the
 * lane grid, the table grid, and the capacity check at commit. Written inline
 * they will agree for about a month. The first one to be updated for a fifth
 * booking type and not the others produces a range that is full according to
 * one screen and open according to another — and the member finds out at the
 * door, which P5 names as the outcome this system is arranged to prevent.
 *
 * ===========================================================================
 * A SPECTATOR CONSUMES NEITHER, AND THAT IS AN OPEN QUESTION, NOT A FINDING
 *
 * §7.4 says a spectator "consumes neither, but does consume a seat and a name
 * on the arrivals list". A name on the arrivals list is unconditional and is
 * the more important half — a person in the building the desk did not expect
 * is the failure the row prevents. Whether a spectator also occupies one of
 * the club's covers is a question about how the club seats people, which the
 * club has not answered, so this returns zero and the question is registered
 * in the outstanding register (`spectator-capacity`) rather than guessed.
 *
 * Zero is the direction that fails safe against P2: a spectator who turns out
 * to need a cover is a seat found on the night, whereas a guessed cover count
 * silently refuses bookings the club would have taken and nobody ever sees it.
 */
export function occupancyOf(
  type: BookingType,
  people: number,
): { readonly lane: number; readonly table: number } {
  switch (type) {
    case "shoot":
      return { lane: people, table: 0 };
    case "table":
      return { lane: 0, table: people };
    case "both":
      return { lane: people, table: people };
    case "spectate":
      return { lane: 0, table: 0 };
  }
}

/** Whether this booking type needs a discipline. The CHECK in 0008, in TypeScript. */
export const usesLane = (type: BookingType): boolean =>
  type === "shoot" || type === "both";

export type Slot = {
  /** Stable id: the Lagos date and time, e.g. `2026-08-14T18:00`. */
  readonly id: string;
  readonly start: Date;
  readonly end: Date;
  /** Null on a table slot — a table is not a discipline. */
  readonly discipline: string | null;
  /** Positions across every available lane for this discipline, or covers. */
  readonly capacity: number;
  readonly taken: number;
  readonly free: number;
};

/* ============================================================================
   THE COMPUTATION
   ========================================================================= */

/**
 * Capacity for one discipline: positions across lanes that are actually usable.
 *
 * `maintenance` and `closed` contribute nothing. That is the case a hand-kept
 * calendar always gets wrong, and the reason §6.2 forbids one.
 */
export function capacityFor(
  lanes: readonly LaneInfo[],
  discipline: string,
): number {
  return lanes
    .filter((lane) => lane.discipline === discipline && lane.status === "available")
    .reduce((total, lane) => total + lane.positionCapacity, 0);
}

/**
 * Every slot for one discipline across a window, with what is left in each.
 *
 * Pure and deterministic: the same arguments give the same slots, which is what
 * lets the portal render a slot id and the server resolve the identical instant
 * without a shared session.
 *
 * Slots that are full are RETURNED, with `free: 0`, rather than filtered out.
 * §6.2 gives the member a picture of the week, and a Saturday that silently
 * vanishes because it is busy reads as the club being closed — which sends them
 * to WhatsApp to ask, which is the phone call the portal exists to prevent.
 */
export function availableSlots(input: {
  readonly policy: AvailabilityPolicy;
  readonly lanes: readonly LaneInfo[];
  readonly booked: readonly BookedSlot[];
  readonly discipline: string;
  readonly now: Date;
  /** How many Lagos days to project, starting today. */
  readonly days: number;
}): Slot[] {
  const { policy, lanes, booked, discipline, now, days } = input;

  const capacity = capacityFor(lanes, discipline);
  if (capacity === 0) return [];

  return grid({
    policy,
    now,
    days,
    /* A firing point needs an officer on the floor. §13 keeps the rota out of
       the system, so an unstaffed period is simply not available — the club
       does not run a range without an officer. */
    staffedOnly: true,
    measure: (start, end) => {
      const taken = booked
        .filter(
          (existing) =>
            existing.discipline === discipline &&
            overlaps(
              start,
              end,
              existing.slotStart,
              occupiedUntil(existing, policy.turnaroundMinutes),
            ),
        )
        .reduce(
          (total, existing) =>
            total + occupancyOf(existing.bookingType, existing.positions).lane,
          0,
        );

      return {
        id: slotId(start),
        start,
        end,
        discipline,
        capacity,
        taken,
        free: Math.max(0, capacity - taken),
      };
    },
  });
}

/**
 * The same week, counted in covers rather than firing points — §7.4.
 *
 * ===========================================================================
 * TWO DIFFERENCES FROM THE LANE GRID, BOTH DELIBERATE
 *
 * 1. IT DOES NOT REQUIRE AN OFFICER. The deck can be open on an evening the
 *    range is not, and a club whose system could not express that would be a
 *    booking tool with a calendar bolted on — which is precisely the priority
 *    inversion P4 names as a structural risk.
 *
 * 2. A NULL CAPACITY YIELDS NOTHING, and says so through `emptyTableReason`
 *    rather than by rendering an empty grid. The club has not counted its
 *    covers; that is a fact about the club, not an absence of tables.
 */
export function availableTables(input: {
  readonly policy: AvailabilityPolicy;
  readonly booked: readonly BookedSlot[];
  readonly now: Date;
  readonly days: number;
}): Slot[] {
  const { policy, booked, now, days } = input;

  const capacity = policy.tableCapacity;
  if (capacity === null || capacity <= 0) return [];

  return grid({
    policy,
    now,
    days,
    staffedOnly: false,
    measure: (start, end) => {
      const taken = booked
        .filter((existing) =>
          overlaps(
            start,
            end,
            existing.slotStart,
            /* A table needs clearing and laying too. The same buffer, for the
               same reason — and the same no-op on an aligned grid. */
            occupiedUntil(existing, policy.turnaroundMinutes),
          ),
        )
        .reduce(
          (total, existing) =>
            total + occupancyOf(existing.bookingType, existing.positions).table,
          0,
        );

      return {
        id: slotId(start),
        start,
        end,
        /* A table is not a discipline and must never be labelled as one. */
        discipline: null,
        capacity,
        taken,
        free: Math.max(0, capacity - taken),
      };
    },
  });
}

/**
 * The slot grid itself: every session start the club's week produces.
 *
 * Extracted because the lane grid and the table grid must step through
 * identically. Two copies of this loop would drift on the one thing that must
 * never drift — a slot id — and a member would be shown a 18:00 table that the
 * server resolved to a different instant from the 18:00 lane beside it.
 */
function grid(input: {
  readonly policy: AvailabilityPolicy;
  readonly now: Date;
  readonly days: number;
  readonly staffedOnly: boolean;
  readonly measure: (start: Date, end: Date) => Slot;
}): Slot[] {
  const { policy, now, days, staffedOnly, measure } = input;

  if (policy.sessionMinutes <= 0) return [];

  /**
   * How far apart two sessions start — the member's hour plus the club's
   * turnaround.
   *
   * The FIT test below is against `sessionMinutes` alone, not against this.
   * A day closing at 18:00 offers a 17:00 session with a 60-minute length even
   * though its buffer would run past closing, because the buffer exists to
   * separate that session from the NEXT one and there is no next one. Testing
   * the step instead would silently cost the club its last slot of every day.
   */
  const step = policy.sessionMinutes + Math.max(0, policy.turnaroundMinutes);

  const earliest = now.getTime() + policy.leadTimeMinutes * 60_000;
  const slots: Slot[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    /* Stepped in Lagos calendar days rather than by adding 24 hours, so the
       projection does not drift. Lagos has no daylight saving today, which makes
       the two equivalent — and writing it the drifting way would leave a trap for
       whoever later reuses this for a club in a zone that does. */
    const dayStart = startOfLagosDayOffset(now, dayOffset);
    const parts = lagosParts(dayStart);

    for (const period of policy.openingHours) {
      /* The Lagos weekday, not the UTC one. Midnight Lagos is 23:00 UTC the
         previous day, so a UTC weekday would shift the club's whole schedule
         back by one day for the first hour of every day. */
      if (period.weekday !== parts.weekday) continue;
      if (staffedOnly && !period.staffed) continue;

      for (
        let minute = period.opens;
        minute + policy.sessionMinutes <= period.closes;
        minute += step
      ) {
        const start = lagosInstant(
          parts.year,
          parts.month,
          parts.day,
          Math.floor(minute / 60),
          minute % 60,
        );
        const end = new Date(start.getTime() + policy.sessionMinutes * 60_000);

        if (start.getTime() < earliest) continue;

        slots.push(measure(start, end));
      }
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Whether a booking occupies any part of a slot.
 *
 * Half-open on both sides: a booking ending at 18:00 does not collide with a
 * slot starting at 18:00. Getting this wrong in the inclusive direction loses
 * the club one slot in every pair, all day, every day.
 */
const overlaps = (
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean => startA < endB && startB < endA;

/**
 * How long a booking keeps a lane out of the grid — its own length, plus the
 * turnaround that has to happen before anybody else steps onto it.
 *
 * ===========================================================================
 * ON THE ALIGNED GRID THIS CHANGES NOTHING, AND THAT IS THE POINT
 *
 * Slots are spaced by session + turnaround, so a 09:00 booking extended to
 * 10:15 still does not collide with the 10:15 slot — the overlap test is
 * half-open, and `10:15 < 10:15` is false. Every on-grid booking behaves
 * exactly as it did before this function existed.
 *
 * What it protects is the OFF-GRID booking: one written by the desk for a
 * member who turned up, one from before the club set a turnaround, one from a
 * week when the hours were different. Those can end at 10:05, and without this
 * the 10:15 slot would look free while the line was still being cleared. The
 * grid's spacing is a promise about the range's day; this is what keeps the
 * promise when a booking did not come from the grid.
 */
const occupiedUntil = (
  booking: BookedSlot,
  turnaroundMinutes: number,
): Date =>
  turnaroundMinutes > 0
    ? new Date(booking.slotEnd.getTime() + turnaroundMinutes * 60_000)
    : booking.slotEnd;

/**
 * The slot id: Lagos date and time.
 *
 * Human-readable on purpose, following the same reasoning as
 * src/server/slots.ts: it is legible in a calendar entry, in a WhatsApp message
 * and in a support conversation, and it cannot drift from the time it names the
 * way an opaque identifier can.
 */
export function slotId(start: Date): string {
  const parts = lagosParts(start);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${lagosDateKey(start)}T${pad(parts.hours)}:${pad(parts.minutes)}`;
}

/** Lagos midnight, `offset` calendar days from the day containing `now`. */
function startOfLagosDayOffset(now: Date, offset: number): Date {
  const parts = lagosParts(now);
  return lagosInstant(parts.year, parts.month, parts.day + offset, 0, 0);
}

/**
 * Resolve a slot id the client sent back to the instant it names.
 *
 * The client picks from `availableSlots` and posts an id; the server must not
 * trust the id to be one it offered. Re-derived and checked against a fresh
 * computation by the caller — a slot id is a reference, never an authorisation.
 */
export function findSlot(
  slots: readonly Slot[],
  id: string,
): Slot | null {
  return slots.find((slot) => slot.id === id) ?? null;
}

/**
 * One line describing why a discipline has no slots at all.
 *
 * §4.3's rule applied to an empty list: "never a stack of conditions", and never
 * a blank screen either. A member looking at nothing is owed a sentence, and the
 * three reasons want completely different responses — one is a call to the club,
 * one is a wait, and one is somebody forgetting to configure the system.
 */
export function emptyReason(
  policy: AvailabilityPolicy,
  lanes: readonly LaneInfo[],
  discipline: string,
): string | null {
  if (policy.openingHours.length === 0) {
    return "The club has not published its opening hours yet.";
  }

  /**
   * Hours published, session length not.
   *
   * This branch could not be reached until the club published a week: with no
   * hours the first branch always answered first, and `sessionMinutes` was a
   * literal zero nobody could change. It is reachable the moment a founder sets
   * opening hours and stops — which is the likeliest way this configuration
   * gets half-done, because publishing the hours is the part that feels like
   * the whole job.
   *
   * Without it the screen falls through to "nothing free on this day", which is
   * the worst available answer: it is not true, it reads as a busy club, and it
   * sends the member to WhatsApp to ask why a range that is open has no
   * sessions. P2 wants the honest sentence, and the honest sentence names the
   * thing that is actually missing.
   */
  if (policy.sessionMinutes <= 0) {
    return "The club has not set how long a session runs, so nothing can be booked yet.";
  }

  const forDiscipline = lanes.filter((lane) => lane.discipline === discipline);
  if (forDiscipline.length === 0) {
    return `The club does not have a range for ${discipline}.`;
  }

  if (capacityFor(lanes, discipline) === 0) {
    return `Every ${discipline} lane is closed or under maintenance. Call the club.`;
  }

  if (!policy.openingHours.some((period) => period.staffed)) {
    return "No sessions are staffed at the moment. Call the club.";
  }

  return null;
}

/**
 * The same sentence for the tables — §7.4, and P2 applied to hospitality.
 *
 * The first branch is the one that will render for some period after opening,
 * and it is written as a fact about the club rather than as an apology. "Table
 * bookings are not open yet" is true, is not the member's problem to solve, and
 * does not suggest the application is broken.
 */
export function emptyTableReason(policy: AvailabilityPolicy): string | null {
  if (policy.tableCapacity === null) {
    return "Table bookings are not open yet.";
  }
  if (policy.tableCapacity === 0) {
    return "The club has no covers to book at the moment. Call the club.";
  }
  if (policy.openingHours.length === 0) {
    return "The club has not published its opening hours yet.";
  }
  /* The same half-configured state as the lane grid, and the same sentence.
     A member should not have to work out that "nothing free" and "nothing set
     up" are different problems. */
  if (policy.sessionMinutes <= 0) {
    return "The club has not set how long a session runs, so nothing can be booked yet.";
  }
  return null;
}
