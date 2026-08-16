import Link from "next/link";
import { cn } from "@/lib/cn";
import { Body, Caption } from "@/components/ui/Text";
import { StatusPill } from "@/components/member/StatusPill";
import { clockOf } from "@/components/member/ProgrammeLine";
import { relativeDayLabel, type AgendaItem } from "@/domain/calendar";
import { formatWeekdayDate } from "@/lib/time";

/**
 * COMING UP — the half of the Diary a grid cannot answer.
 *
 * Members Portal §7.1 sets the Diary two jobs and the calendar only does one of
 * them. A month grid shows a member WHERE things are; it does not show them
 * WHAT they are without a tap per day. The question a member actually opens the
 * Diary with — "is there anything coming up I should know about" — is a
 * question about a list, and no amount of marking cells answers it.
 *
 * So the two sit together. The grid carries the shape of the month and the
 * club's standing rhythm; this carries the exceptions, in order, across the
 * whole window rather than only the month on screen. A guest evening three
 * weeks out is one glance rather than three screens of tapping, which is the
 * specific failure §7.1 names.
 *
 * ===========================================================================
 * THE OPERATING RHYTHM IS NOT IN IT — see `agendaFrom`
 *
 * §7.3 is right that the rhythm is what keeps the Diary from being empty most
 * weeks, and it is exactly wrong for a list of what is coming up: ninety
 * consecutive "Range open, 09:00–18:00" entries is the opening hours printed
 * ninety times, not an agenda. The filter lives in the domain module with the
 * argument attached.
 *
 * ===========================================================================
 * AN EMPTY AGENDA SAYS SO, IN THE CLUB'S VOICE
 *
 * P2, and the failure §7.5 warns about. A club that has published no one-offs
 * gets an empty list, and the honest sentence is a fact about the diary rather
 * than an apology or a blank space. It is also the signal to the founder that
 * the events table is not being written to — which is the way this tab dies.
 */
export function Agenda({
  items,
  /** Where each row goes — the Diary, on that day. Built by the caller. */
  hrefForDay,
  emptyLine,
  className,
}: {
  items: readonly AgendaItem[];
  hrefForDay: (dateKey: string) => string;
  /**
   * What to say when there is nothing. Passed in because the sentence differs
   * by surface: the Diary is looking at three months, Today at a fortnight, and
   * "nothing in the next three months" would be a lie on the second.
   */
  emptyLine: string;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <div className={className}>
        <Body muted>{emptyLine}</Body>
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col", className)}>
      {items.map((item, index) => (
        <li
          key={`${item.dateKey}-${item.entry.title}-${index}`}
          className="border-t border-[var(--rule)]/30 first:border-t-0"
        >
          <Link
            href={hrefForDay(item.dateKey)}
            className={cn(
              "flex gap-3 py-2 no-underline",
              "transition-colors duration-[var(--duration-fast)]",
              "ease-[var(--ease-precision)] hover:bg-[var(--rule)]/10",
            )}
          >
            {/*
              The date rail. Fixed width and tabular figures so a column of them
              lines up — a list of occasions is scanned down the dates, and a
              ragged left edge is the one thing that stops that working.
            */}
            <span className="w-6 shrink-0 text-center">
              <span className="block font-display text-h3 font-bold leading-none tabular-nums">
                {dayOf(item)}
              </span>
              <span className="u-kicker block text-[0.625rem] text-[var(--ink-muted)]">
                {monthOf(item)}
              </span>
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {item.entry.kind === "closure" && (
                  <StatusPill status="blocked" label="Closed" />
                )}
                <Body className="font-medium">{item.entry.title}</Body>
              </span>

              <Caption className="mt-[2px]">
                {[
                  relativeDayLabel(item.inDays, formatWeekdayDate(item.date)),
                  item.entry.startsMinute !== null &&
                  item.entry.endsMinute !== null
                    ? `${clockOf(item.entry.startsMinute)}–${clockOf(item.entry.endsMinute)}`
                    : null,
                  item.entry.detail,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Caption>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* The date rail's two lines. Split from the `YYYY-MM-DD` key rather than
   formatted from the instant, because the key is already the Lagos calendar
   date and re-deriving it through a formatter is one more chance to land on the
   wrong side of midnight. */
const dayOf = (item: AgendaItem): string =>
  String(Number.parseInt(item.dateKey.slice(8, 10), 10));

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const monthOf = (item: AgendaItem): string =>
  MONTH_ABBREVIATIONS[Number.parseInt(item.dateKey.slice(5, 7), 10) - 1];
