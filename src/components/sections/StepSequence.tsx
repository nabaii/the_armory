import { Body, H3, LaneNumeral } from "@/components/ui/Text";
import type { RitualStep } from "@/lib/content";

/* ============================================================================
   STEP SEQUENCE — spec §5: "the single most important content component on
   the site."

   It carries the ritual on the First Visit page: arrival and check-in,
   briefing, supervision by a range officer, equipment issued, the round
   itself, results. The Brief is blunt about why this matters more than any
   other block: "Anxiety is the conversion killer." This is the page that
   serves the growth segment — women, first-timers, couples, corporate groups.

   ----------------------------------------------------------------------------
   THE DEVICE

   Oversized tabular figures, borrowed from the building itself. Brand
   Guidelines §8: "Lane numerals. Large tabular figures echoing the numbered
   firing points." And §5: "Lane numbering in the building is large, plain and
   numeric. Echo it: oversized tabular figures are a legitimate display device."

   So the most important content component and the building's own signage use
   the same visual language — the ritual is numbered the way the lanes are.

   RESTRAINT: the guidelines allow one device per composition. Lane numerals
   are the device here, so dividers are plain hairlines rather than the
   segmented rule — rings, mesh and numerals together "produce noise, and
   noise is the opposite of precision."

   ----------------------------------------------------------------------------
   SEMANTICS

   An ordered list, so sequence is conveyed to assistive technology by the
   markup. The visible numeral is decorative and hidden, since a screen reader
   already announces list position — reading it would double every step.
   ========================================================================= */

export function StepSequence({
  steps,
  className,
}: {
  steps: readonly RitualStep[];
  className?: string;
}) {
  return (
    <ol className={className}>
      {steps.map((step, i) => (
        <li
          key={step.title}
          className={[
            "grid gap-x-4 gap-y-1 py-4",
            "border-t border-[var(--rule)]/30",
            "lg:grid-cols-[7rem_1fr]",
          ].join(" ")}
        >
          {/* Decorative: the <ol> already conveys order. */}
          <LaneNumeral className="lg:text-right" muted>
            {String(i + 1).padStart(2, "0")}
          </LaneNumeral>

          <div className="lg:pt-2">
            <H3>{step.title}</H3>
            {/* Plain words, short sentences. Address the beginner directly,
                without condescension — assume intelligence, not knowledge. */}
            <Body muted className="mt-1">
              {step.body}
            </Body>
          </div>
        </li>
      ))}
    </ol>
  );
}
