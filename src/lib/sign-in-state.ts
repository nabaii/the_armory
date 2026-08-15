/**
 * The form state the passwordless sign-in action returns.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

export type SignInState = {
  ok: boolean;
  error?: string;
};

export const emptySignInState: SignInState = { ok: false };
