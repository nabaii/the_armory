"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * THE MODE SWITCH AND THE WEEK STRIP — Members Portal §7.2.
 *
 * ===========================================================================
 * WHY THESE ARE LINKS AND NOT STATE
 *
 * §13.2 permits client components "where interaction genuinely requires them —
 * the week strip, the mode switch, the booking flow's local state". These two
 * are on that list, and they are still built as links.
 *
 * The reason is §7.4's argument about the booking flow, applied one screen
 * earlier: a Diary whose day and mode live in component state cannot be linked
 * to, does not survive a refresh, and loses the member's place when they follow
 * a booking and come back. As search parameters, "Saturday, availability" is a
 * URL a member can send to somebody, and the back button does what they expect.
 *
 * So this is a client component for one reason only: it needs to know which
 * day and mode are current in order to mark them, and marking them is the whole
 * of its interactivity. Nothing here fetches, holds or mutates anything.
 */

export type DiaryMode = "programme" | "availability";

export function ModeSwitch({
  mode,
  hrefFor,
}: {
  mode: DiaryMode;
  hrefFor: (mode: DiaryMode) => string;
}) {
  return (
    <div
      role="group"
      aria-label="What to show"
      className="inline-flex rounded-control border border-[var(--rule)]/50 p-[3px]"
    >
      {(["programme", "availability"] as const).map((option) => {
        const active = option === mode;
        return (
          <Link
            key={option}
            href={hrefFor(option)}
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

export type WeekDay = {
  /** `YYYY-MM-DD`, and the value the page reads back. */
  readonly key: string;
  /** "Thu" — three letters, because seven of them share a phone's width. */
  readonly weekday: string;
  /** "14" */
  readonly dayOfMonth: string;
  /** Whether anything at all is on. Marks the day as worth a tap. */
  readonly hasProgramme: boolean;
  readonly isToday: boolean;
};

export function WeekStrip({
  days,
  selectedKey,
  hrefFor,
  className,
}: {
  days: readonly WeekDay[];
  selectedKey: string;
  hrefFor: (dayKey: string) => string;
  className?: string;
}) {
  return (
    <nav aria-label="Choose a day" className={className}>
      <ul className="flex gap-1 overflow-x-auto pb-1">
        {days.map((day) => {
          const selected = day.key === selectedKey;

          return (
            <li key={day.key} className="min-w-0 flex-1">
              <Link
                href={hrefFor(day.key)}
                aria-current={selected ? "date" : undefined}
                className={cn(
                  "relative flex min-h-6 min-w-[3rem] flex-col items-center justify-center",
                  "gap-[2px] rounded-control px-1 py-1 no-underline",
                  "border border-[var(--rule)]/40",
                  selected
                    ? "bg-[var(--ink)] text-[var(--btn-fill-ink)]"
                    : "text-[var(--ink)]",
                )}
              >
                <span className="u-kicker text-[0.625rem]">{day.weekday}</span>
                <span className="font-display text-body font-bold">
                  {day.dayOfMonth}
                </span>

                {/*
                  The marker for a day with something on it. Without it the
                  strip is a row of seven identical dates and a member reads
                  none of them — they tap through the week to find out, which is
                  the work the strip was supposed to save.

                  Not colour alone (WCAG 1.4.1): the dot is a shape in a fixed
                  position, and its absence is as legible as its presence.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-[4px] rounded-full",
                    day.hasProgramme
                      ? selected
                        ? "bg-[var(--btn-fill-ink)]"
                        : "bg-ten-ring-red"
                      : "bg-transparent",
                  )}
                />

                {day.isToday && <span className="sr-only">Today</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
