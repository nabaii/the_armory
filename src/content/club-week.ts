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
 * Hours alone do not make a calendar. `club_settings.session_minutes` decides
 * how long one booking occupies a lane, and until it is set the grid produces
 * nothing and says so — `emptyReason` names it specifically rather than letting
 * the screen read as a busy club. `table_capacity` is the same story for the
 * deck. Both remain in the outstanding register.
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
