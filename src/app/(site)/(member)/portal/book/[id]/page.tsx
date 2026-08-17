import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { isAmendable, memberBookingById } from "@/server/armory/member-bookings";
import { Section } from "@/components/layout/Section";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/layout/PageHeader";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/member/StatusPill";
import { QuietAction } from "@/components/member/QuietAction";
import { CancelBookingForm } from "@/components/member/CancelBookingForm";
import { formatTime, formatWeekdayDate, isSameLagosDay } from "@/lib/time";
import { routes } from "@/lib/site";

/**
 * ONE BOOKING — Members Portal §6.1.
 *
 *   "Next booking | Date, time, discipline, lane, companions. Inline: add a
 *    guest, change, cancel."
 *
 * ===========================================================================
 * WHY THIS SCREEN DID NOT EXIST, AND WHAT WAS THERE INSTEAD
 *
 * Today rendered a button reading "Change or cancel" that linked to the Diary.
 * The Diary is the club's week — a calendar of what is on and what is free,
 * with none of the member's own bookings on it to act upon. A member tapped a
 * button naming two things they wanted to do and arrived somewhere that did
 * neither, with nothing on screen to explain it.
 *
 * That is the same class of defect as the waiver remedy pointing at a portal
 * page nobody had built: a promise made by a label, with no surface behind it.
 * This is the surface.
 *
 * ===========================================================================
 * CANCEL IS HERE. CHANGE IS NOT, AND THAT IS NOT AN OVERSIGHT
 *
 * Cancelling is a solved problem: `applyBookingEvent` has released allowance,
 * lane capacity and the attached invitations since M11, and it is careful to
 * succeed even on a full slot.
 *
 * Changing is not the same size of question. It means releasing one slot and
 * taking another atomically, and then answering something nobody at the club
 * has answered: what happens to the guests. A guest holds a link to a session
 * on a particular evening; moving the booking either drags them to an evening
 * they never agreed to, or strands them on one that no longer exists. Both are
 * decisions about hospitality, not about code.
 *
 * So the honest screen offers cancel, and says what "change" means in the
 * meantime — cancel and book again — rather than shipping a Change button that
 * guesses. When the club settles the guest question it lands here.
 *
 * ===========================================================================
 * OWNERSHIP IS THE READ, NOT A CHECK
 *
 * `memberBookingById` scopes the query to the caller's membership, so another
 * member's booking is not something this page has to remember to refuse — it
 * comes back null and the route 404s, which is also the answer a made-up id
 * gets. That is deliberate: distinguishing "not yours" from "no such booking"
 * would confirm to somebody probing ids that a booking exists.
 */

export const metadata: Metadata = { title: "Your booking" };

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return (
      <Section>
        <PageHeader title="Your booking" />
        <Body>Sign in to see your bookings.</Body>
      </Section>
    );
  }

  if (!isArmoryDatabaseConfigured()) {
    return (
      <Section>
        <PageHeader title="Your booking" />
        <Body>The club&rsquo;s system is not reachable just now.</Body>
      </Section>
    );
  }

  const now = new Date();
  const booking = await memberBookingById(getArmoryDb(), {
    bookingId: id,
    membershipId: resolution.member.membershipId,
    personId: resolution.member.personId,
  });

  if (!booking) notFound();

  const cancelled = booking.status === "cancelled";
  const amendable = !cancelled && isAmendable(booking, now);
  const waiting = booking.companions.filter(
    (companion) =>
      companion.isGuest &&
      companion.invitationStatus !== "completed" &&
      companion.invitationStatus !== "attended",
  );

  return (
    <Section ground="terrazzo" rhythm="tight" field>
      <Panel ticks className="flex flex-col gap-3">
        <Kicker>Your booking</Kicker>

        <div>
          <H2>
            {isSameLagosDay(booking.slotStart, now)
              ? "Today"
              : formatWeekdayDate(booking.slotStart)}
            , {formatTime(booking.slotStart)}
          </H2>
          <Body muted className="mt-1">
            {purposeLine(booking)} · until {formatTime(booking.slotEnd)}
          </Body>
        </div>

        {cancelled && (
          <div>
            <StatusPill status="blocked" label="Cancelled" />
            <Body muted className="mt-1 max-w-[68ch]">
              This booking was cancelled. The lane went back to the club — book
              again from the Diary when you know which evening suits.
            </Body>
          </div>
        )}

        {booking.companions.length > 0 && (
          <div>
            <H3>Coming with you</H3>
            <ul className="mt-1 flex flex-col gap-1">
              {booking.companions.map((companion) => (
                <li key={companion.personId}>
                  {/* Named, never counted — §10. */}
                  <Body>
                    {companion.name}
                    {companion.isGuest && (
                      <Caption as="span"> · guest</Caption>
                    )}
                  </Body>
                </li>
              ))}
            </ul>

            {!cancelled && waiting.length > 0 && (
              <div className="mt-2">
                <StatusPill status="attention" />
                <Body muted className="mt-1 max-w-[68ch]">
                  {waiting.length === 1
                    ? `${waiting[0].name} has not finished their guest form yet.`
                    : `${waiting.length} of your guests have not finished their forms yet.`}{" "}
                  They will be held at the desk until they do.
                </Body>
              </div>
            )}
          </div>
        )}

        {amendable && (
          <>
            {/**
             * What "change" means today, said plainly rather than offered as a
             * button that does not exist. See the header on why the reschedule
             * is a hospitality decision before it is a feature.
             */}
            <div className="border-t border-[var(--rule)]/30 pt-3">
              <H3>Moving it</H3>
              <Body muted className="mt-1 max-w-[68ch]">
                There is no way to move a booking yet. Cancel this one and book
                the evening you want — the lane comes back to the club the
                moment you do, so take the new one first if the week is busy.
              </Body>
              <QuietAction href={routes.portalBook}>
                Find another evening
              </QuietAction>
            </div>

            <CancelBookingForm
              bookingId={booking.id}
              companionNames={booking.companions.map((c) => c.name)}
            />
          </>
        )}

        {!cancelled && !amendable && (
          <div className="border-t border-[var(--rule)]/30 pt-3">
            <Body muted className="max-w-[68ch]">
              This session has already started, so it is no longer yours to
              change. Speak to the club and they will sort it out at the desk.
            </Body>
          </div>
        )}
      </Panel>

      <div className="mt-3">
        <Button href={routes.portal} variant="secondary">
          Back to today
        </Button>
      </div>
    </Section>
  );
}

/** What the booking is for, in the member's words rather than the schema's. */
function purposeLine(booking: {
  bookingType: string;
  discipline: string | null;
}): string {
  switch (booking.bookingType) {
    case "shoot":
      return booking.discipline ?? "On the range";
    case "both":
      return `${booking.discipline ?? "On the range"} · and a table`;
    case "table":
      return "A table";
    case "spectate":
      return "Watching";
    default:
      return booking.discipline ?? "At the club";
  }
}
