/**
 * The form state the hosting actions return — booking, inviting, cancelling.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

export type HostingState = {
  ok: boolean;
  message?: string;
  formError?: string;
  /** §12: the price, shown before the member commits, never after. */
  overagePrompt?: { priceLabel: string; guestNumber: number };
};

export const emptyHostingState: HostingState = { ok: false };
