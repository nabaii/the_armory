import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { DisciplineCard } from "@/components/sections/DisciplineCard";
import { SpecificationTable } from "@/components/sections/SpecificationTable";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { Body, Caption, H2, Kicker } from "@/components/ui/Text";
import { CtaPair } from "@/components/ui/Button";
import { cta } from "@/lib/site";
import { disciplines } from "@/content/disciplines";

/* ============================================================================
   THE RANGES — spec §3.

   Purpose: "Prove the competition-standard claim through the facility itself,
   and show that there are four distinct things to do here."

   Register: Range Teak and Charred Timber. Teak is the firing-line counters and
   lattice, and the guidelines call it "the strongest anti-tactical signal
   available" — so the page that comes closest to the equipment is also the
   warmest in material. Teak and Charred Timber are single-ink and layered-text
   grounds respectively, so the teak sections carry short copy only.

   ----------------------------------------------------------------------------
   HARD CONSTRAINT ON THIS PAGE

   Spec §3 and Brand Guidelines §7: no imagery or copy revealing facility
   layout, entry and exit points, storage or armoury arrangements, or security
   staffing. That governs the prose here as much as the photography — every
   discipline is described by what happens on the line, never by where it sits
   in the building or how you get to it.

   Success measure: time on page; onward click to First Visit or Membership.
   ========================================================================= */

export const metadata: Metadata = {
  title: "The ranges",
  description:
    "Four disciplines at The Armory Shooting Sports Club — 10m air rifle with automatic scoring, a 50m range, and 25m and 10m pistol lines. Built to national and international competition standard.",
};

export default function RangesPage() {
  return (
    <>
      <PageHeader
        kicker="The ranges"
        title="Four disciplines, one standard."
        lead="Eight lanes of machine-scored air rifle, a fifty-metre range, and two covered outdoor pistol lines. Every one of them built to national and international competition specification."
        primary={cta.secondary}
        secondary={cta.primary}
      />

      {/* Air rifle first and largest. Spec: "Give it prominence: most
          beginner-accessible, and the future home of Leagues." It is also the
          only line that scores itself, which is the proof the whole page is
          making. */}
      <Section ground="chalk" rhythm="default">
        <DisciplineCard discipline={disciplines[0]} />
        <SpecificationTable
          className="mt-6 max-w-[46rem]"
          caption="10m air rifle — specification"
          rows={[
            { label: "Distance", value: "10 m" },
            { label: "Lanes", value: "8" },
            { label: "Targeting", value: "Automatic" },
            { label: "Scoring", value: "Machine-verified" },
            { label: "Setting", value: "Indoor" },
            { label: "Spectating", value: "Bar seating and viewing rail" },
          ]}
        />
        <Caption className="mt-2">
          Safety systems and full targeting specification per discipline are
          outstanding from Operations.
        </Caption>
      </Section>

      {/* Why automatic scoring matters beyond convenience. Teak: single-ink,
          short copy. */}
      <Section ground="teak" rhythm="default">
        <StatementBlock
          kicker="Why it matters"
          statement="A machine-scored target is a score nobody has to trust."
          support="The air rifle line records each shot as you take it. No officiating, no arithmetic, and no argument — which is also why our leagues will be built on this range first."
        />
      </Section>

      {/* The remaining three. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Also here</Kicker>
        <H2>Three more lines.</H2>
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {disciplines.slice(1).map((d) => (
            <DisciplineCard key={d.slug} discipline={d} />
          ))}
        </div>
        <Body muted className="mt-6">
          The 50m, 25m and 10m pistol lines are scored by a professional rather
          than automatically. Lane counts for the two pistol lines are being
          confirmed.
        </Body>
      </Section>

      <Section ground="charred" rhythm="default">
        <Kicker className="mb-2" muted={false}>
          Start anywhere
        </Kicker>
        <H2>You do not need to choose a discipline.</H2>
        <Body muted className="mt-2">
          Almost everyone starts on the air rifle line. It is the quietest, has
          the least recoil, and scores itself — which makes it the easiest place
          to find out whether you enjoy this.
        </Body>
        <CtaPair primary={cta.secondary} secondary={cta.primary} className="mt-4" />
      </Section>
    </>
  );
}
