/**
 * The form state the league actions return, and the copy the cap is refused in.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

import { SEASON_CAP_MESSAGE } from "@/server/leagues/eligibility";

export type LeagueState = {
  errors?: Record<string, string>;
  formError?: string;
  /** Rendered as a considered offer rather than a rejection. */
  capReached?: boolean;
};

export const emptyLeagueState: LeagueState = {};

/**
 * Re-exported so the form renders the same words the rule uses.
 *
 * The rule keeps the only copy — src/server/leagues/eligibility.ts holds pure
 * logic over a type-only schema import, so reaching it from a client component
 * costs the bundle nothing and duplicating the words here would let the offer
 * and the rule drift apart.
 */
export const seasonCapMessage = SEASON_CAP_MESSAGE;
