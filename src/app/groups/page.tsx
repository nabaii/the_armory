import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { GroupEnquiryForm } from "@/components/sections/GroupEnquiryForm";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { ImageGrid } from "@/components/media/ImageSlot";

/* ============================================================================
   GROUPS, CORPORATE & EVENTS — spec §3.

   Purpose: "Capture a revenue line the facility clearly supports and a
   range-only site would have no home for."

   The spectating point is the commercial argument on this page. Because the bar
   and rail overlook the firing line, a group does not need everyone to shoot —
   which, per the Brief, "roughly doubles the addressable party size". For a
   corporate away-day that is the difference between a viable booking and a
   logistical problem.

   Register: Soffit Blue. Open, welcoming, non-member context.

   ----------------------------------------------------------------------------
   SECURITY — spec §3 attaches a hard constraint specifically to this page:

     "No imagery or copy revealing facility layout, entry and exit points,
      storage or armoury arrangements, or security staffing. Photography must be
      art-directed to exclude these. This is a hard constraint, not a
      preference."

   It applies with extra force here because group enquiries invite questions
   about capacity, access and logistics. None of that is answered on the page —
   it is answered by a person, after an enquiry.

   Success measure: enquiry volume and average party size.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Groups, corporate & events",
  description:
    "Group visits, corporate away-days and private deck hire at The Armory Shooting Sports Club. Not everyone has to shoot — the bar and rail overlook the firing line.",
};

export default function GroupsPage() {
  return (
    <>
      <PageHeader
        ground="soffit"
        kicker="Groups, corporate & events"
        title="Not everyone has to shoot."
        lead="The bar seating and the viewing rail look onto the firing line, and the decks seat people who would rather be outside. A group can split itself however it likes."
      />

      {/* What a group visit includes. Ranges + deck + catering, per spec. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">What a group visit includes</Kicker>
        <H2>Range, deck, and something to eat.</H2>
        <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
          <div>
            <H3>Time on the ranges</H3>
            <Body muted className="mt-1">
              Supervised sessions with everything provided. Beginners are the
              norm rather than the exception, and a range officer stays with each
              group throughout.
            </Body>
          </div>
          <div>
            <H3>Somewhere to sit</H3>
            <Body muted className="mt-1">
              Bar seating indoors overlooking the air rifle line, or the public
              deck outside. People rotate between shooting and sitting rather
              than queueing.
            </Body>
          </div>
          <div>
            <H3>Food and drink</H3>
            <Body muted className="mt-1">
              Served from the snack bar, indoors or on the deck. The offer is
              confirmed when you enquire.
            </Body>
          </div>
        </div>
      </Section>

      {/* The spectating point, made explicitly commercial. */}
      <Section ground="soffit" rhythm="default">
        <StatementBlock
          kicker="Party size"
          statement="Half your group can watch, and still have a good evening."
          support="That is unusual for a shooting range and it is the reason group bookings work here. Non-shooters are accommodated by the building itself, not by being found something to do."
        />
      </Section>

      {/* Formats. Deliberately no prices, no packages, no capacities — none of
          that is settled content, and an invented package is a claim. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Formats</Kicker>
        <H2>What people book us for.</H2>
        <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
          <div>
            <H3>Corporate away-days</H3>
            <Body muted className="mt-1">
              A structured afternoon or evening. Something colleagues can do
              together without needing to be good at it.
            </Body>
          </div>
          <div>
            <H3>Celebrations</H3>
            <Body muted className="mt-1">
              Birthdays and private occasions, on a deck, after dark.
            </Body>
          </div>
          <div>
            <H3>Private deck hire</H3>
            <Body muted className="mt-1">
              The public deck can be taken privately. Availability and terms are
              confirmed on enquiry.
            </Body>
          </div>
        </div>

        <ImageGrid
          className="mt-8"
          columns={3}
          items={[
            {
              awaiting: "Public deck — light columns, glowing deck edge, occupied tables (night)",
              caption: "The public deck, lit after dark.",
            },
            {
              awaiting: "Snack bar interior — seating, blue soffit, lit shelving (both registers)",
              caption: "Indoor seating beside the air rifle line.",
            },
            {
              awaiting: "Air rifle bar seating — the viewing rail and stools (both registers)",
              caption: "The viewing rail.",
            },
          ]}
        />
      </Section>

      {/* Enquiry, routed to bookings rather than the membership pipeline. */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">Enquire</Kicker>
        <H2>Tell us roughly what you have in mind.</H2>
        <Body muted className="mt-2">
          Dates, numbers and the kind of evening. Our bookings team will come
          back to you with what is possible and what it costs.
        </Body>
        <GroupEnquiryForm className="mt-6 max-w-[46rem]" />
        <Caption className="mt-3">
          Capacities and catering are confirmed on enquiry rather than published,
          because both depend on the date and the shape of your group.
        </Caption>
      </Section>
    </>
  );
}
