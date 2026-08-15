"use client";

import { useActionState } from "react";
import { Field, FormStatus, SubmitButton, TextInput } from "@/components/ui/Form";
import { Turnstile } from "@/components/ui/Turnstile";
import { requestSignInLink } from "@/app/actions/auth";
import { emptySignInState } from "@/lib/sign-in-state";

/**
 * Sign-in request form.
 *
 * One field. The whole point of passwordless is that there is nothing else to
 * ask for, and adding anything here would undo that.
 *
 * Note there is no "no account?" error state to render — the action returns the
 * same confirmation whether or not the address belongs to a member, because
 * telling a stranger whether a named person belongs to this club is a
 * disclosure. See the note in src/app/actions/auth.ts.
 */
export function SignInForm({
  next,
  className,
}: {
  next: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState(
    requestSignInLink,
    emptySignInState,
  );

  return (
    <form action={action} className={className}>
      {state.error && (
        <FormStatus tone="error" heading="We could not send that link.">
          {state.error}
        </FormStatus>
      )}

      <input type="hidden" name="next" value={next} />

      {/* Honeypot. A different field name again, so a bot cannot learn one. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="sign-in-surname">Surname</label>
        <input
          id="sign-in-surname"
          name="surname"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field name="email" label="Email address" required className="flex-1">
          {(ids) => (
            <TextInput
              ids={ids}
              type="email"
              required
              autoComplete="email"
              /* Brings up the right keyboard and lets a password manager fill
                 the address on the mid-range Android this audience uses. */
              inputMode="email"
              placeholder="you@example.com"
            />
          )}
        </Field>

        <SubmitButton pending={pending}>
          {pending ? "Sending…" : "Email me a link"}
        </SubmitButton>
      </div>

      <Turnstile className="mt-3" />
    </form>
  );
}
