/**
 * FIXTURES — "your next round".
 *
 * ===========================================================================
 * A FIXTURE IS A WEEK, NOT AN EVENING
 *
 * Leagues Specification §6: "Fixtures — Asynchronous. The fixture is a week,
 * not an evening." Thursday is a SOCIAL ANCHOR, not a binding slot: "Most play
 * together; the week accommodates everyone else."
 *
 * Two reasons, both in the spec:
 *
 *   · Synchronous fixtures are fragile. "One person travels, a child is sick,
 *     and the fixture collapses." Asynchronous play is forgiving of adult
 *     schedules, which is what a foursome of working adults actually has.
 *   · Capacity. If every league had to play Thursday evening the club would
 *     face a crisis on one night and empty lanes on Tuesday. The flexible
 *     format is also the commercially better one.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE WAS REWRITTEN
 *
 * It previously computed a dated fixture from a binding weekly slot and
 * rendered "Thursday 7 August". That is wrong twice over under the Leagues
 * Specification: it makes the fixture an evening rather than a week, and §8
 * states plainly — "Show week numbers, not dates."
 *
 * A public table of named members against dated scores "is a record of who was
 * in the building and when. This is the precise exposure the club's security
 * constraints exist to prevent." Weeks are the unit AND the safer display, so
 * the product requirement and the security requirement point the same way.
 *
 * Dates now appear nowhere in this module's output.
 * ===========================================================================
 */

/** §6: "Season length — six weeks. Capped at six for now." */
export const SEASON_WEEKS = 6;

/**
 * The default social anchor. §6: "Thursday is the default night."
 *
 * Advisory only — it is what a league puts in its group chat, never something
 * the product enforces. A round submitted on a Tuesday counts exactly the same.
 */
export const DEFAULT_ANCHOR_WEEKDAY = 4; // Thursday

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export const weekdayName = (weekday: number): string =>
  WEEKDAYS[weekday] ?? WEEKDAYS[DEFAULT_ANCHOR_WEEKDAY];

export type Fixture = {
  /** 1-based week within the season. The only identifier a fixture has. */
  week: number;
  /** "Week 3 of 6" — what every surface shows. */
  label: string;
};

export type NextFixture =
  | {
      status: "open";
      fixture: Fixture;
      /** Weeks still to play, including this one. */
      weeksRemaining: number;
    }
  | { status: "season-complete" };

/**
 * The week a league is currently owed.
 *
 * Derived from rounds SUBMITTED, never from the calendar. A league that misses
 * a week is behind, not skipped — and because play is asynchronous there is no
 * calendar deadline to miss in the first place. The season advances when people
 * shoot, which is exactly the behaviour the club wants to measure.
 */
export function nextFixture({
  roundsSubmitted,
  seasonWeeks = SEASON_WEEKS,
}: {
  roundsSubmitted: number;
  seasonWeeks?: number;
}): NextFixture {
  if (roundsSubmitted >= seasonWeeks) return { status: "season-complete" };

  const week = roundsSubmitted + 1;
  return {
    status: "open",
    fixture: { week, label: `Week ${week} of ${seasonWeeks}` },
    weeksRemaining: seasonWeeks - roundsSubmitted,
  };
}

/** Every week in a season, for an archive or a table header. */
export function seasonFixtures(seasonWeeks: number = SEASON_WEEKS): Fixture[] {
  return Array.from({ length: seasonWeeks }, (_, i) => ({
    week: i + 1,
    label: `Week ${i + 1} of ${seasonWeeks}`,
  }));
}

/**
 * How a member's own week reads.
 *
 * Deliberately about THEM, not about a deadline. Guidelines §9 forbids urgency,
 * and there is genuinely no deadline to convey — the week is open until they
 * shoot it. "You have not shot this week" is a fact; "2 days left!" would be
 * both hype and false.
 */
export function weekStatus({
  submittedThisWeek,
  fixture,
}: {
  submittedThisWeek: boolean;
  fixture: Fixture;
}): string {
  return submittedThisWeek
    ? `${fixture.label} — submitted`
    : `${fixture.label} — still to shoot`;
}

/* ---------------------------------------------------------------------------
   ATTENDANCE STREAK — §3 and §6.

   "Consecutive weeks with a submitted round. Skill-independent by design — the
   worst shooter in the club can hold the longest streak. Fully within anyone's
   control and the purest retention mechanic available."

   Pure, so it is testable and so the definition of "consecutive" lives in one
   place rather than being re-derived in a query.
   -------------------------------------------------------------------------- */

/**
 * Longest run of consecutive week numbers in a set of submitted weeks.
 * Order-independent; duplicates are ignored.
 */
export function longestStreak(weeks: readonly number[]): number {
  if (weeks.length === 0) return 0;
  const unique = [...new Set(weeks)].sort((a, b) => a - b);

  let best = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    run = unique[i] === unique[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The streak a member is CURRENTLY on — consecutive weeks ending at the most
 * recent completed week.
 *
 * Distinct from `longestStreak` because they answer different questions: a
 * personal best is a trophy, a current streak is a reason to come back this
 * week. The spec wants both.
 */
export function currentStreak(
  weeks: readonly number[],
  throughWeek: number,
): number {
  const submitted = new Set(weeks);
  let streak = 0;
  for (let week = throughWeek; week >= 1; week -= 1) {
    if (!submitted.has(week)) break;
    streak += 1;
  }
  return streak;
}

/* ---------------------------------------------------------------------------
   THE CHURN SIGNAL — §3, "the single most important thing to measure in the
   first season".

   "If beginners stop submitting rounds after three or four weeks, the variance
   problem has surfaced... Track who stops submitting, not only who is winning."

   Implemented as a predicate rather than a report so it can be used both in the
   product (a captain noticing a quiet team-mate) and in analytics.
   -------------------------------------------------------------------------- */

/** Weeks since this player last submitted, or null if they never have. */
export function weeksSinceLastRound(
  weeks: readonly number[],
  currentWeek: number,
): number | null {
  if (weeks.length === 0) return null;
  return currentWeek - Math.max(...weeks);
}

/**
 * Whether a player has gone quiet.
 *
 * Two missed weeks in a six-week season is a third of it — long enough to be a
 * signal and short enough to still act on. Deliberately NOT surfaced to the
 * whole league: §8 forbids publishing individual attendance history, and
 * "visible absence" is meant to be a friend noticing, not a public register.
 */
export function hasGoneQuiet(
  weeks: readonly number[],
  currentWeek: number,
  threshold = 2,
): boolean {
  const since = weeksSinceLastRound(weeks, currentWeek);
  if (since === null) return currentWeek > threshold;
  return since >= threshold;
}
