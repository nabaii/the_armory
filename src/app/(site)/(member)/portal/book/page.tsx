import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import {
  UNCONFIGURED_AVAILABILITY,
  availableSlots,
  emptyReason,
} from "@/domain/availability";
import { bookedSlotsFrom } from "@/server/armory/bookings";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { formatTime, formatWeekdayDate } from "@/lib/time";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, H2 } from "@/components/ui/Text";
import {
  BookSessionForm,
  InviteGuestForm,
  type SlotOption,
} from "@/components/member/HostingForms";

/**
 * BOOK A SESSION, AND INVITE A GUEST — §6.2.
 *
 *   "Availability computed from lanes, hours, officer coverage and existing
 *    bookings — never a manually maintained calendar. Naming a guest calls
 *    MAY_HOST before the booking can be confirmed. ALLOWANCE SHOWN BEFORE AND
 *    AFTER."
 *
 * The two screens live on one page because they are one intention. §6.2 lists
 * them separately and a member does not experience them separately: they are
 * booking a lane in order to bring someone. Splitting them across a navigation
 * would put the allowance — the thing §12 insists must never be a surprise — on
 * a screen the member has to go and find.
 *
 * ===========================================================================
 * EVERY DECISION ON THIS PAGE IS MADE SOMEWHERE ELSE
 *
 *   which slots exist        src/domain/availability.ts (pure)
 *   whether they may book    §4 MAY_BOOK, in the capability service
 *   whether they may host    §4 MAY_HOST, same service, called in the action
 *   what the allowance is    src/server/armory/member-session.ts
 *
 * §4 requires it: "No screen makes its own permission decision." There is no
 * condition on this page that decides anything about a member.
 */

export const metadata: Metadata = { title: "Book a session" };

export const dynamic = "force-dynamic";

/** How far ahead the page projects. A tier's horizon narrows it in MAY_BOOK. */
const WINDOW_DAYS = 14;

export default async function BookPage() {
  const resolution = await resolveArmoryMember();

  if (resolution.state === "signed_out") {
    return (
      <Section>
        <PageHeader title="Book a session" />
        <Body>Sign in to book.</Body>
      </Section>
    );
  }

  if (resolution.state !== "member") {
    /* §3.1: applicant, guest and member are states of a person. Somebody here
       without a membership is very likely a former guest — §3.2's acquisition
       funnel — and the honest screen invites them rather than showing an empty
       calendar they cannot use. */
    return (
      <Section>
        <PageHeader title="Book a session" />
        <Body>
          Booking is for members. If you have shot here as a guest, a member can
          put you forward — or the club can take an application directly.
        </Body>
      </Section>
    );
  }

  const member = resolution.member;

  if (!isArmoryDatabaseConfigured()) {
    return (
      <Section>
        <PageHeader title="Book a session" />
        <Body>The club&rsquo;s system is not reachable just now.</Body>
      </Section>
    );
  }

  const db = getArmoryDb();
  const now = new Date();

  /* §14 has not landed: "lanes per discipline, session length, opening hours".
     `UNCONFIGURED_AVAILABILITY` publishes no hours, so this renders the sentence
     from `emptyReason` rather than a plausible-looking week nobody chose. */
  const policy = UNCONFIGURED_AVAILABILITY;

  /* Only disciplines this member's tier covers. §4 would refuse the others at
     MAY_BOOK anyway, and offering a slot the club will then refuse is exactly
     the discovery §4.3 exists to prevent — one screen earlier than the desk. */
  const disciplines = member.tier.disciplineAccess;

  const boards = await Promise.all(
    disciplines.map(async (discipline) => {
      const lanes = await db
        .select({
          id: schema.lanes.id,
          discipline: schema.lanes.discipline,
          status: schema.lanes.status,
          positionCapacity: schema.lanes.positionCapacity,
        })
        .from(schema.lanes)
        .where(eq(schema.lanes.discipline, discipline));

      const booked = await bookedSlotsFrom(db, { from: now, discipline });

      const slots = availableSlots({
        policy,
        lanes,
        booked,
        discipline,
        now,
        days: WINDOW_DAYS,
      });

      return {
        discipline,
        reason: slots.length === 0 ? emptyReason(policy, lanes, discipline) : null,
        options: slots.map(
          (slot): SlotOption => ({
            id: slot.id,
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            label: `${formatWeekdayDate(slot.start)} · ${formatTime(slot.start)}`,
            free: slot.free,
            capacity: slot.capacity,
          }),
        ),
      };
    }),
  );

  return (
    <Section>
      <PageHeader
        title="Book a session"
        lead={`Member No. ${member.memberNumber} · ${member.tier.name}`}
      />

      {boards.map((board) => (
        <div key={board.discipline} className="mt-8">
          <H2>{board.discipline}</H2>

          {board.reason ? (
            /* §4.3's rule applied to an empty list: never a blank screen, and
               never a stack of conditions. One sentence the member can act on. */
            <Body muted>{board.reason}</Body>
          ) : (
            <BookSessionForm
              discipline={board.discipline}
              slots={board.options}
            />
          )}
        </div>
      ))}

      {disciplines.length === 0 && (
        <Body muted>
          Your tier does not cover any of the club&rsquo;s disciplines yet. Speak
          to the club about an upgrade.
        </Body>
      )}

      {/* §6.2's "Invite a guest", and §6.2's "allowance shown before and after"
          — the form states the remaining count before, and the action returns
          the new one after. */}
      {member.tier.canHost && (
        <div className="mt-12 border-t border-[var(--rule)] pt-8">
          <H2>Invite a guest</H2>
          <InviteGuestForm
            bookingId={null}
            remaining={member.allowance.remaining}
            includedQuota={member.allowance.includedQuota}
          />
        </div>
      )}

      {!member.tier.canHost && (
        <Caption className="mt-12 block">
          Your tier does not include guest visits.
        </Caption>
      )}
    </Section>
  );
}
