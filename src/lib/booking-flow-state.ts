/**
 * The form state the booking flow's action returns.
 *
 * ===========================================================================
 * IN ITS OWN MODULE, AND THIS IS THE ONE THAT ALREADY BROKE THE SITE
 *
 * Members Portal §13.2, NAMED RISK:
 *
 *   "One of the three defects behind the member sign-in failure was seven
 *    'use server' modules exporting their form-state objects. Next registers
 *    every export as a client-callable endpoint, so those modules threw on
 *    submit and took sign-in, the application, the enquiry and the waitlist
 *    forms down together. The booking flow is the largest new server-action
 *    surface in this document. The same failure will recur there unless the
 *    constraint is captured as a lint rule rather than as institutional
 *    memory."
 *
 * The lint rule is in eslint.config.mjs. This module is the other half: a
 * `"use server"` file may export only async functions, so the type and the
 * empty value live here where they can be imported by both sides.
 */

export type BookingFlowState = {
  ok: boolean;
  /** Shown on success, before the redirect lands. */
  message?: string;
  /** The single sentence from the capability service, where it refused. */
  formError?: string;
};

export const emptyBookingFlowState: BookingFlowState = { ok: false };

/**
 * One companion, as the flow holds them before the booking exists.
 *
 * A guest is a NAME AND A PHONE NUMBER and nothing else. §6.3 makes that the
 * whole of what the club knows until they open their link and complete it
 * themselves — the club does not collect a guest's address, date of birth or
 * emergency contact through the member who is bringing them, because the guest
 * has not agreed to any of it and the member is guessing at half of it.
 */
export type Companion = {
  readonly name: string;
  readonly phone: string;
};
