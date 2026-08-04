/**
 * FIRST-VISIT BOOKING CONFIGURATION.
 *
 * Spec §7: "Do not build a bespoke booking engine in Phase 1." That constraint
 * is honoured in spirit rather than to the letter, and the reasoning was settled
 * before build: the spec also requires Naira deposits through Paystack or
 * Flutterwave, and the mainstream schedulers take payment through Stripe or
 * PayPal, neither of which is a practical Naira card-and-transfer rail. The two
 * requirements cannot both be met with an embed.
 *
 * So this is a SLOT REQUEST, not a scheduling product. Fixed weekly sessions
 * declared below, a capacity per session, a deposit, and nothing else. No
 * general availability engine, no resource management, no staff-facing UI beyond
 * the calendar the bookings team already uses.
 *
 * ---------------------------------------------------------------------------
 * TIMEZONE
 *
 * All session times are West Africa Time. WAT is UTC+1 year-round with no
 * daylight saving, which is the one simplification that makes fixed-offset
 * arithmetic safe here — a slot at 18:00 WAT is always 17:00Z. Anywhere else
 * this would need a real timezone library.
 *
 * Slot times must never be derived from the server's clock zone. A build
 * deployed to a US or EU region would otherwise generate sessions in the wrong
 * hours, and the visitor would arrive at the wrong time.
 * ---------------------------------------------------------------------------
 */

import { PENDING, type Pending } from "@/lib/site";

/** WAT offset in hours. Fixed — no DST in Lagos. */
export const WAT_OFFSET_HOURS = 1;

export type SessionTemplate = {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** 24-hour local (WAT) start time, "HH:MM". */
  start: string;
  /**
   * How many people can be booked into this session in total.
   * The air rifle line has eight lanes; a first-visit session is capped below
   * that so a range officer is not supervising a full line of beginners.
   *
   * PENDING confirmation from Operations — the value below is a placeholder
   * that the gate treats as unresolved.
   */
  capacity: number;
};

export const bookingConfig = {
  /* --- Money. Outstanding from the Founder (spec §8). ---------------------
     Both are required before the flow can take a payment. `null` is not a
     free visit — it means the flow refuses to start. */
  pricing: {
    /** Price per person for a first visit, in naira. */
    perPersonNaira: PENDING as Pending<number>,
    /** Deposit taken at booking, in naira. */
    depositNaira: PENDING as Pending<number>,
  },

  /* --- Refund policy version -------------------------------------------------
     Stored against every booking. Spec §9 requires the terms to appear before
     payment is taken, and a dispute weeks later must reference the exact wording
     the customer saw — not whatever the page says by then.

     "unpublished" is deliberately not a valid version. The booking route
     refuses while it is set, because taking a deposit against terms that do not
     exist is the one thing the Brief explicitly warns against: "Deposits require
     a written refund policy, settled before the booking flow is designed."

     Annotated as `string` rather than left as a literal under `as const`,
     so `bookingIsLive()` is a runtime check rather than a comparison TypeScript
     can fold to `false` — and so setting a real version needs no type change. */
  policyVersion: "unpublished" as string,

  /* --- Sessions. Draft, awaiting Operations. ------------------------------ */
  sessions: [
    { weekday: 4, start: "18:00", capacity: 6 }, // Thursday evening
    { weekday: 5, start: "18:00", capacity: 6 }, // Friday evening
    { weekday: 6, start: "11:00", capacity: 6 }, // Saturday late morning
    { weekday: 6, start: "16:00", capacity: 6 }, // Saturday afternoon
  ] as readonly SessionTemplate[],

  /** Minimum notice. Nobody books a supervised session for twenty minutes' time. */
  leadTimeHours: 24,

  /** How far ahead bookings open. Short, so the schedule stays changeable. */
  horizonDays: 28,

  /** Per booking, not per session. Larger parties go through /groups. */
  maxPartySize: 12,

  /** Session length, for the calendar entry and the confirmation email. */
  durationMinutes: 90,
} as const;

/** True when the flow has everything it needs to take a real payment. */
export const bookingIsLive = (): boolean =>
  bookingConfig.pricing.perPersonNaira !== null &&
  bookingConfig.pricing.depositNaira !== null &&
  bookingConfig.policyVersion !== "unpublished";
