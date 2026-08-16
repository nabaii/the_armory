import Link from "next/link";
import { cn } from "@/lib/cn";
import { groundClasses } from "@/components/layout/Section";
import {
  BookedBar,
  MarkRow,
  TodayDot,
  dayNumeralClass,
  markSummary,
} from "@/components/member/DayMarks";
import { WEEKDAY_INITIALS, columnOf, type CalendarCell } from "@/domain/calendar";
import { formatWeekdayDate } from "@/lib/time";

/**
 * THE NEXT SEVEN DAYS — Today's card 3, Members Portal §6.4.
 *
 *   "A member with no booking, no competition and no action items must still
 *    see the club's week. A blank Today screen teaches the member not to open
 *    the application, which is the single outcome the entire design is arranged
 *    to prevent."
 *
 * §6.4 already required the week to be reachable from Today. What it got was a
 * paragraph of prose listing the next three days that had something on, which
 * answers the question and cannot be scanned: a member wanting to know whether
 * Saturday is worth coming to had to read three sentences to find out that
 * Saturday was not one of the three days listed.
 *
 * Seven cells answers it without reading, and each one is a way into the Diary
 * on that day. It is the same marks as the month grid — see `DayMarks.tsx` —
 * because a member who has learned what a filled square means has learned it
 * for the application rather than for one screen.
 *
 * ===========================================================================
 * §6.1 — "NO HORIZONTAL CAROUSELS", AND WHY THIS IS NOT ONE
 *
 * Seven cells fit across the narrowest phone the club supports. Nothing here
 * scrolls, nothing is hidden off the edge, and there is no eighth day a member
 * has to discover by swiping. What §6.1 forbids is content the member cannot
 * see the extent of; this is a fixed row whose extent is its whole content.
 *
 * ===========================================================================
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not select. Today is a notification surface (§7.1) and it has exactly
 * one day in it — today. A rail that changed what the card below it showed
 * would be a small Diary embedded in Today, which is the surface §7.1 spends a
 * paragraph separating them to avoid. Every cell is a link OUT, to the Diary,
 * on that day.
 */

/** One rail cell: a calendar day with the Diary link the server built for it. */
export type RailDay = CalendarCell & { readonly href: string };

export function WeekRail({
  days,
  className,
}: {
  /** Seven days, beginning today. Rolling, not snapped to a Monday. */
  days: readonly RailDay[];
  className?: string;
}) {
  return (
    <nav aria-label="The next seven days" className={className}>
      <ul className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <li key={day.dateKey}>
            <Link
              href={day.href}
              aria-label={markSummary(day, formatWeekdayDate(day.date))}
              className={cn(
                "relative flex min-h-6 flex-col items-center justify-center",
                "gap-[3px] rounded-control px-1 py-1 no-underline",
                /**
                 * EACH CELL CARRIES ITS OWN CHALK GROUND, AND THAT IS A
                 * CONTRAST DECISION RATHER THAN A STYLISTIC ONE.
                 *
                 * This rail sits inside Today's At-the-club card, which is a
                 * Soffit Blue section. Two of the three marks it renders are
                 * fixed brand colours whose contrast is a property of what is
                 * behind them: Ten Ring Red measures 3.79:1 on Chalk and
                 * 1.68:1 on Soffit Blue. Rendered straight onto the card, the
                 * today dot and the something-on square would both be non-text
                 * indicators at roughly half the 3:1 WCAG 2.1 requires.
                 *
                 * `BottomNav` reached the same junction and took the same
                 * turn: rather than pick a different red — which Brand
                 * Guidelines §3 forbids, and which would make the dot a
                 * different dot on one screen — give the marker the opaque
                 * ground the brand already guarantees it. The cells become
                 * chalk chips on the blue, which is also simply what the card
                 * wanted to look like.
                 */
                groundClasses("chalk"),
                "border transition-colors duration-[var(--duration-fast)]",
                "ease-[var(--ease-precision)]",
                /* The operating rhythm, carried by legibility rather than by a
                   glyph — the club is open most days and a mark on every cell
                   carries no information. The cell's own Chalk ground above
                   means `--ink-muted` resolves the way it does in the month
                   grid, so this is the same signal in both places. */
                !day.marks.open && "text-[var(--ink-muted)]",
                /**
                 * A closure is drawn on the EDGE here and not as a fill.
                 *
                 * The month grid tints the whole cell, which it can because the
                 * cell has no ground of its own. These cells do — see above —
                 * and a second background utility on the same element is a
                 * fight over specificity rather than a design.
                 *
                 * Nothing is lost: the strike-through the numeral already
                 * carries is the signal doing the work, it is a shape rather
                 * than a colour (WCAG 1.4.1), and `markSummary` says "club
                 * closed" in words for anyone not reading shapes at all.
                 */
                day.marks.closed
                  ? "border-[var(--ink)]"
                  : "border-[var(--rule)]/40",
              )}
            >
              <span
                aria-hidden="true"
                className="u-kicker text-[0.625rem] leading-none"
              >
                {WEEKDAY_INITIALS[columnOf(day.weekday)]}
              </span>
              <span className={dayNumeralClass(day.marks, true)}>{day.dayOfMonth}</span>
              <MarkRow marks={day.marks} inverted={false} />
              {day.isToday && <TodayDot inverted={false} />}
              {day.marks.booked && <BookedBar inverted={false} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
