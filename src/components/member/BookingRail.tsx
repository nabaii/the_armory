import Link from "next/link";
import { cn } from "@/lib/cn";
import { Caption } from "@/components/ui/Text";

/**
 * THE BOOKING RAIL — where you are, what you have chosen, and the way back.
 *
 * ===========================================================================
 * WHAT IT REPLACES, AND WHY THAT WAS NOT ENOUGH
 *
 * Each step of the flow carried a kicker reading "Step 3 of 5" and, at the
 * bottom, one quiet link reading "Change what for". Between them they told the
 * member two things: a number, and one way back. They never told them what they
 * had already decided.
 *
 * That matters most at exactly the moment booking gets hard. A member two steps
 * in has settled a day, a time and a purpose, and the screen showing them the
 * disciplines shows none of it — so the only way to check the time is right is
 * to go back and lose the place. A flow that cannot be inspected is a flow
 * people abandon, and §2's three-minute budget is spent on re-deciding things
 * that were already decided.
 *
 * The rail carries the whole state. Every settled step shows its ANSWER rather
 * than its name — "Thu 20 Aug, 6:00 pm" rather than "When" — so the member
 * reads their own booking taking shape, and every settled step is a link back
 * to itself.
 *
 * ===========================================================================
 * FIVE STEPS, EXCEPT WHEN THERE ARE FOUR
 *
 * §7.4 numbers the flow one to five, and step three is "which line". A table
 * and a spectate booking touch no line at all, so for those the step does not
 * exist — and the old screens still said "Step 4 of 5" and "Step 5 of 5" to a
 * member who had never seen a step three. A count that lies about its own
 * length teaches the member that the numbers are decoration.
 *
 * So the rail is BUILT from the steps that apply. A table booking is three
 * steps and says so. This is why the caller passes what the member has chosen
 * rather than a step index: the shape of the flow is a consequence of the
 * booking, not a constant.
 *
 * ===========================================================================
 * IT IS A LIST, AND THE CURRENT STEP IS THE ONE WITH `aria-current`
 *
 * An ordered list, because it is ordered and finite and a screen reader should
 * be able to say "3 of 4". The visual spine is a border on the list items, so
 * it costs no extra element and it cannot drift out of alignment with the rows
 * it is supposed to be joining.
 */

export type RailStep = {
  /** "When", "What for", "Which line", "Who", "Confirm". */
  readonly label: string;
  /**
   * What the member chose, once they have. Null while the step is ahead of
   * them — an unanswered step shows its question instead.
   */
  readonly answer: string | null;
  /**
   * Where to go to change this answer. Null for the step they are on, and for
   * steps they have not reached: a rail that let a member jump forward past a
   * decision the next step depends on would produce a screen with a hole in it.
   */
  readonly href: string | null;
  readonly current: boolean;
};

export function BookingRail({
  steps,
  className,
}: {
  steps: readonly RailStep[];
  className?: string;
}) {
  const position = steps.findIndex((step) => step.current) + 1;

  return (
    <nav
      aria-label={`Booking, step ${position} of ${steps.length}`}
      className={className}
    >
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const settled = step.answer !== null && !step.current;
          const ahead = step.answer === null && !step.current;

          const row = (
            <>
              {/* The marker. A filled dot for the step in hand, a hairline ring
                  for one already settled, nothing but the rule for one ahead —
                  which reads as a progression in greyscale, the same test
                  StatusPill sets itself. */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-[0.45em] size-[9px] -translate-x-1/2",
                  "rounded-full border",
                  step.current
                    ? "border-ten-ring-red bg-ten-ring-red"
                    : settled
                      ? "border-[var(--ink)] bg-[var(--glaze-pane,var(--color-chalk))]"
                      : "border-[var(--rule)]/50 bg-[var(--glaze-pane,var(--color-chalk))]",
                )}
              />

              <Caption as="span" className={cn(step.current && "text-[var(--ink)]")}>
                {step.label}
              </Caption>

              {/**
                * The answer only, and nothing where there is not one yet.
                *
                * A placeholder dash was there first and it earned its removal by
                * being looked at: on the CURRENT step it sat under a label whose
                * question the page's own heading was already asking, so the rail
                * said "Which line — —". On a step still ahead it was a dash
                * standing in for a decision nobody has been asked to make.
                * Neither is information; both are furniture.
                */}
              {step.answer !== null && (
                <span
                  className={cn(
                    "block font-display text-body",
                    step.current ? "font-bold text-[var(--ink)]" : "font-normal",
                    ahead && "opacity-45",
                  )}
                >
                  {step.answer}
                </span>
              )}
            </>
          );

          return (
            <li
              key={step.label}
              aria-current={step.current ? "step" : undefined}
              className={cn(
                "relative border-l pl-3",
                /* The spine stops at the last row rather than running past it
                   into nothing. */
                index === steps.length - 1
                  ? "border-transparent pb-0"
                  : "border-[var(--rule)]/35 pb-3",
              )}
            >
              {step.href ? (
                <Link
                  href={step.href}
                  className={cn(
                    "block no-underline",
                    "transition-opacity duration-[var(--duration-fast)]",
                    "hover:opacity-70",
                  )}
                >
                  {row}
                  <span className="sr-only"> — change this</span>
                </Link>
              ) : (
                <div>{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
