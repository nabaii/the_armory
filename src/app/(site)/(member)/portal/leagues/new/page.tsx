import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { CreateLeagueForm } from "@/components/member/LeagueForms";
import { requireMember } from "@/server/auth/session";
import { canCaptainLeague } from "@/server/leagues/eligibility";
import { routes } from "@/lib/site";

export const metadata: Metadata = { title: "Start a league" };

export default async function NewLeaguePage() {
  const member = await requireMember(routes.leagueNew);

  /* Non-members are redirected rather than shown a form that will refuse them.
     Offering a control that cannot work is worse than not offering it. */
  if (!canCaptainLeague(member.status)) redirect(routes.portal);

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Leagues"
        title="Start a league."
        lead="Four friends, the same round, the same evening every week. The standings look after themselves."
      />

      <Section ground="chalk" rhythm="default">
        <CreateLeagueForm className="max-w-[46rem]" />
      </Section>

      <Section ground="terrazzo" rhythm="tight">
        <Body muted className="max-w-[68ch]">
          The round is the same for everyone: a fixed number of shots at ten
          metres on the air rifle line, scored by the targets themselves. Nobody
          has to keep a card, and nobody has to trust anybody.
        </Body>
        <Caption className="mt-3">
          Already have a code from someone?{" "}
          <a
            href={routes.leagueJoin}
            className="underline decoration-1 underline-offset-2"
          >
            Join their league instead
          </a>
          .
        </Caption>
        <Button href={routes.portal} variant="secondary" className="mt-4">
          Back to your club
        </Button>
      </Section>
    </>
  );
}
