/**
 * The form state the booking action returns.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

import type { FieldErrors } from "@/server/validation";

export type BookingState = {
  ok: boolean;
  errors?: FieldErrors;
  formError?: string;
};

export const emptyBookingState: BookingState = { ok: false };
