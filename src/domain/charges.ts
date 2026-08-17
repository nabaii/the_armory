import { ZERO, add, kobo, times, type Kobo } from "@/lib/money";

/**
 * WHAT THE CLUB CHARGES, AND WHO PAYS — §3.5, §1.2 rule 5, §11 M8.
 *
 *   §3.5: "payer_person_id for a guest charge is ALWAYS the host. ENFORCE IN
 *    CODE, NOT CONVENTION."
 *   §1.2 rule 5: "Money from a guest visit lands on the host. A GUEST NEVER
 *    TRANSACTS WITH THE CLUB."
 *   §3.5: "Ledger, not a mutable balance. Balance derived from
 *    account_transactions, never written directly."
 *
 * ===========================================================================
 * "ENFORCE IN CODE, NOT CONVENTION" IS A TYPE, NOT A COMMENT
 *
 * The rule is trivially easy to state and trivially easy to break: somewhere in
 * a hurry, somebody writes `payerPersonId: guest.personId` because the charge
 * is obviously about the guest, and nothing anywhere objects. The row is
 * correct-looking, the total is right, and the first anybody knows is a guest
 * at the desk being asked for money in front of the member who brought them.
 *
 * §1.2 calls that the single worst thing this system could do to the funnel it
 * exists to serve, so the guest's id is not a parameter this module accepts in
 * the payer position. `guestOverage()` takes the HOST's membership and the
 * guest's NAME — the name only so the line item can say who the charge is for.
 * There is no argument to get wrong.
 *
 * ===========================================================================
 * A CHARGE IS A LIST OF LINES, NOT A NUMBER
 *
 * §3.5 gives `charges` a `line_items` JSONB and a `total_kobo`, and the total is
 * derived here from the lines rather than passed alongside them. A charge whose
 * total disagrees with its lines is a charge nobody can explain to the member
 * looking at it, and the way to make that impossible is for the total never to
 * be an input.
 *
 * ===========================================================================
 * NOTHING HERE READS A DATABASE OR A CLOCK
 *
 * Same shape as the rest of src/domain. Prices arrive as arguments, from the
 * tier row or from club settings, because §14 leaves "tier names, fees, guest
 * allowances" and "guest overage price" open — and a module that hard-coded
 * either would have to be edited when the club finally decides.
 */

/* ============================================================================
   LINES
   ========================================================================= */

export type ChargeLine = {
  /** What a member reads on a statement. Never a code. */
  readonly description: string;
  readonly quantity: number;
  readonly unitKobo: Kobo;
  readonly amountKobo: Kobo;
};

/**
 * What a charge is FOR, matching `charges.reference_type`.
 *
 * A closed vocabulary rather than free text because §6.6's revenue-by-source
 * metric groups on it, and a report that groups on strings somebody typed is a
 * report with "Subscription", "subscription" and "Subs" as three sources.
 */
export const CHARGE_REFERENCE_TYPES = [
  "membership",
  "guest_visit",
  "booking",
  /**
   * FOOD AND DRINK — Management finding F1.
   *
   * =========================================================================
   * THE CLUB COULD NOT CHARGE FOR HALF OF WHAT IT SAYS IT IS
   *
   * The governing frame is "a hospitality operation with a shooting range
   * attached", and Management §11.2 makes the revenue mix — membership, range,
   * F&B, guest fees — one of the two numbers that can falsify that. Three of
   * those four had a line here. This one did not, so anything sold on the deck
   * had to be rung up as `adjustment`, the catch-all, which does not merely
   * lose the figure: it moves it into a bucket that is not revenue at all.
   *
   * The specification says the category split "cannot be reconstructed later".
   * It understated the case — until this row existed the split could not be
   * CONSTRUCTED, because the vocabulary had no word for the thing being sold.
   *
   * `payments.purpose` has carried "bar" and "retail" since M8, which is what
   * made this easy to miss: the money coming IN could be labelled, while the
   * club EARNING it could not. src/domain/revenue.ts is where those two lists
   * are reconciled, and why only this one may be read for revenue.
   */
  "fnb",
  "storage",
  "adjustment",
] as const;
export type ChargeReferenceType = (typeof CHARGE_REFERENCE_TYPES)[number];

export type Charge = {
  /**
   * §3.5, and the whole of §1.2 rule 5. For a guest visit this is the HOST.
   *
   * There is no constructor below that can set this to a guest, which is what
   * "enforce in code" means here.
   */
  readonly payerPersonId: string;
  readonly referenceType: ChargeReferenceType;
  readonly referenceId: string | null;
  readonly lines: readonly ChargeLine[];
  /** Derived from the lines. Never an input — see the header. */
  readonly totalKobo: Kobo;
};

const line = (
  description: string,
  quantity: number,
  unitKobo: Kobo,
): ChargeLine => ({
  description,
  quantity,
  unitKobo,
  amountKobo: times(unitKobo, quantity),
});

const total = (lines: readonly ChargeLine[]): Kobo =>
  add(...lines.map((entry) => entry.amountKobo));

/* ============================================================================
   THE CHARGES THE CLUB RAISES
   ========================================================================= */

/**
 * A membership subscription, monthly or annual.
 *
 * The period is in the description rather than in a column because a charge is
 * a historical statement — "Full membership, year to 14 August 2027" — and a
 * column would have to be joined to a tier that may have been renamed since.
 * §3.3 makes the same argument for `participations.tier_snapshot`.
 */
export function subscriptionCharge(input: {
  readonly personId: string;
  readonly membershipId: string;
  readonly tierName: string;
  readonly period: "monthly" | "annual";
  readonly periodEndLabel: string;
  readonly feeKobo: Kobo;
}): Charge {
  const lines = [
    line(
      `${input.tierName} membership, ${
        input.period === "annual" ? "year" : "month"
      } to ${input.periodEndLabel}`,
      1,
      input.feeKobo,
    ),
  ];

  return {
    payerPersonId: input.personId,
    referenceType: "membership",
    referenceId: input.membershipId,
    lines,
    totalKobo: total(lines),
  };
}

/**
 * A guest visit beyond the tier's included allowance — §3.2, §8.3.
 *
 *   §8.3: "If the reconciliation finds the allowance exceeded, the visit
 *    stands — the guest is already on the premises — and THE OVERAGE IS CHARGED
 *    TO THE HOST. The system never resolves a data conflict by embarrassing a
 *    member."
 *
 * Note the parameters. There is a host person id and a guest NAME. The guest's
 * person id is not accepted, because there is no correct use for it here and an
 * argument that exists is an argument that will eventually be passed to the
 * wrong parameter. See the header.
 */
export function guestOverageCharge(input: {
  readonly hostPersonId: string;
  readonly guestName: string;
  readonly invitationId: string | null;
  readonly visits: number;
  readonly priceKobo: Kobo;
}): Charge {
  const lines = [
    line(
      /* Named, because a member checking a statement three weeks later needs to
         recognise the evening. "Guest visit ×1" is a number they cannot check. */
      `Guest visit — ${input.guestName}`,
      input.visits,
      input.priceKobo,
    ),
  ];

  return {
    payerPersonId: input.hostPersonId,
    referenceType: "guest_visit",
    referenceId: input.invitationId,
    lines,
    totalKobo: total(lines),
  };
}

/**
 * Food and drink, put on a member's account at the deck — Management F1, F4.
 *
 * ===========================================================================
 * THIS CONSTRUCTOR CARRIES BOTH FALSIFYING NUMBERS
 *
 * Management §11.2 names two figures that can falsify the club's whole
 * strategy, and this one row feeds both:
 *
 *   revenue mix               the F&B line, which had no vocabulary until now
 *   non-shooting visit share  a member who bought lunch and fired nothing
 *
 * The second is the part that is easy to miss. The desk console is a range gate
 * — a member who comes in to eat is not checked in, fires no round, and under
 * every earlier version of this schema left no trace at all. So the club's
 * first falsifying number would have read zero, honestly, from a record that
 * never had a chance to say otherwise. `nonShootingVisits` in
 * src/domain/intelligence.ts reads these charges as the evidence of a visit,
 * which is why the date on this charge matters as much as the amount.
 *
 * ===========================================================================
 * WHY IT TAKES LINES RATHER THAN A TOTAL
 *
 * A bar tab is genuinely several things, and a member checking a statement
 * three weeks later needs to recognise the evening — the same argument
 * `guestOverageCharge` makes about naming the guest. A single "Deck — ₦12,400"
 * is a figure they cannot check, and an unrecognised figure becomes a WhatsApp
 * message to a person, which is the phone call this system exists to prevent.
 */
export function serviceCharge(input: {
  readonly personId: string;
  readonly items: readonly {
    readonly description: string;
    readonly quantity: number;
    readonly unitKobo: Kobo;
  }[];
  /** The session it was served during, where there is one. Often there is not. */
  readonly sessionId: string | null;
}): Charge {
  const lines = input.items.map((item) =>
    line(item.description, item.quantity, item.unitKobo),
  );

  return {
    payerPersonId: input.personId,
    referenceType: "fnb",
    referenceId: input.sessionId,
    lines,
    totalKobo: total(lines),
  };
}

/**
 * Anything an officer or the founder puts on an account by hand.
 *
 * Deliberately last, and deliberately requires a description. §6.6 reports
 * revenue by source, and an adjustment with no account of itself is the line
 * that makes the report unreadable a year later.
 *
 * ===========================================================================
 * IT IS NOT A REVENUE LINE, AND MUST NOT BECOME THE DRAIN
 *
 * Management §15 lists "`adjustment` used for anything sold" as a failure mode
 * with a specific consequence: the F&B line stays empty while F&B revenue
 * exists, and the falsifying number silently reports that the hospitality
 * thesis failed. `revenueMix` therefore reports adjustments as their own
 * visible line rather than folding them into a category — a growing adjustment
 * share is a miscategorisation the founder can see, instead of a wrong answer
 * they cannot.
 */
export function adjustmentCharge(input: {
  readonly personId: string;
  readonly description: string;
  readonly amountKobo: Kobo;
}): Charge {
  const lines = [line(input.description, 1, input.amountKobo)];

  return {
    payerPersonId: input.personId,
    referenceType: "adjustment",
    referenceId: null,
    lines,
    totalKobo: total(lines),
  };
}

/* ============================================================================
   THE LEDGER — §3.5's "ledger, not a mutable balance"
   ========================================================================= */

export type LedgerEntry = {
  readonly amountKobo: Kobo;
  readonly direction: "credit" | "debit";
  readonly referenceType: string;
  readonly createdAt: Date;
};

/**
 * A balance, from the entries.
 *
 * §3.5: "Balance derived from account_transactions, never written directly."
 * `accounts.balance_kobo` exists as a cache and drizzle/0002 rejects a direct
 * UPDATE to it, exactly as it does for `firearms.status` — the two are the same
 * pattern for the same reason. This function is the derivation the trigger
 * mirrors, and the one the desk and the portal both read.
 *
 * ===========================================================================
 * SIGN CONVENTION, STATED ONCE
 *
 * A CREDIT increases what the club owes the member — a top-up, a refund, a
 * released deposit. A DEBIT decreases it — a charge settled from the balance.
 *
 * So a positive balance means the member is in funds and a negative one means
 * they owe the club. That is the member's point of view, not the club's, and
 * it is chosen deliberately: this number appears on §6.2's Account screen, and
 * a member reading "-₦12,000" should understand it as "I owe twelve thousand",
 * which is what every bank has trained them to read.
 */
export const balanceOf = (entries: readonly LedgerEntry[]): Kobo =>
  kobo(
    entries.reduce(
      (running, entry) =>
        running +
        (entry.direction === "credit" ? entry.amountKobo : -entry.amountKobo),
      0,
    ),
  );

/**
 * What the club is owed, from charges that have not been settled.
 *
 * Kept apart from the balance rather than folded into it, because they are
 * different facts and §6.2 lists both: "charges, payments, balance". An unpaid
 * charge is a bill; a negative balance is an overdraft. A member with ₦20,000
 * on account and a ₦5,000 charge outstanding has both, and a single number
 * would hide one of them.
 */
export const outstandingOf = (
  charges: readonly { readonly totalKobo: Kobo; readonly isSettled: boolean }[],
): Kobo =>
  add(
    ...charges
      .filter((charge) => !charge.isSettled)
      .map((charge) => charge.totalKobo),
  );

/* ============================================================================
   WHAT THE MEMBER IS TOLD — §6.2, §12
   ========================================================================= */

export type AccountStanding = {
  readonly balanceKobo: Kobo;
  readonly outstandingKobo: Kobo;
  /** One line, in plain words. §4.3's shape applied to money. */
  readonly line: string;
  /** What settles it, where there is something to do. */
  readonly remedy: string | null;
};

/**
 * The one sentence at the top of §6.2's Account screen.
 *
 * §6.2 asks for the tier and its privileges "STATED PLAINLY", and the same
 * standard has to apply to the money above them. Four states, four sentences,
 * no arithmetic left for the member to do.
 *
 * ===========================================================================
 * IT NEVER SAYS "OVERDUE" AND NEVER NAMES A CONSEQUENCE
 *
 * §12.1 requires an exhausted allowance to be "offered in the portal with the
 * price shown. NEVER DISCOVERED AT THE DESK", and the same reasoning governs
 * the tone here. This is a members' club, the sums are small, and the member
 * reading this is somebody the founder will see on Saturday. A dunning notice
 * from a system is a worse debt-collection instrument than the conversation
 * that would otherwise happen, and it costs the relationship the club is
 * actually selling.
 *
 * So it states the number and what settles it. Escalation is a human decision
 * and is not automated here.
 */
export function accountStanding(input: {
  readonly balanceKobo: Kobo;
  readonly outstandingKobo: Kobo;
  readonly format: (amount: Kobo) => string;
}): AccountStanding {
  const { balanceKobo, outstandingKobo, format } = input;

  /* Outstanding is stated first when there is any, because it is the one that
     has something to do about it. A member in funds with a bill still has a
     bill, and leading with the credit would read as though they had not. */
  if (outstandingKobo > 0) {
    const covered = balanceKobo >= outstandingKobo;

    return {
      balanceKobo,
      outstandingKobo,
      line: `${format(outstandingKobo)} outstanding.`,
      remedy: covered
        ? "Your account balance covers it."
        : "Top up, or settle it at the desk.",
    };
  }

  if (balanceKobo > 0) {
    return {
      balanceKobo,
      outstandingKobo,
      line: `${format(balanceKobo)} on account.`,
      remedy: null,
    };
  }

  if (balanceKobo < 0) {
    return {
      balanceKobo,
      outstandingKobo,
      line: `${format(kobo(-balanceKobo))} owed.`,
      remedy: "Top up, or settle it at the desk.",
    };
  }

  return {
    balanceKobo,
    outstandingKobo: ZERO,
    line: "Nothing outstanding.",
    remedy: null,
  };
}
