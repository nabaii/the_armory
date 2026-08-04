import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StepSequence } from "@/components/sections/StepSequence";
import { Body } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { CallUs } from "@/components/ui/CallUs";
import { contact, routes } from "@/lib/site";

/* ============================================================================
   FLOW A STEP 3 — the on-screen confirmation.

   Spec: "Immediate on-screen confirmation stating what happens next and within
   what timeframe." The Brief on why this page carries weight rather than being
   a courtesy: "'We will email you back' loses half of them in the gap."

   So it does three things and nothing else: confirms the application landed with
   a person, states the timeframe, and offers the first visit as the immediate
   next step — because "the visit is the sales meeting".

   noindex: a confirmation page in search results is meaningless to a stranger,
   and it also stops the URL being shared as though it were an application form.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Application received",
  robots: { index: false, follow: false },
};

export default function MembershipReceivedPage() {
  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Application received"
        title="Thank you — it is with a person, not an inbox."
        lead="We will be in touch to arrange a tour or a first visit. That conversation is where we talk through the tiers and what each one includes."
      />

      <Section ground="chalk" rhythm="default">
        <StepSequence
          steps={[
            {
              title: "A confirmation is on its way",
              body:
                "Check your email in the next few minutes. If it has not arrived, look in your spam folder and then call us.",
            },
            {
              title: "We contact you within two working days",
              body:
                "A named member of the club, by phone or email, to arrange a time for you to see the place.",
            },
            {
              title: "You visit before anything is decided",
              body:
                "A tour, or a first visit on the range. Nobody is asked to commit to a membership they have not seen.",
            },
          ]}
        />
      </Section>

      <Section ground="terrazzo" rhythm="default">
        <Body>
          You do not have to wait for us to book a first visit. Many members
          started with one, and it is the quickest way to see whether this is for
          you.
        </Body>
        <Button href={routes.firstVisit} variant="primary" className="mt-3">
          Book a first visit
        </Button>
        <CallUs
          className="mt-3"
          value={contact.phone}
          prompt="Something not right, or you applied by mistake?"
          label="Public enquiries phone (Founder)"
        />
      </Section>
    </>
  );
}
