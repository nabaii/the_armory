import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { TierComparison } from "@/components/sections/TierComparison";
import { ApplicationForm } from "@/components/sections/ApplicationForm";
import { StepSequence } from "@/components/sections/StepSequence";
import { Body, Caption, H2, Kicker } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";
import { ImageSlot } from "@/components/media/ImageSlot";
import { tiers } from "@/content/tiers";
import { contact } from "@/lib/site";

/* ============================================================================
   MEMBERSHIP — spec §3.

   Purpose: "Convert interest into an application, and make membership read as
   access to a room rather than a subscription to a facility."

   The governing constraint (§9 acceptance criterion): no membership price is
   published anywhere on the public site. Prices are shared on application, and
   the application is the conversion event — not a checkout.

   Access register: VIP Teal. Membership is the member context, and the
   guidelines ask that teal "feel earned".

   Success measure: application completion rate; drop-off point within the form.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Membership",
  description:
    "Membership of The Armory Shooting Sports Club — the club ladder, priority booking, the VIP deck, and first access to Leagues. Prices are shared on application.",
};

export default function MembershipPage() {
  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Membership"
        title="Anyone can play. Members are the club."
        lead="Membership is not a subscription to a facility. It is access to a room, a standing in it, and the people who are in it with you."
      />

      {/* -------------------------------------------- 1. WHAT MEMBERSHIP IS */}
      <Section ground="chalk" rhythm="default">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-center lg:gap-8">
          <div>
            <Kicker className="mb-2">Belonging</Kicker>
            <H2>A standing, not a subscription.</H2>
            <Body muted className="mt-2">
              Members hold a place on the season-long club ladder, get priority
              on booking, and are the only people who can create and captain a
              league. The top tier carries the VIP deck.
            </Body>
            <Body muted className="mt-2">
              Non-members are welcome — they pay per visit and can play in
              leagues. What they cannot do is captain one, appear on the ladder,
              or stand for the club at a season event.
            </Body>
          </div>
          <ImageSlot
            awaiting="VIP deck — lounge seating, canopies, teal furniture (night register)"
            aspect="landscape"
            layout="half"
          />
        </div>
      </Section>

      {/* --------------------------------------------------- 2. TIERS, GATED */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">The tiers</Kicker>
        <H2>Three ways in.</H2>
        <Body muted className="mt-2">
          Prices are shared on application. That is not evasion — the right tier
          depends on how often you intend to shoot and whether you want the
          club or the range, and that is a conversation rather than a checkout.
        </Body>
        <TierComparison tiers={tiers} className="mt-6" />
      </Section>

      {/* ----------------------------------------------- 3. FOUNDING COHORT */}
      <Section ground="teal" rhythm="default">
        <StatementBlock
          kicker="The founding cohort"
          statement="Closed permanently at launch."
          support="Founding members are recognised permanently and visibly, and the designation cannot be granted again once the cohort closes."
        />
        {/* The cap is an open decision in the Brief, which warns that "a soft
            cap you quietly exceed becomes a lie your best members eventually
            notice". So it is absent rather than approximated. */}
        <div className="mt-4">
          <Pending label="Founding-member cap — is there a hard cap, and is it real? (Founder). Decides this page's central claim." />
        </div>
      </Section>

      {/* ------------------------------------------------- 4. THE APPLICATION */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Apply</Kicker>
        <H2 id="application-heading">Start an application.</H2>
        <Body muted className="mt-2">
          Short, and it goes to a person rather than an inbox. We will come back
          to you to arrange a tour or a first visit — that conversation is where
          tiers and prices are discussed.
        </Body>
        <ApplicationForm tiers={tiers} className="mt-6 max-w-[46rem]" />
      </Section>

      {/* ------------------------------------------------ 5. WHAT HAPPENS NEXT
          Spec: "Explicit three-step description of the process so the applicant
          is not left guessing." The Brief on why: "'We will email you back'
          loses half of them in the gap." */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">What happens next</Kicker>
        <H2>No guessing.</H2>
        <StepSequence
          className="mt-4"
          steps={[
            {
              title: "You get a confirmation immediately",
              body:
                "On screen, and by email, with the name of the person handling your application.",
            },
            {
              title: "We arrange a visit",
              body:
                "A tour, or a first visit on the range. You see the club before anyone discusses membership with you properly.",
            },
            {
              title: "We talk, in person",
              body:
                "Tiers, what is included, and cost. Applications are not accepted or declined by email.",
            },
          ]}
        />
        {contact.membershipOwner === null && (
          <div className="mt-4">
            <Pending label="Named owner of the membership pipeline (Founder) — Flow A cannot complete without a person" />
            <Caption className="mt-2">
              This page promises a named person. Until there is one, that promise
              is not true — which is why it is a launch blocker rather than a
              nice-to-have.
            </Caption>
          </div>
        )}
      </Section>
    </>
  );
}
