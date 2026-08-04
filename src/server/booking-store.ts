/**
 * BOOKING STORE.
 *
 * ===========================================================================
 * WHY A HOLD-THEN-CONFIRM MODEL
 *
 * Payment is not instant. Between "choose a slot" and "money received" the
 * visitor is on Paystack's page, possibly for minutes, possibly entering a
 * transfer. Two people can be in that gap for the last two places in a session.
 *
 * So capacity is reserved BEFORE the visitor leaves for payment, as a hold with
 * a short expiry, and converted to a confirmed booking by the signed webhook.
 * An abandoned payment expires and returns the capacity on its own.
 *
 * IDEMPOTENCY: Paystack retries webhooks, sometimes several times. `confirm` is
 * set-once — a second `charge.success` for the same reference is reported as
 * `already-confirmed` and changes nothing. Without that, a retry would either
 * double-count capacity or send the visitor a second confirmation email.
 *
 * ===========================================================================
 * ⚠ THE IN-MEMORY STORE IS NOT PRODUCTION-DURABLE
 *
 * `InMemoryBookingStore` holds state in module memory. That is correct and fully
 * tested for development and for the pure capacity logic, and it is wrong for
 * production on any host that runs more than one instance or cold-starts:
 * holds and confirmations do not survive a restart and are not shared between
 * instances. Two concurrent instances would each believe a full session had
 * places left.
 *
 * This is registered as a launch blocker in the content gate
 * (`booking-durable-store`) rather than left as a comment, because it is exactly
 * the kind of gap that reads as finished code.
 *
 * ---------------------------------------------------------------------------
 * THE INTENDED PRODUCTION STORE IS A CALENDAR, NOT A DATABASE
 *
 * Consistent with the no-database decision (see crm.ts): a private Google
 * Calendar is the booking record. Reasons, in order of weight:
 *
 *   · No new datastore to secure. The Brief flags visit schedules as among the
 *     most sensitive data on the site — "where they will be, and when" — and a
 *     calendar with a named-staff access list satisfies spec §7 without us
 *     operating an encrypted database badly.
 *   · The bookings team already lives in it. No staff UI to build, which is the
 *     larger half of a booking product.
 *   · It is the natural place for a 24-hour reminder to be driven from.
 *
 * What the adapter must implement, precisely:
 *   1. `remainingCapacity` — list events in the slot window, sum party sizes
 *      from a structured field (extendedProperties.private.partySize), subtract
 *      from the session capacity.
 *   2. `hold` — create a TENTATIVE event with the booking reference in
 *      extendedProperties.private.reference and a short expiry recorded.
 *   3. `confirm` — flip the event to confirmed, set-once, keyed on reference.
 *   4. `release` — delete the tentative event.
 *
 * Authentication is a service-account JWT (RS256) exchanged for an access token.
 * It is deliberately NOT stubbed here: untested integration code that looks
 * complete is worse than an honest absence, and none of it can be exercised
 * without real credentials.
 * ===========================================================================
 */

export type BookingRecord = {
  reference: string;
  slotId: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  /** The refund terms in force when this visitor booked. Spec §9. */
  policyVersion: string;
  status: "held" | "confirmed";
  /** Holds only. Epoch ms after which capacity returns. */
  expiresAt?: number;
  amountKobo?: number;
  createdAt: number;
  confirmedAt?: number;
};

export type HoldOutcome =
  | { ok: true; record: BookingRecord }
  | { ok: false; reason: "slot-full"; remaining: number }
  | { ok: false; reason: "duplicate-reference" };

export type ConfirmOutcome =
  | { status: "confirmed"; record: BookingRecord }
  | { status: "already-confirmed"; record: BookingRecord }
  | { status: "unknown-reference" }
  | { status: "expired" };

export interface BookingStore {
  remainingCapacity(slotId: string, slotCapacity: number): Promise<number>;
  hold(
    input: Omit<BookingRecord, "status" | "createdAt">,
    slotCapacity: number,
  ): Promise<HoldOutcome>;
  confirm(reference: string, amountKobo: number): Promise<ConfirmOutcome>;
  release(reference: string): Promise<void>;
  get(reference: string): Promise<BookingRecord | null>;
  /** Confirmed bookings starting in a window — drives the 24-hour reminder. */
  confirmedBetween(fromMs: number, toMs: number): Promise<BookingRecord[]>;
}

/** How long a visitor has to complete payment before capacity is released. */
export const HOLD_TTL_MS = 20 * 60_000;

export class InMemoryBookingStore implements BookingStore {
  private readonly records = new Map<string, BookingRecord>();

  async remainingCapacity(slotId: string, slotCapacity: number): Promise<number> {
    this.expireStaleHolds();
    let taken = 0;
    for (const record of this.records.values()) {
      if (record.slotId === slotId) taken += record.partySize;
    }
    return Math.max(0, slotCapacity - taken);
  }

  async hold(
    input: Omit<BookingRecord, "status" | "createdAt">,
    slotCapacity: number,
  ): Promise<HoldOutcome> {
    this.expireStaleHolds();

    if (this.records.has(input.reference)) {
      return { ok: false, reason: "duplicate-reference" };
    }

    const remaining = await this.remainingCapacity(input.slotId, slotCapacity);
    if (input.partySize > remaining) {
      return { ok: false, reason: "slot-full", remaining };
    }

    const record: BookingRecord = {
      ...input,
      status: "held",
      expiresAt: input.expiresAt ?? Date.now() + HOLD_TTL_MS,
      createdAt: Date.now(),
    };
    this.records.set(record.reference, record);
    return { ok: true, record };
  }

  async confirm(reference: string, amountKobo: number): Promise<ConfirmOutcome> {
    const record = this.records.get(reference);

    /* Deliberately NOT expiring holds first. If payment succeeded on a hold
       that has just lapsed, the money is real and the booking must stand —
       honouring it and letting staff resolve an over-booked session is far
       better than taking a deposit for a slot we then deny. */
    if (!record) return { status: "unknown-reference" };

    if (record.status === "confirmed") {
      /* Paystack retry. Set-once: no capacity change, no second email. */
      return { status: "already-confirmed", record };
    }

    record.status = "confirmed";
    record.amountKobo = amountKobo;
    record.confirmedAt = Date.now();
    delete record.expiresAt;

    return { status: "confirmed", record };
  }

  async release(reference: string): Promise<void> {
    const record = this.records.get(reference);
    /* Never release a confirmed booking — that would silently cancel a paid
       visit. Cancellation is a staff action against the refund policy. */
    if (record && record.status === "held") this.records.delete(reference);
  }

  async get(reference: string): Promise<BookingRecord | null> {
    return this.records.get(reference) ?? null;
  }

  async confirmedBetween(fromMs: number, toMs: number): Promise<BookingRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.status === "confirmed" && r.createdAt >= 0 && withinSlot(r, fromMs, toMs),
    );
  }

  private expireStaleHolds() {
    const now = Date.now();
    for (const [reference, record] of this.records) {
      if (record.status === "held" && record.expiresAt && record.expiresAt <= now) {
        this.records.delete(reference);
      }
    }
  }

  /** Tests only. */
  __clear() {
    this.records.clear();
  }
}

/**
 * Slot ids are `YYYY-MM-DDTHH:MM` in WAT, so the start instant is recoverable
 * without storing it twice.
 */
function withinSlot(record: BookingRecord, fromMs: number, toMs: number): boolean {
  const start = slotIdToInstant(record.slotId);
  return start !== null && start >= fromMs && start <= toMs;
}

export function slotIdToInstant(slotId: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(slotId);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  /* WAT is UTC+1, no DST. */
  return Date.UTC(y, mo - 1, d, h - 1, mi, 0, 0);
}

/**
 * The active store.
 *
 * Swapping in the calendar-backed adapter is a single assignment here once
 * credentials exist. Until then this is development-only, and the gate blocks
 * launch on `booking-durable-store`.
 */
export const bookingStore: BookingStore = new InMemoryBookingStore();
