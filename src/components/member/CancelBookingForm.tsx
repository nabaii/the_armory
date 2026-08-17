"use client";

import { useActionState, useState } from "react";
import { cancelBooking } from "@/app/actions/booking-amend";
import { emptyBookingAmendState } from "@/lib/booking-amend-state";
import { Body, Caption } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

/**
 * CANCELLING, WITH THE CONSEQUENCE STATED BEFORE THE BUTTON.
 *
 * A form over a server action, so it works before the bundle parses — the same
 * reasoning `HostingForms` gives: a member on Nigerian mobile data should not
 * wait for JavaScript to give a lane back.
 *
 * ===========================================================================
 * TWO TAPS, AND THE SECOND ONE IS NOT A DIALOG
 *
 * Cancellation is not reversible from here — there is no un-cancel event, and
 * rebooking gets a different slot at whatever capacity is left. So it asks
 * twice.
 *
 * It asks by REVEALING THE CONSEQUENCE rather than by opening a confirm dialog.
 * A dialog asks "are you sure?", which is a question a member answers yes to
 * without reading, and on a phone it also arrives over the thing they were
 * looking at. Expanding in place says what will actually happen — the lane
 * goes back, the guests' links stop, nobody is told — and only then offers the
 * button. The member reads the sentence because it is where the button was.
 *
 * ===========================================================================
 * THE GUEST SENTENCE IS THE POINT OF THE WHOLE COMPONENT
 *
 * The server releases the guests' invitations, and this system sends nobody a
 * message. P5's failure is a guest arriving at the National Stadium for a
 * session that no longer exists, and the member is the only person who can
 * prevent it. So where there are guests, the warning names them and says
 * plainly that the club will not do it.
 */
export function CancelBookingForm({
  bookingId,
  companionNames,
}: {
  bookingId: string;
  /** Named, never counted — §10. Empty when the member is coming alone. */
  companionNames: readonly string[];
}) {
  const [state, action] = useActionState(cancelBooking, emptyBookingAmendState);
  const [armed, setArmed] = useState(false);

  if (state.ok) {
    return (
      <div role="status" className="border-t border-[var(--rule)]/30 pt-3">
        <Body>{state.message}</Body>
      </div>
    );
  }

  if (!armed) {
    return (
      <div className="border-t border-[var(--rule)]/30 pt-3">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className={cn(
            "inline-flex min-h-6 items-center rounded-control px-3 py-1",
            "border border-[var(--rule)] text-body font-display font-bold",
            "transition-colors duration-[var(--duration-fast)]",
            "hover:bg-[var(--rule)]/15",
          )}
        >
          Cancel this booking
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="border-t border-[var(--rule)]/30 pt-3">
      <input type="hidden" name="bookingId" value={bookingId} />

      <Body className="font-medium">Cancel this booking?</Body>

      <Body muted className="mt-1 max-w-[68ch]">
        The lane goes back to the club and somebody else can take it.
        {companionNames.length > 0 && (
          <>
            {" "}
            {listNames(companionNames)}{" "}
            {companionNames.length === 1 ? "loses" : "lose"} the link
            {companionNames.length === 1 ? "" : "s"} you sent{" "}
            {companionNames.length === 1 ? "them" : "them"} — and the club does
            not message {companionNames.length === 1 ? "them" : "them"}, so tell{" "}
            {companionNames.length === 1 ? "them" : "them"} yourself.
          </>
        )}
      </Body>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Destructive, and it looks it. Ten Ring Deep is the text-bearing red —
            the same decision every other label-carrying red on this site
            makes. */}
        <button
          type="submit"
          className={cn(
            "inline-flex min-h-6 items-center rounded-control px-3 py-1",
            "bg-ten-ring-deep text-white text-body font-display font-bold",
            "transition-opacity duration-[var(--duration-fast)] hover:opacity-90",
          )}
        >
          Yes, cancel it
        </button>

        {/* Equal tap target, unequal voice — Button.tsx's rule. Keeping the
            booking must be at least as easy as losing it. */}
        <button
          type="button"
          onClick={() => setArmed(false)}
          className={cn(
            "inline-flex min-h-6 items-center rounded-control px-3 py-1",
            "border border-[var(--ink)] text-body font-display font-bold",
            "transition-colors duration-[var(--duration-fast)]",
            "hover:bg-[var(--rule)]/15",
          )}
        >
          Keep it
        </button>
      </div>

      {state.formError && (
        <Caption className="mt-2 text-ten-ring-deep">{state.formError}</Caption>
      )}
    </form>
  );
}

/** Ada · Ada and Tunde · Ada, Tunde and Bisi. */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
