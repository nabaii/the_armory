import { cn } from "@/lib/cn";

/**
 * A PANEL ON THE DAY, AND THE THREE WAYS IT CAN BE EMPTY.
 *
 * Management S2: "A management surface that renders a plausible zero where it
 * has no data is worse than one that renders nothing, because a zero invites a
 * decision."
 *
 * ===========================================================================
 * WHAT NOTHING LOOKS LIKE IS THE MOST-SEEN SCREEN IN MONTH ONE
 *
 * The applications queue with no applications, the expiry register with nothing
 * expiring, the booking book on a day with no bookings. A single blank panel
 * conflates three states that call for three different actions, and the third
 * is the one a generic empty state destroys:
 *
 *   nothing yet        The club has not started this.
 *   nothing today      Working as intended, and worth saying so.
 *   nothing authored   SOMEBODY HAS TO TYPE THIS.
 *
 * M11 records the failure the third guards against: an events table nobody
 * writes to makes the Diary emptier than no Diary would have been. A panel that
 * says "the club has not published a programme" with the surface to do it one
 * tap away is the difference between a system that reports a gap and one that
 * closes it.
 *
 * `Pending` is not reused here on purpose. It renders NOTHING in production,
 * which is right for a marketing page that must never show invented content to
 * a visitor and wrong for an internal tool, where a panel silently vanishing
 * teaches staff that the software is unreliable.
 */

export type EmptyState =
  | { readonly kind: "not_started"; readonly line: string }
  | { readonly kind: "clear"; readonly line: string }
  | {
      readonly kind: "unauthored";
      readonly line: string;
      /** Where somebody goes to type it. The half that closes the gap. */
      readonly action?: { readonly href: string; readonly label: string };
    }
  | {
      /** Built later, and said out loud rather than left blank. */
      readonly kind: "not_built";
      readonly line: string;
    };

export function Panel({
  title,
  count,
  /** Set where the panel's content requires a decision — never for emphasis. */
  needsDecision = false,
  empty,
  children,
}: {
  title: string;
  count?: number;
  needsDecision?: boolean;
  empty?: EmptyState;
  children?: React.ReactNode;
}) {
  const isEmpty = children === undefined || children === null;

  return (
    <section
      className={cn(
        "border border-sight-grey/30 bg-chalk",
        /* Red means "this requires a decision" and never "primary action". On
           a screen the founder opens to find out what needs them, spending the
           urgent colour on a Save button leaves nothing to say urgent with. */
        needsDecision && !isEmpty && "border-l-2 border-l-ten-ring-deep",
      )}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-sight-grey/25 px-2 py-1">
        <h2 className="text-[13px] font-semibold leading-tight">{title}</h2>
        {count !== undefined && count > 0 && (
          <span
            data-numeric
            className={cn(
              "text-[13px] font-semibold tabular-nums",
              needsDecision ? "text-ten-ring-deep" : "text-sight-ink",
            )}
          >
            {count}
          </span>
        )}
      </header>

      <div className="px-2 py-2 text-[13px] leading-snug">
        {isEmpty ? <Empty state={empty} /> : children}
      </div>
    </section>
  );
}

function Empty({ state }: { state?: EmptyState }) {
  if (!state) {
    /* A panel with no content and no declared empty state is a bug, and it says
       so rather than rendering a reassuring blank. S2 again: the absence has to
       be visible to whoever can fix it. */
    return (
      <p className="text-sight-ink">
        This panel has nothing to show and did not say why.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p
        className={cn(
          state.kind === "unauthored" ? "text-reticle-black" : "text-sight-ink",
        )}
      >
        {state.line}
      </p>
      {state.kind === "unauthored" && state.action && (
        <a
          href={state.action.href}
          className="self-start border-b border-ten-ring-deep pb-[1px] font-medium text-ten-ring-deep"
        >
          {state.action.label}
        </a>
      )}
      {state.kind === "not_built" && (
        <p className="text-[11px] uppercase tracking-[0.12em] text-sight-grey">
          Not built yet
        </p>
      )}
    </div>
  );
}
