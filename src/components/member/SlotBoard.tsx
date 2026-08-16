import Link from "next/link";
import { cn } from "@/lib/cn";
import { Body, Caption, H3 } from "@/components/ui/Text";
import type { Slot } from "@/domain/availability";
import { formatTime, lagosParts } from "@/lib/time";

/**
 * WHAT IS FREE, ON ONE DAY — Members Portal §7.2's availability grid.
 *
 * ===========================================================================
 * WHY THIS IS NOT THE ROW OF CHIPS IT REPLACES
 *
 * The first version was one wrapping row of time chips per discipline. It is
 * correct and it is unreadable at the club's real volume: seven sessions a day
 * across three disciplines plus tables is thirty chips in four rows of
 * identical shapes, and the member's actual question — "is there anything
 * around six" — is answered by counting along a row.
 *
 * People do not hold a day as a list of times. They hold it as morning,
 * afternoon and evening, and they arrive at the Diary already knowing which of
 * the three they mean. Grouping by that is not decoration; it is the difference
 * between scanning and reading.
 *
 * ===========================================================================
 * A FULL SLOT IS RENDERED, NOT FILTERED — §6.2
 *
 *   "a Saturday that silently vanishes because it is busy reads as the club
 *    being closed — which sends them to WhatsApp to ask, which is the phone
 *    call the portal exists to prevent."
 *
 * The same argument applies to a part of a day. An evening with nothing free is
 * shown as an evening with nothing free, and a part of the day the club is not
 * open at all is simply absent — those are different facts and the grid must
 * not merge them.
 *
 * ===========================================================================
 * THE PLACES COUNT IS A NUMBER AND A BAR, AND THE NUMBER IS THE HONEST HALF
 *
 * The bar is a scanning aid — a nearly-full slot should look nearly full from
 * across the screen. It is never the only statement: "2 places" is written on
 * every slot, because a bar cannot distinguish two places from three and the
 * difference is exactly the one a member bringing a guest cares about.
 */

/**
 * Morning, afternoon, evening — the way a day is actually held.
 *
 * Half-open on the hour: a 12:00 session is the afternoon's first, a 17:00 one
 * the evening's. The boundaries are the ordinary English ones rather than the
 * club's — the club's own day is described by its opening hours, and a member
 * reading "Evening" wants the word to mean what it means.
 */
const PARTS = [
  { key: "morning", label: "Morning", from: 0, until: 12 },
  { key: "afternoon", label: "Afternoon", from: 12, until: 17 },
  { key: "evening", label: "Evening", from: 17, until: 24 },
] as const;

export function SlotBoard({
  title,
  slots,
  reason,
  hrefFor,
}: {
  /** "A table", or the discipline's own name. */
  title: string;
  slots: readonly Slot[];
  /**
   * Why there is nothing, where the club can say. Null means the ordinary
   * case: the day is simply full or over.
   *
   * §4.3's rule applied to an empty list — never a blank screen, and never a
   * stack of conditions. One sentence, written by `emptyReason`, which is where
   * the club's voice for this lives.
   */
  reason: string | null;
  hrefFor: (slot: Slot) => string;
}) {
  const grouped = PARTS.map((part) => ({
    ...part,
    slots: slots.filter((slot) => {
      const hour = lagosParts(slot.start).hours;
      return hour >= part.from && hour < part.until;
    }),
  })).filter((part) => part.slots.length > 0);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <H3>{title}</H3>
        {!reason && slots.length > 0 && (
          <Caption as="span">{freeLine(slots)}</Caption>
        )}
      </div>

      {reason ? (
        <Body muted className="mt-1">
          {reason}
        </Body>
      ) : grouped.length === 0 ? (
        <Body muted className="mt-1">
          Nothing free on this day.
        </Body>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {grouped.map((part) => (
            <div key={part.key}>
              <p className="u-micro text-[var(--ink-muted)]">
                {part.label}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {part.slots.map((slot) => (
                  <li key={slot.id}>
                    <SlotChip slot={slot} href={hrefFor(slot)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** "4 of 7 free" — the day at a glance, before any of it is read in detail. */
function freeLine(slots: readonly Slot[]): string {
  const open = slots.filter((slot) => slot.free > 0).length;
  if (open === 0) return "Fully booked";
  return `${open} of ${slots.length} free`;
}

function SlotChip({ slot, href }: { slot: Slot; href: string }) {
  const full = slot.free === 0;

  if (full) {
    return (
      <span
        className={cn(
          "inline-flex min-h-6 min-w-[4.5rem] flex-col justify-center",
          "rounded-control border border-[var(--rule)]/40 px-2 py-1 opacity-55",
        )}
        aria-label={`${formatTime(slot.start)} — full`}
      >
        <span className="font-display text-body font-bold line-through">
          {formatTime(slot.start)}
        </span>
        <Caption as="span">Full</Caption>
      </span>
    );
  }

  const taken = slot.capacity > 0 ? slot.taken / slot.capacity : 0;

  return (
    <Link
      href={href}
      aria-label={`${formatTime(slot.start)} — ${placesLabel(slot.free)} — book`}
      className={cn(
        "group relative inline-flex min-h-6 min-w-[4.5rem] flex-col justify-center",
        "overflow-hidden px-2 py-1 no-underline",
        /**
         * FLAT GLAZING, AND THE FLATNESS IS THE ENGINEERING DECISION.
         *
         * A bookable slot is the smallest thing on this product a member picks
         * up, so it gets the material — but `.u-glaze-flat` rather than
         * `.u-glaze`. A Diary day renders a table board plus three discipline
         * boards of seven slots each; thirty `backdrop-filter` layers is a
         * dropped frame per scroll on the mid-range Android §6.4's budget is
         * measured against, and a 44px chip has no room to show a blurred
         * drawing through itself anyway. It keeps the tint and the lit edge,
         * which is the part that reads at this size.
         *
         * The border comes from the edge rather than from full `--ink`: the
         * chip is one of thirty, and thirty full-ink rectangles is a grid of
         * boxes rather than a row of choices. What marks it as available is now
         * the lit edge and the fill behind it.
         */
        "u-glaze-flat u-glaze-edge u-glaze-raise rounded-control",
        "transition-colors duration-[var(--duration-fast)]",
        "ease-[var(--ease-precision)]",
        "hover:bg-[var(--ink)] hover:text-[var(--btn-fill-ink)]",
      )}
    >
      <span className="font-display text-body font-bold">
        {formatTime(slot.start)}
      </span>
      <Caption as="span" className="group-hover:text-[var(--btn-fill-ink)]">
        {placesLabel(slot.free)}
      </Caption>

      {/*
        How full it is, along the bottom edge. Never the only statement of it —
        the places count above is written out, because a bar cannot tell two
        places from three and that is the difference a member bringing a guest
        is reading for.
      */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--rule)]/25"
      >
        <span
          className="block h-full bg-ten-ring-red"
          style={{ width: `${Math.round(taken * 100)}%` }}
        />
      </span>
    </Link>
  );
}

const placesLabel = (free: number): string =>
  `${free} ${free === 1 ? "place" : "places"}`;
