import { Section } from "@/components/layout/Section";
import { Hero } from "@/components/sections/Hero";
import { Proposition, StatementBlock } from "@/components/sections/StatementBlock";
import { DisciplineCard } from "@/components/sections/DisciplineCard";
import { LegitimacyStrip } from "@/components/sections/LegitimacyStrip";
import { WaitlistCapture } from "@/components/sections/WaitlistCapture";
import { Button, CtaPair } from "@/components/ui/Button";
import { Body, Caption, H2, Kicker, Lead } from "@/components/ui/Text";
import { ImageSlot } from "@/components/media/ImageSlot";
import { cta, routes, site } from "@/lib/site";
import { disciplines } from "@/content/disciplines";
import { credentials } from "@/content/credentials";

/* ============================================================================
   HOME — spec §3.

   Purpose, verbatim: "Sell the club in one screen to a sceptical, wealthy,
   never-done-this visitor arriving from a friend's WhatsApp link."

   It must survive a two-minute scroll. Block order is specified and followed
   exactly: hero, proposition, first-visit module, the range, membership module,
   Leagues teaser, legitimacy strip, footer.

   Success measure: scroll depth past the first-visit module; application
   starts; first-visit bookings.
   ========================================================================= */

const featured = disciplines.find((d) => d.featured)!;
const secondary = disciplines.filter((d) => !d.featured).slice(0, 2);

export default function HomePage() {
  return (
    <>
      {/* ------------------------------------------------------------ 1. HERO
          Headline carries the competition-standard claim — true from opening
          day. Sub-line carries the welcome. */}
      <Hero
        headline="Built to international competition standard."
        subline="A private shooting sports club at the Abuja National Stadium. No experience needed — everything is provided."
        kicker={site.location}
        primary={cta.primary}
        secondary={cta.secondary}
        awaiting="Hero — reception & lockup wall (day register)"
      />

      {/* ----------------------------------------------------- 2. PROPOSITION
          "Three to four short statements." Facts, flat, no icons. */}
      <Section ground="chalk" rhythm="default">
        <Proposition
          items={[
            {
              label: "Competition standard",
              detail:
                "Built to national and international specification, across three disciplines.",
            },
            {
              label: "Everything provided",
              detail:
                "All firearms belong to the range. You arrive with nothing and take nothing away.",
            },
            {
              label: "Professional supervision",
              detail:
                "A range officer is on the line with you throughout. Nobody shoots unsupervised.",
            },
            {
              label: "At the National Stadium",
              detail: "Abuja, FCT.",
            },
          ]}
        />
      </Section>

      {/* ------------------------------------------------ 3. FIRST-VISIT MODULE
          "Short, warm, anxiety-reducing." Soffit Blue — the open register.
          This is the module the scroll-depth measure is taken against, so it
          sits high and reads as an invitation rather than a lesser option. */}
      <Section ground="soffit" rhythm="default">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-center lg:gap-8">
          <div>
            <Kicker className="mb-2">Never done this before</Kicker>
            <H2>You are not expected to know anything.</H2>
            <Body className="mt-2">
              The first visit is built for people who have never held a rifle.
              You are met at reception, briefed plainly, and a range officer
              stays with you. Everything you need is issued on the day.
            </Body>
            <Body className="mt-2">
              Bring someone who has no interest in shooting. The bar seating
              looks straight onto the firing line, so they have a seat, a drink
              and a clear view.
            </Body>
            <Button href={routes.firstVisit} variant="primary" className="mt-3">
              See what happens on a first visit
            </Button>
          </div>
          <ImageSlot
            awaiting="Instruction moment — range officer with a beginner (day register)"
            aspect="landscape"
            layout="half"
          />
        </div>
      </Section>

      {/* -------------------------------------------------------- 4. THE RANGE
          "Two or three images with brief captions naming disciplines,
          including air rifle." Air rifle leads — it is the beginner entry
          point and the future home of Leagues. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Three disciplines</Kicker>
        <H2>Somewhere to start, and somewhere to get serious.</H2>

        <div className="mt-6 flex flex-col gap-8">
          <DisciplineCard discipline={featured} />
          <div className="grid gap-6 md:grid-cols-2">
            {secondary.map((d) => (
              <DisciplineCard key={d.slug} discipline={d} />
            ))}
          </div>
        </div>

        <Button href={routes.ranges} variant="secondary" className="mt-6">
          All three ranges
        </Button>
      </Section>

      {/* ------------------------------------------------- 5. MEMBERSHIP MODULE
          "What belonging means; founding-cohort scarcity; gated pricing; CTA to
          apply." VIP Teal — the member register. Single-ink, so this block is
          deliberately short copy. */}
      <Section ground="teal" rhythm="default">
        <StatementBlock
          kicker="Membership"
          statement="Anyone can play. Members are the club."
          support="Membership is access to a room and the people in it — the club ladder, priority booking, the VIP deck, and first access to Leagues. Prices are shared on application."
        />
        <CtaPair
          primary={cta.primary}
          secondary={{ href: routes.membership, label: "What membership includes" }}
          className="mt-6"
        />
      </Section>

      {/* -------------------------------------------------- 6. LEAGUES TEASER
          "Concept in three sentences plus founding-member first-access line
          and waitlist capture." Nothing more — Leagues is Phase 2, and §9
          requires it to promise nothing Phase 2 will not deliver. */}
      <Section ground="charred" rhythm="default">
        <Kicker className="mb-2">Coming after opening</Kicker>
        <H2>Leagues</H2>
        <Lead muted className="mt-2">
          Friends form a league and shoot the same standard air rifle round each
          week. Scores come straight off the automatic targeting system, so
          standings update on their own and nobody has to trust anybody.
          Founding members get first access.
        </Lead>
        <WaitlistCapture source="home-module" className="mt-4" />
      </Section>

      {/* ----------------------------------------------- 7. LEGITIMACY STRIP
          "Stadium location, sporting body affiliations, safety and licensing
          posture." Only claims true on day one render. */}
      <Section ground="chalk" rhythm="tight">
        <LegitimacyStrip credentials={credentials} />
        <Caption className="mt-3">
          The Armory Shooting Sports Club operates under a private lease at the{" "}
          {site.location}. All firearms are range-owned and remain on site.
        </Caption>
      </Section>
    </>
  );
}
