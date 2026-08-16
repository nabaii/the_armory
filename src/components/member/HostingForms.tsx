"use client";

import { useActionState } from "react";
import { cancelInvitation, inviteGuest } from "@/app/actions/hosting";
import { emptyHostingState } from "@/lib/hosting-state";
import { FormStatus, SubmitButton } from "@/components/ui/Form";
import { Body, Caption } from "@/components/ui/Text";

/**
 * INVITE A GUEST — §6.2, and §10's third placement.
 *
 * A form over a server action, so it works before the bundle parses — the same
 * reasoning as the guest link and as src/app/actions/intake.ts. A member on
 * Nigerian mobile data should not wait for JavaScript to invite somebody.
 *
 * ---------------------------------------------------------------------------
 * WHAT USED TO BE HERE
 *
 * `BookSessionForm` — one slot picker per discipline, posting to `bookSession`.
 * It was the whole of booking before the Members Portal specification, and it
 * is superseded by the five-step flow at /portal/book/new, which asks what the
 * booking is FOR (§7.4) before it asks which line. Both are removed rather than
 * left beside the new flow: a second path into the same table would eventually
 * take a booking without a `booking_type`, and dead code that reads as live is
 * how a member ends up on a screen nobody maintains.
 */

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
