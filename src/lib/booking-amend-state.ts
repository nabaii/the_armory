/**
 * The form state the booking-amendment actions return.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

export type BookingAmendState = {
  ok: boolean;
  /** What happened, in the club's voice. Shown on success. */
  message?: string;
  formError?: string;
};

export const emptyBookingAmendState: BookingAmendState = { ok: false };
