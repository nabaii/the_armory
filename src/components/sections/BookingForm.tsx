"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/cn";
import { Body, Caption, H3, Kicker } from "@/components/ui/Text";
import {
  Field,
  FieldError,
  FormStatus,
  SubmitButton,
  TextInput,
} from "@/components/ui/Form";
import { Turnstile } from "@/components/ui/Turnstile";
import { requestBooking, emptyBookingState } from "@/app/actions/booking";
import { routes } from "@/lib/site";

/* ============================================================================
   BOOKING FORM — Flow B, steps 2 to 4.

   Target: "complete in under three minutes on a mobile device." Everything here
   is shaped by that budget — one screen, no wizard, no account, four decisions
   (when, how many, who you are, agree to the terms) and then payment.

   ----------------------------------------------------------------------------
   PARTY NAMES ARE NOT COLLECTED

   Flow B step 3 lists them as optional. They are omitted entirely, because
   collecting the names of everyone attending against a date and a time builds
   precisely the dataset the Brief identifies as the site's core risk — "a list
   of wealthy Abuja residents and where they will be, and when". A head count is
   all the session needs; names are taken at reception.

   ----------------------------------------------------------------------------
   THE DEPOSIT TERMS ARE ON THIS FORM, NOT BEHIND THE PAYMENT BUTTON

   Spec §9: "Refund and deposit terms appear before payment is taken." Flow B
   step 4: "Refund policy shown before payment, not after." The version the
   visitor is shown travels with the submission in a hidden field, and the server
   rejects the booking if the policy changed in the meantime — because at that
   point they have agreed to terms that are no longer in force.
   ========================================================================= */

export type BookableSlot = {
  id: string;
  dateLabel: string;
  timeLabel: string;
  remaining: number;
};

export type SlotGroup = { dateLabel: string; slots: BookableSlot[] };

export function BookingForm({
  groups,
  policyVersion,
  depositLabel,
  priceLabel,
  maxPartySize,
  className,
}: {
  groups: readonly SlotGroup[];
  policyVersion: string;
  /** Pre-formatted naira. Formatting happens server-side, once. */
  depositLabel: string;
  priceLabel: string;
  maxPartySize: number;
  className?: string;
}) {
  const [state, action, pending] = useActionState(
    requestBooking,
    emptyBookingState,
  );
  const errors = state.errors ?? {};

  /* Local selection state is for the visual affordance only. The submitted
     value comes from the checked radio, so the form still works without JS. */
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <form action={action} className={cn("max-w-[46rem]", className)}>
      {state.formError && (
        <FormStatus tone="error" heading="We could not start your booking.">
          {state.formError}
        </FormStatus>
      )}

      {/* The terms in force when this page rendered. */}
      <input type="hidden" name="policyVersion" value={policyVersion} />

      {/* Honeypot. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="booking-organisation">Organisation</label>
        <input
          id="booking-organisation"
          name="organisation"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {/* ------------------------------------------------- 1. WHEN
          A radio group in a fieldset, so the whole set is announced with its
          legend and arrow keys move between options. A listbox or a custom
          widget would be worse on both counts and slower on a phone. */}
      <fieldset className="mt-3">
        <legend className="u-kicker mb-2 text-[var(--ink)]">
          Choose a session
        </legend>

        {errors.slotId && <FieldError>{errors.slotId}</FieldError>}

        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.dateLabel}>
              <H3 className="text-h3">{group.dateLabel}</H3>
              <div className="mt-1 flex flex-wrap gap-2">
                {group.slots.map((slot) => {
                  const full = slot.remaining <= 0;
                  return (
                    <label
                      key={slot.id}
                      className={cn(
                        "inline-flex min-h-6 cursor-pointer items-center gap-2 border px-2 py-1",
                        "rounded-control transition-colors",
                        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
                        "has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ten-ring-red",
                        full && "cursor-not-allowed opacity-50",
                        selected === slot.id
                          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--btn-fill-ink)]"
                          : "border-[var(--rule)] text-[var(--ink)]",
                      )}
                    >
                      <input
                        type="radio"
                        name="slotId"
                        value={slot.id}
                        disabled={full}
                        required
                        onChange={() => setSelected(slot.id)}
                        className="sr-only"
                      />
                      <span className="text-body font-bold">{slot.timeLabel}</span>
                      {/* No opacity — the size difference already separates the
                          count from the time. A fixed opacity is not a colour:
                          it lands differently on every ground, and the same
                          trick on form labels measured 3.27:1 on Soffit Blue.
                          Availability is the deciding fact on this control and
                          must not be the dimmest thing on it. */}
                      <span className="text-caption">
                        {full
                          ? "full"
                          : `${slot.remaining} ${slot.remaining === 1 ? "place" : "places"}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {/* ------------------------------------------------- 2. HOW MANY */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          name="partySize"
          label="How many people"
          hint={`Up to ${maxPartySize}. Larger groups are better through our groups page.`}
          error={errors.partySize}
          required
        >
          {(ids) => (
            <TextInput
              ids={ids}
              type="number"
              required
              min={1}
              max={maxPartySize}
              defaultValue={1}
            />
          )}
        </Field>

        <Field name="name" label="Full name" error={errors.name} required>
          {(ids) => <TextInput ids={ids} required autoComplete="name" />}
        </Field>

        <Field name="email" label="Email address" error={errors.email} required>
          {(ids) => (
            <TextInput ids={ids} type="email" required autoComplete="email" />
          )}
        </Field>

        <Field name="phone" label="Phone number" error={errors.phone} required>
          {(ids) => <TextInput ids={ids} type="tel" required autoComplete="tel" />}
        </Field>
      </div>

      {/* --------------------------------- 3. PRICE AND DEPOSIT TERMS
          Before the payment button, never after it. */}
      <div className="mt-4 border-l-2 border-[var(--rule)] pl-3">
        <Kicker className="mb-1">Price and deposit</Kicker>
        <Body>
          {priceLabel} per person. A deposit of {depositLabel} per person is taken
          now to hold your session; the balance is paid on the day.
        </Body>
        <Caption className="mt-1">
          Read the{" "}
          <a
            href={routes.refunds}
            className="underline decoration-1 underline-offset-2"
          >
            refund and deposit policy
          </a>{" "}
          before you pay. It covers changing your date, cancelling, and what
          happens if we have to close.
        </Caption>
      </div>

      {/* ------------------------------------ 4. AGE CONFIRMATION
          An explicit affirmation, unchecked by default. A pre-ticked box is not
          a confirmation of anything. */}
      <div className="mt-4">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            name="ageConfirmed"
            value="yes"
            required
            className="mt-[0.3em] size-2 shrink-0 accent-ten-ring-deep"
            aria-describedby={errors.ageConfirmed ? "age-error" : undefined}
            aria-invalid={errors.ageConfirmed ? true : undefined}
          />
          <span className="text-body text-[var(--ink)]">
            I confirm everyone in my party meets the age requirement, and that we
            will follow the range officer&rsquo;s instructions throughout.
          </span>
        </label>
        {errors.ageConfirmed && (
          <FieldError id="age-error">{errors.ageConfirmed}</FieldError>
        )}
      </div>

      {errors.policyVersion && (
        <div className="mt-3">
          <FormStatus tone="error" heading="Our deposit terms changed.">
            {errors.policyVersion}
          </FormStatus>
        </div>
      )}

      <Turnstile className="mt-3" />

      <SubmitButton pending={pending} className="mt-4">
        {pending ? "Taking you to payment…" : "Pay deposit and book"}
      </SubmitButton>

      <Caption className="mt-2">
        Payment is handled by Paystack. We never see or store your card details.
      </Caption>
    </form>
  );
}
