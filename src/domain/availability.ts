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
};

export type AvailabilityPolicy = {
  /** §14. How long one booking occupies a lane. */
  readonly sessionMinutes: number;
  /** §14. */
  readonly openingHours: readonly OpeningPeriod[];
  /**
   * The least notice the club accepts. Distinct from a tier's booking horizon
   * (§4 MAY_BOOK), which is the far end of the same window and belongs to the
   * member rather than to the range.
   */
  readonly leadTimeMinutes: number;
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
  openingHours: [],
  leadTimeMinutes: 60,
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
  readonly discipline: string;
  /**
   * How many firing positions this booking occupies — the host plus their
   * guests. Not one per booking: a member bringing two guests takes three
   * positions, and counting bookings instead of people is how a range ends up
   * double-booked on a Saturday.
   */
  readonly positions: number;
};

export type Slot = {
  /** Stable id: the Lagos date and time, e.g. `2026-08-14T18:00`. */
  readonly id: string;
  readonly start: Date;
  readonly end: Date;
  readonly discipline: string;
  /** Positions across every available lane for this discipline. */
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
  if (policy.sessionMinutes <= 0) return [];

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
      /* §13 keeps the rota out of the system; an unstaffed period is simply not
         available. The club does not run a range without an officer. */
      if (!period.staffed) continue;

      for (
        let minute = period.opens;
        minute + policy.sessionMinutes <= period.closes;
        minute += policy.sessionMinutes
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

        const taken = booked
          .filter(
            (existing) =>
              existing.discipline === discipline &&
              overlaps(start, end, existing.slotStart, existing.slotEnd),
          )
          .reduce((total, existing) => total + existing.positions, 0);

        slots.push({
          id: slotId(start),
          start,
          end,
          discipline,
          capacity,
          taken,
          free: Math.max(0, capacity - taken),
        });
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
