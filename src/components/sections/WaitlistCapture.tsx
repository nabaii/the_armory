"use client";

import { useActionState } from "react";
import { cn } from "@/lib/cn";
import { Caption } from "@/components/ui/Text";
import { Field, FormStatus, SubmitButton, TextInput } from "@/components/ui/Form";
import { Turnstile } from "@/components/ui/Turnstile";
import { joinWaitlist, emptyIntakeState } from "@/app/actions/intake";
import { routes } from "@/lib/site";

/* ============================================================================
   WAITLIST CAPTURE — spec §5: "Single-field email capture for Leagues."

   Spec §3 is emphatic about the scope: "Email waitlist capture. Nothing else.
   No accounts, no league creation, no scores." Leagues is a genuine software
   product and it ships in Phase 2, onto a founding-member base that already
   exists. Launching a social competition product to an empty range is throwing
   a party nobody attends.

   So this component is one field and one button, and the §9 criterion it must
   satisfy is that it "promises nothing that Phase 2 will not deliver".

   ----------------------------------------------------------------------------
   TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT

   1. THE SOURCE FIELD. The stated success measure for the Leagues page is
      "waitlist sign-ups; proportion converting to membership applications". That
      second number cannot be computed after the fact without a shared
      identifier, and it is the number that decides whether Leagues is worth
      building at all. So every signup carries where it came from.

   2. A WAITLIST IS PERSONAL DATA. It is a list of people interested in a
      private club — the same category the Brief flags as "an attractive target".
      It goes through the same delivery path and the same durability guarantee as
      a membership application, with explicit consent language and a linked
      privacy policy. Not an email field bolted onto a marketing page.
   ========================================================================= */

export function WaitlistCapture({
  /** Where this instance sits, e.g. "leagues-page" or "home-module". */
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState(joinWaitlist, emptyIntakeState);
  const errors = state.errors ?? {};

  return (
    <form action={action} className={cn("max-w-[34rem]", className)}>
      {state.formError && (
        <FormStatus tone="error" heading="We could not add you just now.">
          {state.formError}
        </FormStatus>
      )}

      {/* Attribution for the conversion measure. */}
      <input type="hidden" name="source" value={source} />

      {/* Honeypot. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="waitlist-company">Company</label>
        <input
          id="waitlist-company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field
          name="email"
          label="Email address"
          error={errors.email}
          required
          className="flex-1"
        >
          {(ids) => (
            <TextInput
              ids={ids}
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          )}
        </Field>

        <SubmitButton pending={pending}>
          {pending ? "Adding…" : "Join the waitlist"}
        </SubmitButton>
      </div>

      <Turnstile className="mt-2" />

      <Caption className="mt-2">
        We will email you once when Leagues opens. Founding members get first
        access. Your address is not shared, and you can ask us to remove it at
        any time — see our{" "}
        <a
          href={routes.privacy}
          className="underline decoration-1 underline-offset-2"
        >
          privacy policy
        </a>
        .
      </Caption>
    </form>
  );
}
