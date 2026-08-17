import { lagosDateKey } from "@/lib/time";

/**
 * THE NON-SHOOTING VISIT SHARE — Management §11.2, finding F4.
 *
 *   "Visits with no round fired, as a share of all visits. Whether the club is
 *    a destination or a range. If this stays near zero, the hospitality thesis
 *    is not working and the programme needs to change."
 *
 * The first of the two numbers that can falsify the club's strategy, and the
 * one that could not be computed at all until this module and the `fnb` charge
 * existed together.
 *
 * ===========================================================================
 * WHY IT WOULD HAVE READ ZERO, AND WHY THAT IS THE DANGEROUS ANSWER
 *
 * Walk a Tuesday lunch through the club as it was built. A member comes in to
 * eat. They do not check in — the desk console is a range gate, and its fifteen
 * seconds are about waivers, licences and equipment, none of which a person
 * eating on the deck needs. They fire nothing, so no round is scored. They buy
 * lunch, which until F1 the schema could not categorise.
 *
 * At the end of the quarter the number that decides whether this club is a
 * destination or a range would have reported ZERO — honestly, from a record
 * that never had a chance to say otherwise.
 *
 * S2 exists for exactly this: "a missing value must look missing… because a
 * zero invites a decision". The decision this particular zero invites is
 * abandoning the hospitality thesis on evidence produced by not having
 * instrumented it.
 *
 * ===========================================================================
 * SOLVE IT IN THE MONEY, NOT AT THE DOOR
 *
 * The obvious fix is to check everybody in, and it is the wrong one: it adds
 * work to the desk for a person who came to eat, which S6 forbids, and it would
 * be quietly abandoned within a fortnight.
 *
 * So the evidence of a non-shooting visit is the CHARGE. A member with a
 * categorised F&B charge on a day they fired no round was at the club that day
 * — the club has their money and a timestamp to prove it. One capture path
 * serves both falsifying numbers, which is why §8 sequences `fnb` before every
 * screen in the management system.
 *
 * ===========================================================================
 * IT IS A FLOOR, NOT A CENSUS, AND THE SURFACE MUST SAY SO
 *
 * A member who comes to watch a fixture and buys nothing leaves no trace under
 * this scheme. That is a real limit and it is stated rather than hidden:
 * `VisitMix.basis` carries the sentence, and no caller may render the figure
 * without it.
 *
 * A floor that is honest about being a floor is a usable number — it can only
 * understate the thesis, so a rising floor is real evidence. A census that is
 * quietly a floor is not a number at all.
 *
 * ===========================================================================
 * NO PERSONAL DATA LEAVES THIS MODULE — §11.1
 *
 * Person ids come in, because a visit is per person per day and there is no
 * other way to count one. Nothing but counts goes out. There is no return path
 * here that can name a member, which is the module-level version of "compute;
 * do not copy" and the reason this can be built before the retention schedule
 * lands — unlike the per-member analytics of §11.5, which cannot.
 */

/* ============================================================================
   THE INPUTS

   Both deliberately minimal. A participation that carried a tier, a lane and a
   host would let a later change quietly turn this into the surveillance surface
   §11.5 keeps behind a legal blocker.
   ========================================================================= */

/** Somebody was on the premises, from the desk's record. */
export type VisitRecord = {
  readonly personId: string;
  readonly at: Date;
  /**
   * Whether this person fired anything that day.
   *
   * Supplied rather than derived here, because "a round exists for this
   * participation" is a join the caller is already doing and re-deriving it
   * from a second list would let the two disagree.
   */
  readonly firedRound: boolean;
};

/** Somebody bought food or drink, from the ledger. */
export type ServiceRecord = {
  readonly personId: string;
  readonly at: Date;
};

export type VisitMix = {
  /** Distinct person-days with any evidence at all. */
  readonly visits: number;
  /** Person-days with at least one round fired. */
  readonly shooting: number;
  /** Person-days with evidence of presence and no round. */
  readonly nonShooting: number;
  /**
   * How many of the non-shooting visits are known ONLY from a charge.
   *
   * The club's hospitality trade made visible as its own figure. A founder
   * watching this rise is watching the thesis work; a founder watching it stay
   * at zero while the deck is busy is watching the deck fail to ring things up,
   * which is an operational problem and not a strategic one. Two very different
   * conclusions from the same total, so the split is reported.
   */
  readonly fromServiceOnly: number;
  /** The obligatory caveat. Never render the figures without it. */
  readonly basis: string;
};

/**
 * The one sentence that must accompany the number.
 *
 * A constant rather than a parameter, because a caveat a caller can choose not
 * to pass is a caveat that will eventually not be passed.
 */
export const VISIT_MIX_BASIS =
  "A floor, not a census. A visit is counted where the club has a record of it — " +
  "a check-in, or something bought. A member who came in and bought nothing does not appear.";

/**
 * Count the club's visits, by whether anybody shot.
 *
 * A visit is a PERSON-DAY, not a check-in row. A member who checks in at noon,
 * leaves, and returns for dinner visited once — counting rows would report two
 * and would make the club look busier every time somebody stepped out, which is
 * the kind of number that improves for no reason and is then defended.
 *
 * The window is half-open, matching `revenueMix` and every other range here: a
 * record at exactly `to` belongs to the next period.
 */
export function visitMix(input: {
  readonly visits: readonly VisitRecord[];
  readonly service: readonly ServiceRecord[];
  readonly window: { readonly from: Date; readonly to: Date };
}): VisitMix {
  const { window } = input;

  const inWindow = (at: Date) => at >= window.from && at < window.to;

  /* One entry per person-day. `fired` is sticky: a member who checked in twice
     and shot on the second visit shot that day. */
  const days = new Map<string, { fired: boolean; fromDesk: boolean }>();

  const touch = (
    personId: string,
    at: Date,
    patch: { fired?: boolean; fromDesk?: boolean },
  ) => {
    const key = `${personId}|${lagosDateKey(at)}`;
    const existing = days.get(key) ?? { fired: false, fromDesk: false };
    days.set(key, {
      fired: existing.fired || (patch.fired ?? false),
      fromDesk: existing.fromDesk || (patch.fromDesk ?? false),
    });
  };

  for (const visit of input.visits) {
    if (!inWindow(visit.at)) continue;
    touch(visit.personId, visit.at, { fired: visit.firedRound, fromDesk: true });
  }

  for (const sale of input.service) {
    if (!inWindow(sale.at)) continue;
    /* Never sets `fired`. A charge is evidence of presence and says nothing
       about the firing line — that is the entire point of counting it. */
    touch(sale.personId, sale.at, {});
  }

  let shooting = 0;
  let nonShooting = 0;
  let fromServiceOnly = 0;

  for (const day of days.values()) {
    if (day.fired) {
      shooting += 1;
      continue;
    }
    nonShooting += 1;
    if (!day.fromDesk) fromServiceOnly += 1;
  }

  return {
    visits: days.size,
    shooting,
    nonShooting,
    fromServiceOnly,
    basis: VISIT_MIX_BASIS,
  };
}

/**
 * The caveat that outranks the figure — §11.1's second governing rule.
 *
 *   "With a cohort this size, a weekly conversion rate moves eight points
 *    because one person did something."
 *
 * Returns the sentence to render INSTEAD of a share, or null when the sample
 * carries one. The threshold is a quarter's worth of ordinary trading rather
 * than a statistical test, for the reason `MEANINGFUL_CHARGE_COUNT` gives.
 */
export function visitMixCaveat(mix: VisitMix): string | null {
  if (mix.visits === 0) {
    return "No visits recorded in this period.";
  }
  if (mix.visits < MEANINGFUL_VISIT_COUNT) {
    return `Only ${mix.visits} visit${mix.visits === 1 ? "" : "s"} recorded — too few to read as a share.`;
  }
  return null;
}

export const MEANINGFUL_VISIT_COUNT = 30;

/**
 * THE FIFTEEN SECONDS — Management §11.4.
 *
 *   "The club's central operating promise is currently unmeasured… Nothing
 *    measures it. The console can timestamp arrival and completion at almost no
 *    cost. Once it does, the promise becomes a number that can be watched, and
 *    every claim made about the portal reducing desk work becomes testable
 *    rather than asserted."
 *
 * It turned out to cost one field rather than two: `participations.checked_in_at`
 * has always recorded the completion. What was missing was the START — the
 * moment the officer opened the sheet on a person standing at the desk.
 *
 * ===========================================================================
 * REPORTED AS A DISTRIBUTION, NEVER AS A MEAN
 *
 * A mean check-in time is the number that hides the problem. Fifty check-ins at
 * eight seconds and five at four minutes average out to a healthy figure while
 * five members stood at a counter watching an officer fight the software — and
 * those five are the entire content of the measurement. The median says what a
 * normal check-in feels like; the ninetieth percentile says what a bad one
 * costs; the count over the promise is the number that should be zero.
 *
 * ===========================================================================
 * IT IS A PROPERTY OF THE SOFTWARE, NOT OF THE OFFICER — S4, S5
 *
 * This must never be rendered per staff member. §12 already frames desk speed
 * as a property of the screens rather than of the training, and a management
 * surface that ranked officers by check-in time would produce officers who
 * check people in badly and quickly. There is no staff id in this type and
 * there must not be one.
 */
export type CheckInClock = {
  readonly count: number;
  /** Seconds. Null where nothing has been measured yet — S2. */
  readonly medianSeconds: number | null;
  readonly ninetiethSeconds: number | null;
  /** How many took longer than the club's promise. The number to watch. */
  readonly overPromise: number;
};

/** The promise, in seconds. Design Specification, and three documents since. */
export const CHECK_IN_PROMISE_SECONDS = 15;

/**
 * The check-in distribution over a set of measured arrivals.
 *
 * Durations arrive already computed, in seconds, because the two timestamps are
 * a subtraction the caller does in SQL over a window it has already scoped —
 * and because passing dates here would put a person's arrival time into a
 * module that has no business holding one.
 */
export function checkInClock(
  durationsSeconds: readonly number[],
): CheckInClock {
  /* Negative durations are clock skew between a tablet and the server, not
     fast check-ins. §8 has the desk writing both a device clock and a server
     clock precisely because the device's is not trusted; a negative here means
     the pair disagreed, and averaging it in would flatter the figure. */
  const clean = durationsSeconds
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0)
    .sort((a, b) => a - b);

  if (clean.length === 0) {
    return {
      count: 0,
      medianSeconds: null,
      ninetiethSeconds: null,
      overPromise: 0,
    };
  }

  return {
    count: clean.length,
    medianSeconds: percentile(clean, 0.5),
    ninetiethSeconds: percentile(clean, 0.9),
    overPromise: clean.filter((s) => s > CHECK_IN_PROMISE_SECONDS).length,
  };
}

/**
 * Nearest-rank percentile on an already-sorted list.
 *
 * Nearest-rank rather than interpolated because every value here is a real
 * check-in that really happened, and the ninetieth percentile of a range
 * officer's day should be a duration somebody actually experienced rather than
 * a weighted average of two that did.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}
