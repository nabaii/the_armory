"use client";

import { useActionState } from "react";
import { Field, FormStatus, SubmitButton, TextInput } from "@/components/ui/Form";
import { Body, Caption } from "@/components/ui/Text";
import { confirmEmail, sendEmailVerification } from "@/app/actions/member-auth";
import {
  emptyEmailFormState,
  type EmailFormState,
} from "@/lib/member-auth-state";

/**
 * ADDING AN EMAIL, AND CONFIRMING IT.
 *
 * ===========================================================================
 * THE COPY LEADS WITH THE REASON, NOT THE FIELD
 *
 * A member does not want to "manage email preferences". The thing they will one
 * day want, urgently, is to get back into their account — and with no address
 * on file the only route is asking the club, which cannot be done at ten at
 * night from a car park. So the heading is about getting in, and the address is
 * how.
 *
 * src/lib/content-gate.ts sets the house rule the empty state follows: "a
 * missing value must LOOK missing." No greyed-out placeholder address.
 */

export function AddEmailForm({
  current,
  state: emailState,
}: {
  current?: string;
  state: "none" | "pending" | "unconfirmed" | "verified";
}) {
  const [state, action, pending] = useActionState<EmailFormState, FormData>(
    sendEmailVerification,
    emptyEmailFormState,
  );

  if (state.ok && state.sentTo) {
    return (
      <FormStatus tone="success" heading="Check your inbox.">
        We sent a link to {state.sentTo}. It works once and expires in an hour.
      </FormStatus>
    );
  }

  return (
    <form action={action} className="max-w-[34rem]">
      {state.error && (
        <div className="mb-4">
          <FormStatus tone="error" heading="That did not work.">
            {state.error}
          </FormStatus>
        </div>
      )}

      {emailState === "verified" && current && (
        <Body className="mb-3">
          <span className="font-medium">{current}</span> — confirmed.
        </Body>
      )}

      {emailState === "pending" && current && (
        <Body className="mb-3">
          We sent a link to <span className="font-medium">{current}</span>. Send it
          again below, or use a different address.
        </Body>
      )}

      {emailState === "unconfirmed" && current && (
        <Body className="mb-3">
          The club has <span className="font-medium">{current}</span> on your
          record, but nobody has confirmed it yet. Confirm it and you can use it
          to sign in.
        </Body>
      )}

      {emailState === "none" && (
        <Body className="mb-3">
          You sign in with your phone number and your password. Adding an email
          gives you a second way in — and a way back if you ever forget the
          password.
        </Body>
      )}

      <Field
        name="email"
        label="Email address"
        required
        hint="We send one message to it. Nothing changes until you open the link."
      >
        {(ids) => (
          <TextInput
            ids={ids}
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            defaultValue={emailState === "unconfirmed" ? current : undefined}
          />
        )}
      </Field>

      <SubmitButton pending={pending} className="mt-4">
        {pending
          ? "Sending…"
          : emailState === "none"
            ? "Send me a link"
            : "Send the link again"}
      </SubmitButton>

      <Caption className="mt-3">
        Nothing changes until you open the link. Without an email you can still
        sign in with your phone and password — you would just need to ask the
        club to reset it.
      </Caption>
    </form>
  );
}

/**
 * The POST that actually redeems the token.
 *
 * A form rather than an auto-submitting effect, for the reason VerifyForm gives
 * about sign-in links: a link that redeems itself is redeemed by mail scanners
 * and link previewers before the member ever clicks it, and the member is then
 * told their brand-new link has already been used.
 */
export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmEmail, {});

  return (
    <form action={action}>
      {state.error && (
        <div className="mb-4">
          <FormStatus tone="error" heading="That link no longer works.">
            {state.error}
          </FormStatus>
        </div>
      )}

      <input type="hidden" name="token" value={token} />

      {!state.error && (
        <SubmitButton pending={pending}>
          {pending ? "Confirming…" : "Confirm this address"}
        </SubmitButton>
      )}
    </form>
  );
}
