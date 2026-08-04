import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { CallUs } from "@/components/ui/CallUs";
import { contact, routes } from "@/lib/site";

export const metadata: Metadata = {
  title: "Enquiry received",
  robots: { index: false, follow: false },
};

/**
 * Group enquiry confirmation.
 *
 * Deliberately states that this went to BOOKINGS rather than to membership.
 * Spec §3 separates the two pipelines, and the visitor should be able to tell
 * they reached the right one — otherwise a corporate organiser who hears nothing
 * for a day cannot tell whether they enquired in the wrong place.
 */
export default function GroupsReceivedPage() {
  return (
    <>
      <PageHeader
        ground="soffit"
        kicker="Enquiry received"
        title="Thank you — this is with our bookings team."
        lead="They will come back to you with what is possible on your dates, what it costs, and how we would shape the evening."
      />

      <Section ground="chalk" rhythm="default">
        <Body muted>
          Group enquiries are answered by a person rather than an automated quote,
          because the right shape depends on your numbers, your date, and how many
          of your party actually want to shoot. Not everyone has to.
        </Body>
        <CallUs
          className="mt-3"
          value={contact.bookingsPhone}
          prompt="If your plans are firm and time is short, calling is faster."
          label="Bookings phone number (Founder)"
        />
        <Button href={routes.theClub} variant="secondary" className="mt-4">
          See the bar and the decks
        </Button>
      </Section>
    </>
  );
}
