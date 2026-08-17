import type { Metadata } from "next";
import Link from "next/link";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { isDatabaseConfigured } from "@/db/client";
import { getMember } from "@/server/auth/session";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { remediesFor } from "@/server/armory/remedies";
import {
  bookingWorthHosting,
  upcomingBookingsFor,
  type MemberBooking,
} from "@/server/armory/member-bookings";
import { competitiveRecordFor } from "@/server/armory/member-record";
import { clubOpeningHours } from "@/server/armory/club-policy";
import { programmeWeek, publishedEvents } from "@/server/armory/programme";
import type { ProgrammeDay } from "@/domain/programme";
import { Section } from "@/components/layout/Section";
import { Panel } from "@/components/ui/Panel";
import { QuietAction } from "@/components/member/QuietAction";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { RemedyStack } from "@/components/member/RemedyCard";
import { ScoreLine } from "@/components/member/ScoreLine";
import { StatusPill } from "@/components/member/StatusPill";
import { ProgrammeLine } from "@/components/member/ProgrammeLine";
import { WeekRail, type RailDay } from "@/components/member/WeekRail";
import { calendarDays } from "@/domain/calendar";
import {
  addDays,
  formatTime,
  formatWeekdayDate,
  isSameLagosDay,
  lagosDateKey,
  lagosDaysBetween,
} from "@/lib/time";
import { routes } from "@/lib/site";

/**
 * TODAY — Members Portal Design Specification §6.
 *
 *   "A single vertical stack of cards. No tabs within tabs, no horizontal
 *    carousels, no dashboard grid. The member scrolls once and has seen
 *    everything the club has to say to them."
 *
 * ===========================================================================
 * §6.3 — THE ORDER IS FIXED, NOT COMPUTED
 *
 *   "Ordering cards by computed urgency was proposed and rejected. A home
 *    screen that reshuffles between visits is never learned, and a member who
 *    has learned where the next-booking card sits can find it without reading.
 *    The order is: action required, next booking, tonight at the club, live
 *    competition, last round. Cards absent from a given member's state
 *    collapse; the surviving cards do not reorder."
 *
 * That is why this file is a flat sequence of five blocks with no sort anywhere
 * in it. The temptation to promote a card — an expiring licence to the top, a
 * fixture on the day it is due — is the temptation §6.3 is refusing.
 *
 * ===========================================================================
 * §6.4 — THE EMPTY STATES ARE THE POINT
 *
 *   "A member with no booking, no competition and no action items must still
 *    see the club's week. A blank Today screen teaches the member not to open
 *    the application, which is the single outcome the entire design is arranged
 *    to prevent. The Tonight at the club card therefore has no empty state —
 *    where nothing is scheduled tonight, it shows the week ahead."
 *
 * ===========================================================================
 * P3 — WHY THIS SCREEN EXISTS WHEN THE MEMBER IS NOT SHOOTING
 *
 * Shooting is infrequent. Four of the five cards are for the weeks in between:
 * what is on, where the member's league stands, what they last shot. Only one
 * of them is about a session they have booked.
 */

export const metadata: Metadata = { title: "Today" };

export const dynamic = "force-dynamic";

/** How far the fallback week looks when nothing is on tonight. §6.4. */
const WEEK_AHEAD_DAYS = 7;

export default async function TodayPage() {
  const member = await getMember();
  if (!member) return null;

  const now = new Date();
  const resolution = await resolveArmoryMember();
  const configured = isDatabaseConfigured() && isArmoryDatabaseConfigured();

  /**
   * A person signed in with no membership behind them.
   *
   * §3.1 makes applicant, guest and member states of a person, and this account
   * is very likely the club's warmest prospect — a former guest. The honest
   * screen invites them rather than showing them an empty members' home, and
   * §3.2 is the reason it is worth doing well: "someone brought four times by
   * four different members is the person most likely to join".
   */
  if (resolution.state !== "member") {
    return <NotYetAMember state={resolution.state} />;
  }

  const armory = resolution.member;
  const db = getArmoryDb();

  const [remedies, bookings, record, openingHours] = await Promise.all([
    remediesFor(db, armory, now),
    upcomingBookingsFor(db, {
      membershipId: armory.membershipId,
      personId: armory.personId,
      from: now,
      /**
       * Enough to mark the rail, not only to name the next session.
       *
       * The card itself needs one booking and the hosting prompt needs the
       * first without companions. The rail below them needs every booking in
       * the next seven days, and a limit of three would silently leave a fourth
       * unmarked — a member would see an empty Saturday on Today and a booked
       * Saturday in the Diary, and would be right to trust neither. It is one
       * member's own bookings over one week: tens of rows at the very most.
       */
      limit: 20,
    }),
    competitiveRecordFor({ personId: armory.personId, memberId: member.id }),
    clubOpeningHours(db),
  ]);

  const events = configured
    ? await publishedEvents(db, { from: now, to: addDays(now, WEEK_AHEAD_DAYS) })
    : [];

  /* Fixtures are weeks, never dates (Leagues Spec §8), so they do not land on a
     day and are not merged into the programme. They appear on their own card
     below, where "week 3, still to shoot" is the whole fact. */
  const week = programmeWeek({
    from: now,
    days: WEEK_AHEAD_DAYS,
    openingHours,
    events,
    fixtures: [],
  });

  const today = week[0];
  const next = bookings[0] ?? null;

  /**
   * The next seven days, marked, for the rail at the top of card 3.
   *
   * Built from the same `calendarDays` the Diary's grid is built from, so a day
   * carrying a filled square here carries one there. Two markings of the same
   * days would disagree within a release and the version a member believed
   * would depend on which tab they happened to be on.
   */
  const rail: RailDay[] = calendarDays({
    from: now,
    days: WEEK_AHEAD_DAYS,
    today: now,
    programme: week,
    bookedKeys: new Set(
      bookings.map((booking) => lagosDateKey(booking.slotStart)),
    ),
  }).map((cell) => ({
    ...cell,
    href: `${routes.portalBook}?day=${cell.dateKey}`,
  }));
  const toHost =
    armory.tier.canHost && armory.allowance.remaining > 0
      ? bookingWorthHosting(bookings)
      : null;

  const lastRound = record.shooting.mostRecent;
  const bestForFormat = lastRound
    ? record.shooting.bests.find(
        (best) => best.formatLabel === lastRound.formatLabel,
      )
    : undefined;

  return (
    /**
     * ONE BAND, FIVE PANES — and this is §6.1 read literally for the first time.
     *
     *   "A single vertical stack of cards. No tabs within tabs, no horizontal
     *    carousels, no dashboard grid."
     *
     * This screen shipped as five full-bleed colour bands. Bands are the right
     * structure for the marketing site, where each one is an argument, and they
     * are not cards: every surface sat at the same distance from the reader, so
     * nothing on Today could be picked up, compared, or told apart from the page
     * it was printed on. A member scrolled through five paragraphs of club, not
     * five things that were theirs.
     *
     * They are panes now, set into one setting-out field. The order is still
     * fixed and still not computed — §6.3 — and the stack is still flat. What
     * changed is that the five things Today has to say are now five objects.
     *
     * ===========================================================================
     * THE SOFFIT BLUE BAND ON CARD 3 IS GONE, DELIBERATELY
     *
     * It cannot carry a pane: light glazing over Soffit Blue puts Ten Ring Red at
     * 2.78:1, under the 3:1 a marker needs, and leaves captions at 4.57:1 with
     * no headroom at all. See `groundGlaze`.
     *
     * It should not have carried one anyway. Guidelines §4 makes Soffit Blue the
     * OPEN register and VIP Teal the member one — the registers encode which
     * CONTEXT a reader is in, first visit against membership. Today is entirely
     * one context. Using the open register to distinguish one of a member's own
     * cards from another of a member's own cards was reading a rule about access
     * as a rule about variety, which is how a colour system stops meaning
     * anything. The member register is carried where it belongs: the tier chip in
     * the header, and the teal band the Diary uses to say you are coming in.
     */
    <Section ground="terrazzo" rhythm="tight" field>
      <div className="flex flex-col gap-3">
        {/* ============================================================ 1 of 5
            ACTION REQUIRED — §6.2. One component, in a loop, rendering whatever
            the capability service hands back. Renders nothing when there is
            nothing to say: a heading reading "nothing needs your attention" over
            blank space is a club filling a screen with its own reassurance. */}
        {remedies.length > 0 && (
          <Panel>
            <Kicker className="mb-2">Needs you</Kicker>
            <RemedyStack items={remedies} />
          </Panel>
        )}

        {/* ============================================================ 2 of 5
            NEXT BOOKING. The one pane on this screen that carries the
            setting-out ticks: it is the thing the member opened the app for,
            and a mark on every pane is a border treatment rather than a mark. */}
        <Panel ticks>
          <Kicker className="mb-2">Your next session</Kicker>
          {next ? (
            <NextBooking booking={next} now={now} />
          ) : (
            <>
              <H2>Nothing booked.</H2>
              <Body muted className="mt-2 max-w-[68ch]">
                The club&rsquo;s week is below. When you know which evening
                suits, book it — you can add whoever is coming with you at the
                same time.
              </Body>
              <Button href={routes.portalBookNew} variant="primary" className="mt-4">
                Book a session
              </Button>
            </>
          )}

          {/* §10's second placement. Suggestive, and attached to a specific
              booking rather than to the member — "never repeated for the same
              booking" is a property of the prompt, so it names the session. */}
          {toHost && (
            <div className="mt-6 border-t border-[var(--rule)]/30 pt-3">
              <H3>Bringing anyone on {formatWeekdayDate(toHost.slotStart)}?</H3>
              <Body muted className="mt-1">
                You have {armory.allowance.remaining}{" "}
                {armory.allowance.remaining === 1 ? "guest visit" : "guest visits"}{" "}
                included. Add them now and they get their own link.
              </Body>
              <QuietAction href={routes.portalBook}>Add a guest</QuietAction>
            </div>
          )}
        </Panel>

        {/* ============================================================ 3 of 5
            TONIGHT AT THE CLUB — §6.4: this card has NO empty state. Where
            nothing is on tonight it shows the week ahead, because a blank Today
            teaches the member not to open the application. */}
        <Panel>
          <Kicker className="mb-2">At the club</Kicker>

          {/*
            The rail comes FIRST, above whatever the card has to say about
            tonight. §6.4's requirement is that a member with nothing booked
            still sees the club's week, and the sentence below answers that in
            prose — which a member reads, and cannot scan. Seven marked cells
            answer "is Saturday worth coming to" without reading, and each is a
            way into the Diary on that day.

            It does not select. Today has exactly one day in it, and a rail that
            changed the card beneath it would be a small Diary embedded in
            Today — the surface §7.1 spends a paragraph keeping separate.
          */}
          <WeekRail days={rail} className="mb-4" />

          <TonightOrTheWeek today={today} week={week} />
        </Panel>

        {/* ============================================================ 4 of 5
            COMPETITION. §15 holds LIVE standings for Phase 1.5 — this is the
            commitment rather than the scoreboard, which is the right half to
            ship first: "the engine is not the leaderboard, it is social
            obligation. People return because they told a friend they would be
            there." */}
        {record.leagues.length > 0 && (
          <Panel>
            <Kicker className="mb-2">Your leagues</Kicker>
            <ul className="flex flex-col gap-3">
              {record.leagues.map((league) => (
                <li
                  key={league.id}
                  className="border-t border-[var(--rule)]/30 pt-3 first:border-t-0 first:pt-0"
                >
                  <H3>
                    <Link
                      href={routes.league(league.id)}
                      className="no-underline hover:underline"
                    >
                      {league.name}
                    </Link>
                  </H3>
                  <Body muted className="mt-1">
                    {league.nextFixtureLabel
                      ? `${league.nextFixtureLabel} — still to shoot. Most play ${league.anchorWeekdayName}.`
                      : `Season complete — all ${league.seasonWeeks} weeks are in.`}
                  </Body>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* ============================================================ 5 of 5
            LAST ROUND. */}
        {lastRound && (
          <Panel>
            <Kicker className="mb-2">Your last round</Kicker>
            <ScoreLine
              score={{
                reads: lastRound.reads,
                discipline: lastRound.discipline,
                formatLabel: lastRound.formatLabel,
                capturedAt: lastRound.capturedAt,
                relation: bestForFormat?.trend ?? null,
                isPersonalBest: bestForFormat?.reads === lastRound.reads,
                superseded: lastRound.superseded,
              }}
            />
            <QuietAction href={routes.portalShooting}>
              Your whole record
            </QuietAction>
          </Panel>
        )}
      </div>
    </Section>
  );
}

/* ============================================================================
   THE NEXT-BOOKING CARD
   ========================================================================= */

function NextBooking({ booking, now }: { booking: MemberBooking; now: Date }) {
  const amendable = booking.slotStart > now;

  /* §14: "Guest link abandonment — a guest half-completes their link. Nobody
     notices until arrival. Flagged to the HOST, never to the guest." */
  const waiting = booking.companions.filter(
    (companion) =>
      companion.isGuest &&
      companion.invitationStatus !== "completed" &&
      companion.invitationStatus !== "attended",
  );

  return (
    <>
      <H2>
        {isSameLagosDay(booking.slotStart, now)
          ? "Today"
          : formatWeekdayDate(booking.slotStart)}
        , {formatTime(booking.slotStart)}
      </H2>

      <Body muted className="mt-1">
        {/*
          How far off it is, before what it is for. A date is a fact a member
          has to do arithmetic on; "in three days" is the answer they were
          going to work out anyway, and it is the half of this card that decides
          whether they read the rest of it now or later.
        */}
        {countdownLine(booking.slotStart, now)} · {purposeLine(booking)}
      </Body>

      {booking.companions.length > 0 && (
        <Body className="mt-2">
          {/* Named, never counted — §10. */}
          With {listNames(booking.companions.map((companion) => companion.name))}.
        </Body>
      )}

      {waiting.length > 0 && (
        <div className="mt-3">
          <StatusPill status="attention" />
          <Body muted className="mt-1">
            {waiting.length === 1
              ? `${waiting[0].name} has not finished their guest form yet.`
              : `${waiting.length} of your guests have not finished their forms yet.`}{" "}
            They will be held at the desk until they do.
          </Body>
        </div>
      )}

      {amendable && (
        <div className="mt-4 flex flex-wrap gap-2">
          {/* The booking it is talking about, not the club's week. This button
              linked to the Diary — a calendar with none of the member's own
              bookings on it and nothing to cancel — which is a label promising
              a surface that did not exist. */}
          <Button href={routes.portalBooking(booking.id)} variant="secondary">
            Change or cancel
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * How far off a booking is, in whole days.
 *
 * ===========================================================================
 * DAYS, AND NEVER HOURS OR MINUTES
 *
 * "In 4 hours" is the obvious next increment and it is the one that cannot be
 * shipped. This page is `force-dynamic` but the shell around it is a PWA that
 * serves a cached screen when the phone is offline (§8.1), and an hours
 * countdown rendered on the server is wrong by however long the screen has been
 * cached — a member reading "in 2 hours" off a screen cached this morning has
 * been told something false about the one thing on this card that matters.
 *
 * A day boundary is coarse enough to survive that: a screen cached inside the
 * same Lagos day still says "today", which is the claim it was making when it
 * was rendered. Anything finer would need a live clock in the client, which is
 * a component, a bundle and a hydration boundary bought for a phrase.
 */
function countdownLine(slotStart: Date, now: Date): string {
  const days = lagosDaysBetween(now, slotStart);

  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 14) return "Next week";
  return `In ${Math.floor(days / 7)} weeks`;
}

/** What the booking is for, in the member's words rather than the schema's. */
function purposeLine(booking: MemberBooking): string {
  switch (booking.bookingType) {
    case "shoot":
      return booking.discipline ?? "On the range";
    case "both":
      return `${booking.discipline ?? "On the range"} · and a table`;
    case "table":
      return "A table";
    case "spectate":
      return "Watching";
  }
}

/** Ada · Ada and Tunde · Ada, Tunde and Bisi. */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ============================================================================
   TONIGHT, OR THE WEEK — §6.4
   ========================================================================= */

function TonightOrTheWeek({
  today,
  week,
}: {
  today: ProgrammeDay | undefined;
  week: readonly ProgrammeDay[];
}) {
  if (today && today.entries.length > 0) {
    return (
      <>
        <H2>{today.closed ? "Closed today." : "Today."}</H2>
        <ul className="mt-4 flex flex-col gap-3">
          {today.entries.map((entry, index) => (
            <li key={`${entry.title}-${index}`}>
              <ProgrammeLine entry={entry} />
            </li>
          ))}
        </ul>
        <QuietAction href={routes.portalBook}>
            The club&rsquo;s diary
          </QuietAction>
      </>
    );
  }

  /* Nothing on today. §6.4 forbids an empty state here, so the card shows the
     next days that DO have something — and only falls through to the honest
     sentence when the club has published nothing at all. */
  const ahead = week.filter((day) => day.entries.length > 0).slice(0, 3);

  if (ahead.length === 0) {
    /**
     * P2. The club has published no opening hours and no events, so this is
     * what the screen says — one sentence, and no interface pretending there is
     * something to look at.
     *
     * It is written as a fact about the club rather than an apology, and it
     * does not suggest the member try again later: they cannot make it true.
     */
    return (
      <>
        <H2>The club has not published its week yet.</H2>
        <Body muted className="mt-2 max-w-[68ch]">
          Opening hours and what is on will appear here as soon as they are set.
        </Body>
      </>
    );
  }

  return (
    <>
      <H2>Nothing on today. This week:</H2>
      <ul className="mt-4 flex flex-col gap-4">
        {ahead.map((day) => (
          <li key={day.dateKey} className="border-t border-[var(--rule)]/30 pt-3">
            <H3>{formatWeekdayDate(day.date)}</H3>
            <ul className="mt-2 flex flex-col gap-2">
              {day.entries.map((entry, index) => (
                <li key={`${entry.title}-${index}`}>
                  <ProgrammeLine entry={entry} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <QuietAction href={routes.portalBook}>
            The club&rsquo;s diary
          </QuietAction>
    </>
  );
}

/* ============================================================================
   THE PERSON WHO IS NOT A MEMBER
   ========================================================================= */

function NotYetAMember({ state }: { state: "signed_out" | "not_linked" | "no_membership" }) {
  return (
    <Section ground="chalk" rhythm="default">
      <Kicker className="mb-2">Your club</Kicker>
      {state === "no_membership" ? (
        <>
          <H2>The club knows you.</H2>
          <Body muted className="mt-2 max-w-[68ch]">
            You have a record with us, and any rounds you have shot here are
            already against your name. Membership is what turns that into a
            standing, a diary and guests of your own.
          </Body>
          <Body muted className="mt-2 max-w-[68ch]">
            <Caption>
              Your visits so far are on file, whoever brought you.
            </Caption>
          </Body>
        </>
      ) : (
        <>
          <H2>You are signed in.</H2>
          <Body muted className="mt-2 max-w-[68ch]">
            Your leagues and your scores are here. Booking, guests and the
            club&rsquo;s diary come with membership.
          </Body>
        </>
      )}
      <Button href={routes.membership} variant="primary" className="mt-4">
        What membership includes
      </Button>
    </Section>
  );
}
