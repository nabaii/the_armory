"use client";

import { useActionState } from "react";
import { Caption } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";
import {
  Field,
  FormStatus,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "@/components/ui/Form";
import { Turnstile } from "@/components/ui/Turnstile";
import { submitApplication, emptyIntakeState } from "@/app/actions/intake";
import { routes } from "@/lib/site";
import type { Tier } from "@/lib/content";

/* ============================================================================
   MEMBERSHIP APPLICATION FORM — Flow A, the primary conversion event.

   Spec Flow A step 2: "Short. Name, email, phone, tier of interest, referral
   source, optional note. No ID documents, no payment."

   Three constraints that shape it:

   1. IT IS AN APPLICATION, NOT A CHECKOUT. From the Brief: "Nobody buys a
      status membership from a button." The submit label says so, and no price
      appears anywhere near it. The close happens in person.

   2. NO ID DOCUMENTS, EVER, IN PHASE 1. Spec §7: "No ID documents collected via
      the website in Phase 1. Identity verification happens in person." There is
      no file input in this component and there must not be one — the Brief is
      blunt that the site otherwise becomes "a list of wealthy Abuja residents
      and where they will be, and when".

   3. REFERRAL SOURCE IS NOT DECORATION. Discovery happens on Instagram and
      WhatsApp, where a friend sends a link. This field is how the club learns
      which of those actually converts, and it is the only attribution the site
      will have.

   ----------------------------------------------------------------------------
   PROGRESSIVE ENHANCEMENT

   `useActionState` makes this a client component so field errors render inline,
   but the form still submits without JavaScript: the browser posts it, the
   server action runs, and the page re-renders with the errors in place. Nothing
   the visitor typed is lost either way. `defaultValue` is repopulated from the
   submitted values so a validation error never empties the form — on the site's
   primary conversion event, making someone retype their details is how you lose
   them.
   ========================================================================= */

export function ApplicationForm({
  tiers,
  defaultTier,
  className,
}: {
  tiers: readonly Tier[];
  defaultTier?: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState(
    submitApplication,
    emptyIntakeState,
  );
  const errors = state.errors ?? {};

  return (
    <form action={action} className={className}>
      {state.formError && (
        <FormStatus tone="error" heading="We could not submit that.">
          {state.formError}
        </FormStatus>
      )}

      {/* Honeypot. Bots complete it; humans never see it. Paired with Turnstile
          and rate limiting — deliberately not reCAPTCHA, which is an
          advertising-adjacent tracker and would breach spec §7 on a page
          handling personal data. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="application-website">Website</label>
        <input
          id="application-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          name="name"
          label="Full name"
          error={errors.name}
          required
          className="sm:col-span-2"
        >
          {(ids) => <TextInput ids={ids} required autoComplete="name" />}
        </Field>

        <Field name="email" label="Email address" error={errors.email} required>
          {(ids) => (
            <TextInput ids={ids} type="email" required autoComplete="email" />
          )}
        </Field>

        <Field name="phone" label="Phone number" error={errors.phone} required>
          {(ids) => (
            <TextInput ids={ids} type="tel" required autoComplete="tel" />
          )}
        </Field>

        {/* Tier of interest. Rendered only when the founder has settled tier
            names — an invented option list would put words in their mouth and
            then route real enquiries against them. */}
        <div className="sm:col-span-2">
          {tiers.length > 0 ? (
            <Field
              name="tier"
              label="Tier of interest"
              hint="If you are not sure, choose the closest and we will advise."
              error={errors.tier}
              required
            >
              {(ids) => (
                <SelectInput
                  ids={ids}
                  required
                  placeholder="Select a tier"
                  defaultValue={defaultTier}
                  options={tiers.map((t) => ({ value: t.slug, label: t.name }))}
                />
              )}
            </Field>
          ) : (
            <Pending label="Membership tier names — needed to populate this field and route enquiries (Founder)" />
          )}
        </div>

        <Field
          name="referral"
          label="How did you hear about the club?"
          error={errors.referral}
          required
          className="sm:col-span-2"
        >
          {(ids) => (
            <SelectInput
              ids={ids}
              required
              placeholder="Select one"
              options={[
                { value: "friend", label: "From a friend or member" },
                { value: "instagram", label: "Instagram" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "search", label: "Search" },
                { value: "event", label: "At an event" },
                { value: "other", label: "Somewhere else" },
              ]}
            />
          )}
        </Field>

        <Field
          name="note"
          label="Anything you would like us to know"
          error={errors.note}
          className="sm:col-span-2"
        >
          {(ids) => <TextArea ids={ids} rows={4} />}
        </Field>
      </div>

      <Turnstile className="mt-3" />

      <SubmitButton pending={pending} className="mt-4">
        {pending ? "Submitting…" : "Submit application"}
      </SubmitButton>

      <Caption className="mt-2">
        We do not ask for identity documents online — that happens in person.
        Your details are held only to process your application and are never
        published. See our{" "}
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
