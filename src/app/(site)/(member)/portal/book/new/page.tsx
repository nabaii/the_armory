import type { Metadata } from "next";
import Link from "next/link";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import {
  availableSlots,
  availableTables,
  emptyReason,
  emptyTableReason,
  usesLane,
  type Slot,
} from "@/domain/availability";
import { BOOKING_TYPES, type BookingType } from "@/domain/enums";
import {
  bookedInWindow,
  clubAvailabilityPolicy,
  clubLanes,
} from "@/server/armory/club-policy";
import { programmeWeek, publishedEvents } from "@/server/armory/programme";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { overagePriceLabel } from "@/server/armory/overage";
import {
  calendarMonth,
  monthKeyOf,
  monthLabel,
  parseMonthKey,
  withinHorizon,
  type MonthKey,
} from "@/domain/calendar";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Panel } from "@/components/ui/Panel";
import { Body, Caption, H2, H3 } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { BookingFlow } from "@/components/member/BookingFlow";
import { BookingRail, type RailStep } from "@/components/member/BookingRail";
import { SlotBoard } from "@/components/member/SlotBoard";
import {
  MonthCalendar,
  type CalendarDay,
  type CalendarView,
} from "@/components/member/DiaryCalendar";
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
 * THE BOOKING FLOW — Members Portal Design Specification §7.4.
 *
 *   "A route, not a modal sheet — deep-linkable, surviving refresh, giving the
 *    red action a destination, and behaving correctly under React Server
 *    Components."
 *
 *   1 — When       Date, then slot         Booking horizon by tier
 *   2 — What       Shoot · Table · Both · Spectate.  FOUR EQUAL OPTIONS.
 *   3 — Discipline Which line, where shooting is selected
 *   4 — Who        Just me, or named companions
 *   5 — Confirm    Summary, any overage as a line item
 *
 * Steps one to three are this file, held in the URL. Four and five are the
 * flow's local state in BookingFlow.tsx, and the reason the line is drawn there
 * rather than anywhere else is set out at the top of that component: a URL
 * carrying a guest's name and number is a URL in a history and a server log.
 *
 * ===========================================================================
 * THIS SCREEN WAS THE LAST FLAT SURFACE IN THE PORTAL
 *
 * Today and the Diary were rebuilt onto the setting-out field and its glazed
 * panes, and onto one calendar and one way of reading a session. Booking kept
 * none of it, and the result was worse than merely plainer: it was a DIFFERENT
 * PRODUCT one tap from the others.
 *
 * Three specific discontinuities, all now closed:
 *
 *   THE DATE PICKER. Step one offered a wrapping row of chips reading "Thursday
 *   20 August", fourteen of them, over four rows. The member had, one tap
 *   earlier, been looking at a month calendar in the Diary — frequently on the
 *   very day they were now being asked to find again in a bag of pills. There
 *   is one calendar in this product now, and this is it.
 *
 *   THE SLOTS. Step one drew its own chips inline while the Diary rendered the
 *   same slots through `SlotBoard`, grouped morning / afternoon / evening with
 *   capacity along the bottom edge. Two renderings of one concept, in one
 *   product, differing on the screen where the member is actually spending
 *   money.
 *
 *   THE PROGRESS. Each step said "Step 3 of 5" and offered one quiet link back.
 *   Neither told the member what they had already chosen, which is the thing
 *   they most want to check two steps in. `BookingRail` carries the whole
 *   state — and, for a table booking, correctly says three steps rather than
 *   claiming a step three that does not exist.
 *
 * ===========================================================================
 * §7.4's SECOND STEP IS A STRATEGY DECISION WEARING A RADIO BUTTON
 *
 *   "2 — What | Shoot · Table · Both · Spectate | Enforces: NOTHING. Four equal
 *    options; table-only is not a lesser booking."
 *
 * The governing frame is "a hospitality operation with a shooting range
 * attached", and P4 names priority inversion as a structural design risk. A
 * screen that offered "Book a lane" with a quiet "or just a table?" underneath
 * would have inverted it in the surface members touch most often. So the four
 * are one grid of equal panes, in the specification's order, and the table is
 * not smaller, greyer or second.
 *
 * ===========================================================================
 * WHY THE RED ACTION STILL LANDS HERE WHEN NOTHING IS BOOKABLE
 *
 * §5.1: "When there is nothing bookable, the action does not disappear. It
 * routes to the same honest sentence the calendar renders."
 */

export const metadata: Metadata = { title: "Book a session" };

export const dynamic = "force-dynamic";

/**
 * The furthest the flow will project availability, whatever month is on screen.
 *
 * The calendar can be paged, and each page asks for the slots on its days — so
 * without a ceiling a member could walk forward indefinitely, each step costing
 * a full grid computation over a longer window. Sixty-two days is two months,
 * which is past every tier's horizon and therefore past anything a member could
 * act on.
 */
const MAX_PROJECTION_DAYS = 62;

type Search = {
  readonly day?: string;
  readonly slot?: string;
  readonly type?: string;
  readonly discipline?: string;
  readonly month?: string;
};

export default async function BookingFlowPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return (
      <>
        <PageHeader kicker="Book" title="Booking is for members" />
        <Section ground="chalk">
          <Body muted className="max-w-[68ch]">
            {resolution.state === "signed_out"
              ? "Sign in with your member account to book a session."
              : "If you have shot here as a guest, a member can put you forward — or the club can take an application directly."}
          </Body>
          <Button href={routes.membership} variant="primary" className="mt-4">
            What membership includes
          </Button>
        </Section>
      </>
    );
  }

  if (!isArmoryDatabaseConfigured()) {
    return (
      <>
        <PageHeader kicker="Book" title="Book a session" />
        <Section ground="chalk">
          <Body>The club&rsquo;s system is not reachable just now.</Body>
        </Section>
      </>
    );
  }

  const member = resolution.member;
  const db = getArmoryDb();
  const now = new Date();

  const bookingType = readType(params.type);
  const discipline = params.discipline?.trim() || null;

  /* ---- The month on screen, in the Diary's own grammar -------------------- */

  const selectedDay = readDay(params.day, now);
  const monthKey = readMonth(params.month, selectedDay, now);
  const shape = calendarMonth({ monthKey, today: now });

  /**
   * Project availability as far as the calendar can be tapped, and no further.
   *
   * The old screen projected a flat fourteen days and drew fourteen date chips,
   * so the window and the control agreed by construction. A month grid does not
   * get that for free: a calendar showing thirty-one days while only fourteen
   * of them could ever be booked is a control that lies about its own extent,
   * and the member finds out by tapping.
   */
  const days = Math.min(
    MAX_PROJECTION_DAYS,
    Math.max(1, lagosDaysBetween(now, shape.to) + 1),
  );

  const [policy, lanes, booked, events] = await Promise.all([
    clubAvailabilityPolicy(db),
    clubLanes(db),
    bookedInWindow(db, { from: now, to: addDays(startOfLagosDay(now), days) }),
    publishedEvents(db, { from: shape.from, to: shape.to }),
  ]);

  /**
   * The grid the chosen type is measured against.
   *
   * Before the type is chosen this is the LANE grid, which is not arbitrary:
   * the two grids share a session pattern (both come from the club's opening
   * hours) and the lane grid is the narrower of the two, since it also requires
   * an officer. Offering the wider one first would show a member a 21:00 slot
   * that disappears the moment they say they are shooting.
   */
  const slots =
    bookingType && !usesLane(bookingType)
      ? availableTables({ policy, booked, now, days })
      : availableSlots({
          policy,
          lanes,
          booked,
          discipline: discipline ?? member.tier.disciplineAccess[0] ?? "",
          now,
          days,
        });

  const chosen = params.slot
    ? (slots.find((slot) => slot.id === params.slot) ?? null)
    : null;

  /* ---- The URL builder every step shares --------------------------------- */

  const hrefWith = (next: Partial<Search>) => {
    const query = new URLSearchParams();
    const merged = { ...params, ...next };
    for (const key of ["day", "slot", "type", "discipline", "month"] as const) {
      const value = merged[key];
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return suffix ? `${routes.portalBookNew}?${suffix}` : routes.portalBookNew;
  };

  /* ---- The rail, built from the steps that actually apply ----------------- */

  const needsLine = bookingType ? usesLane(bookingType) : true;

  const rail = (current: "when" | "what" | "line" | "who"): RailStep[] => {
    const steps: RailStep[] = [
      {
        label: "When",
        answer: chosen
          ? `${formatWeekdayDate(chosen.start)} · ${formatTime(chosen.start)}`
          : null,
        href:
          current === "when"
            ? null
            : hrefWith({ slot: undefined, type: undefined, discipline: undefined }),
        current: current === "when",
      },
      {
        label: "What for",
        answer: bookingType ? TYPE_LABELS[bookingType] : null,
        href:
          current === "what" || !chosen
            ? null
            : hrefWith({ type: undefined, discipline: undefined }),
        current: current === "what",
      },
    ];

    /* Step three exists only where a line does. A table booking is three steps
       and the rail says three, rather than counting to five past a step the
       member will never see. */
    if (needsLine) {
      steps.push({
        label: "Which line",
        answer: discipline,
        href:
          current === "line" || !bookingType
            ? null
            : hrefWith({ discipline: undefined }),
        current: current === "line",
      });
    }

    steps.push({
      label: "Who, and confirm",
      answer: null,
      href: null,
      current: current === "who",
    });

    return steps;
  };

  /* ======================================================================
     STEP 1 — WHEN
     =================================================================== */

  if (!chosen) {
    const byDay = groupByDay(slots);
    const bookable = new Set(
      byDay.filter((entry) => entry.slots.some((s) => s.free > 0)).map((e) => e.key),
    );

    const openKey =
      bookable.has(lagosDateKey(selectedDay))
        ? lagosDateKey(selectedDay)
        : (byDay.find((entry) => bookable.has(entry.key))?.key ?? null);

    const forDay = byDay.find((entry) => entry.key === openKey);

    /* P2. The one honest sentence, and the reason the red action never
       disappears — it lands here and explains itself. */
    const reason =
      slots.length === 0
        ? (emptyReason(
            policy,
            lanes,
            discipline ?? member.tier.disciplineAccess[0] ?? "",
          ) ??
          emptyTableReason(policy) ??
          "There is nothing bookable at the moment.")
        : null;

    if (reason) {
      return (
        <>
          <PageHeader kicker="Book" title="When?" />
          <Section ground="terrazzo" rhythm="tight" field>
            <Panel>
              <H2>Nothing is bookable yet.</H2>
              <Body muted className="mt-2 max-w-[68ch]">
                {reason}
              </Body>
              <Button href={routes.portalBook} variant="secondary" className="mt-4">
                See the club&rsquo;s week
              </Button>
            </Panel>
          </Section>
        </>
      );
    }

    /* The club's month, marked as the Diary marks it, with one addition that
       belongs only here: a day with nothing free is not a link. It renders —
       §6.2's rule about a Saturday that vanishes reading as a closed club — but
       it cannot be chosen, which is the honest form of a booking calendar. */
    const month = calendarMonth({
      monthKey,
      today: now,
      programme: programmeWeek({
        from: shape.from,
        days: lagosDaysBetween(shape.from, shape.to) + 1,
        openingHours: policy.openingHours,
        events,
        fixtures: [],
      }),
    });

    const view: CalendarView = {
      monthKey: month.monthKey,
      label: month.label,
      weeks: month.weeks.map((week) =>
        week.map(
          (cell): CalendarDay => ({
            ...cell,
            href: bookable.has(cell.dateKey)
              ? hrefWith({ day: cell.dateKey, month: month.monthKey, slot: undefined })
              : null,
          }),
        ),
      ),
      previousHref: month.previousKey
        ? hrefWith({ month: month.previousKey, day: undefined, slot: undefined })
        : null,
      nextHref: month.nextKey
        ? hrefWith({ month: month.nextKey, day: undefined, slot: undefined })
        : null,
      previousLabel: month.previousKey ? monthLabel(month.previousKey) : null,
      nextLabel: month.nextKey ? monthLabel(month.nextKey) : null,
      todayHref: hrefWith({
        day: lagosDateKey(now),
        month: monthKeyOf(now),
        slot: undefined,
      }),
    };

    return (
      <>
        <PageHeader kicker="Book" title="When?" />
        <Section ground="terrazzo" rhythm="tight" field>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <Panel className="lg:w-[15rem] lg:shrink-0">
              <BookingRail steps={rail("when")} />
            </Panel>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Panel ticks padded={false} className="max-w-[46rem] p-2 sm:p-3">
                <MonthCalendar view={view} selectedKey={openKey ?? ""} />
              </Panel>

              <Panel>
                {forDay ? (
                  <SlotBoard
                    title={formatWeekdayDate(forDay.slots[0].start)}
                    slots={forDay.slots}
                    reason={null}
                    hrefFor={(slot) =>
                      hrefWith({ slot: slot.id, day: forDay.key })
                    }
                  />
                ) : (
                  <>
                    <H3>Pick a day.</H3>
                    <Body muted className="mt-1 max-w-[68ch]">
                      The days you can book are the ones you can tap. Days the
                      club is shut, or already full, stay on the calendar so you
                      can see the shape of the month.
                    </Body>
                  </>
                )}
              </Panel>
            </div>
          </div>
        </Section>
      </>
    );
  }

  /* ======================================================================
     STEP 2 — WHAT. Four equal options. §7.4.
     =================================================================== */

  if (!bookingType) {
    return (
      <>
        <PageHeader kicker="Book" title="What for?" />
        <Section ground="terrazzo" rhythm="tight" field>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <Panel className="lg:w-[15rem] lg:shrink-0">
              <BookingRail steps={rail("what")} />
            </Panel>

            <ul className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              {BOOKING_TYPES.map((type) => (
                <li key={type} className="contents">
                  <Panel as="div" raised padded={false}>
                    <Link
                      href={hrefWith({ type })}
                      className="flex min-h-8 flex-col justify-center gap-1 p-3 no-underline"
                    >
                      <span className="font-display text-h3 font-bold text-[var(--ink)]">
                        {TYPE_LABELS[type]}
                      </span>
                      <Caption>{TYPE_NOTES[type]}</Caption>
                    </Link>
                  </Panel>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </>
    );
  }

  /* ======================================================================
     STEP 3 — DISCIPLINE, where a line is involved at all.
     =================================================================== */

  if (usesLane(bookingType) && !discipline) {
    /* Only disciplines this member's tier covers. §4 would refuse the others at
       MAY_BOOK anyway, and offering a slot the club will then refuse is exactly
       the discovery §4.3 exists to prevent — one screen earlier than the desk. */
    const options = member.tier.disciplineAccess;

    return (
      <>
        <PageHeader kicker="Book" title="Which line?" />
        <Section ground="terrazzo" rhythm="tight" field>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <Panel className="lg:w-[15rem] lg:shrink-0">
              <BookingRail steps={rail("line")} />
            </Panel>

            <div className="min-w-0 flex-1">
              {options.length === 0 ? (
                <Panel>
                  <Body muted className="max-w-[68ch]">
                    Your tier does not cover any of the club&rsquo;s disciplines
                    yet. Speak to the club about an upgrade.
                  </Body>
                </Panel>
              ) : (
                <ul className="flex flex-col gap-3">
                  {options.map((option) => {
                    const free = freeAt(
                      availableSlots({
                        policy,
                        lanes,
                        booked,
                        discipline: option,
                        now,
                        days,
                      }),
                      chosen.id,
                    );

                    if (free === 0 || free === null) {
                      return (
                        <li key={option}>
                          <Panel flat className="opacity-55">
                            <div className="flex flex-wrap items-baseline justify-between gap-3">
                              <span className="font-display text-body font-bold">
                                {option}
                              </span>
                              <Caption as="span">
                                {free === null
                                  ? "Not running at this time"
                                  : "Full at this time"}
                              </Caption>
                            </div>
                          </Panel>
                        </li>
                      );
                    }

                    return (
                      <li key={option}>
                        <Panel raised padded={false}>
                          <Link
                            href={hrefWith({ discipline: option })}
                            className="flex flex-wrap items-baseline justify-between gap-3 p-3 no-underline"
                          >
                            <span className="font-display text-body font-bold text-[var(--ink)]">
                              {option}
                            </span>
                            <Caption as="span">
                              {free} {free === 1 ? "place" : "places"}
                            </Caption>
                          </Link>
                        </Panel>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Section>
      </>
    );
  }

  /* ======================================================================
     STEPS 4 AND 5
     =================================================================== */

  return (
    <>
      <PageHeader kicker="Book" title={formatWeekdayDate(chosen.start)} />
      <Section ground="terrazzo" rhythm="tight" field>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <Panel className="lg:w-[15rem] lg:shrink-0">
            <BookingRail steps={rail("who")} />
          </Panel>

          <Panel ticks className="min-w-0 flex-1">
            <BookingFlow
              summary={{
                whenLabel: `${formatWeekdayDate(chosen.start)} · ${formatTime(chosen.start)}–${formatTime(chosen.end)}`,
                purposeLabel: purposeLabel(bookingType, discipline),
                slotId: chosen.id,
                bookingType,
                discipline,
              }}
              canHost={member.tier.canHost}
              allowance={{
                remaining: member.allowance.remaining,
                includedQuota: member.allowance.includedQuota,
                periodEnd: member.allowance.periodEnd.toISOString(),
              }}
              overagePriceLabel={overagePriceLabel()}
            />
          </Panel>
        </div>
      </Section>
    </>
  );
}

/* ============================================================================
   LABELS AND HELPERS
   ========================================================================= */

const TYPE_LABELS: Record<BookingType, string> = {
  shoot: "Shoot",
  table: "A table",
  both: "Both",
  spectate: "Spectate",
};

/**
 * One line each, and none of them apologises for itself.
 *
 * "A table" does not say "no shooting" and "Spectate" does not say "you will
 * not be firing". §7.4 makes the four equal, and a note that defines a choice
 * by what it lacks is the inequality creeping back in through the copy.
 */
const TYPE_NOTES: Record<BookingType, string> = {
  shoot: "A place on the line.",
  table: "A seat on the deck.",
  both: "A place on the line and a table after.",
  spectate: "Along to watch. The desk will be expecting you.",
};

function purposeLabel(type: BookingType, discipline: string | null): string {
  if (type === "shoot") return discipline ?? "On the line";
  if (type === "both") return `${discipline ?? "On the line"} and a table`;
  return TYPE_LABELS[type];
}

function readType(raw: string | undefined): BookingType | null {
  return raw && (BOOKING_TYPES as readonly string[]).includes(raw)
    ? (raw as BookingType)
    : null;
}

/** The day the calendar opens on. Defaults to today; refuses what it cannot parse. */
function readDay(raw: string | undefined, now: Date): Date {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return now;
  const parsed = parseDateColumn(raw);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

/** The month on screen. The Diary's grammar, so the two behave alike. */
function readMonth(
  raw: string | undefined,
  selected: Date,
  now: Date,
): MonthKey {
  if (raw && parseMonthKey(raw) && withinHorizon(raw, now)) return raw;
  return monthKeyOf(selected);
}

/** Slots grouped by their Lagos day, in order. */
function groupByDay(slots: readonly Slot[]): { key: string; slots: Slot[] }[] {
  const days = new Map<string, Slot[]>();

  for (const slot of slots) {
    const key = lagosDateKey(slot.start);
    const existing = days.get(key);
    if (existing) existing.push(slot);
    else days.set(key, [slot]);
  }

  return [...days.entries()].map(([key, entries]) => ({ key, slots: entries }));
}

/**
 * Places left on one discipline at one instant.
 *
 * Null where that discipline has no slot at that time at all — which is a
 * different fact from a full one and reads differently on the screen: one is
 * "come back later", the other is "this line does not run then".
 */
function freeAt(slots: readonly Slot[], slotId: string): number | null {
  const match = slots.find((slot) => slot.id === slotId);
  return match ? match.free : null;
}
