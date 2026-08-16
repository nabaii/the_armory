import { minuteOfDay, type OpeningPeriod } from "@/domain/availability";

/**
 * THE CLUB'S DECLARED WEEK — decided by the founder, 16 August 2026.
 *
 *   "Open from 9AM–6PM everyday."
 *
 * ===========================================================================
 * WHY THIS IS CONTENT AND STILL HAS TO BE APPLIED
 *
 * The portal reads `armory.opening_hours`, not this file. This is the club's
 * declaration in one reviewable place — the same role `src/content/ritual.ts`
 * and `src/content/tiers.ts` play — and `npm run db:hours` is what puts it in
 * the database.
 *
 * The indirection is deliberate and it is the same argument the whole system
 * makes about a manually maintained calendar (§6.2): once the hours are rows,
 * the founder can change a Tuesday without a deploy, and this file records what
 * was declared rather than becoming a second source of truth for what is true
 * today. If the two ever disagree, the DATABASE is right and this file is out
 * of date — which is why the script prints what it found before it writes.
 *
 * ===========================================================================
 * `staffed: true` ON ALL SEVEN DAYS IS AN ASSUMPTION, AND A CONSEQUENTIAL ONE
 *
 * `staffed` declares that a range officer is on the floor. An unstaffed period
 * yields NO shooting slots at all — the club does not run a range without an
 * officer — while still publishing to the Diary as "club open", which is how
 * the deck can be lit on an evening the range is not.
 *
 * "Open 9 to 6 every day" is read here as the RANGE being open 9 to 6 every
 * day, because that is what a shooting club saying it is open ordinarily means.
 * If the true answer is narrower — an officer only on certain days, or only
 * from noon — this is the one field to change, and changing it is the
 * difference between a bookable range and a lit deck.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT SETTLE
 *
 * `table_capacity` — how many covers the club can seat. Until it is set, table
 * bookings are not open and the Diary says so. It remains in the outstanding
 * register.
 */

/** 0 = Sunday, matching `Date#getDay` and `lagosParts().weekday`. */
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const OPENS = minuteOfDay(9);
export const CLOSES = minuteOfDay(18);

/**
 * What the club calls this period, rendered in the Diary as written.
 *
 * One label for all seven days because the club declared one week. The moment
 * a day differs — a late deck on Friday, a closed Monday morning — it becomes
 * its own row with its own label, which is exactly what the table is for.
 */
export const CLUB_WEEK: readonly OpeningPeriod[] = EVERY_DAY.map((weekday) => ({
  weekday,
  opens: OPENS,
  closes: CLOSES,
  staffed: true,
  label: "Range and deck",
}));

/** The same fact as one sentence, for the public site. */
export const CLUB_HOURS_LINE = "9am – 6pm, every day";

/* ============================================================================
   THE SESSION — decided by the founder, 16 August 2026

   "A standard session is 60 minutes. Make the booking system slot-based.
    60-minute default + 15-minute operational buffer."
   ========================================================================= */

/**
 * How long the lane is the member's.
 *
 * This is what their booking says, what the desk expects, and what they were
 * sold. It is NOT the spacing between slots — see the buffer below.
 */
export const SESSION_MINUTES = 60;

/**
 * The club's turnaround between one session and the next.
 *
 * Clearing the line, resetting targets, one relay off and the next briefed.
 * The grid steps by SESSION_MINUTES + TURNAROUND_MINUTES, so the club's day
 * runs 09:00, 10:15, 11:30, 12:45, 14:00, 15:15, 16:30 — seven sessions
 * between 9 and 6, each an hour long, each with a quarter hour behind it.
 *
 * The last of them ends at 17:30 and its buffer runs to 17:45, comfortably
 * inside closing. A 17:45 session would end at 18:45 and is not offered: the
 * fit test is against the session, not the step, so the club keeps every slot
 * that actually fits and offers none that does not.
 */
export const TURNAROUND_MINUTES = 15;

/**
 * The whole grid for one day of the declared week, as times.
 *
 * Exported for the tests and for anybody who wants to see the club's day
 * without running a query. It is derived from the three constants above rather
 * than typed out, so it cannot drift from what the portal computes.
 */
export function declaredSessionStarts(): number[] {
  const starts: number[] = [];
  for (
    let minute = OPENS;
    minute + SESSION_MINUTES <= CLOSES;
    minute += SESSION_MINUTES + TURNAROUND_MINUTES
  ) {
    starts.push(minute);
  }
  return starts;
}
