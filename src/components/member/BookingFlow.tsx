"use client";

import { useActionState, useState } from "react";
import { placeBooking } from "@/app/actions/booking-flow";
import { emptyBookingFlowState, type Companion } from "@/lib/booking-flow-state";
import { Body, Caption, H2, H3 } from "@/components/ui/Text";
import { CONTROL, FormStatus, SubmitButton } from "@/components/ui/Form";
import { AllowanceMeter } from "@/components/member/AllowanceMeter";
import { cn } from "@/lib/cn";

/**
 * STEPS FOUR AND FIVE — Members Portal §7.4.
 *
 *   "4 — Who | Just me, or named companions. Members searched; guests named
 *        and sent a link. | Host allowance, atomically, server-side."
 *   "5 — Confirm | Summary, any overage as a line item | Capacity at commit."
 *
 * ===========================================================================
 * WHY THESE TWO ARE ONE COMPONENT AND STEPS ONE TO THREE ARE ROUTES
 *
 * §7.4 asks for a route rather than a modal sheet, and steps one to three are
 * exactly that: date, slot, what for, which line, all in the URL. They are
 * deep-linkable, they survive a refresh, and the Diary links straight into them
 * with a slot already chosen.
 *
 * The line is drawn here, at the step where the member starts naming people.
 * Two reasons, and the second is the one that decided it:
 *
 * 1. A URL that carries a guest's name and phone number is a URL in a browser
 *    history, a shared link and a server log. §10 names visit schedules among
 *    the most sensitive data the club holds; the names of who is coming with
 *    them is not less so.
 *
 * 2. The alternative — persist a draft booking at step four and confirm it at
 *    step five — would hold the member's guest allowance from the moment they
 *    typed a name. Somebody who closes the tab has spent a guest visit they did
 *    not use, and the club then owes a sweep to release them. Nothing is
 *    written until the member commits, so there is nothing to abandon.
 *
 * §13.2 permits precisely this: "the booking flow's local state".
 *
 * ===========================================================================
 * THE OVERAGE APPEARS ONCE, HERE, AS A LINE ITEM
 *
 * §7.4: "not confirmed twice, not warned about in advance, and not accompanied
 * by a note that the allowance is exhausted. A member who performs mental
 * arithmetic before inviting someone invites fewer people, and invitations are
 * the only growth channel the club has."
 *
 * So step four's guest fields carry no running total and no warning. The count
 * and the price appear on the confirm panel, in the summary, next to everything
 * else the member is agreeing to.
 */

export type FlowSummary = {
  readonly whenLabel: string;
  readonly purposeLabel: string;
  readonly slotStart: string;
  readonly slotEnd: string;
  readonly bookingType: string;
  readonly discipline: string | null;
};

export function BookingFlow({
  summary,
  canHost,
  allowance,
  overagePriceLabel,
}: {
  summary: FlowSummary;
  canHost: boolean;
  allowance: {
    readonly remaining: number;
    readonly includedQuota: number;
    readonly periodEnd: string;
  };
  /** Already formatted by the money layer. Null while §14 leaves it unset. */
  overagePriceLabel: string | null;
}) {
  const [state, action] = useActionState(placeBooking, emptyBookingFlowState);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [step, setStep] = useState<"who" | "confirm">("who");

  const overageCount = Math.max(0, companions.length - allowance.remaining);

  return (
    <form action={action} className="space-y-6">
      {/* Everything steps one to three settled, carried as the form's own
          record of what the member chose. Re-read and re-checked server-side —
          a hidden input is a convenience, never an authorisation. */}
      <input type="hidden" name="slotStart" value={summary.slotStart} />
      <input type="hidden" name="slotEnd" value={summary.slotEnd} />
      <input type="hidden" name="bookingType" value={summary.bookingType} />
      {summary.discipline && (
        <input type="hidden" name="discipline" value={summary.discipline} />
      )}

      {step === "who" ? (
        <>
          <div>
            <Caption>Step 4 of 5</Caption>
            <H2>Who&rsquo;s coming?</H2>
          </div>

          {companions.length === 0 && (
            <Body muted>
              Just you, unless you add someone. A guest gets their own link to
              fill in before they arrive.
            </Body>
          )}

          {/* Named, never counted — §10. */}
          {companions.map((companion, index) => (
            <div
              key={index}
              className="rounded-control border border-[var(--rule)]/40 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`companion-name-${index}`}
                    className="u-kicker text-[var(--ink)]"
                  >
                    Name
                  </label>
                  <input
                    id={`companion-name-${index}`}
                    name="companionName"
                    value={companion.name}
                    required
                    autoComplete="off"
                    className={CONTROL}
                    onChange={(event) =>
                      setCompanions((current) =>
                        current.map((entry, position) =>
                          position === index
                            ? { ...entry, name: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`companion-phone-${index}`}
                    className="u-kicker text-[var(--ink)]"
                  >
                    Phone
                    <span className="ml-1 font-normal normal-case tracking-normal">
                      (optional)
                    </span>
                  </label>
                  <input
                    id={`companion-phone-${index}`}
                    name="companionPhone"
                    type="tel"
                    value={companion.phone}
                    autoComplete="off"
                    className={CONTROL}
                    onChange={(event) =>
                      setCompanions((current) =>
                        current.map((entry, position) =>
                          position === index
                            ? { ...entry, phone: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCompanions((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
                className="mt-2 text-caption underline decoration-1 underline-offset-4"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            {canHost && (
              <button
                type="button"
                onClick={() =>
                  setCompanions((current) => [...current, { name: "", phone: "" }])
                }
                className={cn(
                  "inline-flex min-h-6 items-center rounded-control px-4 py-2",
                  "border border-[var(--ink)] text-[var(--ink)]",
                  "text-body font-display font-bold",
                )}
              >
                {companions.length === 0 ? "Add someone" : "Add another"}
              </button>
            )}

            <button
              type="button"
              onClick={() => setStep("confirm")}
              className={cn(
                "inline-flex min-h-6 items-center rounded-control px-4 py-2",
                "bg-[var(--btn-fill)] text-[var(--btn-fill-ink)]",
                "text-body font-display font-bold",
              )}
            >
              {companions.length === 0 ? "Just me" : "Continue"}
            </button>
          </div>

          {!canHost && (
            <Caption>Your tier does not include guest visits.</Caption>
          )}
        </>
      ) : (
        <>
          <div>
            <Caption>Step 5 of 5</Caption>
            <H2>Confirm.</H2>
          </div>

          <dl className="flex flex-col gap-3">
            <SummaryRow term="When" value={summary.whenLabel} />
            <SummaryRow term="What" value={summary.purposeLabel} />
            <SummaryRow
              term="Who"
              value={
                companions.length === 0
                  ? "Just you"
                  : `You, ${companions.map((companion) => companion.name).join(", ")}`
              }
            />
          </dl>

          {canHost && companions.length > 0 && (
            <div className="border-t border-[var(--rule)]/30 pt-3">
              <H3>Guest visits</H3>
              <AllowanceMeter
                className="mt-2"
                remaining={allowance.remaining}
                included={allowance.includedQuota}
                periodEnd={new Date(allowance.periodEnd)}
                /* §7.4's line item. This is the ONE place the price appears,
                   and only when there is actually a charge to state. */
                overage={
                  overageCount > 0
                    ? {
                        count: overageCount,
                        price: overagePriceLabel ?? "the guest rate",
                      }
                    : undefined
                }
              />
            </div>
          )}

          {state.formError && (
            <FormStatus tone="error" heading={state.formError} />
          )}

          <div className="flex flex-wrap gap-2">
            <SubmitButton>Book it</SubmitButton>
            <button
              type="button"
              onClick={() => setStep("who")}
              className="text-body font-display font-bold underline decoration-1 underline-offset-4"
            >
              Back
            </button>
          </div>

          <Caption>
            {/* P5 and §13.4. Said once, plainly, where it is relevant — not as a
                disclaimer on every screen. */}
            Your place is held the moment this confirms, and not before.
          </Caption>
        </>
      )}
    </form>
  );
}

function SummaryRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-[var(--rule)]/25 pb-2">
      <dt>
        <Caption>{term}</Caption>
      </dt>
      <dd className="text-body text-[var(--ink)]">{value}</dd>
    </div>
  );
}
