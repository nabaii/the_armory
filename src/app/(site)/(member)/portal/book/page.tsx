import type { Metadata } from "next";
import Link from "next/link";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import {
  availableSlots,
  availableTables,
  emptyReason,
  emptyTableReason,
} from "@/domain/availability";
import {
  bookedInWindow,
  clubAvailabilityPolicy,
  clubLanes,
} from "@/server/armory/club-policy";
import { programmeWeek, publishedEvents } from "@/server/armory/programme";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { upcomingBookingsFor } from "@/server/armory/member-bookings";
import { hasProgramme, weekFrom, type ProgrammeDay } from "@/domain/programme";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { ProgrammeLine } from "@/components/member/ProgrammeLine";
import {
  ModeSwitch,
  WeekStrip,
  type DiaryMode,
  type WeekDay,
} from "@/components/member/DiaryControls";
import {
  addDays,
  formatTime,
  formatWeekdayDate,
  lagosDateKey,
  lagosParts,
  parseDateColumn,
} from "@/lib/time";
import { routes } from "@/lib/site";

/**
 * DIARY — Members Portal Design Specification §7.
 *
 *   "§7.1 — Today answers what am I doing. Diary answers what could I do.
 *    Today is a notification surface … It cannot show the shape of a month
 *    without becoming a scroll. A member deciding whether to come in on the
 *    twenty-seventh, or noticing a fixture three weeks out, needs a surface
 *    Today cannot be."
 *
 * ===========================================================================
 * §7.3 — THREE FEEDS, AND THAT IS WHY THIS TAB IS NOT EMPTY MOST WEEKS
 *
 *   "A Diary populated only by special occasions will be empty most weeks, and
 *    an empty calendar signals a dead club more loudly than no calendar at all.
 *    The surface survives because it draws on three feeds of very different
 *    frequency."
 *
 * The operating rhythm — which evenings the club is open, which of them are
 * staffed — is the feed that carries it, and it costs nothing beyond the
 * opening-hours migration that booking needed anyway.
 *
 * ===========================================================================
 * §7.5 — THE DECISION THIS TAB SAT ON, NOW TAKEN
 *
 *   "If the club has a programme — a reason to be there on an evening you are
 *    not shooting, published in advance — Diary is the hospitality surface and
 *    it earns a tab. If the honest answer is *the range is open, come when you
 *    like*, then Diary is a date picker wearing a tab."
 *
 * SETTLED, 16 August 2026: the club has a programme. The Diary keeps its tab
 * and the four-tab structure stands.
 *
 * What that creates is an obligation rather than a feature. A tab promising a
 * programme has to have one in it: the operating rhythm fills it every day now
 * that the week is published, and the one-off feed is the club's to keep
 * current. An events table nobody writes to would make this tab emptier than no
 * tab would have been, which is the failure §7.3 warns about.
 *
 * ===========================================================================
 * WHY THE STATE IS IN THE URL
 *
 * §13.2 and §7.4's argument for the booking flow, applied here: a day and a
 * mode held in component state cannot be linked to, do not survive a refresh,
 * and lose the member's place when they follow a booking and come back. As
 * search parameters they are all three.
 */

export const metadata: Metadata = { title: "Diary" };

export const dynamic = "force-dynamic";

/** How far the strip and the grids project. Two weeks of the club's week. */
const WINDOW_DAYS = 14;

/** How many days the strip itself shows at once. Seven fit a phone. */
const STRIP_DAYS = 7;

type Search = { readonly day?: string; readonly mode?: string };

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
  const mode: DiaryMode = params.mode === "availability" ? "availability" : "programme";
  const selected = selectedDay(params.day, now);
  const selectedKey = lagosDateKey(selected);

  const [policy, lanes, events, booked] = await Promise.all([
    clubAvailabilityPolicy(db),
    clubLanes(db),
    publishedEvents(db, { from: now, to: addDays(now, WINDOW_DAYS) }),
    bookedInWindow(db, { from: now, to: addDays(now, WINDOW_DAYS) }),
  ]);

  const week = programmeWeek({
    from: now,
    days: WINDOW_DAYS,
    openingHours: policy.openingHours,
    events,
    fixtures: [],
  });

  /* Declared before the strip that calls it. A `const` arrow referenced above
     its own declaration is a temporal dead zone error at request time, which no
     type check catches. */
  const hrefFor = (next: { day?: string; mode?: DiaryMode }) => {
    const query = new URLSearchParams();
    query.set("day", next.day ?? selectedKey);
    const nextMode = next.mode ?? mode;
    if (nextMode !== "programme") query.set("mode", nextMode);
    return `${routes.portalBook}?${query.toString()}`;
  };

  const strip: WeekDay[] = weekFrom(now, STRIP_DAYS).map((date) => {
    const key = lagosDateKey(date);
    const day = week.find((candidate) => candidate.dateKey === key);
    const parts = lagosParts(date);

    return {
      key,
      weekday: WEEKDAY_LABELS[parts.weekday],
      dayOfMonth: String(parts.day),
      hasProgramme: day ? hasProgramme(day) : false,
      isToday: key === lagosDateKey(now),
      /* Built here rather than in the strip: a function cannot cross into a
         client component, and the URL grammar belongs to this page anyway. */
      href: hrefFor({ day: key }),
    };
  });

  const day = week.find((candidate) => candidate.dateKey === selectedKey) ?? null;

  return (
    <>
      <PageHeader
        kicker="Diary"
        title="The club's week"
        lead="What is on, and what is free."
      />

      <Section ground="chalk" rhythm="tight">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ModeSwitch
            mode={mode}
            programmeHref={hrefFor({ mode: "programme" })}
            availabilityHref={hrefFor({ mode: "availability" })}
          />
          <Button href={routes.portalBookNew} variant="primary">
            Book a session
          </Button>
        </div>

        <WeekStrip className="mt-4" days={strip} selectedKey={selectedKey} />
      </Section>

      {mode === "programme" ? (
        <ProgrammeMode day={day} date={selected} />
      ) : (
        <AvailabilityMode
          date={selected}
          now={now}
          policy={policy}
          lanes={lanes}
          booked={booked}
          disciplines={
            resolution.state === "member"
              ? resolution.member.tier.disciplineAccess
              : []
          }
          closed={day?.closed ?? false}
        />
      )}

      {/* The member's own bookings on this day, in either mode. §7.2's booking
          detail: a member looking at Saturday should see that they are already
          coming on Saturday without switching surfaces to find out. */}
      {resolution.state === "member" && (
        <YourBookings
          db={db}
          membershipId={resolution.member.membershipId}
          personId={resolution.member.personId}
          dateKey={selectedKey}
          now={now}
        />
      )}
    </>
  );
}

/* ============================================================================
   MODE ONE — WHAT'S ON. §7.2's programme list, and the default.
   ========================================================================= */

function ProgrammeMode({
  day,
  date,
}: {
  day: ProgrammeDay | null;
  date: Date;
}) {
  return (
    <Section ground="soffit" rhythm="default">
      <Kicker className="mb-2">{formatWeekdayDate(date)}</Kicker>

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
          <H2>Nothing scheduled.</H2>
          <Body muted className="mt-2 max-w-[68ch]">
            Nothing is published for this day. Try another in the strip above.
          </Body>
        </>
      ) : (
        <>
          <H2>{day.closed ? "The club is closed." : "What's on."}</H2>
          <ul className="mt-4 flex flex-col gap-3">
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
   MODE TWO — AVAILABILITY. §7.2's grid, blocked on nothing since 0008 and
   honest until the club publishes hours.
   ========================================================================= */

function AvailabilityMode({
  date,
  now,
  policy,
  lanes,
  booked,
  disciplines,
  closed,
}: {
  date: Date;
  now: Date;
  policy: Awaited<ReturnType<typeof clubAvailabilityPolicy>>;
  lanes: Awaited<ReturnType<typeof clubLanes>>;
  booked: Awaited<ReturnType<typeof bookedInWindow>>;
  disciplines: readonly string[];
  closed: boolean;
}) {
  const dayKey = lagosDateKey(date);
  const onThisDay = <T extends { start: Date }>(slots: readonly T[]) =>
    slots.filter((slot) => lagosDateKey(slot.start) === dayKey);

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
        <Kicker className="mb-2">{formatWeekdayDate(date)}</Kicker>
        <H2>The club is closed on this day.</H2>
        <Body muted className="mt-2 max-w-[68ch]">
          Nothing is bookable. The rest of the week is in the strip above.
        </Body>
      </Section>
    );
  }

  /* §14's window: 14 days of grid, then filtered to the chosen day. One
     computation for the window rather than one per day, because the slot ids
     must be identical whichever day the member is looking at. */
  const tables = onThisDay(
    availableTables({ policy, booked, now, days: WINDOW_DAYS }),
  );
  const tableReason = emptyTableReason(policy);

  return (
    <Section ground="chalk" rhythm="default">
      <Kicker className="mb-2">{formatWeekdayDate(date)}</Kicker>

      {/* §7.4, and P4. The tables come FIRST. The club is a hospitality
          operation with a shooting range attached, and a screen that opens on a
          lane grid has re-inverted the strategy in the surface members touch
          most often. */}
      <H3>A table</H3>
      {tableReason ? (
        <Body muted className="mt-1">
          {tableReason}
        </Body>
      ) : tables.length === 0 ? (
        <Body muted className="mt-1">
          Nothing free on this day.
        </Body>
      ) : (
        <SlotRow slots={tables} />
      )}

      <div className="mt-8 flex flex-col gap-6">
        {disciplines.map((discipline) => {
          const slots = onThisDay(
            availableSlots({ policy, lanes, booked, discipline, now, days: WINDOW_DAYS }),
          );
          const reason =
            slots.length === 0 ? emptyReason(policy, lanes, discipline) : null;

          return (
            <div key={discipline}>
              <H3>{discipline}</H3>
              {reason ? (
                /* §4.3's rule applied to an empty list: never a blank screen,
                   and never a stack of conditions. One sentence. */
                <Body muted className="mt-1">
                  {reason}
                </Body>
              ) : slots.length === 0 ? (
                <Body muted className="mt-1">
                  Nothing free on this day.
                </Body>
              ) : (
                <SlotRow slots={slots} />
              )}
            </div>
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

/**
 * One line of slots.
 *
 * A full slot is RENDERED, with nothing free, rather than filtered out. §6.2:
 * "a Saturday that silently vanishes because it is busy reads as the club being
 * closed — which sends them to WhatsApp to ask, which is the phone call the
 * portal exists to prevent."
 */
function SlotRow({
  slots,
}: {
  slots: readonly {
    id: string;
    start: Date;
    free: number;
    capacity: number;
    discipline: string | null;
  }[];
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {slots.map((slot) => {
        const full = slot.free === 0;

        return (
          <li key={slot.id}>
            {full ? (
              <span
                className="inline-flex min-h-6 flex-col items-center justify-center rounded-control border border-[var(--rule)]/40 px-2 py-1 opacity-55"
                aria-label={`${formatTime(slot.start)} — full`}
              >
                <span className="font-display text-body font-bold line-through">
                  {formatTime(slot.start)}
                </span>
                <Caption>Full</Caption>
              </span>
            ) : (
              <Link
                href={slotHref(slot)}
                className="inline-flex min-h-6 flex-col items-center justify-center rounded-control border border-[var(--ink)] px-2 py-1 no-underline"
              >
                <span className="font-display text-body font-bold">
                  {formatTime(slot.start)}
                </span>
                <Caption>
                  {slot.free} {slot.free === 1 ? "place" : "places"}
                </Caption>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A slot links into the booking flow with step one already answered. */
function slotHref(slot: { id: string; discipline: string | null }): string {
  const query = new URLSearchParams({ slot: slot.id });
  if (slot.discipline) {
    query.set("type", "shoot");
    query.set("discipline", slot.discipline);
  } else {
    query.set("type", "table");
  }
  return `${routes.portalBookNew}?${query.toString()}`;
}

/* ============================================================================
   THE MEMBER'S OWN BOOKINGS ON THIS DAY
   ========================================================================= */

async function YourBookings({
  db,
  membershipId,
  personId,
  dateKey,
  now,
}: {
  db: ReturnType<typeof getArmoryDb>;
  membershipId: string;
  personId: string;
  dateKey: string;
  now: Date;
}) {
  const bookings = await upcomingBookingsFor(db, {
    membershipId,
    personId,
    from: now,
    limit: 20,
  });

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
   DAYS
   ========================================================================= */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}
