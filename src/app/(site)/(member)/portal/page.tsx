import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, Data, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Pending } from "@/components/ui/Pending";
import { StatementBlock } from "@/components/sections/StatementBlock";
import Link from "next/link";
import { getMember } from "@/server/auth/session";
import { leaguesForMember } from "@/server/leagues/repository";
import { nextFixture, weekdayName } from "@/server/leagues/fixtures";
import { isDatabaseConfigured } from "@/db/client";
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

  /* Guarded rather than assumed: the portal is reachable only with a session,
     which needs a database — but a misconfiguration should degrade to an empty
     list rather than a stack trace on a member's home page. */
  const summaries = isDatabaseConfigured() ? await leaguesForMember(member.id) : [];

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

      {/* ------------------------------------------- 1. YOUR LEAGUES & ROUNDS
          The commitment first. From the Brief: "the engine is not the
          leaderboard — it is social obligation." A member should learn when
          they are next expected before they learn where they are ranked. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Your leagues</Kicker>

        {summaries.length === 0 ? (
          <>
            <H2>Nothing on yet.</H2>
            <Body muted className="mt-2 max-w-[68ch]">
              A league is four friends, one round each per week, over six
              weeks. Shoot yours whenever suits you — the week is the fixture,
              not the evening. The standings look after themselves.
            </Body>
            <div className="mt-4 flex flex-wrap gap-2">
              {canCaptainLeague(member.status) && (
                <Button href={routes.leagueNew} variant="primary">
                  Start a league
                </Button>
              )}
              <Button
                href={routes.leagueJoin}
                variant={canCaptainLeague(member.status) ? "secondary" : "primary"}
              >
                Join with a code
              </Button>
            </div>
          </>
        ) : (
          <>
            <H2>When you are next expected.</H2>
            <ul className="mt-6 flex flex-col gap-4">
              {summaries.map(({ league, season, playerCount, roundsPlayed }) => {
                /* Weeks, never dates. Leagues Spec §8: "Show week numbers,
                   not dates." A dated table of named members is a record of who
                   was in the building and when. */
                const next = nextFixture({
                  roundsSubmitted: roundsPlayed,
                  seasonWeeks: season.roundCount,
                });

                return (
                  <li
                    key={league.id}
                    className="border-t border-[var(--rule)]/30 pt-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <H3>
                        <Link
                          href={routes.league(league.id)}
                          className="no-underline hover:underline"
                        >
                          {league.name}
                        </Link>
                      </H3>
                      <Caption>
                        {playerCount} {playerCount === 1 ? "player" : "players"}
                      </Caption>
                    </div>

                    {next.status === "season-complete" ? (
                      <Body muted className="mt-1">
                        Season complete — all {season.roundCount} weeks are in.
                      </Body>
                    ) : (
                      <Body className="mt-1">
                        <Data muted={false}>{next.fixture.label}</Data>
                        <span className="text-[var(--ink-muted)]">
                          {" — still to shoot. Most play "}
                          {weekdayName(league.anchorWeekday)}.
                        </span>
                      </Body>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex flex-wrap gap-2">
              {canCaptainLeague(member.status) && (
                <Button href={routes.leagueNew} variant="secondary">
                  Start another league
                </Button>
              )}
              <Button href={routes.leagueJoin} variant="secondary">
                Join with a code
              </Button>
            </div>
          </>
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
