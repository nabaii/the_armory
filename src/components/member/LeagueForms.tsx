"use client";

import { useActionState } from "react";
import {
  Field,
  FormStatus,
  SelectInput,
  SubmitButton,
  TextInput,
} from "@/components/ui/Form";
import { Body, Caption, H2 } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { createLeagueAction, joinLeagueAction } from "@/app/actions/leagues";
import { emptyLeagueState, seasonCapMessage } from "@/lib/league-state";
import { routes } from "@/lib/site";

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

/* ---------------------------------------------------------------------------
   CREATE A LEAGUE

   Three fields, and the two that look optional are the mechanism. From the
   Brief: "Design for the group, not the individual: shared fixtures, a standing
   weekly slot, visible absence." A league without a standing slot is a group
   chat — there is nothing for anyone to turn up to.
   -------------------------------------------------------------------------- */

export function CreateLeagueForm({ className }: { className?: string }) {
  const [state, action, pending] = useActionState(createLeagueAction, emptyLeagueState);
  const errors = state.errors ?? {};

  return (
    <form action={action} className={className}>
      {state.formError && (
        <FormStatus tone="error" heading="We could not create that league.">
          {state.formError}
        </FormStatus>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          name="name"
          label="League name"
          hint="Something your friends will recognise."
          error={errors.name}
          required
          className="sm:col-span-2"
        >
          {(ids) => <TextInput ids={ids} required maxLength={60} />}
        </Field>

        {/* Advisory, and the label says so. §6 makes fixtures asynchronous
            — "the fixture is a week, not an evening" — so promising a fixed
            time would be a promise the product deliberately does not keep. */}
        <Field
          name="anchorWeekday"
          label="Which night do you plan to play?"
          hint="Most leagues pick Thursday. Anyone can shoot another day — the week is what counts."
          error={errors.anchorWeekday}
          required
          className="sm:col-span-2"
        >
          {(ids) => (
            <SelectInput
              ids={ids}
              required
              defaultValue="4"
              placeholder="Choose a night"
              options={WEEKDAYS}
            />
          )}
        </Field>
      </div>

      <SubmitButton pending={pending} className="mt-4">
        {pending ? "Creating…" : "Create the league"}
      </SubmitButton>

      <Caption className="mt-2">
        You will get a code to share with three others. A league is a foursome,
        over six weeks — small enough that everyone notices who is missing, and
        short enough that a bad start is never the whole season.
      </Caption>
    </form>
  );
}

/* ---------------------------------------------------------------------------
   JOIN A LEAGUE
   -------------------------------------------------------------------------- */

export function JoinLeagueForm({ className }: { className?: string }) {
  const [state, action, pending] = useActionState(joinLeagueAction, emptyLeagueState);
  const errors = state.errors ?? {};

  /* The season cap is a conversion moment, not a rejection.
     This person has just played a full season and is trying to sign up for
     another. The Brief: "anyone playing weekly discovers, without being
     pitched, that membership is cheaper." So the form gets out of the way and
     the offer takes the page. */
  if (state.capReached) {
    return (
      <div className={className}>
        <H2>{seasonCapMessage.heading}</H2>
        <Body muted className="mt-2 max-w-[68ch]">
          {seasonCapMessage.body}
        </Body>
        <Button href={routes.membership} variant="primary" className="mt-4">
          What membership includes
        </Button>
        <Caption className="mt-3">
          Your scores from last season stay yours, and your league is waiting.
        </Caption>
      </div>
    );
  }

  return (
    <form action={action} className={className}>
      {state.formError && (
        <FormStatus tone="error" heading="We could not join that league.">
          {state.formError}
        </FormStatus>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field
          name="joinCode"
          label="Join code"
          hint="Six characters, from whoever invited you."
          error={errors.joinCode}
          required
          className="flex-1"
        >
          {(ids) => (
            <TextInput
              ids={ids}
              required
              placeholder="ABC-234"
              /* Codes are read aloud and typed on a phone. Autocorrect and
                 autocapitalise both fight the member here; normalisation on the
                 server forgives the rest. */
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
            />
          )}
        </Field>

        <SubmitButton pending={pending}>
          {pending ? "Joining…" : "Join"}
        </SubmitButton>
      </div>
    </form>
  );
}
