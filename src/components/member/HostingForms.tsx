"use client";

import { useActionState } from "react";
import { bookSession, cancelInvitation, inviteGuest } from "@/app/actions/hosting";
import { emptyHostingState } from "@/lib/hosting-state";
import { FormStatus, SubmitButton } from "@/components/ui/Form";
import { Body, Caption } from "@/components/ui/Text";

/**
 * BOOK A SESSION, AND INVITE A GUEST — §6.2's two interactive surfaces.
 *
 * Both are forms over server actions, so both work before the bundle parses —
 * the same reasoning as the guest link and as src/app/actions/intake.ts. A
 * member on Nigerian mobile data should not wait for JavaScript to book a lane.
 */

/* ============================================================================
   BOOK A SESSION
   ========================================================================= */

export type SlotOption = {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly label: string;
  readonly free: number;
  readonly capacity: number;
};

export function BookSessionForm({
  discipline,
  slots,
}: {
  discipline: string;
  slots: readonly SlotOption[];
}) {
  const [state, action] = useActionState(bookSession, emptyHostingState);

  if (slots.length === 0) {
    return (
      <Body muted>
        Nothing open for {discipline} in the next two weeks.
      </Body>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="discipline" value={discipline} />

      {state.formError && (
        <FormStatus tone="error" heading="Not booked">
          <Body>{state.formError}</Body>
        </FormStatus>
      )}

      {state.ok && state.message && (
        <FormStatus tone="success" heading="Booked">
          <Body>{state.message}</Body>
        </FormStatus>
      )}

      <fieldset className="space-y-2">
        <legend className="u-kicker text-[var(--ink)]">Choose a session</legend>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {slots.map((slot) => (
            <label
              key={slot.id}
              className={`flex items-center gap-3 border border-[var(--rule)] p-3 ${
                slot.free === 0 ? "opacity-50" : ""
              }`}
            >
              <input
                type="radio"
                name="slot"
                value={slot.id}
                disabled={slot.free === 0}
                required
                className="size-4 shrink-0"
                /* The instants travel as hidden values on the chosen radio
                   rather than being re-derived server-side from the id. The id
                   is a reference the server re-validates; these are what it
                   validates against. */
                onChange={(event) => {
                  const form = event.currentTarget.form;
                  if (!form) return;
                  (form.elements.namedItem("slotStart") as HTMLInputElement).value =
                    slot.start;
                  (form.elements.namedItem("slotEnd") as HTMLInputElement).value =
                    slot.end;
                }}
              />
              <span className="flex-1">{slot.label}</span>
              <span className="text-sm text-[var(--ink-muted)]">
                {/* §6.2 shows the picture of the week, full slots included —
                    a Saturday that vanished because it was busy would read as
                    the club being closed. */}
                {slot.free === 0
                  ? "Full"
                  : `${slot.free} of ${slot.capacity} free`}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Populated by the radio above. Present in the markup from the start so
          a submission without JavaScript still carries them — the first slot is
          the default, which matches what a no-JS member would have selected. */}
      <input type="hidden" name="slotStart" defaultValue={slots[0]?.start ?? ""} />
      <input type="hidden" name="slotEnd" defaultValue={slots[0]?.end ?? ""} />

      <SubmitButton>Book this session</SubmitButton>
    </form>
  );
}

/* ============================================================================
   INVITE A GUEST
   ========================================================================= */

export function InviteGuestForm({
  bookingId,
  remaining,
  includedQuota,
}: {
  bookingId: string | null;
  remaining: number;
  includedQuota: number;
}) {
  const [state, action] = useActionState(inviteGuest, emptyHostingState);

  return (
    <form action={action} className="space-y-4">
      {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}

      {/* §6.2: "Allowance shown BEFORE and after." This is before. */}
      <Body>
        {remaining > 0
          ? `${remaining} of your ${includedQuota} included guest visits left this year.`
          : `You have used all ${includedQuota} included guest visits this year.`}
      </Body>

      {state.formError && (
        <FormStatus tone="error" heading="Not invited">
          <Body>{state.formError}</Body>
        </FormStatus>
      )}

      {/* §12: "Overage offered in the portal WITH THE PRICE SHOWN. Never
          discovered at the desk."

          This is that offer. It appears in place of a refusal, carries the
          price, and requires a second deliberate submission — a member is never
          billed by the same tap that discovered the charge. */}
      {state.overagePrompt && !state.ok && (
        <div className="border-l-4 border-[var(--rule)] py-2 pl-4">
          <Body>
            This would be guest {state.overagePrompt.guestNumber}, beyond your
            included allowance. Further guests are{" "}
            {state.overagePrompt.priceLabel} each, charged to your account.
          </Body>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="overageAccepted"
              value="yes"
              className="mt-1 size-4 shrink-0"
            />
            <span>I accept the charge. Send the invitation.</span>
          </label>
        </div>
      )}

      {state.ok && state.message && (
        <FormStatus tone="success" heading="Invitation ready">
          <Body>Send your guest this link. It is good for three days.</Body>
          {/* §9 makes WhatsApp the primary channel and its queued, retried,
              template-versioned sender is M8. Until it exists the host passes
              the link on — which is what a member would do anyway if a message
              failed to arrive. */}
          <code className="mt-2 block break-all border border-[var(--rule)] p-2 text-sm">
            {state.message}
          </code>
          {state.overagePrompt && (
            <Caption>
              Charged to your account at {state.overagePrompt.priceLabel}.
            </Caption>
          )}
        </FormStatus>
      )}

      <SubmitButton>
        {state.overagePrompt && !state.ok ? "Confirm and invite" : "Invite a guest"}
      </SubmitButton>

      <Caption>
        Your guest fills in their own details and signs the waiver. Nothing for
        you to collect.
      </Caption>
    </form>
  );
}

/* ============================================================================
   CANCEL — §5: "Cancelling returns it."
   ========================================================================= */

export function CancelInvitationForm({
  invitationId,
  guestLabel,
}: {
  invitationId: string;
  guestLabel: string;
}) {
  const [state, action] = useActionState(cancelInvitation, emptyHostingState);

  if (state.ok) {
    return <Caption>{state.message}</Caption>;
  }

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="invitationId" value={invitationId} />
      <span className="flex-1 text-sm">{guestLabel}</span>
      <button
        type="submit"
        className="shrink-0 rounded-control border border-[var(--rule)] px-3 py-1 text-sm"
      >
        Cancel
      </button>
      {state.formError && <Caption>{state.formError}</Caption>}
    </form>
  );
}
