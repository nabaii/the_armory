import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { JoinLeagueForm } from "@/components/member/LeagueForms";
import { requireMember } from "@/server/auth/session";
import { canCaptainLeague } from "@/server/leagues/eligibility";
import { routes } from "@/lib/site";

export const metadata: Metadata = { title: "Join a league" };

export default async function JoinLeaguePage() {
  const member = await requireMember(routes.leagueJoin);

  return (
    <>
      <PageHeader
        /* Joining is the open motion — anyone can play. Blue rather than teal,
           because this is the door rather than the room. */
        ground="soffit"
        kicker="Leagues"
        title="Join a league."
        lead="Someone has sent you a six-character code. That is all you need."
      />

      <Section ground="chalk" rhythm="default">
        <JoinLeagueForm className="max-w-[46rem]" />

        <Caption className="mt-6 max-w-[68ch]">
          Codes are not case sensitive, and the hyphen is optional. If someone
          read it to you and you are unsure whether that was an O or a zero,
          type either — we will work it out.
        </Caption>
      </Section>

      <Section ground="terrazzo" rhythm="tight">
        <Body muted className="max-w-[68ch]">
          You do not need to be a member to play in a league. You pay for each
          visit as you go, and your scores count in your league exactly the same
          as anyone else&rsquo;s.
        </Body>

        {canCaptainLeague(member.status) && (
          <Caption className="mt-3">
            Nobody sent you a code?{" "}
            <a
              href={routes.leagueNew}
              className="underline decoration-1 underline-offset-2"
            >
              Start your own league
            </a>
            .
          </Caption>
        )}

        <Button href={routes.portal} variant="secondary" className="mt-4">
          Back to your club
        </Button>
      </Section>
    </>
  );
}
