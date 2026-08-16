"use client";

import Link, { useLinkStatus } from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { H3 } from "@/components/ui/Text";
import {
  BookedBar,
  MarkLegend,
  MarkRow,
  TodayDot,
  dayNumeralClass,
  markSummary,
} from "@/components/member/DayMarks";
import {
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
  type CalendarCell,
} from "@/domain/calendar";

/**
 * THE MONTH — the Diary's calendar, Members Portal §7.1.
 *
 *   "A member deciding whether to come in on the twenty-seventh, or noticing a
 *    fixture three weeks out, needs a surface Today cannot be."
 *
 * The seven-day strip this replaces could not do either. The twenty-seventh was
 * reachable one tap at a time and a fixture three weeks out was invisible.
 *
 * ===========================================================================
 * EVERY DESTINATION ARRIVES AS A STRING — the rule DiaryControls learned
 *
 * A function cannot be serialised into a client component, and the Diary is the
 * only portal screen that crosses this boundary: the first version of the week
 * strip took an `hrefFor` callback and returned a 500 on every request while
 * every other screen was fine. So the URL grammar stays on the server and this
 * component receives finished hrefs — on every cell, on both arrows, and on the
 * return-to-today control.
 *
 * ===========================================================================
 * WHY THIS IS A CLIENT COMPONENT AT ALL, GIVEN THAT
 *
 * Three things, and none of them is data:
 *
 *   1. OPTIMISTIC SELECTION. A tap moves the selected cell immediately rather
 *      than when the server answers. The grid is the one surface in the portal
 *      a member taps repeatedly in a single sitting — scanning a month is half
 *      a dozen taps — and a selection that lags each one by a round trip is the
 *      difference between an application and a website with a calendar on it.
 *
 *   2. THE GRID KEYBOARD PATTERN. Arrow keys move between days, Home and End to
 *      the ends of a week. A calendar that can only be reached by tabbing
 *      through forty-two links is one no keyboard user will use twice.
 *
 *   3. PENDING FEEDBACK ON THE ARROWS. A month change is a server round trip
 *      with nothing to show optimistically — the next month's marks are not
 *      known here. `useLinkStatus` is the honest answer: the arrow says it is
 *      working, and says nothing about what it will find.
 *
 * State that belongs in the URL is still in the URL. `?month=2026-09&day=…` is
 * a link a member can send to somebody, survives a refresh, and the back button
 * does what they expect.
 *
 * The marks themselves are in `DayMarks.tsx`, shared with Today's rail, because
 * a member who has learned what a filled square means has learned it for the
 * application rather than for one screen.
 */

/** A grid cell with its destination attached by the server. */
export type CalendarDay = CalendarCell & {
  /**
   * Where this cell goes, or null for a day the Diary will not open.
   *
   * Past days are rendered and not linked. The Diary answers "what could I do",
   * and a past Tuesday has no answer to that question — Compete holds the
   * member's history and holds it better than an empty availability grid would.
   * They are rendered rather than blanked because a month with holes in it
   * reads as broken.
   */
  readonly href: string | null;
};

export type CalendarView = {
  readonly monthKey: string;
  /** "August 2026". */
  readonly label: string;
  readonly weeks: readonly (readonly CalendarDay[])[];
  /** Null at the near edge of the horizon — there is no travelling backwards. */
  readonly previousHref: string | null;
  /** Null at the far edge. See `HORIZON_MONTHS`. */
  readonly nextHref: string | null;
  /** Always present. The way back from wherever the member has wandered. */
  readonly todayHref: string;
  /** The months the arrows lead to, for their accessible names. */
  readonly previousLabel: string | null;
  readonly nextLabel: string | null;
};

export function MonthCalendar({
  view,
  selectedKey,
  className,
}: {
  view: CalendarView;
  /** The day the page is showing, `YYYY-MM-DD`. */
  selectedKey: string;
  className?: string;
}) {
  /**
   * The cell the member has just tapped, before the server has answered.
   *
   * ===========================================================================
   * THE GUESS REMEMBERS WHAT IT WAS A GUESS ABOUT
   *
   * The obvious shape is a key plus an effect that clears it when `selectedKey`
   * changes, and it is both a lint failure and a real one: the effect runs a
   * render late, so there is a frame in which the server's new answer and the
   * stale guess are both on screen and the guess wins.
   *
   * Storing the selection the guess was made AGAINST removes the reset
   * entirely. The moment `selectedKey` changes the guess no longer matches and
   * is ignored in the same render — no effect, no extra pass, and no window in
   * which the calendar shows a day the page below it is not showing. A failed
   * navigation self-corrects for the same reason: `selectedKey` never changed,
   * so the guess stands until the member taps elsewhere.
   */
  const [guess, setGuess] = useState<{
    readonly key: string;
    readonly against: string;
  } | null>(null);

  const shownKey = guess?.against === selectedKey ? guess.key : selectedKey;

  const cells = view.weeks.flat();
  const cellRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  /**
   * The one cell in the tab order — the roving tabindex of the grid pattern.
   *
   * The selected day when it is on this month's grid, and the first selectable
   * day when it is not: a member who selected the twenty-seventh of August and
   * paged to September must still be able to tab into September.
   */
  const focusKey =
    cells.find((cell) => cell.dateKey === shownKey && cell.href)?.dateKey ??
    cells.find((cell) => cell.href)?.dateKey ??
    null;

  function moveFrom(index: number, key: string) {
    const row = Math.floor(index / 7);

    /* Home and End are the ends of the week the focus is in, which is what the
       grid pattern specifies and what the row of a calendar means. */
    if (key === "Home") {
      focusNearest(row * 7, 1);
      return true;
    }
    if (key === "End") {
      focusNearest(row * 7 + 6, -1);
      return true;
    }

    const delta = MOVES[key];
    if (delta === undefined) return false;

    /* Clamped to the rendered grid rather than wrapping into another month. The
       leading and trailing cells mean the grid already reaches a few days
       either side, and a focus ring that silently teleports a member into
       another month is the calendar behaviour everybody has been annoyed by.
       The arrows change months, deliberately and visibly.

       Handled either way: an arrow at the edge of the grid does nothing rather
       than scrolling the page out from under a member who is reading it. */
    focusNearest(index + delta, delta > 0 ? 1 : -1);
    return true;
  }

  function focusNearest(start: number, direction: 1 | -1): void {
    for (
      let index = start;
      index >= 0 && index < cells.length;
      index += direction
    ) {
      const candidate = cells[index];
      if (!candidate.href) continue;

      cellRefs.current.get(candidate.dateKey)?.focus();
      return;
    }
  }

  return (
    <div className={className}>
      <MonthNav view={view} />

      {/*
        `role="grid"` rather than a table. The cells are links and a member moves
        between them with the arrow keys, which is the grid pattern; a table
        would promise row and column headers that a month does not have.
      */}
      <div
        role="grid"
        aria-label={`${view.label}. What is on at the club.`}
        className="mt-3 border-t border-l border-[var(--rule)]/25"
      >
        <div role="row" className="grid grid-cols-7">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <div
              key={initial}
              role="columnheader"
              className={cn(
                "border-r border-b border-[var(--rule)]/25 py-1",
                "u-kicker text-center text-[0.625rem] text-[var(--ink-muted)]",
              )}
            >
              <span aria-hidden="true">{initial}</span>
              <span className="sr-only">{WEEKDAY_NAMES[index]}</span>
            </div>
          ))}
        </div>

        {view.weeks.map((week, weekIndex) => (
          <div role="row" key={week[0].dateKey} className="grid grid-cols-7">
            {week.map((cell, columnIndex) => (
              <DayCell
                key={cell.dateKey}
                cell={cell}
                selected={cell.dateKey === shownKey}
                tabbable={cell.dateKey === focusKey}
                onSelect={() => setGuess({ key: cell.dateKey, against: selectedKey })}
                onKey={(key) => moveFrom(weekIndex * 7 + columnIndex, key)}
                register={(node) => {
                  if (node) cellRefs.current.set(cell.dateKey, node);
                  else cellRefs.current.delete(cell.dateKey);
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <MarkLegend className="mt-2" />
    </div>
  );
}

/** Arrow keys move a day, up and down move a week. The grid pattern. */
const MOVES: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: 7,
  ArrowUp: -7,
};

/* ============================================================================
   ONE DAY
   ========================================================================= */

function DayCell({
  cell,
  selected,
  tabbable,
  onSelect,
  onKey,
  register,
}: {
  cell: CalendarDay;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
  /** Returns whether the key was one this grid handles. */
  onKey: (key: string) => boolean;
  register: (node: HTMLAnchorElement | null) => void;
}) {
  /* The face every cell shares, so a past day and a selected day are the same
     size and the grid does not reflow as the member moves through it. The
     gridcell owns the border; the face fills it. */
  const face = cn(
    "relative flex min-h-6 w-full flex-col items-center justify-center",
    "gap-[3px] px-1 py-1",
  );

  return (
    <div
      role="gridcell"
      className={cn(
        "flex border-r border-b border-[var(--rule)]/25",
        /* A closure tints the whole cell, not just the numeral. It is the one
           mark whose consequence is a member NOT driving to the National
           Stadium, and it is worth more than a glyph. */
        cell.marks.closed && !selected && "bg-[var(--rule)]/12",
        selected && "bg-[var(--ink)] text-[var(--btn-fill-ink)]",
      )}
    >
      {!cell.href ? (
        <div className={cn(face, "opacity-40")}>
          <span className={dayNumeralClass(cell.marks, cell.inMonth)}>{cell.dayOfMonth}</span>
          <MarkRow marks={cell.marks} inverted={false} />
        </div>
      ) : (
        <Link
          ref={register}
          href={cell.href}
          aria-current={selected ? "date" : undefined}
          aria-label={markSummary(cell, String(cell.dayOfMonth))}
          tabIndex={tabbable ? 0 : -1}
          onClick={onSelect}
          onKeyDown={(event) => {
            if (onKey(event.key)) event.preventDefault();
          }}
          className={cn(
            face,
            "no-underline transition-colors duration-[var(--duration-fast)]",
            "ease-[var(--ease-precision)]",
            selected
              ? "text-[var(--btn-fill-ink)]"
              : cn(
                  /* The operating rhythm, carried by legibility rather than by
                     a glyph. A day the club is open is full ink; a day it is
                     shut or unpublished recedes. See DayMarks.tsx. */
                  cell.marks.open
                    ? "text-[var(--ink)]"
                    : "text-[var(--ink-muted)]",
                  "hover:bg-[var(--rule)]/15",
                ),
          )}
        >
          <span className={dayNumeralClass(cell.marks, cell.inMonth)}>{cell.dayOfMonth}</span>
          <MarkRow marks={cell.marks} inverted={selected} />
          {cell.isToday && <TodayDot inverted={selected} />}
          {cell.marks.booked && <BookedBar inverted={selected} />}
        </Link>
      )}
    </div>
  );
}

/* ============================================================================
   THE MONTH BAR
   ========================================================================= */

function MonthNav({ view }: { view: CalendarView }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <H3>{view.label}</H3>

      <div className="flex items-center gap-1">
        {/* Today is a destination, not a state. A member three months out has
            no cheap way back otherwise, and paging is not it. */}
        <Link
          href={view.todayHref}
          className={cn(
            "inline-flex min-h-5 items-center rounded-control px-2 py-1",
            "border border-[var(--rule)]/50 u-kicker no-underline",
            "text-[var(--ink)] hover:bg-[var(--rule)]/15",
            "transition-colors duration-[var(--duration-fast)]",
          )}
        >
          Today
        </Link>

        <MonthArrow
          href={view.previousHref}
          label={
            view.previousLabel ? `Go to ${view.previousLabel}` : "Earlier months"
          }
          glyph="‹"
          /* P2 applied to time: the arrow is present and inert at the edge
             rather than absent, so the member can see that the Diary HAS an
             edge rather than wondering where the control went. */
          edgeNote="The Diary does not look back past this month."
        />
        <MonthArrow
          href={view.nextHref}
          label={view.nextLabel ? `Go to ${view.nextLabel}` : "Later months"}
          glyph="›"
          edgeNote="The club has not published this far ahead."
        />
      </div>
    </div>
  );
}

function MonthArrow({
  href,
  label,
  glyph,
  edgeNote,
}: {
  href: string | null;
  label: string;
  glyph: string;
  edgeNote: string;
}) {
  const shell = cn(
    "inline-flex size-5 items-center justify-center rounded-control",
    "border border-[var(--rule)]/50 font-display text-body leading-none",
  );

  if (!href) {
    return (
      <span className={cn(shell, "opacity-35")} title={edgeNote}>
        <span aria-hidden="true">{glyph}</span>
        <span className="sr-only">{edgeNote}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        shell,
        "text-[var(--ink)] no-underline hover:bg-[var(--rule)]/15",
        "transition-colors duration-[var(--duration-fast)]",
      )}
    >
      <ArrowFace glyph={glyph} />
    </Link>
  );
}

/**
 * The arrow, and whether it is working.
 *
 * `useLinkStatus` only reports for the `Link` it is rendered inside, which is
 * why this is its own component. A month change has nothing to show
 * optimistically — the next month's marks are not known on this client — so the
 * honest feedback is that the control was pressed, and nothing about what it
 * will find.
 */
function ArrowFace({ glyph }: { glyph: string }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "transition-opacity duration-[var(--duration-fast)]",
        pending && "opacity-40",
      )}
    >
      {glyph}
    </span>
  );
}
