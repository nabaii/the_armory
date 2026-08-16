import { Body, Caption } from "@/components/ui/Text";
import { StatusPill } from "@/components/member/StatusPill";
import type { ProgrammeEntry } from "@/domain/programme";

/**
 * ONE THING THAT IS ON — Members Portal §6.1's Tonight card and §7.2's
 * programme list, which render the same shape and must render it the same way.
 *
 * Today shows tonight; the Diary shows a week of them. A member who learns to
 * read one has learned to read the other, which is the argument for one
 * component rather than two similar ones — and the reason it lives here rather
 * than inside either page.
 *
 * ===========================================================================
 * A CLOSURE IS THE ONLY ENTRY THAT CARRIES A PILL
 *
 * Everything else on the list is an invitation and reads as one. A closure is
 * the single entry whose consequence is a member NOT travelling to the National
 * Stadium, and it is the one thing on this surface worth interrupting a scan
 * for. Giving every kind its own colour would make the closure ordinary, which
 * is the failure mode this rule exists to prevent.
 */
export function ProgrammeLine({ entry }: { entry: ProgrammeEntry }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {entry.kind === "closure" && <StatusPill status="blocked" label="Closed" />}

      <Body>{entry.title}</Body>

      {entry.startsMinute !== null && entry.endsMinute !== null && (
        <Caption>
          {clockOf(entry.startsMinute)}&ndash;{clockOf(entry.endsMinute)}
        </Caption>
      )}

      {entry.detail && <Caption>{entry.detail}</Caption>}
    </div>
  );
}

/**
 * Minutes since Lagos midnight, as the club writes them. 1140 is 19:00.
 *
 * Twenty-four hour, zero-padded, because it is read in a list beside other
 * times and a column of 9:00 / 10:30 / 19:00 does not line up. The rest of the
 * system uses `formatTime` for instants; these are not instants — they are
 * minutes on a weekday, which is the whole reason opening hours are stored the
 * way they are.
 */
export function clockOf(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
