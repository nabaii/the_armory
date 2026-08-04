import { cn } from "@/lib/cn";
import { Display, Kicker, Lead } from "@/components/ui/Text";

/* ============================================================================
   STATEMENT BLOCK — spec §5: "Large-type positioning statement on a plain
   ground. Used for the proposition and reframe moments."

   This is the component that does the reframe — moving shooting from "guns" to
   "sport" — and it does it with type and space rather than argument. The Brief
   is clear that the building already won the argument and the site is only
   "reporting it", so these moments should read as statements of fact, not
   persuasion.

   Deliberately plain: no photography, no device, no rule. Spec §6 — "whitespace
   is the primary signal of premium positioning". A statement block surrounded
   by generous space is the whole effect; anything added to it subtracts.

   Text measure is capped at 68 characters even at display size, because a
   statement that runs the full 1280px is a paragraph pretending to be a
   statement.
   ========================================================================= */

export function StatementBlock({
  kicker,
  statement,
  support,
  align = "left",
  className,
}: {
  kicker?: string;
  /**
   * One sentence. Short words. The brand "is confident enough to be simple",
   * and it "never raises its voice".
   */
  statement: string;
  /** Optional second line — never more than a sentence or two. */
  support?: string;
  align?: "left" | "centre";
  className?: string;
}) {
  return (
    <div
      className={cn(
        align === "centre" && "mx-auto text-center",
        "max-w-[52rem]",
        className,
      )}
    >
      {kicker && <Kicker className="mb-3">{kicker}</Kicker>}

      {/* `as="p"` — a statement block is emphasis, not document structure.
          Using a heading element here would inject a phantom level into the
          page outline and mislead screen-reader navigation. */}
      <Display as="p">{statement}</Display>

      {support && (
        <Lead muted className={cn("mt-3", align === "centre" && "mx-auto")}>
          {support}
        </Lead>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   PROPOSITION — the homepage block spec §3 asks for: "Three to four short
   statements: competition-standard facility, everything provided, professional
   supervision, at the National Stadium."

   Each is a fact, stated flat. No icons: an icon row turns four facts into a
   feature grid, and a feature grid is what a facility sells. This is a club.
   ------------------------------------------------------------------------- */

export function Proposition({
  items,
  className,
}: {
  items: readonly { label: string; detail?: string }[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "grid gap-4 sm:grid-cols-2",
        items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="border-t border-[var(--rule)]/30 pt-2">
          <p className="font-display text-h3 font-bold text-[var(--ink)]">
            {item.label}
          </p>
          {item.detail && (
            <p className="mt-1 text-body text-[var(--ink-muted)]">
              {item.detail}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
