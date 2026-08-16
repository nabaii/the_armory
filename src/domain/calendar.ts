import {
  lagosDateKey,
  lagosInstant,
  lagosParts,
  startOfLagosDay,
} from "@/lib/time";
import type { ProgrammeDay, ProgrammeEntry } from "@/domain/programme";

/**
 * THE MONTH — Members Portal Design Specification §7.1, taken further.
 *
 *   "§7.1 — Today answers what am I doing. Diary answers what could I do …
 *    A member deciding whether to come in on the twenty-seventh, or noticing a
 *    fixture three weeks out, needs a surface Today cannot be."
 *
 * The Diary shipped with a rolling seven-day strip, which answers the first
 * half of that sentence and not the second. The twenty-seventh is reachable
 * from a strip only by tapping forward through it one day at a time, and a
 * fixture three weeks out is not visible at all — it is three screens of
 * tapping away, which in practice means nobody finds it. A member planning a
 * month cannot see a month.
 *
 * This module is the shape a month has. It is pure, it writes nothing, and it
 * takes the programme it is given: the merge in `programme.ts` remains the only
 * place that decides WHAT is on a day, and this decides only how days are
 * arranged and what is worth marking on them.
 *
 * ===========================================================================
 * WHY A MONTH AND NOT AN INFINITE SCROLL OF WEEKS
 *
 * A month is the unit people plan in. It is what a wall calendar shows, what a
 * fixture list is published against, and — decisively — it is a bounded surface
 * with a name, which means it can be a URL. `?month=2026-09` is a link a member
 * can send to somebody else and a state the back button restores. A scroll
 * position is none of those things, and §7.4's argument for putting the booking
 * flow's state in the URL applies here with more force, because a calendar is
 * the screen a member is most likely to want to send.
 *
 * ===========================================================================
 * THE GRID IS SIX ROWS WHEN IT NEEDS SIX, AND NOT OTHERWISE
 *
 * A fixed six-row grid is the common implementation and it is wrong on the
 * screen this club is designed for. On a phone, a month needing five rows and
 * rendered in six gives up a whole row of vertical space to nothing — which is
 * the row the day's detail would otherwise occupy above the fold. So the grid
 * is generated to the length the month actually needs, and the layout is told
 * how many rows it got rather than assuming.
 *
 * The cost is that the calendar changes height between months. That is honest:
 * months are different lengths, and a member has never once been confused by a
 * wall calendar for the same reason.
 */

/* ============================================================================
   MONTH KEYS
   ========================================================================= */

/** `YYYY-MM`, on the Lagos calendar. The Diary's `month` search parameter. */
export type MonthKey = string;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

/** The month an instant falls in, as seen in Lagos. */
export function monthKeyOf(instant: Date): MonthKey {
  const parts = lagosParts(instant);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}`;
}

/**
 * A month key as year and zero-indexed month, or null if it is not one.
 *
 * Returns null rather than throwing for the same reason `selectedDay` does in
 * the Diary: this value arrives from a URL a member can edit or a link somebody
 * sent them, and a calendar that renders a five-hundred error on a mistyped
 * month is worse than one that shows this month.
 */
export function parseMonthKey(
  raw: string | undefined | null,
): { readonly year: number; readonly month: number } | null {
  if (!raw) return null;

  const match = MONTH_KEY_PATTERN.exec(raw);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;

  if (month < 0 || month > 11) return null;
  /* A four-digit year is already enforced by the pattern. This rejects the
     remaining nonsense — year 0000 — without inventing a business rule about
     how far a club's calendar may reach. The horizon does that, below. */
  if (year < 1970 || year > 9999) return null;

  return { year, month };
}

/** The month key `months` away. Handles the year boundary in both directions. */
export function shiftMonthKey(key: MonthKey, months: number): MonthKey {
  const parsed = parseMonthKey(key);
  if (!parsed) return key;

  /* Date.UTC normalises month overflow and underflow, so December + 1 and
     January - 1 both land on the right year without a branch here. */
  const shifted = new Date(Date.UTC(parsed.year, parsed.month + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "August 2026". The heading above the grid, and the accessible month name. */
export function monthLabel(key: MonthKey): string {
  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  return `${MONTH_NAMES[parsed.month]} ${parsed.year}`;
}

/** Compares two month keys as `Date.prototype.getTime` would. Lexical is enough. */
export const monthKeyBefore = (a: MonthKey, b: MonthKey): boolean => a < b;

/* ============================================================================
   THE WEEK'S FIRST DAY
   ========================================================================= */

/**
 * Monday, and it is a decision rather than a default.
 *
 * `lagosParts().weekday` is 0-for-Sunday because that is what `Date` gives, and
 * the seven-day strip inherited that ordering by accident — it starts on
 * whatever day the member opened the app, so the question never arose.
 *
 * It arises here. A grid has to commit, and a Nigerian club's week runs Monday
 * to Sunday: the working week first, the weekend as the pair of columns at the
 * end where the club is busiest. Rendering Sunday first would split the weekend
 * across both edges of the grid, which is the one arrangement that makes "am I
 * free at the weekend" harder to read than it needs to be.
 */
export const WEEK_STARTS_ON = 1;

/** Column headings, in grid order. One letter is not enough; two is. */
export const WEEKDAY_INITIALS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/** Full weekday names in grid order, for the column headers' accessible text. */
export const WEEKDAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;

/** How many columns from the week's start this weekday sits. */
export const columnOf = (weekday: number): number =>
  (weekday - WEEK_STARTS_ON + 7) % 7;

/* ============================================================================
   WHAT A DAY IS MARKED WITH
   ========================================================================= */

/**
 * The marks a day can carry.
 *
 * ===========================================================================
 * FOUR MARKS, AND NOT ONE PER ENTRY
 *
 * The strip this replaces carried a single dot meaning "something is on", which
 * is the minimum that beats a row of identical numerals. A month has thirty-one
 * of them and a single dot on all thirty-one is exactly as unreadable as no dot
 * at all — the club is open every day, so the operating rhythm marks every cell
 * and the mark stops carrying information.
 *
 * So the rhythm gets the quietest treatment the grid has and the exceptional
 * things get the loud ones. What a member is scanning a month for is the
 * unusual day: the guest evening, the fixture, the closure, and the day they
 * have already committed to. Those are the four.
 */
export type DayMarks = {
  /** The club is open — the operating rhythm. True on most days by design. */
  readonly open: boolean;
  /** A published one-off: a guest evening, a dinner, an open day. */
  readonly event: boolean;
  /** A league round due this week. */
  readonly fixture: boolean;
  /**
   * A closure suppressed this day's service.
   *
   * This is the mark the whole grid exists to make visible at a glance. The
   * programme merge already gives a closure priority over everything else on
   * the day (see `programme.ts`), and the calendar carries that priority into
   * the one place a member looks before deciding to drive to the National
   * Stadium.
   */
  readonly closed: boolean;
  /** The member has a booking on this day. Personal, never the club's. */
  readonly booked: boolean;
};

const NO_MARKS: DayMarks = {
  open: false,
  event: false,
  fixture: false,
  closed: false,
  booked: false,
};

/** Whether a day carries anything at all worth a tap. */
export const isMarked = (marks: DayMarks): boolean =>
  marks.open || marks.event || marks.fixture || marks.closed || marks.booked;

/**
 * Whether a day carries something OTHER than the club simply being open.
 *
 * The distinction the agenda and the grid's loud marks both turn on. A club
 * open on a Tuesday is not news; a guest evening on a Tuesday is.
 */
export const isNotable = (marks: DayMarks): boolean =>
  marks.event || marks.fixture || marks.closed;

function marksFor(day: ProgrammeDay | undefined, booked: boolean): DayMarks {
  if (!day) return { ...NO_MARKS, booked };

  return {
    open: day.entries.some((entry) => entry.kind === "service"),
    event: day.entries.some((entry) => entry.kind === "event"),
    fixture: day.entries.some((entry) => entry.kind === "fixture"),
    closed: day.closed,
    booked,
  };
}

/* ============================================================================
   THE GRID
   ========================================================================= */

export type CalendarCell = {
  /** `YYYY-MM-DD`. The `day` search parameter this cell selects. */
  readonly dateKey: string;
  /** Lagos midnight on this day. */
  readonly date: Date;
  readonly dayOfMonth: number;
  /** 0 = Sunday, as `Date` counts. Use `columnOf` for the grid position. */
  readonly weekday: number;
  /**
   * False for the leading and trailing days that fill the first and last rows.
   *
   * They are rendered rather than blanked. A grid with holes in its corners
   * reads as broken, and — more usefully — the last days of August and the
   * first of September are the days a member planning across a month boundary
   * most wants to see beside each other.
   */
  readonly inMonth: boolean;
  readonly isToday: boolean;
  /** Strictly before today, on the Lagos calendar. */
  readonly isPast: boolean;
  readonly marks: DayMarks;
};

export type CalendarMonth = {
  readonly monthKey: MonthKey;
  /** "August 2026". */
  readonly label: string;
  /** Rows of exactly seven cells, as many rows as this month needs. */
  readonly weeks: readonly (readonly CalendarCell[])[];
  /** The first cell's day — the start of the range this grid displays. */
  readonly from: Date;
  /** The last cell's day. */
  readonly to: Date;
  /** Null at the near edge of the horizon: there is no travelling backwards. */
  readonly previousKey: MonthKey | null;
  /** Null at the far edge. */
  readonly nextKey: MonthKey | null;
};

/**
 * How far forward the Diary travels.
 *
 * ===========================================================================
 * THREE MONTHS, AND WHY THERE IS A LIMIT AT ALL
 *
 * The obvious implementation has no limit: the member pages forward for as long
 * as they like and the grid keeps rendering. It is also the implementation that
 * lies. Beyond a few months the club has published nothing but its weekly
 * rhythm, so every cell carries the same quiet open mark and the calendar says
 * "the club is open on 14 February" with the same confidence it says it about
 * next Tuesday. It is not the same claim. Opening hours are a standing rule the
 * club can change; a date four months out is a projection of that rule and
 * nothing has been decided about it.
 *
 * Three months forward is roughly the distance the club can honestly speak to,
 * and stopping there is P2 applied to time: the absence of a next-month arrow
 * is a visible statement that the club's diary ends here, which is true.
 *
 * ===========================================================================
 * AND NO TRAVELLING BACKWARDS PAST THIS MONTH
 *
 * The Diary answers "what could I do". A member's own history is Compete's job
 * and it is a better answer than an empty grid of past Tuesdays would be. The
 * current month remains reachable in full — a member looking at September on
 * the first of the month can still see the last week of August in the leading
 * cells, which is where the useful part of the past actually lives.
 */
export const HORIZON_MONTHS = 3;

/**
 * One month, as a grid.
 *
 * `programme` is whatever the caller has loaded — days missing from it simply
 * carry no marks, which is what an unloaded day honestly is. The caller is
 * expected to load the range this function reports as `from`/`to`, and the
 * usual shape is: build the grid once for its range, load, then build it again
 * with the days. Two constructions of a pure function are cheaper than a
 * loading state on a calendar.
 */
export function calendarMonth(input: {
  readonly monthKey: MonthKey;
  /** Now. Decides today, the past, and the near edge of the horizon. */
  readonly today: Date;
  readonly programme?: readonly ProgrammeDay[];
  /** Lagos date keys on which this member has a booking. */
  readonly bookedKeys?: ReadonlySet<string>;
  readonly horizonMonths?: number;
}): CalendarMonth {
  const {
    monthKey,
    today,
    programme = [],
    bookedKeys,
    horizonMonths = HORIZON_MONTHS,
  } = input;

  const parsed = parseMonthKey(monthKey) ?? {
    year: lagosParts(today).year,
    month: lagosParts(today).month,
  };

  /* The first day of the month, and how far back the grid reaches to reach the
     start of its week. `lagosInstant` normalises day overflow, so day 0 and day
     32 are both expressible and neither needs a branch. */
  const first = lagosInstant(parsed.year, parsed.month, 1);
  const lead = columnOf(lagosParts(first).weekday);

  /* Day 0 of the following month is the last day of this one — the standard
     trick, and the reason this file never needs a table of month lengths or a
     leap-year rule. */
  const lastDayOfMonth = lagosParts(
    lagosInstant(parsed.year, parsed.month + 1, 0),
  ).day;

  const cells = calendarDays({
    from: lagosInstant(parsed.year, parsed.month, 1 - lead),
    days: Math.ceil((lead + lastDayOfMonth) / 7) * 7,
    today,
    programme,
    bookedKeys,
    inMonth: parsed,
  });

  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  const thisMonth = monthKeyOf(today);
  const furthest = shiftMonthKey(thisMonth, horizonMonths);
  const previousKey = shiftMonthKey(monthKey, -1);
  const nextKey = shiftMonthKey(monthKey, 1);

  return {
    monthKey,
    label: monthLabel(monthKey),
    weeks,
    from: cells[0].date,
    to: cells[cells.length - 1].date,
    previousKey: monthKeyBefore(previousKey, thisMonth) ? null : previousKey,
    nextKey: monthKeyBefore(furthest, nextKey) ? null : nextKey,
  };
}

/**
 * A run of consecutive days, marked.
 *
 * The grid is one caller and Today's seven-day rail is the other. They are the
 * same days with the same marks arranged differently, and writing the marking
 * twice is how the rail and the calendar end up disagreeing about whether the
 * fourteenth has anything on it — which is the class of defect `app-nav.ts` and
 * `ProgrammeLine` are each structured to prevent.
 */
export function calendarDays(input: {
  /** The first day. Taken at Lagos midnight whatever time it carries. */
  readonly from: Date;
  readonly days: number;
  readonly today: Date;
  readonly programme?: readonly ProgrammeDay[];
  readonly bookedKeys?: ReadonlySet<string>;
  /**
   * The month the caller considers "in frame", if any. Only the grid has one —
   * a rail is about its seven days and about nothing else, so it passes none
   * and every cell comes back `inMonth: true`.
   */
  readonly inMonth?: { readonly year: number; readonly month: number };
}): CalendarCell[] {
  const { from, days, today, programme = [], bookedKeys, inMonth } = input;

  const byKey = new Map(programme.map((day) => [day.dateKey, day]));
  const todayKey = lagosDateKey(today);
  const todayStart = startOfLagosDay(today).getTime();
  const start = lagosParts(from);

  return Array.from({ length: days }, (_, offset) => {
    const date = lagosInstant(start.year, start.month, start.day + offset);
    const parts = lagosParts(date);
    const dateKey = lagosDateKey(date);

    return {
      dateKey,
      date,
      dayOfMonth: parts.day,
      weekday: parts.weekday,
      inMonth: inMonth
        ? parts.month === inMonth.month && parts.year === inMonth.year
        : true,
      isToday: dateKey === todayKey,
      isPast: date.getTime() < todayStart,
      marks: marksFor(byKey.get(dateKey), bookedKeys?.has(dateKey) ?? false),
    };
  });
}

/**
 * Whether a month is one the Diary will show — the horizon, as a predicate.
 *
 * Applied to the `month` search parameter before anything is loaded. A member
 * who edits the URL to a month in 2031 gets this month rather than a grid of
 * projected Tuesdays, for the reason in `HORIZON_MONTHS`.
 */
export function withinHorizon(
  key: MonthKey,
  today: Date,
  horizonMonths = HORIZON_MONTHS,
): boolean {
  const thisMonth = monthKeyOf(today);
  if (monthKeyBefore(key, thisMonth)) return false;
  return !monthKeyBefore(shiftMonthKey(thisMonth, horizonMonths), key);
}

/* ============================================================================
   WHAT IS COMING UP
   ========================================================================= */

export type AgendaItem = {
  readonly dateKey: string;
  readonly date: Date;
  readonly entry: ProgrammeEntry;
  /** Whole Lagos days from today. 0 is today, 1 tomorrow. */
  readonly inDays: number;
};

/**
 * The next occasions, in order, across however many days the caller loaded.
 *
 * ===========================================================================
 * THIS IS THE HALF OF THE BRIEF A GRID CANNOT ANSWER
 *
 * A month grid shows a member WHERE things are. It does not show them WHAT they
 * are without a tap per day, and the thing a member most wants from the Diary —
 * "is there anything coming up I should know about" — is a question about a
 * list, not about a shape. The grid and this list answer the two halves and
 * neither is redundant.
 *
 * ===========================================================================
 * THE OPERATING RHYTHM IS EXCLUDED, AND THAT IS THE WHOLE FILTER
 *
 * §7.3 is right that the rhythm is what stops the Diary being empty most weeks,
 * and it is exactly wrong for an agenda: ninety consecutive "Range open, 09:00
 * to 18:00" entries is not a list of what is coming up, it is the opening hours
 * printed ninety times. The grid carries the rhythm — that is what the quiet
 * open mark is for. This carries the exceptions.
 *
 * A club that has published no one-offs therefore gets an EMPTY agenda, and the
 * surface must say so in the club's voice rather than render nothing. That is
 * P2, and it is also the honest signal to the founder that the events table is
 * not being written to — which §7.5 names as the way this tab fails.
 */
export function agendaFrom(input: {
  readonly days: readonly ProgrammeDay[];
  readonly today: Date;
  readonly limit?: number;
}): AgendaItem[] {
  const { days, today, limit = 5 } = input;
  const todayStart = startOfLagosDay(today).getTime();

  const items: AgendaItem[] = [];

  for (const day of days) {
    if (day.date.getTime() < todayStart) continue;

    for (const entry of day.entries) {
      /* The rhythm is the grid's job. See the header. */
      if (entry.kind === "service") continue;

      items.push({
        dateKey: day.dateKey,
        date: day.date,
        entry,
        inDays: Math.round((day.date.getTime() - todayStart) / 86_400_000),
      });
    }
  }

  /* `programmeWeek` already returns days in order and `programmeForDay` already
     orders the entries within a day, so this is a stable slice rather than a
     sort. Re-sorting here would be a second ordering rule for the same list,
     and §6.3's argument against computed ordering applies to any list a member
     learns to read. */
  return items.slice(0, limit);
}

/**
 * "Today" · "Tomorrow" · "Thursday 3 September".
 *
 * Only the two days a member holds by name get one. Everything else gets its
 * date: "in 23 days" is a number nobody can act on without a calendar, which is
 * the surface they are already looking at.
 *
 * `formatted` is passed in rather than computed here so the module stays free
 * of the rendering layer — `formatWeekdayDate` is the caller's to choose.
 */
export function relativeDayLabel(inDays: number, formatted: string): string {
  if (inDays === 0) return "Today";
  if (inDays === 1) return "Tomorrow";
  return formatted;
}
