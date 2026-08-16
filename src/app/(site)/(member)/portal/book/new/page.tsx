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
import { resolveArmoryMember } from "@/server/armory/member-session";
import { overagePriceLabel } from "@/server/armory/overage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, H2, H3 } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { BookingFlow } from "@/components/member/BookingFlow";
import { QuietAction } from "@/components/member/QuietAction";
import {
  addDays,
  formatTime,
  formatWeekdayDate,
  lagosDateKey,
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
 * §7.4's SECOND STEP IS A STRATEGY DECISION WEARING A RADIO BUTTON
 *
 *   "2 — What | Shoot · Table · Both · Spectate | Enforces: NOTHING. Four equal
 *    options; table-only is not a lesser booking."
 *
 * The governing frame is "a hospitality operation with a shooting range
 * attached", and P4 names priority inversion as a structural design risk. A
 * screen that offered "Book a lane" with a quiet "or just a table?" underneath
 * would have inverted it in the surface members touch most often. So the four
 * are one row of equal choices, in the specification's order, and the table is
 * not smaller, greyer or second.
 *
 * ===========================================================================
 * WHY THE RED ACTION STILL LANDS HERE WHEN NOTHING IS BOOKABLE
 *
 * §5.1: "When there is nothing bookable, the action does not disappear. It
 * routes to the same honest sentence the calendar renders. This is P2 applied
 * to navigation: a tab that vanishes and reappears teaches a member that the
 * application is unreliable; a tab that explains itself teaches them that the
 * club is not yet open for bookings, which is true."
 *
 * That is why this page has an empty state at all, and why the empty state is
 * a sentence about the club rather than an error about the application.
 */

export const metadata: Metadata = { title: "Book a session" };

export const dynamic = "force-dynamic";

/** How far ahead the flow projects. A tier's horizon narrows it in MAY_BOOK. */
const WINDOW_DAYS = 14;

type Search = {
  readonly day?: string;
  readonly slot?: string;
  readonly type?: string;
  readonly discipline?: string;
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

  const [policy, lanes, booked] = await Promise.all([
    clubAvailabilityPolicy(db),
    clubLanes(db),
    bookedInWindow(db, { from: now, to: addDays(now, WINDOW_DAYS) }),
  ]);

  const bookingType = readType(params.type);
  const discipline = params.discipline?.trim() || null;

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
      ? availableTables({ policy, booked, now, days: WINDOW_DAYS })
      : availableSlots({
          policy,
          lanes,
          booked,
          discipline: discipline ?? member.tier.disciplineAccess[0] ?? "",
          now,
          days: WINDOW_DAYS,
        });

  const chosen = params.slot ? (slots.find((slot) => slot.id === params.slot) ?? null) : null;

  /* ---- The URL builder every step shares --------------------------------- */

  const hrefWith = (next: Partial<Search>) => {
    const query = new URLSearchParams();
    const merged = { ...params, ...next };
    for (const key of ["day", "slot", "type", "discipline"] as const) {
      const value = merged[key];
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return suffix ? `${routes.portalBookNew}?${suffix}` : routes.portalBookNew;
  };

  /* ======================================================================
     STEP 1 — WHEN
     =================================================================== */

  if (!chosen) {
    const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : null;
    const days = groupByDay(slots);
    const openDay = day ?? days[0]?.key ?? null;
    const forDay = days.find((entry) => entry.key === openDay);

    /* P2. The one honest sentence, and the reason the red action never
       disappears — it lands here and explains itself. */
    const reason =
      slots.length === 0
        ? (emptyReason(policy, lanes, discipline ?? member.tier.disciplineAccess[0] ?? "") ??
          emptyTableReason(policy) ??
          "There is nothing bookable at the moment.")
        : null;

    return (
      <>
        <PageHeader kicker="Step 1 of 5" title="When?" />
        <Section ground="chalk">
          {reason ? (
            <>
              <H2>Nothing is bookable yet.</H2>
              <Body muted className="mt-2 max-w-[68ch]">
                {reason}
              </Body>
              <Button href={routes.portalBook} variant="secondary" className="mt-4">
                See the club&rsquo;s week
              </Button>
            </>
          ) : (
            <>
              <ul className="flex flex-wrap gap-2">
                {days.map((entry) => (
                  <li key={entry.key}>
                    <Link
                      href={hrefWith({ day: entry.key, slot: undefined })}
                      aria-current={entry.key === openDay ? "date" : undefined}
                      className={[
                        "inline-flex min-h-6 items-center rounded-control px-2 py-1 no-underline",
                        "border border-[var(--rule)]/40 font-display text-body",
                        entry.key === openDay
                          ? "bg-[var(--ink)] text-[var(--btn-fill-ink)] font-bold"
                          : "text-[var(--ink)]",
                      ].join(" ")}
                    >
                      {formatWeekdayDate(entry.slots[0].start)}
                    </Link>
                  </li>
                ))}
              </ul>

              <H3 className="mt-6">Sessions</H3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {(forDay?.slots ?? []).map((slot) => (
                  <li key={slot.id}>
                    {slot.free === 0 ? (
                      <span className="inline-flex min-h-6 flex-col items-center rounded-control border border-[var(--rule)]/40 px-2 py-1 opacity-55">
                        <span className="font-display text-body font-bold line-through">
                          {formatTime(slot.start)}
                        </span>
                        <Caption>Full</Caption>
                      </span>
                    ) : (
                      <Link
                        href={hrefWith({ slot: slot.id, day: forDay?.key })}
                        className="inline-flex min-h-6 flex-col items-center rounded-control border border-[var(--ink)] px-2 py-1 no-underline"
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
                ))}
              </ul>
            </>
          )}
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
        <PageHeader
          kicker="Step 2 of 5"
          title="What for?"
          lead={`${formatWeekdayDate(chosen.start)} · ${formatTime(chosen.start)}`}
        />
        <Section ground="chalk">
          <ul className="grid gap-2 sm:grid-cols-2">
            {BOOKING_TYPES.map((type) => (
              <li key={type}>
                <Link
                  href={hrefWith({ type })}
                  className="flex min-h-8 flex-col justify-center rounded-control border border-[var(--ink)] px-3 py-2 no-underline"
                >
                  <span className="font-display text-h3 font-bold text-[var(--ink)]">
                    {TYPE_LABELS[type]}
                  </span>
                  <Caption>{TYPE_NOTES[type]}</Caption>
                </Link>
              </li>
            ))}
          </ul>

          <BackLink href={hrefWith({ slot: undefined })} label="Change the time" />
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
        <PageHeader
          kicker="Step 3 of 5"
          title="Which line?"
          lead={`${formatWeekdayDate(chosen.start)} · ${formatTime(chosen.start)}`}
        />
        <Section ground="chalk">
          {options.length === 0 ? (
            <Body muted className="max-w-[68ch]">
              Your tier does not cover any of the club&rsquo;s disciplines yet.
              Speak to the club about an upgrade.
            </Body>
          ) : (
            <ul className="flex flex-col gap-2">
              {options.map((option) => {
                const free = freeAt(
                  availableSlots({
                    policy,
                    lanes,
                    booked,
                    discipline: option,
                    now,
                    days: WINDOW_DAYS,
                  }),
                  chosen.id,
                );

                return (
                  <li key={option}>
                    {free === 0 ? (
                      <span className="flex min-h-6 items-baseline justify-between gap-3 rounded-control border border-[var(--rule)]/40 px-3 py-2 opacity-55">
                        <span className="font-display text-body font-bold">
                          {option}
                        </span>
                        <Caption>Full at this time</Caption>
                      </span>
                    ) : (
                      <Link
                        href={hrefWith({ discipline: option })}
                        className="flex min-h-6 items-baseline justify-between gap-3 rounded-control border border-[var(--ink)] px-3 py-2 no-underline"
                      >
                        <span className="font-display text-body font-bold text-[var(--ink)]">
                          {option}
                        </span>
                        <Caption>
                          {free === null
                            ? "Not running at this time"
                            : `${free} ${free === 1 ? "place" : "places"}`}
                        </Caption>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <BackLink href={hrefWith({ type: undefined })} label="Change what for" />
        </Section>
      </>
    );
  }

  /* ======================================================================
     STEPS 4 AND 5
     =================================================================== */

  return (
    <>
      <PageHeader
        kicker="Book"
        title={formatWeekdayDate(chosen.start)}
        lead={`${formatTime(chosen.start)} · ${purposeLabel(bookingType, discipline)}`}
      />
      <Section ground="chalk">
        <BookingFlow
          summary={{
            whenLabel: `${formatWeekdayDate(chosen.start)} · ${formatTime(chosen.start)}`,
            purposeLabel: purposeLabel(bookingType, discipline),
            slotStart: chosen.start.toISOString(),
            slotEnd: chosen.end.toISOString(),
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

        <BackLink
          href={hrefWith({ slot: undefined, type: undefined, discipline: undefined })}
          label="Start again"
        />
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

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <QuietAction href={href} className="mt-5">
      {label}
    </QuietAction>
  );
}
