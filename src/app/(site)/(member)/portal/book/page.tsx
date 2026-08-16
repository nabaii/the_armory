import type { Metadata } from "next";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import {
  availableSlots,
  availableTables,
  emptyReason,
  emptyTableReason,
  type Slot,
} from "@/domain/availability";
import {
  bookedInWindow,
  clubAvailabilityPolicy,
  clubLanes,
} from "@/server/armory/club-policy";
import { programmeWeek, publishedEvents } from "@/server/armory/programme";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { upcomingBookingsFor } from "@/server/armory/member-bookings";
import { bookingHorizonBlock } from "@/domain/capability";
import type { ProgrammeDay } from "@/domain/programme";
import {
  agendaFrom,
  calendarMonth,
  monthKeyOf,
  monthLabel,
  parseMonthKey,
  withinHorizon,
  HORIZON_MONTHS,
  type MonthKey,
} from "@/domain/calendar";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { ProgrammeLine } from "@/components/member/ProgrammeLine";
import { Agenda } from "@/components/member/Agenda";
import { SlotBoard } from "@/components/member/SlotBoard";
import {
  MonthCalendar,
  type CalendarDay,
  type CalendarView,
} from "@/components/member/DiaryCalendar";
import { ModeSwitch, type DiaryMode } from "@/components/member/DiaryControls";
import {
  addDays,
  formatTime,
  formatWeekdayDate,
  lagosDateKey,
  lagosDaysBetween,
  parseDateColumn,
  startOfLagosDay,
} from "@/lib/time";
import { routes } from "@/lib/site";

/**
 * DIARY — Members Portal Design Specification §7.
 *
 *   "§7.1 — Today answers what am I doing. Diary answers what could I do …
 *    A member deciding whether to come in on the twenty-seventh, or noticing a
 *    fixture three weeks out, needs a surface Today cannot be."
 *
 * ===========================================================================
 * THE STRIP DID NOT ANSWER EITHER HALF OF THAT SENTENCE
 *
 * This tab shipped with a rolling seven-day strip. It is a good day picker and
 * it is not a diary: the twenty-seventh was reachable only by tapping forward
 * through the week one day at a time, and a fixture three weeks out was not
 * visible at all — three screens of tapping away, which in practice means
 * nobody finds it. A member planning a month could not see a month.
 *
 * The Diary is now a month, and the month travels. Three surfaces, in the order
 * a member uses them:
 *
 *   1. THE CALENDAR   the shape of the month, and which days are worth a tap
 *   2. COMING UP      what those days actually are, in a list, across the whole
 *                     window rather than only the month on screen
 *   3. THE DAY        what is on, or what is free, on the one day chosen
 *
 * The grid answers WHERE, the agenda answers WHAT, and the day panel answers
 * the question that follows. None of the three is redundant and removing any
 * one of them puts its question back on WhatsApp.
 *
 * ===========================================================================
 * §7.3 — THREE FEEDS, AND THAT IS WHY THIS TAB IS NOT EMPTY MOST WEEKS
 *
 *   "A Diary populated only by special occasions will be empty most weeks, and
 *    an empty calendar signals a dead club more loudly than no calendar at all.
 *    The surface survives because it draws on three feeds of very different
 *    frequency."
 *
 * A month makes that argument sharper rather than weaker. Thirty-one cells of
 * operating rhythm is the club looking open, which is the whole point — and it
 * is also why the rhythm is NOT what the agenda lists. See `agendaFrom`.
 *
 * ===========================================================================
 * WHY THE STATE IS IN THE URL — §13.2, and §7.4's argument moved one screen up
 *
 * A month, a day and a mode held in component state cannot be linked to, do not
 * survive a refresh, and lose the member's place when they follow a booking and
 * come back. As search parameters, "September, the fourth, availability" is a
 * URL a member can send to somebody and the back button does what they expect.
 */

export const metadata: Metadata = { title: "Diary" };

export const dynamic = "force-dynamic";

/**
 * How far COMING UP looks, whichever month is on screen.
 *
 * Deliberately not the visible month. A member looking at October must still be
 * told about the guest evening a week on Thursday — an agenda that reset every
 * time the member paged the calendar would be a second, worse calendar. It is
 * the same list on every month, and it is the club's next occasions.
 */
const AGENDA_DAYS = HORIZON_MONTHS * 31;

/** How many occasions the list carries before it becomes a scroll. */
const AGENDA_LIMIT = 5;

type Search = {
  readonly day?: string;
  readonly mode?: string;
  readonly month?: string;
};

export default async function DiaryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const resolution = await resolveArmoryMember();

  if (resolution.state === "signed_out") {
    return (
      <Section>
        <PageHeader title="The week" />
        <Body>Sign in to see the club&rsquo;s week.</Body>
      </Section>
    );
  }

  if (!isArmoryDatabaseConfigured()) {
    return (
      <Section>
        <PageHeader title="The week" />
        <Body>The club&rsquo;s system is not reachable just now.</Body>
      </Section>
    );
  }

  const db = getArmoryDb();
  const now = new Date();
  const mode: DiaryMode =
    params.mode === "availability" ? "availability" : "programme";

  const selected = selectedDay(params.day, now);
  const selectedKey = lagosDateKey(selected);
  const monthKey = selectedMonth(params.month, selected, now);

  /**
   * The grid is built twice, and the first one is thrown away.
   *
   * Its only job is to report the range it covers — a month grid reaches into
   * the neighbouring months to fill its first and last rows, and how far
   * depends on which weekday the first of the month falls on. Loading a fixed
   * "month plus a week" would over-fetch on most months and under-fetch on the
   * ones that start on a Sunday.
   *
   * A second pass through a pure function costs nothing measurable and it means
   * the calendar never renders a day it did not load, which would show as a day
   * with no marks on it — indistinguishable from a day with nothing on.
   */
  const shape = calendarMonth({ monthKey, today: now });

  /* One window covering everything three surfaces need: the grid's range, and
     the agenda's, which does not move when the member pages the calendar. */
  const from = earlier(shape.from, startOfLagosDay(now));
  const to = later(shape.to, addDays(startOfLagosDay(now), AGENDA_DAYS));

  const [policy, events, bookings] = await Promise.all([
    clubAvailabilityPolicy(db),
    publishedEvents(db, { from, to }),
    resolution.state === "member"
      ? upcomingBookingsFor(db, {
          membershipId: resolution.member.membershipId,
          personId: resolution.member.personId,
          from: now,
          /* The calendar marks every day the member is coming in, across the
             whole horizon, so this is a roster rather than a preview. It is one
             member's own bookings — tens of rows at the very most. */
          limit: 200,
        })
      : Promise.resolve([]),
  ]);

  /* Fixtures are weeks, never dates (Leagues Spec §8), so they do not land on a
     day and are not merged into the programme. When they do arrive they arrive
     here, and both the grid and the agenda pick them up with no further work —
     which is why `hasFixture` is already a mark. */
  const days = programmeWeek({
    from,
    days: lagosDaysBetween(from, to) + 1,
    openingHours: policy.openingHours,
    events,
    fixtures: [],
  });

  const bookedKeys = new Set(
    bookings.map((booking) => lagosDateKey(booking.slotStart)),
  );

  const month = calendarMonth({
    monthKey,
    today: now,
    programme: days,
    bookedKeys,
  });

  /* Every destination is built here and handed over finished. A function cannot
     be serialised into a client component — the Diary is the only portal screen
     that crosses that boundary, and it is the screen that returned a 500 on
     every request the first time this rule was broken. */
  const hrefFor = (next: {
    day?: string;
    mode?: DiaryMode;
    month?: MonthKey;
  }): string => {
    const query = new URLSearchParams();
    const day = next.day ?? selectedKey;
    query.set("day", day);

    /* The month is only in the URL when it is not the selected day's own month.
       Otherwise every link carries a redundant parameter that has to agree with
       the day beside it, and the first one to disagree is a calendar showing
       September with the fourth of August selected. */
    const nextMonth = next.month ?? monthKey;
    if (nextMonth !== monthKeyOf(parseDateColumn(day))) {
      query.set("month", nextMonth);
    }

    const nextMode = next.mode ?? mode;
    if (nextMode !== "programme") query.set("mode", nextMode);

    return `${routes.portalBook}?${query.toString()}`;
  };

  const view: CalendarView = {
    monthKey: month.monthKey,
    label: month.label,
    weeks: month.weeks.map((week) =>
      week.map(
        (cell): CalendarDay => ({
          ...cell,
          /* Past days are rendered and not linked. The Diary answers "what
             could I do", and a past Tuesday has no answer — Compete holds the
             member's history and holds it better than an empty grid would. */
          href: cell.isPast ? null : hrefFor({ day: cell.dateKey, month: month.monthKey }),
        }),
      ),
    ),
    previousHref: month.previousKey
      ? hrefFor({ month: month.previousKey, day: firstSelectableDay(month.previousKey, now) })
      : null,
    nextHref: month.nextKey
      ? hrefFor({ month: month.nextKey, day: firstSelectableDay(month.nextKey, now) })
      : null,
    previousLabel: month.previousKey ? monthLabel(month.previousKey) : null,
    nextLabel: month.nextKey ? monthLabel(month.nextKey) : null,
    todayHref: hrefFor({
      day: lagosDateKey(now),
      month: monthKeyOf(now),
    }),
  };

  const day = days.find((candidate) => candidate.dateKey === selectedKey) ?? null;
  const agenda = agendaFrom({ days, today: now, limit: AGENDA_LIMIT });

  return (
    <>
      <PageHeader
        kicker="Diary"
        title="The club's week"
        lead="What is on, and what is free."
      />

      {/* ============================================================== 1 of 3
          THE CALENDAR. */}
      <Section ground="chalk" rhythm="tight">
        <MonthCalendar view={view} selectedKey={selectedKey} />
      </Section>

      {/* ============================================================== 2 of 3
          COMING UP — the same list on every month. See AGENDA_DAYS. */}
      <Section ground="soffit" rhythm="tight">
        <Kicker className="mb-2">Coming up</Kicker>
        <Agenda
          items={agenda}
          hrefForDay={(dateKey) =>
            hrefFor({ day: dateKey, month: monthKeyOf(parseDateColumn(dateKey)) })
          }
          emptyLine="Nothing out of the ordinary is published for the next few months. The club's opening hours are on the calendar above."
        />
      </Section>

      {/* ============================================================== 3 of 3
          THE DAY. */}
      <Section ground="chalk" rhythm="tight">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <H2>{formatWeekdayDate(selected)}</H2>
          <Button href={bookHref(selectedKey)} variant="primary">
            Book this day
          </Button>
        </div>

        <ModeSwitch
          className="mt-3"
          mode={mode}
          programmeHref={hrefFor({ mode: "programme" })}
          availabilityHref={hrefFor({ mode: "availability" })}
        />
      </Section>

      {mode === "programme" ? (
        <ProgrammeMode day={day} />
      ) : (
        <AvailabilityMode
          db={db}
          date={selected}
          now={now}
          policy={policy}
          disciplines={
            resolution.state === "member"
              ? resolution.member.tier.disciplineAccess
              : []
          }
          /* P1. The screen is handed the sentence and never the membership: it
             does not know what a booking horizon is and must not learn. */
          horizonLine={
            resolution.state === "member"
              ? (bookingHorizonBlock(resolution.member.tier, now, selected)
                  ?.message ?? null)
              : null
          }
          closed={day?.closed ?? false}
        />
      )}

      {/* The member's own bookings on this day, in either mode. §7.2's booking
          detail: a member looking at Saturday should see that they are already
          coming on Saturday without switching surfaces to find out. */}
      <YourBookings bookings={bookings} dateKey={selectedKey} />
    </>
  );
}

/* ============================================================================
   MODE ONE — WHAT'S ON. §7.2's programme list, and the default.
   ========================================================================= */

function ProgrammeMode({ day }: { day: ProgrammeDay | null }) {
  return (
    <Section ground="chalk" rhythm="default">
      {!day || day.entries.length === 0 ? (
        /**
         * P2. Two different absences, and they are not the same sentence.
         *
         * A club that has published its week and has nothing on this particular
         * Tuesday is a normal club. A club that has published nothing at all
         * has not set its opening hours yet, which is a fact about the system
         * rather than about the day — and the member should not be left to
         * infer which of the two they are looking at.
         */
        <>
          <H3>Nothing scheduled.</H3>
          <Body muted className="mt-2 max-w-[68ch]">
            Nothing is published for this day. Try another on the calendar
            above.
          </Body>
        </>
      ) : (
        <>
          <H3>{day.closed ? "The club is closed." : "What's on"}</H3>
          <ul className="mt-3 flex flex-col gap-3">
            {day.entries.map((entry, index) => (
              <li key={`${entry.title}-${index}`}>
                <ProgrammeLine entry={entry} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/* ============================================================================
   MODE TWO — AVAILABILITY. §7.2's grid, honest until the club publishes hours.
   ========================================================================= */

async function AvailabilityMode({
  db,
  date,
  now,
  policy,
  disciplines,
  horizonLine,
  closed,
}: {
  db: ReturnType<typeof getArmoryDb>;
  date: Date;
  now: Date;
  policy: Awaited<ReturnType<typeof clubAvailabilityPolicy>>;
  disciplines: readonly string[];
  /** The tier's booking horizon as a sentence, or null. Never a number. */
  horizonLine: string | null;
  closed: boolean;
}) {
  /**
   * A closure hides the grids entirely rather than rendering them empty.
   *
   * The two are visually similar and mean completely different things: an empty
   * grid is "everything is taken", a closure is "the club is shut". A member
   * who read the first when the second was true would keep checking back.
   */
  if (closed) {
    return (
      <Section ground="chalk" rhythm="default">
        <H3>The club is closed on this day.</H3>
        <Body muted className="mt-2 max-w-[68ch]">
          Nothing is bookable. The rest of the month is on the calendar above.
        </Body>
      </Section>
    );
  }

  /**
   * Past the member's own horizon, the grid is not drawn at all.
   *
   * The calendar reaches three months ahead and most tiers do not. Drawing a
   * grid of bookable Saturdays the club will refuse hands the member a
   * discovery at step five of the booking flow, after they have chosen a day
   * and named their guests — P5's failure, one screen earlier. The sentence
   * comes from the capability layer; this screen only renders it.
   */
  if (horizonLine) {
    return (
      <Section ground="chalk" rhythm="default">
        <H3>Not yet bookable.</H3>
        <Body muted className="mt-2 max-w-[68ch]">
          {horizonLine} What is on is still on the calendar above, and this day
          opens for booking as it comes closer.
        </Body>
      </Section>
    );
  }

  /**
   * The grid is projected from today to the chosen day and then filtered to it.
   *
   * `availableSlots` counts days forward from now because a slot id must be the
   * same instant whichever screen produced it — the booking flow re-derives the
   * identical grid on commit and refuses any id not on it. Starting the
   * projection at the chosen day instead would produce the same ids by
   * coincidence and stop doing so the first time the step changed.
   */
  const days = lagosDaysBetween(now, date) + 1;
  const dayKey = lagosDateKey(date);
  const onThisDay = <T extends { start: Date }>(slots: readonly T[]) =>
    slots.filter((slot) => lagosDateKey(slot.start) === dayKey);

  const [lanes, booked] = await Promise.all([
    clubLanes(db),
    bookedInWindow(db, {
      from: now,
      to: addDays(startOfLagosDay(date), 1),
    }),
  ]);

  const tables = onThisDay(availableTables({ policy, booked, now, days }));
  const tableReason = emptyTableReason(policy);

  return (
    <Section ground="chalk" rhythm="default">
      {/* §7.4, and P4. The tables come FIRST. The club is a hospitality
          operation with a shooting range attached, and a screen that opens on a
          lane grid has re-inverted the strategy in the surface members touch
          most often. */}
      <SlotBoard
        title="A table"
        slots={tables}
        reason={tableReason}
        hrefFor={slotHref}
      />

      <div className="mt-6 flex flex-col gap-6">
        {disciplines.map((discipline) => {
          const slots = onThisDay(
            availableSlots({ policy, lanes, booked, discipline, now, days }),
          );

          return (
            <SlotBoard
              key={discipline}
              title={discipline}
              slots={slots}
              reason={
                slots.length === 0
                  ? emptyReason(policy, lanes, discipline)
                  : null
              }
              hrefFor={slotHref}
            />
          );
        })}

        {disciplines.length === 0 && (
          <Body muted>
            Your tier does not cover any of the club&rsquo;s disciplines yet.
            Speak to the club about an upgrade.
          </Body>
        )}
      </div>
    </Section>
  );
}

/** A slot links into the booking flow with step one already answered. */
function slotHref(slot: Slot): string {
  const query = new URLSearchParams({ slot: slot.id });
  if (slot.discipline) {
    query.set("type", "shoot");
    query.set("discipline", slot.discipline);
  } else {
    query.set("type", "table");
  }
  return `${routes.portalBookNew}?${query.toString()}`;
}

/** The booking flow, opened on the day the member is looking at. */
const bookHref = (dateKey: string): string =>
  `${routes.portalBookNew}?day=${dateKey}`;

/* ============================================================================
   THE MEMBER'S OWN BOOKINGS ON THIS DAY
   ========================================================================= */

function YourBookings({
  bookings,
  dateKey,
}: {
  bookings: Awaited<ReturnType<typeof upcomingBookingsFor>>;
  dateKey: string;
}) {
  const onThisDay = bookings.filter(
    (booking) => lagosDateKey(booking.slotStart) === dateKey,
  );

  if (onThisDay.length === 0) return null;

  return (
    <Section ground="teal" rhythm="tight">
      <Kicker className="mb-2">You are coming in</Kicker>
      <ul className="flex flex-col gap-3">
        {onThisDay.map((booking) => (
          <li key={booking.id}>
            <Body>
              {formatTime(booking.slotStart)} ·{" "}
              {booking.discipline ?? "A table"}
              {booking.companions.length > 0 &&
                ` · with ${booking.companions.map((c) => c.name).join(", ")}`}
            </Body>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ============================================================================
   DAYS AND MONTHS
   ========================================================================= */

/**
 * The day the member is looking at.
 *
 * Defaults to today, and refuses anything it cannot parse rather than throwing.
 * The parameter is in a URL a member can edit or a link somebody sent them, and
 * a Diary that renders a five-hundred error on a mistyped date is worse than
 * one that shows today.
 */
function selectedDay(raw: string | undefined, now: Date): Date {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return now;

  const parsed = parseDateColumn(raw);
  if (Number.isNaN(parsed.getTime())) return now;

  /* A day before today, or past the far edge of the horizon, falls back to
     today rather than rendering a grid the calendar refuses to reach. A link
     sent last week is the ordinary way this happens. */
  if (parsed.getTime() < startOfLagosDay(now).getTime()) return now;
  if (!withinHorizon(monthKeyOf(parsed), now)) return now;

  return parsed;
}

/**
 * The month the calendar shows.
 *
 * The explicit parameter wins where it is a month the Diary will reach —
 * paging from August into September with the fourth of August still selected is
 * a real state and the arrows produce it. Otherwise it is the selected day's
 * own month, which is what a link carrying only `?day=` should show.
 */
function selectedMonth(
  raw: string | undefined,
  selected: Date,
  now: Date,
): MonthKey {
  const parsed = parseMonthKey(raw);
  if (parsed && raw && withinHorizon(raw, now)) return raw;
  return monthKeyOf(selected);
}

/**
 * Which day an arrow lands on.
 *
 * The first of the month, except in the month that contains today, where it is
 * today. Landing on the first of THIS month would select a day already past and
 * `selectedDay` would send it straight back to today — a "previous month" arrow
 * that appeared to do nothing.
 */
function firstSelectableDay(monthKey: MonthKey, now: Date): string {
  return monthKey === monthKeyOf(now) ? lagosDateKey(now) : `${monthKey}-01`;
}

const earlier = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);
const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);
