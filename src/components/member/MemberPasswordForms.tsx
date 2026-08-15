"use client";

import { useActionState } from "react";
import { Field, FormStatus, SubmitButton, TextInput } from "@/components/ui/Form";
import { Body } from "@/components/ui/Text";
import { changeMemberPassword, signInWithPassword } from "@/app/actions/member-auth";
import {
  emptyChangePasswordState,
  emptyMemberSignInState,
} from "@/lib/member-auth-state";

/**
 * MEMBER SIGN-IN AND PASSWORD CHANGE — the interim credential's two screens.
 *
 * Forms over server actions, so both work before the bundle parses. The
 * reasoning is the same as `SignInForm` and the guest link: a member on
 * Nigerian mobile data should not wait for JavaScript to sign in.
 *
 * ===========================================================================
 * THE PHONE FIELD IS `type="tel"` AND `autoComplete="username"`
 *
 * `tel` raises the numeric keypad on the mid-range Android this audience uses.
 * `username` is what tells a password manager that THIS is the identifier
 * paired with the password below — without it, managers offer to save the
 * password against no username and the member's next sign-in autofills
 * nothing, which is how a password login trains people to write it on paper.
 */

export function MemberSignInForm({
  next,
  className,
}: {
  next: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState(
    signInWithPassword,
    emptyMemberSignInState,
  );

  return (
    <form action={action} className={className}>
      {state.error && (
        <FormStatus tone="error" heading="We could not sign you in.">
          {state.error}
        </FormStatus>
      )}

      <input type="hidden" name="next" value={next} />

      <Field
        name="phone"
        label="Phone number"
        required
        className="mt-3"
        hint="The number the club has for you. A leading 0 is fine."
      >
        {(ids) => (
          <TextInput
            ids={ids}
            type="tel"
            required
            inputMode="tel"
            autoComplete="username"
            placeholder="0801 234 5678"
          />
        )}
      </Field>

      <Field name="password" label="Password" required className="mt-4">
        {(ids) => (
          <TextInput
            ids={ids}
            type="password"
            required
            autoComplete="current-password"
          />
        )}
      </Field>

      <SubmitButton pending={pending} className="mt-5">
        {pending ? "Signing in…" : "Sign in"}
      </SubmitButton>
    </form>
  );
}

/**
 * Change your own password.
 *
 * `mustChange` decides whether the current password is asked for. A member the
 * founder set a password for may never have been told the old one — see the
 * note in src/app/actions/member-auth.ts on why the check exists at all and why
 * this is the one case that waives it.
 */
export function ChangePasswordForm({
  mustChange,
  phone,
  className,
}: {
  mustChange: boolean;
  /** Needed to re-verify the current password. Not shown as an editable field. */
  phone: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState(
    changeMemberPassword,
    emptyChangePasswordState,
  );

  if (state.ok) {
    return (
      <div className={className}>
        <FormStatus tone="success" heading="Done.">
          {state.message}
        </FormStatus>
      </div>
    );
  }

  return (
    <form action={action} className={className}>
      {state.error && (
        <FormStatus tone="error" heading="Not changed.">
          {state.error}
        </FormStatus>
      )}

      <input type="hidden" name="phone" value={phone} />

      {!mustChange && (
        <Field
          name="currentPassword"
          label="Current password"
          required
          className="mt-3"
        >
          {(ids) => (
            <TextInput
              ids={ids}
              type="password"
              required
              autoComplete="current-password"
            />
          )}
        </Field>
      )}

      <Field
        name="password"
        label="New password"
        required
        className="mt-4"
        hint="At least ten characters. A phrase you will remember beats a short one with symbols in it."
      >
        {(ids) => (
          <TextInput
            ids={ids}
            type="password"
            required
            autoComplete="new-password"
          />
        )}
      </Field>

      <Field
        name="confirmation"
        label="New password again"
        required
        className="mt-4"
      >
        {(ids) => (
          <TextInput
            ids={ids}
            type="password"
            required
            autoComplete="new-password"
          />
        )}
      </Field>

      <SubmitButton pending={pending} className="mt-5">
        {pending ? "Saving…" : "Change password"}
      </SubmitButton>

      {mustChange && (
        <Body muted className="mt-4">
          This password was set for you, which means somebody else has seen it.
          Choose one only you know.
        </Body>
      )}
    </form>
  );
}
