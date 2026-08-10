/**
 * TIME — stored UTC, rendered Africa/Lagos.
 *
 * Build Specification §2: "All timestamps stored UTC. Rendered Africa/Lagos.
 * Client-generated timestamps are recorded alongside server receipt time,
 * never instead of it."
 *
 * ===========================================================================
 * WHY A MODULE RATHER THAN toLocaleString
 *
 * The club runs on one clock and the servers run on another. Every surface in
 * this system displays a time to someone standing in Abuja — a slot on a
 * booking page, an arrival on the desk, an expiry on a licence — and every one
 * of those is stored in UTC. Left to `toLocaleString()`, the rendering follows
 * whatever timezone the RUNTIME happens to be in: UTC on the server, the
 * device's own setting in the browser. Those disagree, and they disagree by a
 * whole hour, which is exactly enough to put a 6pm session on the wrong side
 * of a day boundary and show a range officer yesterday's arrivals.
 *
 * So rendering goes through here, the zone is named explicitly, and no
 * component is permitted to reach for a locale API directly.
 *
 * ===========================================================================
 * ONE FIXED OFFSET, DELIBERATELY
 *
 * West Africa Time is UTC+1 all year. Nigeria has never observed daylight
 * saving. That makes a fixed offset correct rather than merely convenient, and
 * it means date arithmetic here is exact without a timezone database — which
 * matters because this code runs on a tablet, offline, out of a service worker
 * cache, where pulling in a 300kB IANA dataset to represent a constant would
 * be an unreasonable trade against §2's one-second cold start budget.
 *
 * The constant is named and cited so that if Nigeria ever changes, one line
 * changes and the failure is loud rather than distributed across the codebase.
 */

/** West Africa Time. UTC+1, no daylight saving. */
export const LAGOS_OFFSET_HOURS = 1;
export const LAGOS_OFFSET_MS = LAGOS_OFFSET_HOURS * 3_600_000;

export const TIMEZONE = "Africa/Lagos";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export type LagosParts = {
  year: number;
  /** 0-indexed, as in Date. */
  month: number;
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  hours: number;
  minutes: number;
  seconds: number;
};

/**
 * Calendar parts of an instant, as seen in Lagos.
 *
 * Uses UTC getters against a shifted timestamp rather than the host's local
 * getters, for the reason in the header: the host is not in Lagos.
 */
export function lagosParts(instant: Date): LagosParts {
  const shifted = new Date(instant.getTime() + LAGOS_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
  };
}

/** The instant at a Lagos wall-clock time. The inverse of `lagosParts`. */
export function lagosInstant(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): Date {
  return new Date(
    Date.UTC(year, month, day, hours - LAGOS_OFFSET_HOURS, minutes, seconds),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The Lagos calendar date of an instant, as `YYYY-MM-DD`.
 *
 * This is the function that decides which day a record belongs to, and it is
 * used everywhere a `date` column is written — `bookings.booking_date`,
 * `sessions.session_date`, the day pack window (§8.1). Deriving those from a
 * UTC date would file every session that starts after 11pm Lagos under the
 * following day, which the end-of-day reconciliation (§6.4) would then fail to
 * find.
 */
export function lagosDateKey(instant: Date): string {
  const p = lagosParts(instant);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

/** Midnight in Lagos on the day an instant falls. */
export function startOfLagosDay(instant: Date): Date {
  const p = lagosParts(instant);
  return lagosInstant(p.year, p.month, p.day);
}

/** Whole days between two instants, counted on the Lagos calendar. */
export function lagosDaysBetween(from: Date, to: Date): number {
  const a = startOfLagosDay(from).getTime();
  const b = startOfLagosDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export const addDays = (instant: Date, days: number): Date =>
  new Date(instant.getTime() + days * 86_400_000);

/** Whether two instants fall on the same Lagos day. */
export const isSameLagosDay = (a: Date, b: Date): boolean =>
  lagosDateKey(a) === lagosDateKey(b);

/* ---------------------------------------------------------------------------
   RENDERING

   Short forms, because these appear inside single-line block reasons on a desk
   screen an officer reads in about a second (§6.4). "Your licence expired on
   14 March" reads; "expired on Friday, 14 March 2026 at 00:00 WAT" does not.
   -------------------------------------------------------------------------- */

/** "14 March" — the form used inside block reasons and remedies. */
export function formatDay(instant: Date): string {
  const p = lagosParts(instant);
  return `${p.day} ${MONTHS[p.month]}`;
}

/** "14 March 2026" — where the year is not obvious from context. */
export function formatDate(instant: Date): string {
  const p = lagosParts(instant);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "Thursday 14 March" — booking pickers and confirmations. */
export function formatWeekdayDate(instant: Date): string {
  const p = lagosParts(instant);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
}

/** "6:00 pm" — lower case meridiem, matching the house voice. */
export function formatTime(instant: Date): string {
  const p = lagosParts(instant);
  const period = p.hours >= 12 ? "pm" : "am";
  const twelve = p.hours % 12 === 0 ? 12 : p.hours % 12;
  return p.minutes === 0
    ? `${twelve}:00 ${period}`
    : `${twelve}:${pad(p.minutes)} ${period}`;
}

/** "Thursday 14 March, 6:00 pm" */
export const formatDateTime = (instant: Date): string =>
  `${formatWeekdayDate(instant)}, ${formatTime(instant)}`;

/**
 * Parse a `YYYY-MM-DD` date column into the instant at Lagos midnight.
 *
 * Postgres `date` columns come back as a bare string with no zone. Passing
 * that to `new Date()` parses it as UTC midnight, which is 1am Lagos — an hour
 * that lands on the right day but the wrong instant, and which drifts a
 * comparison against `now` by an hour in whichever direction hurts most.
 */
export function parseDateColumn(value: string): Date {
  const [year, month, day] = value.split("-").map((n) => Number.parseInt(n, 10));
  return lagosInstant(year, month - 1, day);
}

/** Format an instant as a `YYYY-MM-DD` date column value, on the Lagos calendar. */
export const toDateColumn = lagosDateKey;
