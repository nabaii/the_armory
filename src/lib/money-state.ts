/**
 * THE FORM STATE THE MONEY ACTIONS RETURN — §6.2's Account screen.
 *
 * A type and one constant, in their own module for a reason the framework
 * enforces: a `"use server"` file may export only async functions, because
 * anything else it exports would be reachable as a client-callable endpoint.
 * `emptyMoneyState` is an object, so it cannot live beside the actions that use
 * it.
 *
 * That is a constraint worth respecting rather than working around. The rule
 * exists so the boundary between what a browser may invoke and what it may only
 * read stays visible in the file layout — and this codebase already leans on
 * that boundary hard (§9: "the amount never originates in the browser").
 */
export type MoneyState = {
  ok: boolean;
  message?: string;
  /**
   * Where to send the member to pay, on a successful start.
   *
   * Returned rather than redirected to, because a server action that redirected
   * to a third-party host could not also report a refusal — a member whose
   * payment could not be started would be sent nowhere, with nothing on screen.
   */
  authorizationUrl?: string;
};

export const emptyMoneyState: MoneyState = { ok: false };
