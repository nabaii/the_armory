import type { ChargeReferenceType } from "./charges";
import { ZERO, add, type Kobo } from "@/lib/money";

/**
 * THE REVENUE MIX — Management System Design Specification §11.2, finding F2.
 *
 *   "Revenue mix — membership · range · F&B · guest fees, by period. The same
 *    question asked of the money. A club whose F&B line is trivial is a range
 *    with a bar, whatever the strategy document says."
 *
 * One of the two numbers that can falsify the club's strategy. This module is
 * the only place it may be computed.
 *
 * ===========================================================================
 * THE SECOND PIPELINE ALREADY EXISTED, IN THE SCHEMA
 *
 * §11.6 warns that two reporting pipelines produce two answers, and that the
 * first time a report disagrees with a dashboard the founder stops trusting
 * both. The panel's finding was that the second pipeline was already here
 * before anybody had written a report — as two overlapping vocabularies in two
 * tables, neither a superset of the other:
 *
 *   charges.reference_type   membership · guest_visit · booking · fnb ·
 *                            storage · adjustment
 *   payments.purpose         subscription · guest_overage · account_topup ·
 *                            bar · retail · other
 *
 * `charges` knew nothing about the bar until F1 added `fnb`; `payments` still
 * knows nothing about storage. Either list alone gives a wrong mix, and the two
 * together give two different wrong mixes.
 *
 * ===========================================================================
 * REVENUE IS READ FROM CHARGES. NEVER FROM PAYMENTS. THE REASON IS account_topup
 *
 * A charge is the club EARNING something. A payment is the club BEING PAID.
 * They are different events and only the first is revenue — which matters most
 * for the one row that makes reading payments actively wrong rather than merely
 * incomplete:
 *
 *   A member puts ₦50,000 on their account. `payments.purpose = account_topup`.
 *   The club has been handed cash it has NOT YET EARNED — a liability, money it
 *   owes in food and lane time. Count it as revenue on the day it arrives and
 *   the mix is inflated by ₦50,000 of nothing; then the member spends it at the
 *   deck, a `bar` payment settles the tab, and the SAME ₦50,000 is counted a
 *   second time.
 *
 * So there is one rule, and it is asserted in the tests rather than trusted:
 * nothing in this module reads `payments`, and no other module may compute a
 * revenue figure. Reconciliation joins charges to payments — that is its job,
 * in src/server/armory/reconcile.ts — and intelligence reads only the charge.
 *
 * ===========================================================================
 * ADJUSTMENTS ARE A LINE, NOT A CATEGORY
 *
 * §15: "`adjustment` used for anything sold → the F&B line stays empty while
 * F&B revenue exists; the falsifying number silently says the thesis failed."
 *
 * The defence is visibility rather than cleverness. An adjustment cannot be
 * classified — by construction it is whatever an officer typed — so it is
 * reported as itself, beside the mix rather than inside it. A club whose
 * adjustment line is growing has a miscategorisation problem it can SEE, which
 * is the difference between a report that is honest and one that is wrong.
 *
 * ===========================================================================
 * COUNTS TRAVEL WITH AMOUNTS — §11.1
 *
 *   "At 125 members, report counts and not percentages… an explicit sample size
 *    beside any ratio."
 *
 * Every line therefore carries how many charges produced it, and `share` is
 * deliberately absent from the return type. A caller that wants a percentage
 * can compute one from `amountKobo` and `total`, and will have the count in
 * hand to decide whether it means anything.
 */

/* ============================================================================
   THE VOCABULARY

   Not in src/domain/enums.ts, and that is deliberate. Everything there is a
   status persisted in a column; this is a DERIVED grouping that exists only at
   read time. §11.1's rule is "compute; do not copy" — a revenue_category column
   would be a copy of a fact the reference type already determines, and the
   first time the two disagreed the column would win and be wrong.
   ========================================================================= */

/**
 * The four lines of the business, plus the two that are not lines.
 *
 * `uncategorised` exists so that a reference type nobody has classified appears
 * on the screen instead of vanishing into a bucket. S2: a missing value must
 * look missing, because a zero invites a decision.
 */
export const REVENUE_CATEGORIES = [
  "membership",
  "range",
  "fnb",
  "guest",
  "storage",
  "uncategorised",
] as const;
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];

/**
 * Which line of the business a charge belongs to.
 *
 * Derived, never guessed — Management §4.7. Three of the four falsifying lines
 * are determined entirely by what the charge points at, which is why they were
 * already correct in the schema and why no human has to supply them at the
 * desk. S6 forbids adding a tap to the fifteen-second check-in, and this
 * function is how that constraint and §11.2's requirement are both satisfied.
 *
 * A defaulted category that is DERIVED is safe. A defaulted category that is
 * GUESSED is worse than a missing one, because a missing value looks missing
 * and a wrong one looks like data. So `adjustment` returns `uncategorised`
 * rather than being assigned somewhere plausible.
 */
export function revenueCategoryOf(
  referenceType: ChargeReferenceType,
): RevenueCategory {
  switch (referenceType) {
    case "membership":
      return "membership";
    case "booking":
      return "range";
    case "fnb":
      return "fnb";
    case "guest_visit":
      return "guest";
    case "storage":
      return "storage";
    case "adjustment":
      /* An officer typed a description. There is nothing here to classify, and
         inventing a classification is the failure §15 names. */
      return "uncategorised";
  }
}

/* ============================================================================
   THE COMPUTATION
   ========================================================================= */

/**
 * A charge, as revenue sees it. Deliberately three fields.
 *
 * No person id, and that is not an oversight — §11.1 forbids analytics from
 * holding or copying personal data, and the mix has no use for a payer. A
 * function that cannot see who paid cannot leak who paid.
 */
export type RevenueCharge = {
  readonly referenceType: ChargeReferenceType;
  readonly totalKobo: Kobo;
  readonly raisedAt: Date;
};

export type RevenueLine = {
  readonly category: RevenueCategory;
  readonly amountKobo: Kobo;
  /** §11.1's sample size. How many charges make up this line. */
  readonly count: number;
};

export type RevenueMix = {
  readonly lines: readonly RevenueLine[];
  readonly totalKobo: Kobo;
  readonly count: number;
  /**
   * Whether anything landed in `uncategorised`.
   *
   * Lifted out of the lines so a screen cannot fail to notice it. This is the
   * signal that somebody is ringing sales up as adjustments, and it wants to be
   * the thing the founder reads first rather than a row near the bottom.
   */
  readonly hasUncategorised: boolean;
};

/**
 * The mix over a period.
 *
 * Half-open on the window, matching every other range in this codebase: a
 * charge raised at exactly `to` belongs to the next period. Getting this wrong
 * in the inclusive direction double-counts one charge at every period boundary
 * — §2.1's warning that "most defects in this system only appear at volume or
 * at a period boundary", in the one module whose whole job is periods.
 */
export function revenueMix(
  charges: readonly RevenueCharge[],
  window: { readonly from: Date; readonly to: Date },
): RevenueMix {
  const totals = new Map<RevenueCategory, { amount: Kobo; count: number }>();

  let total = ZERO;
  let count = 0;

  for (const charge of charges) {
    if (charge.raisedAt < window.from || charge.raisedAt >= window.to) continue;

    const category = revenueCategoryOf(charge.referenceType);
    const running = totals.get(category) ?? { amount: ZERO, count: 0 };

    totals.set(category, {
      amount: add(running.amount, charge.totalKobo),
      count: running.count + 1,
    });

    total = add(total, charge.totalKobo);
    count += 1;
  }

  /* Every category is emitted, including the empty ones. A line that is absent
     because the club sold none of it and a line that is absent because nobody
     built the screen for it look identical, and only one of them is news. */
  const lines = REVENUE_CATEGORIES.map((category) => {
    const running = totals.get(category);
    return {
      category,
      amountKobo: running?.amount ?? ZERO,
      count: running?.count ?? 0,
    };
  });

  return {
    lines,
    totalKobo: total,
    count,
    hasUncategorised: (totals.get("uncategorised")?.count ?? 0) > 0,
  };
}

/**
 * The one sentence the intelligence surface renders above the mix.
 *
 * §11.1: "Where a figure is too small to mean anything, the surface says so
 * rather than drawing a line through three points." A mix computed from four
 * charges is not a mix, it is four charges, and a founder shown a pie of it
 * will make a decision the data cannot support.
 *
 * Returns null when the figure is worth reading, so the caller renders the
 * sentence or the mix and never has to decide which.
 */
export function mixCaveat(mix: RevenueMix): string | null {
  if (mix.count === 0) {
    return "No charges have been raised in this period.";
  }
  if (mix.count < MEANINGFUL_CHARGE_COUNT) {
    return `Only ${mix.count} charge${mix.count === 1 ? "" : "s"} in this period — too few to read as a mix.`;
  }
  if (mix.hasUncategorised) {
    return "Some charges are uncategorised, so the mix is incomplete. These are adjustments entered by hand.";
  }
  return null;
}

/**
 * Below this, the mix is a list of charges wearing a chart.
 *
 * Thirty is a judgement rather than a statistic, chosen against the club's own
 * size: at roughly 125 members a quarter with fewer than thirty charges means
 * the club barely traded, and the founder needs to be told that rather than
 * shown a composition of it.
 */
export const MEANINGFUL_CHARGE_COUNT = 30;
