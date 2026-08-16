import { cn } from "@/lib/cn";
import { Caption } from "@/components/ui/Text";
import type { CalendarCell, DayMarks } from "@/domain/calendar";

/**
 * WHAT A DAY IS MARKED WITH — one vocabulary, two surfaces.
 *
 * The Diary's month grid and Today's seven-day rail both render days, and they
 * must render them identically. A member who has learned that a filled square
 * means "something is on" has learned it for the application, not for one
 * screen; two implementations of the same marks would disagree within a release
 * and the version a member saw would depend on which tab they were on.
 *
 * That is the same argument `app-nav.ts` makes about the two navigations and
 * `ProgrammeLine` makes about Today's card and the Diary's list. It holds here
 * for the same reason, so the glyphs live in one file that neither screen owns.
 *
 * ===========================================================================
 * THIS FILE IS DELIBERATELY NOT A CLIENT COMPONENT
 *
 * The month grid is one (optimistic selection, the grid keyboard pattern), and
 * Today's rail is not — a rail cell navigates to another screen and has nothing
 * to be optimistic about. Sharing through a plain module keeps Today off the
 * calendar's bundle, which matters against §6.4's one-second cold render.
 *
 * ===========================================================================
 * THE CLUB BEING OPEN IS NOT A GLYPH
 *
 * The club is open every day. A mark on every cell of a month carries exactly
 * as much information as no mark at all, so the operating rhythm is carried by
 * the legibility of the numeral — full ink when the club is open, muted when it
 * is not — and the glyphs are reserved for the exceptional days a member is
 * actually scanning for.
 *
 * None of the marks is colour alone (WCAG 1.4.1): filled and hollow are shapes,
 * the strike-through is a shape, the booked bar is a position, and `markSummary`
 * writes the whole lot out for anyone not looking at shapes.
 */

/**
 * The glyph row, whose height is reserved whether or not it has anything in it.
 *
 * A row that collapsed on a quiet day would leave every numeral in the month at
 * a slightly different height, and the eye reads that as a broken grid long
 * before it reads it as information.
 */
export function MarkRow({
  marks,
  /** True on a cell filled with ink, where the marks must invert to be seen. */
  inverted,
}: {
  marks: DayMarks;
  inverted: boolean;
}) {
  return (
    <span aria-hidden="true" className="flex h-[5px] items-center gap-[3px]">
      {marks.event && (
        <span
          className={cn(
            "u-mark u-mark-event size-[5px]",
            /* Ten Ring Red measures 3.31:1 against Reticle Black, which clears
               the 3:1 a non-text indicator needs — so the filled square keeps
               its own colour on a selected cell rather than becoming a second
               glyph the member has to learn. */
            inverted ? "bg-[var(--btn-fill-ink)]" : "bg-ten-ring-red",
          )}
        />
      )}
      {marks.fixture && (
        <span
          className={cn(
            "u-mark u-mark-fixture size-[5px] border",
            inverted ? "border-[var(--btn-fill-ink)]" : "border-[var(--ink)]",
          )}
        />
      )}
    </span>
  );
}

/**
 * The member's own commitment: a bar inside the cell, not a glyph in the row.
 *
 * It is a fact about the member rather than about the club, and it should not
 * compete for the row the club's programme uses.
 *
 * ===========================================================================
 * INSET, AND THE FIRST VERSION WAS NOT
 *
 * At `left-0` the bar lands exactly on the hairline between two cells, and on a
 * rendered grid it reads as sitting between them — a member with a booking on
 * Saturday sees a mark that could as easily belong to Friday. Three pixels in
 * from the edge is the whole fix, and it is not cosmetic: a calendar that is
 * ambiguous about WHICH DAY a member is committed to has failed at the one
 * thing this mark exists to say.
 */
export function BookedBar({ inverted }: { inverted: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "u-mark u-mark-booked absolute inset-y-[5px] left-[3px] w-[3px]",
        /* VIP Teal measures 2.40:1 against the selected cell's ink fill and
           fails the 3:1 a non-text indicator needs, so an inked cell inverts it
           rather than shipping a mark that cannot be seen. */
        inverted ? "bg-[var(--btn-fill-ink)]" : "bg-vip-teal",
      )}
    />
  );
}

/** Brand Guidelines §8's red dot, spent on the one thing it is for: where you are. */
export function TodayDot({ inverted }: { inverted: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "u-mark u-mark-today absolute inset-x-0 bottom-[3px] mx-auto size-[4px] rounded-full",
        inverted ? "bg-[var(--btn-fill-ink)]" : "bg-ten-ring-red",
      )}
    />
  );
}

/**
 * The numeral, and the two things about a day that are said with type rather
 * than with a glyph: a closure strikes it through, and a day outside the frame
 * the surface is about is set lighter.
 *
 * `emphasised` is passed in rather than read off `inMonth`, because the two
 * surfaces mean different things by it. On the month grid it is exactly
 * `inMonth` — the neighbouring months' days fill the corners and should recede.
 * On Today's rail every day is one of the seven the rail is about, including the
 * ones that fall in next month, and setting those lighter would be marking a
 * distinction the rail is not making.
 */
export function dayNumeralClass(marks: DayMarks, emphasised: boolean) {
  return cn(
    "font-display text-body leading-none tabular-nums",
    marks.closed && "line-through decoration-2",
    emphasised ? "font-bold" : "font-normal",
  );
}

/**
 * What this day says, written out.
 *
 * The glyphs are a scanning aid for a member reading a month at a glance. This
 * is the same information for everybody else, and it is the reason neither
 * surface needs a colour key to be usable.
 */
export function markSummary(
  cell: Pick<CalendarCell, "marks" | "dayOfMonth" | "isToday">,
  /** How the day is named — "14", or "Thursday 14 August" on the rail. */
  name: string,
): string {
  const parts: string[] = [];

  if (cell.marks.closed) parts.push("club closed");
  else if (cell.marks.open) parts.push("club open");

  if (cell.marks.event) parts.push("something on");
  if (cell.marks.fixture) parts.push("league round");
  if (cell.marks.booked) parts.push("you are coming in");

  const today = cell.isToday ? "Today, " : "";

  return parts.length > 0 ? `${today}${name} — ${parts.join(", ")}` : `${today}${name}`;
}

/**
 * Two glyphs and a bar, named.
 *
 * A legend is usually a sign that a visual language failed, and this one is kept
 * to the marks that are genuinely arbitrary. The strike-through, the red dot on
 * today and the muted numeral are not in it: none of them needs explaining to
 * anybody who has seen a calendar.
 */
export function MarkLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="u-mark u-mark-event size-[5px] bg-ten-ring-red" />
        <Caption as="span">Something on</Caption>
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="u-mark u-mark-fixture size-[5px] border border-[var(--ink)]" />
        <Caption as="span">League round</Caption>
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="u-mark u-mark-booked h-[10px] w-[3px] bg-vip-teal" />
        <Caption as="span">You are coming in</Caption>
      </li>
    </ul>
  );
}
