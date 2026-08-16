"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * THE MODE SWITCH — Members Portal §7.2.
 *
 * What's on, or what is free, for the day the Diary has selected. Two modes and
 * not two tabs: they are two readings of one day, and a member who has chosen a
 * Saturday should not have to choose it again to see what is free on it.
 *
 * ===========================================================================
 * WHY THIS IS A LINK AND NOT STATE
 *
 * §13.2 permits client components "where interaction genuinely requires them —
 * the week strip, the mode switch, the booking flow's local state". This is on
 * that list, and it is still built as links.
 *
 * The reason is §7.4's argument about the booking flow, applied one screen
 * earlier: a Diary whose day and mode live in component state cannot be linked
 * to, does not survive a refresh, and loses the member's place when they follow
 * a booking and come back. As search parameters, "Saturday, availability" is a
 * URL a member can send to somebody, and the back button does what they expect.
 *
 * So this is a client component for one reason only: it needs to know which
 * mode is current in order to mark it, and marking it is the whole of its
 * interactivity. Nothing here fetches, holds or mutates anything.
 *
 * ===========================================================================
 * EVERY DESTINATION ARRIVES AS A STRING, NOT AS A FUNCTION THAT BUILDS ONE
 *
 * The first version took an `hrefFor` callback, which is the natural shape when
 * the page owns the URL grammar — and it is not expressible across this
 * boundary. A function cannot be serialised into a client component, and React
 * refuses the render: the Diary returned a 500 on every request while every
 * other portal screen was fine, because it is the only one that crosses here.
 *
 * Passing the finished hrefs is better anyway. The URL grammar stays in one
 * place on the server, these components stay dumb, and what they render is
 * exactly what the page decided rather than what a callback reconstructs.
 *
 * ===========================================================================
 * THE WEEK STRIP THAT USED TO LIVE HERE IS GONE
 *
 * It was a seven-day rolling day picker, and §7.1 asks the Diary for a surface
 * that can show "the twenty-seventh, or a fixture three weeks out" — neither of
 * which a rolling week reaches. `DiaryCalendar` is the month that replaced it,
 * and `WeekRail` is the seven-day row that now does the strip's other job on
 * Today, where seven days is the right window. Both mark days through
 * `DayMarks`, so there is one mark vocabulary rather than three.
 */

export type DiaryMode = "programme" | "availability";

export function ModeSwitch({
  mode,
  programmeHref,
  availabilityHref,
  className,
}: {
  mode: DiaryMode;
  /** Where "What's on" goes, built by the page. */
  programmeHref: string;
  /** Where "Availability" goes, built by the page. */
  availabilityHref: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="What to show"
      className={cn(
        "inline-flex rounded-control border border-[var(--rule)]/50 p-[3px]",
        className,
      )}
    >
      {(["programme", "availability"] as const).map((option) => {
        const active = option === mode;
        return (
          <Link
            key={option}
            href={option === "programme" ? programmeHref : availabilityHref}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-control px-2 py-1 u-kicker no-underline",
              "min-h-5 inline-flex items-center",
              active
                ? "bg-[var(--ink)] text-[var(--btn-fill-ink)]"
                : "text-[var(--ink)]",
            )}
          >
            {option === "programme" ? "What's on" : "Availability"}
          </Link>
        );
      })}
    </div>
  );
}
