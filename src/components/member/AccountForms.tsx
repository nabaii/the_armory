"use client";

import { useActionState, useEffect } from "react";
import { settleCharge, startTopUp } from "@/app/actions/money";
import { emptyMoneyState } from "@/lib/money-state";
import { FormStatus, SubmitButton } from "@/components/ui/Form";
import { Body, Caption } from "@/components/ui/Text";

/**
 * TOP UP, AND SETTLE FROM BALANCE — §6.2's Account screen, §9's Paystack.
 *
 * Forms over server actions, like every other member surface here, so both work
 * before the bundle parses. The reasoning is the same as HostingForms and the
 * guest link: a member on Nigerian mobile data should not wait for JavaScript
 * to pay a bill.
 *
 * ===========================================================================
 * THE REDIRECT TO PAYSTACK IS THE ONE PLACE THAT NEEDS THE CLIENT
 *
 * `startTopUp` returns an authorisation URL rather than redirecting, because a
 * server action that redirects to a third-party host loses the ability to
 * report a refusal — a member whose payment could not be started would be sent
 * nowhere, with nothing on screen.
 *
 * So the action answers, the refusal renders if there is one, and the effect
 * below performs the redirect when there is not. With JavaScript unavailable
 * the link renders instead and the member taps it, which is one extra tap and
 * no lost payment.
 */

export function TopUpForm({
  amounts,
}: {
  /** Labels for `TOP_UP_AMOUNTS`, in the same order. The index is what posts. */
  amounts: readonly string[];
}) {
  const [state, action] = useActionState(startTopUp, emptyMoneyState);

  useEffect(() => {
    if (state.ok && state.authorizationUrl) {
      window.location.href = state.authorizationUrl;
    }
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      {state.message && !state.ok && (
        <FormStatus tone="error" heading="Not started">
          <Body>{state.message}</Body>
        </FormStatus>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Top up by</legend>

        {/* A radio group over a fixed list. The value posted is the INDEX; the
            amount is read server-side from `TOP_UP_AMOUNTS`, so nothing a
            browser can edit becomes a price. See src/app/actions/money.ts. */}
        <div className="flex flex-wrap gap-3">
          {amounts.map((label, index) => (
            <label
              key={label}
              className="flex items-center gap-2 border border-[--color-reticle-black] px-4 py-3"
            >
              <input
                type="radio"
                name="amount"
                value={index}
                defaultChecked={index === 0}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton>Top up</SubmitButton>

      {state.ok && state.authorizationUrl && (
        <Body>
          {/* The no-JavaScript path, and the fallback if the redirect above is
              blocked. Never a success message — nothing has been paid yet. */}
          <a href={state.authorizationUrl} className="underline">
            Continue to payment
          </a>
        </Body>
      )}

      <Caption muted>
        Your account is credited when the bank confirms the payment, not when you
        return to this page.
      </Caption>
    </form>
  );
}

/**
 * Settle one outstanding charge from money already on account.
 *
 * `requestId` is generated on the server for each render and posted with the
 * form. §7 wants every write idempotent on a client-generated id, and this is
 * that id: a member who double-taps, or whose connection drops and who submits
 * again, settles the charge once.
 */
export function SettleForm({
  chargeId,
  requestId,
  label,
}: {
  chargeId: string;
  requestId: string;
  label: string;
}) {
  const [state, action] = useActionState(settleCharge, emptyMoneyState);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="chargeId" value={chargeId} />
      <input type="hidden" name="requestId" value={requestId} />

      {state.message && (
        <Caption muted={state.ok}>{state.message}</Caption>
      )}

      {!state.ok && <SubmitButton>{label}</SubmitButton>}
    </form>
  );
}
