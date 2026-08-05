import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { WaitlistCapture } from "@/components/sections/WaitlistCapture";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { routes } from "@/lib/site";

/* ============================================================================
   LEAGUES (TEASER) — spec §3.

   Purpose: "Create anticipation and capture a waitlist. It sells a future
   benefit of membership; it is not a product."

   ----------------------------------------------------------------------------
   WHAT THIS PAGE MUST NOT DO

   Spec §9, acceptance criterion: "The Leagues page captures a waitlist and
   promises nothing that Phase 2 will not deliver."

   Spec §3, contents: "Email waitlist capture. Nothing else. No accounts, no
   league creation, no scores."

   And the sequencing note from the Brief, which is the reason this is a teaser
   at all: "Leagues is a genuine software product — accounts, scoring, fixtures,
   standings, social features. It cannot be built in the launch window alongside
   opening a physical facility without shipping a poor version of both...
   Launching a social competition product to an empty range is throwing a party
   nobody attends."

   So there is no product surface here. No dates are promised, because none have
   been set. The one commitment made is founding-member first access, which is a
   membership benefit the club controls entirely.

   The concept is given in three sentences, as specified — no more.

   Success measure: waitlist sign-ups; proportion converting to membership
   applications. That second figure is why the capture carries a source.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Leagues",
  description:
    "Leagues at The Armory Shooting Sports Club — friends form a league, shoot a standard air rifle round, and machine-verified standings update automatically. Founding members get first access.",
};

export default function LeaguesPage() {
  return (
    <>
      <PageHeader
        ground="charred"
        kicker="Coming after opening"
        title="Leagues."
        lead="Friends form a league and shoot the same standard air rifle round each week. Scores come straight off the automatic targeting system, so standings update on their own. Founding members get first access."
      />

      {/* Why it is credible — the machine-scoring argument. This is the whole
          reason Leagues anchors to the air rifle range: score integrity is the
          load-bearing problem, and "a league collapses the first time a member
          suspects a friend inflated a score". */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Why it will work</Kicker>
        <H2>Nobody has to trust anybody.</H2>
        <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
          <div>
            <H3>The targets do the scoring</H3>
            <Body muted className="mt-1">
              The air rifle range scores automatically. There is no card to sign,
              no arithmetic, and nothing to dispute.
            </Body>
          </div>
          <div>
            <H3>The same round every time</H3>
            <Body muted className="mt-1">
              A fixed number of shots at a fixed distance. Your score this week
              is comparable with your score last week, and with your friend&rsquo;s.
            </Body>
          </div>
          <div>
            <H3>It is watched</H3>
            <Body muted className="mt-1">
              The bar seating overlooks the firing line, so a league night has an
              audience rather than being four people taking turns in a lane.
            </Body>
          </div>
        </div>
      </Section>

      {/* Access model. Stated plainly because it is the honest answer to the
          first question a non-member will ask, and because the per-visit cost
          does the selling on its own. */}
      <Section ground="terrazzo" rhythm="default">
        <StatementBlock
          kicker="Who can play"
          statement="Anyone can play. Members are the club."
          support="Non-members can join a league and play, paying per visit. Members create and captain leagues, hold a place on the season-long club ladder, get league entry priced in, and are eligible for season events."
        />
      </Section>

      {/* The waitlist, and nothing else. */}
      <Section ground="charred" rhythm="default">
        <Kicker className="mb-2" muted={false}>
          The waitlist
        </Kicker>
        <H2>Be told once, when it opens.</H2>
        <Body muted className="mt-2">
          We are not taking sign-ups, building teams or keeping scores yet.
          Leagues opens after the club does, once there are enough members to
          make a season worth playing.
        </Body>
        <WaitlistCapture source="leagues-page" className="mt-4" />
      </Section>

      <Section ground="chalk" rhythm="tight">
        <Body muted>
          Founding members get first access to Leagues, along with everything
          else the founding cohort carries.
        </Body>
        <Button href={routes.membership} variant="secondary" className="mt-3">
          What membership includes
        </Button>
        <Caption className="mt-3 max-w-[68ch]">
          We have not published a launch date because one has not been set.
          Leagues follows opening, not the other way round.
        </Caption>
      </Section>
    </>
  );
}
