"use client";

import { useActionState } from "react";
import { Caption } from "@/components/ui/Text";
import {
  Field,
  FormStatus,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "@/components/ui/Form";
import { Turnstile } from "@/components/ui/Turnstile";
import { submitGroupEnquiry } from "@/app/actions/intake";
import { emptyIntakeState } from "@/lib/intake-state";
import { routes } from "@/lib/site";

/* ============================================================================
   GROUP AND EVENT ENQUIRY — routed to BOOKINGS, not to the membership pipeline.

   Spec §3 is explicit about the routing: "Enquiry form routed to bookings, not
   to the membership pipeline." That separation matters operationally — a
   corporate away-day and a membership application need different people, a
   different response time and a different conversation. Collapsing them into
   one generic form is how both get answered badly.

   Party size is a required field because the stated success measure for this
   page is "enquiry volume and average party size" — that number cannot be
   recovered later if it is not captured here.

   No prices, no packages. Group pricing is a conversation, and none of it is
   settled content yet.
   ========================================================================= */

export function GroupEnquiryForm({ className }: { className?: string }) {
  const [state, action, pending] = useActionState(
    submitGroupEnquiry,
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

      {/* Honeypot. A different field name from the application form, so a bot
          cannot learn one name and skip it everywhere. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="group-fax">Fax</label>
        <input id="group-fax" name="fax" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          name="group-name"
          label="Your name"
          error={errors["group-name"]}
          required
          className="sm:col-span-2"
        >
          {(ids) => <TextInput ids={ids} required autoComplete="name" />}
        </Field>

        <Field
          name="group-email"
          label="Email address"
          error={errors["group-email"]}
          required
        >
          {(ids) => <TextInput ids={ids} type="email" required autoComplete="email" />}
        </Field>

        <Field
          name="group-phone"
          label="Phone number"
          error={errors["group-phone"]}
          required
        >
          {(ids) => <TextInput ids={ids} type="tel" required autoComplete="tel" />}
        </Field>

        <Field
          name="group-size"
          label="How many people"
          hint="An estimate is fine. It tells us which spaces to hold."
          error={errors["group-size"]}
          required
        >
          {(ids) => <TextInput ids={ids} type="number" required min={2} max={200} />}
        </Field>

        <Field
          name="group-type"
          label="What kind of visit"
          error={errors["group-type"]}
          required
        >
          {(ids) => (
            <SelectInput
              ids={ids}
              required
              placeholder="Select one"
              options={[
                { value: "corporate", label: "Corporate away-day" },
                { value: "celebration", label: "Celebration or birthday" },
                { value: "private-hire", label: "Private hire of a deck" },
                { value: "friends", label: "A group of friends" },
                { value: "other", label: "Something else" },
              ]}
            />
          )}
        </Field>

        <Field
          name="group-note"
          label="Dates you have in mind, and anything else"
          error={errors["group-note"]}
          className="sm:col-span-2"
        >
          {(ids) => <TextArea ids={ids} rows={4} />}
        </Field>
      </div>

      <Turnstile className="mt-3" />

      <SubmitButton pending={pending} className="mt-4">
        {pending ? "Sending…" : "Enquire about a group booking"}
      </SubmitButton>

      <Caption className="mt-2">
        Group enquiries go to our bookings team. Your details are used only to
        answer this enquiry — see our{" "}
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
