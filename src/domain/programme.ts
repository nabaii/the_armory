import type { ProgrammeKind } from "@/domain/enums";
import type { OpeningPeriod } from "@/domain/availability";
import { lagosDateKey, lagosInstant, lagosParts } from "@/lib/time";

/**
 * THE CLUB'S WEEK — Members Portal §7.3.
 *
 *   "A Diary populated only by special occasions will be empty most weeks, and
 *    an empty calendar signals a dead club more loudly than no calendar at all.
 *    The surface survives because it draws on three feeds of very different
 *    frequency."
 *
 * ===========================================================================
 * THREE FEEDS, ONE LIST, AND THE MERGE IS THE WHOLE FILE
 *
 *   operating rhythm   every day       opening_hours          derived
 *   fixtures           weekly in season public leagues        derived
 *   events             occasional      armory.events          rows
 *
 * Two of the three are already facts the club holds elsewhere, and this module
 * deliberately writes nothing: it takes the three inputs and produces one
 * ordered list for a day. Copying fixtures into the events table would have
 * been easier and would have created a second source of truth for when a league
 * round is — and the first one to drift would be a member arriving for a round
 * that had moved.
 *
 * ===========================================================================
 * A CLOSURE OUTRANKS EVERYTHING, AND THAT IS THE MOST IMPORTANT RULE HERE
 *
 * A member who drives to the National Stadium on a Thursday because the portal
 * said the range was open is the single worst thing this surface can do. It
 * costs the club a member and it is entirely preventable.
 *
 * So a `closure` on a day suppresses that day's service periods rather than
 * sitting alongside them. The club never has to remember to edit its opening
 * hours for a public holiday and remember to put them back — which is the
 * version of this feature that fails, because the second half is the half
 * everybody forgets.
 *
 * Fixtures and events are NOT suppressed. A closure of the range does not
 * necessarily cancel a dinner, and silently deleting something the club
 * announced would be a worse failure than showing both. Where the two genuinely
 * conflict the club writes one closure and cancels the event; that is an
 * operational act, and this module will not perform it by inference.
 */

/* ============================================================================
   THE ENTRY
   ========================================================================= */

/**
 * What kind of thing this is.
 *
 * `service` is the derived one — it has no row anywhere and exists only as a
 * projection of an opening period onto a date.
 */
export type ProgrammeEntryKind = "service" | ProgrammeKind;

export type ProgrammeEntry = {
  readonly kind: ProgrammeEntryKind;
  readonly title: string;
  readonly detail: string | null;
  /** Minutes since Lagos midnight. Null on both means all day. */
  readonly startsMinute: number | null;
  readonly endsMinute: number | null;
  /**
   * Whether an officer is on the floor. Only meaningful on `service`, and it is
   * the difference between "the club is open" and "you can shoot", which is a
   * distinction a member will otherwise discover on arrival.
   */
  readonly staffed: boolean;
};

/** One published one-off, as the programme sees it. */
export type ProgrammeEvent = {
  readonly kind: ProgrammeKind;
  readonly title: string;
  readonly detail: string | null;
  /** Lagos date key, `YYYY-MM-DD`. */
  readonly onDate: string;
  readonly startsMinute: number | null;
  readonly endsMinute: number | null;
};

/** One league round due in a week, from the leagues product. */
export type ProgrammeFixture = {
  readonly title: string;
  readonly detail: string | null;
  /** Lagos date key. Fixtures are anchored to a weekday, not to a time. */
  readonly onDate: string;
};

/* ============================================================================
   THE MERGE
   ========================================================================= */

export type ProgrammeDay = {
  /** Lagos date key, `YYYY-MM-DD`. */
  readonly dateKey: string;
  /** Lagos midnight on this day, for formatting. */
  readonly date: Date;
  readonly entries: readonly ProgrammeEntry[];
  /** True where a closure suppressed the day's service periods. */
  readonly closed: boolean;
};

export function programmeForDay(input: {
  readonly date: Date;
  readonly openingHours: readonly OpeningPeriod[];
  readonly events: readonly ProgrammeEvent[];
  readonly fixtures: readonly ProgrammeFixture[];
}): ProgrammeDay {
  const { date, openingHours, events, fixtures } = input;

  const parts = lagosParts(date);
  const dateKey = lagosDateKey(date);
  const dayStart = lagosInstant(parts.year, parts.month, parts.day, 0, 0);

  const onThisDay = events.filter((event) => event.onDate === dateKey);
  const closures = onThisDay.filter((event) => event.kind === "closure");
  const closed = closures.length > 0;

  const entries: ProgrammeEntry[] = [];

  /* ---- 1. The operating rhythm. Suppressed entirely by a closure. --------- */
  if (!closed) {
    for (const period of openingHours) {
      if (period.weekday !== parts.weekday) continue;
      entries.push({
        kind: "service",
        /* The club's own words where it has written them. The fallback is not
           a label the club chose, so it says only what is certainly true. */
        title: period.label?.trim() || (period.staffed ? "Range open" : "Club open"),
        detail: period.staffed ? null : "No range officer on the floor.",
        startsMinute: period.opens,
        endsMinute: period.closes,
        staffed: period.staffed,
      });
    }
  }

  /* ---- 2. The one-offs, closures included. -------------------------------- */
  for (const event of onThisDay) {
    entries.push({
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      startsMinute: event.startsMinute,
      endsMinute: event.endsMinute,
      staffed: false,
    });
  }

  /* ---- 3. Fixtures. ------------------------------------------------------- */
  for (const fixture of fixtures.filter((f) => f.onDate === dateKey)) {
    entries.push({
      kind: "fixture",
      title: fixture.title,
      detail: fixture.detail,
      startsMinute: null,
      endsMinute: null,
      staffed: false,
    });
  }

  return { dateKey, date: dayStart, entries: entries.sort(byTime), closed };
}

/**
 * Ordered by when it starts, with all-day entries first.
 *
 * All-day first because an entry with no time is usually the frame the timed
 * ones sit inside — a closure, a tournament running all day — and reading it
 * after the 18:00 fixture it governs is reading it too late.
 *
 * The tiebreak is a fixed kind order rather than insertion order, so a day's
 * programme does not reshuffle when the founder adds an event. §6.3's argument
 * about computed ordering on Today applies to a list a member learns to read.
 */
const KIND_ORDER: Record<ProgrammeEntryKind, number> = {
  closure: 0,
  service: 1,
  fixture: 2,
  event: 3,
};

function byTime(a: ProgrammeEntry, b: ProgrammeEntry): number {
  if (a.startsMinute === null && b.startsMinute !== null) return -1;
  if (a.startsMinute !== null && b.startsMinute === null) return 1;
  if (a.startsMinute !== null && b.startsMinute !== null) {
    if (a.startsMinute !== b.startsMinute) return a.startsMinute - b.startsMinute;
  }
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}

/* ============================================================================
   THE WEEK
   ========================================================================= */

/**
 * Seven Lagos days beginning on `from`.
 *
 * Rolling from today rather than snapping to a Monday. §7.2's week strip is a
 * date selector, and a member opening the Diary on a Saturday wants the days in
 * front of them — a strip that starts on the Monday they cannot travel back to
 * spends two of its seven cells on the past.
 */
export function weekFrom(from: Date, days = 7): Date[] {
  const parts = lagosParts(from);
  return Array.from({ length: days }, (_, offset) =>
    lagosInstant(parts.year, parts.month, parts.day + offset, 0, 0),
  );
}

/**
 * Whether a day has anything on it at all.
 *
 * Used by the week strip to mark days worth tapping. A strip where every day
 * looks identical is a row of dates, and the member reads none of them.
 */
export const hasProgramme = (day: ProgrammeDay): boolean =>
  day.entries.length > 0;
