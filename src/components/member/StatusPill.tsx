import { cn } from "@/lib/cn";

/**
 * CLEAR · ATTENTION · BLOCKED — Members Portal §11.
 *
 *   "StatusPill is shared with the desk console deliberately. Cleared,
 *    attention and blocked must mean the same thing and look the same way to a
 *    member on a phone and to a range officer on a tablet. Two implementations
 *    will diverge, and the first divergence will be a member who was told they
 *    were clear standing in front of an officer whose screen says otherwise."
 *
 * ===========================================================================
 * DISTINGUISHABLE BY SHAPE AND POSITION, NOT ONLY BY COLOUR
 *
 * §11 asks for this explicitly and WCAG 1.4.1 requires it, but the operational
 * reason is stronger than either: this pill is read at a counter, in daylight,
 * on a phone held at arm's length by somebody who is also holding a rifle case.
 * Colour is the first thing that fails in those conditions.
 *
 * So each state carries three signals — a distinct glyph, a distinct fill, and
 * the word itself. The glyph is a filled disc, a half disc and an open ring:
 * one solid, one partial, one empty, which reads as a progression even in
 * greyscale and even out of focus.
 *
 * ===========================================================================
 * ON THE RED
 *
 * `blocked` uses Ten Ring Deep rather than Ten Ring Red. Brand Guidelines
 * reserve the mark's red for the dot, the rings and graphic accent; anything
 * text-bearing takes the deeper value, which clears AA against white at 5.73:1.
 * The pill carries a word, so it is text-bearing. See the palette note in the
 * README — this is not a different red, it is the same decision the buttons
 * already made.
 */

export type Status = "clear" | "attention" | "blocked";

const LABELS: Record<Status, string> = {
  clear: "Clear",
  /* Not "Warning". The club is telling a member something needs doing, not
     scolding them — and this pill renders where a guest can see it (P5). */
  attention: "Attention",
  blocked: "Blocked",
};

const TONES: Record<Status, string> = {
  /* VIP Teal, the club's own furniture colour, rather than a green nobody
     chose. Chalk on VIP Teal is 5.32:1. */
  clear: "bg-vip-teal text-chalk",
  /* Charred Timber. A member reading this needs to act, not to panic, and an
     amber warning triangle is the register a good club does not use. */
  attention: "bg-charred-timber text-chalk",
  blocked: "bg-ten-ring-deep text-white",
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: Status;
  /** Overrides the word. The glyph and fill never change with it. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-1 py-[3px]",
        "u-kicker text-[0.6875rem] whitespace-nowrap",
        TONES[status],
        className,
      )}
    >
      <Glyph status={status} />
      {label ?? LABELS[status]}
    </span>
  );
}

/**
 * The second signal. Drawn rather than lit by a font, so it is identical on a
 * member's phone and on the desk tablet whatever either has installed.
 */
function Glyph({ status }: { status: Status }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="size-[10px] shrink-0"
      fill="none"
    >
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
      {status === "clear" && <circle cx="6" cy="6" r="3" fill="currentColor" />}
      {status === "attention" && (
        /* Half filled. Something is true and something is not. */
        <path d="M6 3 A3 3 0 0 1 6 9 Z" fill="currentColor" />
      )}
      {/* `blocked` is the open ring — nothing inside it. */}
    </svg>
  );
}

/**
 * The status a set of refusals adds up to.
 *
 * ===========================================================================
 * THIS FUNCTION DOES NOT DECIDE ANYTHING
 *
 * P1: "No screen makes its own permission decision." It would be very easy to
 * read this as an exception — it takes blocks and returns a status, which looks
 * like judgement. It is not: the decision was made by the capability service,
 * which already said whether each refusal stops the member now or later. This
 * only chooses which of three words to print above them.
 *
 * The distinction is worth defending, because the moment this function starts
 * taking a membership or an allowance as an argument, it has become a second
 * source of truth about permission and P1 is gone.
 */
export function statusOf(input: {
  /** Refusals that stop the member from attending at all, right now. */
  readonly blocking: number;
  /** Things that will stop them, that they can deal with in advance. */
  readonly foreseen: number;
}): Status {
  if (input.blocking > 0) return "blocked";
  if (input.foreseen > 0) return "attention";
  return "clear";
}
