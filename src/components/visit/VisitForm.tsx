"use client";

import { useActionState } from "react";
import { Field, FormStatus, SubmitButton, TextInput } from "@/components/ui/Form";
import { Body, Caption } from "@/components/ui/Text";
import { emptyVisitState, submitVisit } from "@/app/actions/visit";

/**
 * THE GUEST FORM — §6.3.
 *
 *   "Acceptance: personal details, emergency contact, date of birth and a signed
 *    waiver, completed end to end in under two minutes on a mid-range Android
 *    over throttled 3G, with no account creation and no password."
 *
 * ===========================================================================
 * SEVEN FIELDS, AND EVERY ONE OF THEM EARNS ITS PLACE
 *
 * Two minutes is the budget for a nervous person in a car park, thumb-typing.
 * Every field is one §6.3 names or one the club cannot run a range without:
 *
 *   first name, last name    who is on the premises (§3.3 participations)
 *   phone                    §3.1's account identifier; how the club reaches them
 *   date of birth            §3.1: "required before a person may shoot"
 *   emergency contact × 2    somebody about to stand on a live range
 *   waiver                   §4 GUEST_MAY_ATTEND fails without it
 *
 * Email is optional and marked so — §3.1: "email is optional and secondary,
 * which is the reverse of the leagues product." Address is not asked for at all.
 * The club does not need where a guest lives in order to host them once, and §10
 * calls every field here "a concentration of sensitive personal data". The
 * cheapest way to protect data is not to collect it.
 *
 * ===========================================================================
 * WHY THIS IS A CLIENT COMPONENT AND STILL WORKS WITHOUT JAVASCRIPT
 *
 * `useActionState` renders a plain <form action={…}>. Before hydration the
 * browser posts it natively, the server action runs, and the page re-renders
 * with errors in place — which is the path that has to fit inside two minutes on
 * 3G. Hydration only upgrades it.
 *
 * That inverts the usual reading of "use client": nothing here WAITS for
 * JavaScript. The directive buys a pending state, and if the bundle never
 * arrives the form is still complete and still submits.
 *
 * ===========================================================================
 * INPUT TYPES ARE A PERFORMANCE FEATURE ON A PHONE
 *
 * `type="tel"` and `inputMode` decide which keyboard opens. On a mid-range
 * Android, a guest who has to switch from letters to numbers loses several
 * seconds per field, and there are three numeric fields here. It is the cheapest
 * part of the two-minute budget and the easiest to leave on the table.
 */

export function VisitForm({
  token,
  personId,
  signatureId,
  hostName,
  waiverBody,
}: {
  token: string;
  /* Minted server-side when the form was drawn. §7's replay safety for a surface
     that has no client to generate one — see src/app/actions/visit.ts. */
  personId: string;
  signatureId: string;
  hostName: string;
  waiverBody: string;
}) {
  const [state, action] = useActionState(submitVisit, emptyVisitState);

  if (state.ok) {
    return (
      <FormStatus tone="success" heading="You are on the list.">
        <Body>
          {hostName} will meet you at the club. Nothing to bring and nothing to
          print — the desk already has your details.
        </Body>
      </FormStatus>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="signatureId" value={signatureId} />

      {state.formError && (
        <FormStatus tone="error" heading="That did not go through">
          <Body>{state.formError}</Body>
        </FormStatus>
      )}

      <Field
        name="firstName"
        label="First name"
        required
        error={state.errors?.firstName}
      >
        {(ids) => <TextInput ids={ids} autoComplete="given-name" required />}
      </Field>

      <Field
        name="lastName"
        label="Last name"
        required
        error={state.errors?.lastName}
      >
        {(ids) => <TextInput ids={ids} autoComplete="family-name" required />}
      </Field>

      <Field
        name="phone"
        label="Phone"
        hint="So the club can reach you on the day."
        required
        error={state.errors?.phone}
      >
        {(ids) => (
          <TextInput
            ids={ids}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0801 234 5678"
            required
          />
        )}
      </Field>

      <Field
        name="dateOfBirth"
        label="Date of birth"
        hint="Everyone shooting must be 18 or over."
        required
        error={state.errors?.dateOfBirth}
      >
        {(ids) => <TextInput ids={ids} type="date" autoComplete="bday" required />}
      </Field>

      <Field
        name="emergencyContactName"
        label="Emergency contact"
        hint="Somebody we can call. Standard for any live range."
        required
        error={state.errors?.emergencyContactName}
      >
        {(ids) => <TextInput ids={ids} required />}
      </Field>

      <Field
        name="emergencyContactPhone"
        label="Their phone"
        required
        error={state.errors?.emergencyContactPhone}
      >
        {(ids) => (
          <TextInput
            ids={ids}
            type="tel"
            inputMode="tel"
            placeholder="0801 234 5678"
            required
          />
        )}
      </Field>

      <Field
        name="email"
        label="Email"
        hint="Only used to send your scores afterwards."
        error={state.errors?.email}
      >
        {(ids) => <TextInput ids={ids} type="email" inputMode="email" />}
      </Field>

      {/* THE WAIVER.

          Shown in full, not behind a link. §3.1 makes the signature the club's
          evidence that a named person accepted a NAMED VERSION of a document,
          and a checkbox beside a hyperlink nobody opened is weak evidence of
          that. It is also one fewer navigation inside the two minutes.

          A scrolling region rather than a wall of text, so the guest can see the
          form continues below it — otherwise the page reads as a legal document
          with a button lost somewhere at the bottom. */}
      <fieldset className="space-y-2">
        <legend className="u-kicker text-[var(--ink)]">The waiver</legend>

        <div
          className="max-h-48 overflow-y-auto border border-[var(--rule)] p-3 text-sm"
          tabIndex={0}
          role="region"
          aria-label="Waiver text"
        >
          {waiverBody.split("\n\n").map((paragraph, index) => (
            <p key={index} className="mb-2 last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="waiver"
            value="accepted"
            required
            aria-describedby={state.errors?.waiver ? "waiver-error" : undefined}
            className="mt-1 size-4 shrink-0"
          />
          <span>I have read the waiver and I accept it.</span>
        </label>

        {state.errors?.waiver && (
          <Caption id="waiver-error">{state.errors.waiver}</Caption>
        )}
      </fieldset>

      <SubmitButton>Confirm my visit</SubmitButton>

      <Caption>
        No account and no password. The club keeps these details for your visit.
      </Caption>
    </form>
  );
}
