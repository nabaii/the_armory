import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { ApplicationForm } from "@/components/sections/ApplicationForm";
import { GroupEnquiryForm } from "@/components/sections/GroupEnquiryForm";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Pending, Resolved } from "@/components/ui/Pending";
import { SegmentedRule } from "@/components/ui/Text";
import { contact, site } from "@/lib/site";
import { tiers } from "@/content/tiers";

/* ============================================================================
   ENQUIRE — spec §3.

   Purpose: "Route three different enquiry types to the right destination
   without collapsing them into one generic form."

   The three routes are genuinely different motions, and merging them is the
   obvious mistake this page exists to avoid:

   1. MEMBERSHIP — consultative. Goes to the membership pipeline and a named
      person. It is an application, not a purchase.

   2. GROUPS, CORPORATE AND EVENTS — transactional. Goes to bookings. Different
      people, different response time, different conversation.

   3. INSTITUTIONAL AND PROFESSIONAL TRAINING — no form at all.

   ----------------------------------------------------------------------------
   WHY THE THIRD ROUTE HAS NO FORM

   Spec §3: "Institutional and professional training — a named contact and a
   direct telephone number. No form. This audience does not fill in web forms."

   Flow C in §4 adds: "Deliberately minimal... no form, no automation, no public
   pricing. An unlisted capability page may be sent after an initial
   conversation. This audience is won in person."

   So a form here would not merely be redundant, it would be counterproductive —
   it signals that the club treats private security and close-protection
   enquiries as web leads. The unlisted capability page is never linked from
   navigation or from here; it is sent after a meeting.

   Success measure: enquiry volume by type; response time.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Enquire",
  description:
    "Enquire about membership, group and corporate bookings, or professional training at The Armory Shooting Sports Club, Abuja National Stadium.",
};

export default function EnquirePage() {
  return (
    <>
      <PageHeader
        kicker="Enquire"
        title="Three different conversations."
        lead="Membership, a group booking, or professional training. They go to different people, so it is worth picking the right one."
      />

      {/* ------------------------------------------------------ 1. MEMBERSHIP */}
      <Section ground="teal" rhythm="default" id="membership">
        <Kicker className="mb-2" muted={false}>
          01 — Membership
        </Kicker>
        <H2 id="application-heading">Apply for membership</H2>
        <Body className="mt-2">
          This goes to the person who handles membership, not to a general inbox.
          We will come back to you to arrange a tour or a first visit, and tiers
          and prices are discussed then.
        </Body>
        <ApplicationForm tiers={tiers} className="mt-6 max-w-[46rem]" />
      </Section>

      {/* ------------------------------------------ 2. GROUPS AND CORPORATE */}
      <Section ground="soffit" rhythm="default" id="groups">
        <Kicker className="mb-2" muted={false}>
          02 — Groups, corporate & events
        </Kicker>
        <H2>Book for a group</H2>
        <Body className="mt-2">
          Away-days, celebrations and private deck hire. This goes to our
          bookings team.
        </Body>
        <GroupEnquiryForm className="mt-6 max-w-[46rem]" />
      </Section>

      {/* ------------------------------- 3. INSTITUTIONAL — NAMED CONTACT ONLY
          No form. No public pricing. Do not add either. */}
      <Section ground="charred" rhythm="default" id="institutional">
        <Kicker className="mb-2" muted={false}>
          03 — Institutional & professional training
        </Kicker>
        <H2>Speak to someone directly</H2>
        {/* The instruction and the contact are rendered together or not at all.
            `Pending` is silent in production, so "call the number below"
            followed by nothing would be an instruction the page cannot help
            anyone follow — true by omission is still untrue (§9). Caught by the
            unfulfillable-prompt rule in scripts/audit.ts. */}
        {contact.institutional ? (
          <>
            <Body muted className="mt-2">
              For private security, close-protection and mission training
              requirements, we would rather have a conversation than an enquiry
              form. Call the number below and ask for the name listed.
            </Body>
            <p className="mt-4 font-display text-h3 font-bold text-[var(--ink)]">
              {contact.institutional.name}
              {" — "}
              <a
                href={`tel:${contact.institutional.phone.replace(/\s/g, "")}`}
                className="underline decoration-1 underline-offset-2"
              >
                {contact.institutional.phone}
              </a>
            </p>
          </>
        ) : (
          <>
            <Body muted className="mt-2">
              For private security, close-protection and mission training
              requirements, we would rather have a conversation than an enquiry
              form.
            </Body>
            <div className="mt-4">
              <Pending label="Institutional contact: named person and direct number (Founder)" />
            </div>
          </>
        )}

        <Caption className="mt-3 max-w-[68ch]">
          We do not publish training capability, pricing or programme detail. That
          is shared after an initial conversation.
        </Caption>
      </Section>

      {/* -------------------------------------------- LOCATION, HOURS, GETTING
          Spec: "Location, hours, and directions to the facility at the National
          Stadium." Directions are given only to the stadium — the site must not
          reveal entry points or approach routes to the facility itself. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Finding us</Kicker>
        <H2>{site.location}</H2>

        <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
          <div>
            <H3>Address</H3>
            <Body muted className="mt-1">
              {site.legalName}
              <br />
              {site.location}
            </Body>
          </div>
          <div>
            <H3>Hours</H3>
            <Body muted className="mt-1">
              <Resolved value={contact.hours} label="Opening hours (Operations)" />
            </Body>
          </div>
          <div>
            <H3>General enquiries</H3>
            <Body muted className="mt-1">
              <Resolved
                value={contact.phone}
                label="Public enquiries phone (Founder)"
                render={(v) => (
                  <a
                    href={`tel:${v.replace(/\s/g, "")}`}
                    className="underline decoration-1 underline-offset-2"
                  >
                    {v}
                  </a>
                )}
              />
              <br />
              <Resolved
                value={contact.email}
                label="Public enquiries email (Founder)"
                render={(v) => (
                  <a
                    href={`mailto:${v}`}
                    className="underline decoration-1 underline-offset-2"
                  >
                    {v}
                  </a>
                )}
              />
            </Body>
          </div>
        </div>

        <SegmentedRule className="mt-8" />

        <Caption className="mt-3 max-w-[68ch]">
          Detailed arrival directions are sent with your booking confirmation
          rather than published. This is deliberate: the site does not describe
          approach routes, entry points or the layout of the facility.
        </Caption>
      </Section>
    </>
  );
}
