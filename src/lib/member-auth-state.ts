/**
 * THE FORM STATE THE MEMBER PASSWORD ACTIONS RETURN — the interim sign-in.
 *
 * Here rather than beside the actions for the reason src/lib/money-state.ts
 * sets out and the framework enforces: a `"use server"` file may export only
 * async functions, because everything it exports is registered as a
 * client-callable endpoint. An exported object is not callable, so the module
 * throws when it is loaded — which happened on SUBMIT rather than on render,
 * and so presented as "something went wrong at our end" on a sign-in form that
 * had been fine a second earlier.
 *
 * These two constants are the initial argument to `useActionState`, which is a
 * client hook. They have to be importable by a client component and they must
 * not be exported from the action module, so they live here.
 */

export type MemberSignInState = {
  ok: boolean;
  error?: string;
};

export const emptyMemberSignInState: MemberSignInState = { ok: false };

export type ChangePasswordState = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const emptyChangePasswordState: ChangePasswordState = { ok: false };

export type EmailFormState = {
  ok: boolean;
  error?: string;
  /** Set on success so the screen can name the address it sent to. */
  sentTo?: string;
};

export const emptyEmailFormState: EmailFormState = { ok: false };

export type ConfirmEmailState = { error?: string };
