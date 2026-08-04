import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { LegitimacyStrip } from "@/components/sections/LegitimacyStrip";
import { SpecificationTable } from "@/components/sections/SpecificationTable";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Pending } from "@/components/ui/Pending";
import { credentials } from "@/content/credentials";
import { routes } from "@/lib/site";

/* ============================================================================
   SPORT & COMPETITION — spec §3.

   Purpose: "Carry institutional legitimacy — for members, for sporting bodies,
   and for stakeholders."

   Register: Reticle Black on Chalk, austere. No blue, no teal, minimal warmth.
   This is the one page whose audience is institutional rather than hospitable,
   and it should read like a governing body's own documentation — which is
   exactly what the display face was chosen for.

   ----------------------------------------------------------------------------
   THIS PAGE IS WHERE CLAIMS DISCIPLINE IS TESTED

   Spec §3, claims discipline: "Only publish what is true on day one. 'Built to
   international competition standard' is a credibility claim true from opening.
   'Host of the national championships' is a fact that can only be published
   once it has happened. Do not spend a claim that cannot yet be cashed — the
   audience that matters will check."

   So: the competition-standard claim is substantiated with facts a reader can
   verify on site. Affiliations render only when supplied with evidence. Hosting
   is described as capability, never as history. Nothing on this page is
   aspirational.

   Success measure: enquiries from institutional and sporting stakeholders.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Sport & competition",
  description:
    "The Armory Shooting Sports Club is built to national and international competition standard, with automatic targeting and scoring on the air rifle range at the Abuja National Stadium.",
};

export default function SportPage() {
  return (
    <>
      <PageHeader
        kicker="Sport & competition"
        title="Built to standard, and built to be measured."
        lead="The claim is specific and checkable: national and international competition specification across four disciplines, with automatic targeting and scoring on the air rifle range."
      />

      {/* The claim, substantiated. Facts rather than adjectives — this is the
          page where "eight lanes, machine-scored" earns its keep. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Substantiated</Kicker>
        <H2>What the standard actually means here.</H2>
        <SpecificationTable
          className="mt-4 max-w-[46rem]"
          caption="Competition specification"
          rows={[
            { label: "Disciplines", value: "4" },
            { label: "Air rifle", value: "10 m · 8 lanes · automatic" },
            { label: "Rifle", value: "50 m · 6 lanes" },
            { label: "Pistol", value: "25 m and 10 m, covered outdoor" },
            { label: "Scoring", value: "Machine-verified on air rifle" },
            { label: "Supervision", value: "Range officer on every line" },
            { label: "Location", value: "Abuja National Stadium, FCT" },
          ]}
        />
        <Caption className="mt-2">
          Remaining rows — safety systems and full targeting specification per
          discipline — are outstanding from Operations.
        </Caption>
      </Section>

      {/* Why automatic scoring is a legitimacy argument, not a convenience. */}
      <Section ground="terrazzo" rhythm="default">
        <StatementBlock
          kicker="Score integrity"
          statement="A machine-scored result needs no officiating."
          support="The air rifle range records each shot as it is taken. That removes the human bottleneck from scoring, and it is the reason our leagues and ladder can scale without inviting disputes."
        />
      </Section>

      {/* Affiliations. Only what is true today, with evidence held internally. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Standing</Kicker>
        <H2>What we claim, and what we do not.</H2>
        <Body muted className="mt-2">
          We publish claims that are true on the day they appear. Anything we are
          working towards is not listed here until it has happened.
        </Body>
        <LegitimacyStrip credentials={credentials} className="mt-6" />
      </Section>

      {/* Hosting: capability, never history. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Hosting</Kicker>
        <H2>Capability.</H2>
        <Body muted className="mt-2">
          The facility is specified to host national and international events.
          Enquiries from federations, organising committees and visiting clubs go
          to a named person.
        </Body>
        <Caption className="mt-2 max-w-[68ch]">
          We describe this as capability rather than record. Events we have
          hosted will be listed here once they have taken place — not before.
        </Caption>
        <Button href={routes.enquire} variant="primary" className="mt-4">
          Enquire about competition and hosting
        </Button>
      </Section>

      {/* Pathway. Careful: structured coaching is not confirmed content, so it
          is described only as far as the documents support it. */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">Pathway</Kicker>
        <H2>From a first visit to a ladder position.</H2>
        <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
          <div>
            <H3>Instruction</H3>
            <Body muted className="mt-1">
              Every session is supervised by a range officer, and the manually
              scored disciplines are scored by a professional. Beginners are
              taught on the line, from the first visit onwards.
            </Body>
          </div>
          <div>
            <H3>Progression</H3>
            <Body muted className="mt-1">
              A repeatable, machine-scored round means your own scores are
              comparable week to week. Improvement here is a number, not an
              impression.
            </Body>
          </div>
          <div>
            <H3>Competition</H3>
            <Body muted className="mt-1">
              Members hold a place on the season-long club ladder and are
              eligible for season events. Leagues open after opening, and
              founding members get first access.
            </Body>
          </div>
        </div>
        <div className="mt-6">
          <Pending label="Structured coaching and class programme — confirm whether it exists at launch (Operations). Phase 2.5 scopes the class calendar." />
        </div>
      </Section>
    </>
  );
}
