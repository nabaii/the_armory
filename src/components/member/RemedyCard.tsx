import Link from "next/link";
import { cn } from "@/lib/cn";
import { Body, H3 } from "@/components/ui/Text";
import { StatusPill, type Status } from "@/components/member/StatusPill";

/**
 * ONE REFUSAL, RENDERED — Members Portal §6.2, §11.
 *
 *   "The temptation is to hand-write a card for each condition — an expiring
 *    waiver card, an unpaid balance card, an incomplete guest link card. Do
 *    not. The capability service already returns a refusal with a reason and a
 *    remedy attached. The action stack is therefore a single RemedyCard
 *    rendering whatever capability hands back, in a loop.
 *
 *    Two things follow. Every future gate the club introduces appears on Today
 *    automatically, with no interface work. And P1 is structurally enforced on
 *    the busiest screen in the portal, because there is nowhere for an inline
 *    permission check to live."
 *
 * ===========================================================================
 * THE SECOND PARAGRAPH IS WHY THIS COMPONENT IS SHAPED THE WAY IT IS
 *
 * It takes a sentence, a remedy and an optional action. It does not take a
 * membership, an allowance, a licence or a date. There is no argument you could
 * pass it that would let it decide anything, which is P1 enforced by a type
 * signature rather than by a code review.
 *
 * If a future card needs to say something the capability service does not
 * produce, the fix is a new block in src/domain/capability/reasons.ts — not a
 * new prop here.
 *
 * ===========================================================================
 * THE REMEDY IS NOT OPTIONAL COPY
 *
 * §4.3: "Every block returns a specific single-line reason … a member standing
 * at a desk in front of their guest needs to know which of the two of them is
 * the problem and what fixes it."
 *
 * Every `Block` in reasons.ts already carries a remedy or an explicit null, and
 * null means the member genuinely cannot fix it themselves (a suspended
 * membership, a revoked licence). Where it is null this card says nothing
 * rather than inventing "contact the club" — the reasons file is where that
 * sentence would belong if the club wanted one, and it is a decision about what
 * the club promises, not about layout.
 */

export type Remedy = {
  /** The single line from the capability service. Never a code, never a stack. */
  readonly reason: string;
  /** What fixes it. Null where the member cannot. */
  readonly remedy: string | null;
  /**
   * Whether this stops them now or is something to deal with in advance.
   *
   * Decided by the capability service's `foreseeable`, never here.
   */
  readonly status: Status;
  /** A destination that actually performs the remedy, where one exists. */
  readonly action?: { readonly href: string; readonly label: string };
};

export function RemedyCard({ item, className }: { item: Remedy; className?: string }) {
  return (
    <article
      className={cn(
        "rounded-control border border-[var(--rule)]/40 p-3",
        /* No fill. A stack of five tinted cards is a screen that shouts, and
           the member most likely to see five is the one having the worst week
           — P5's rule about never embarrassing a member applies to the visual
           register as much as to the words. The pill carries the colour. */
        className,
      )}
    >
      <StatusPill status={item.status} />

      <H3 className="mt-2">{item.reason}</H3>

      {item.remedy && (
        <Body muted className="mt-1">
          {item.remedy}
        </Body>
      )}

      {item.action && (
        <Link
          href={item.action.href}
          className={cn(
            "mt-2 inline-block text-body font-display font-bold",
            "text-[var(--ink)] underline decoration-1 underline-offset-4",
          )}
        >
          {item.action.label}
        </Link>
      )}
    </article>
  );
}

/**
 * The action stack — §6.1's first card, and the whole of it.
 *
 * Renders nothing at all when there is nothing to say. §6.4 makes empty states
 * load-bearing on Today, and this is the one card whose correct empty state is
 * absence: a heading reading "Nothing needs your attention" over blank space is
 * a club filling a screen with its own reassurance.
 */
export function RemedyStack({
  items,
  className,
}: {
  items: readonly Remedy[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.map((item, index) => (
        /* Keyed on the reason, which is stable for a given block and unique
           within a stack — `foreseeableBlocks` deduplicates by reason code
           before this ever sees them. The index is the tiebreak for the case it
           does not: two expiries of the same kind on different documents. */
        <RemedyCard key={`${item.reason}-${index}`} item={item} />
      ))}
    </div>
  );
}
