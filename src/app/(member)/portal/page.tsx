import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Pending } from "@/components/ui/Pending";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { getMember } from "@/server/auth/session";
import {
  canAppearOnClubLadder,
  canCaptainLeague,
  isFullMember,
} from "@/server/leagues/eligibility";
import { routes } from "@/lib/site";

/* ============================================================================
   THE MEMBER HOME.

   ===========================================================================
   THIS PAGE OPENS ON A COMMITMENT, NOT A SCOREBOARD

   The Brief is unambiguous about what actually drives return visits: "the
   engine is therefore not the leaderboard — it is social obligation. People
   return because they told a friend they would be there. Design for the group,
   not the individual."

   So the first thing a member sees is their next round and who else is in it.
   Standings sit below. A ladder is a scoreboard; a fixture is a promise to
   someone, and the promise is the product.

   Everything league-shaped here is scaffolded until Workstreams 8-10 build it.
   The structure is deliberate rather than placeholder: it fixes the hierarchy
   now, while it is cheap to argue about.
   ========================================================================= */

export const metadata: Metadata = { title: "Your club" };

export default async function PortalPage() {
  /* The layout has already required a member; this is the same request's
     cached read, not a second authentication. */
  const member = await getMember();
  if (!member) return null;

  const fullMember = isFullMember(member.status);

  return (
    <>
      <PageHeader
        ground={fullMember ? "teal" : "soffit"}
        kicker="Your club"
        title={greeting(member.displayName)}
        lead={
          fullMember
            ? "Your next round, your leagues, and where you stand."
            : "Your next round and your leagues. The club ladder is for members."
        }
      />

      {/* ---------------------------------------------- 1. YOUR NEXT ROUND
          The commitment. First, largest, and the only thing above the fold. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Next round</Kicker>
        <H2>When you are next expected.</H2>
        <div className="mt-4">
          <Pending label="Fixtures — your next round and who else is in it (Workstream 8)" />
        </div>
        <Caption className="mt-3 max-w-[68ch]">
          This is the top of the page on purpose. People come back because they
          told a friend they would be there, not because of a table.
        </Caption>
      </Section>

      {/* ------------------------------------------------- 2. YOUR LEAGUES */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">Your leagues</Kicker>
        <H2>Who you are playing with.</H2>
        <div className="mt-4">
          <Pending label="League membership and standings (Workstreams 8-9)" />
        </div>

        {canCaptainLeague(member.status) ? (
          <Body muted className="mt-4">
            As a member you can start a league and captain it. Four people and a
            standing weekly slot is all it takes.
          </Body>
        ) : (
          <Body muted className="mt-4">
            You can join a league that a member has started. Creating and
            captaining one is a members&rsquo; privilege.
          </Body>
        )}
      </Section>

      {/* ------------------------------------------------ 3. THE CLUB LADDER
          Members only — "members appear on the persistent season-long club
          ladder". This is the sharpest members-only privilege, so the
          non-member view states it plainly rather than hiding the section. */}
      <Section ground={canAppearOnClubLadder(member.status) ? "teal" : "chalk"} rhythm="default">
        <Kicker className="mb-2" muted={!canAppearOnClubLadder(member.status)}>
          The club ladder
        </Kicker>
        {canAppearOnClubLadder(member.status) ? (
          <>
            <H2>Where you stand.</H2>
            <div className="mt-4">
              <Pending label="Club ladder — season-long standings (Workstream 9)" />
            </div>
          </>
        ) : (
          <>
            <H2>The ladder is for members.</H2>
            <Body muted className="mt-2">
              Your scores count in your own league. The season-long club ladder,
              priority on league slots and entry to season events come with
              membership.
            </Body>
            <Button href={routes.membership} variant="primary" className="mt-4">
              What membership includes
            </Button>
          </>
        )}
      </Section>

      {/* ------------------------------------------------------ 4. ACCOUNT */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Your details</Kicker>
        <H2>What we hold.</H2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt>
              <H3>Display name</H3>
            </dt>
            <dd className="mt-1 text-body text-[var(--ink-muted)]">
              {member.displayName}
              <Caption className="mt-1">
                This is the only name that appears on standings. It is not your
                real name unless you choose to make it so.
              </Caption>
            </dd>
          </div>
          <div>
            <dt>
              <H3>Email</H3>
            </dt>
            <dd className="mt-1 text-body text-[var(--ink-muted)]">
              {member.email}
              <Caption className="mt-1">
                Used to sign you in, and never shown to other members.
              </Caption>
            </dd>
          </div>
        </dl>

        <div className="mt-6">
          <Pending label="Change display name, export or erase your data (Workstream 7 follow-up / NDPA)" />
        </div>
      </Section>

      <Section ground="charred" rhythm="default">
        <StatementBlock
          kicker="Leagues"
          statement="Anyone can play. Members are the club."
          support="Leagues open after the club does, once there are enough members for a season to be worth playing."
        />
      </Section>
    </>
  );
}

/**
 * Plain and unexcitable. "Welcome back!" is the register this brand explicitly
 * does not use — no hype, no exclamation marks (Guidelines §9).
 */
function greeting(displayName: string): string {
  return `${displayName}.`;
}
