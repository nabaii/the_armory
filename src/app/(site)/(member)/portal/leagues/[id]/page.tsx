import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, Data, H2, H3, Kicker, LaneNumeral } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Pending } from "@/components/ui/Pending";
import { CentreDot } from "@/components/brand/Reticle";
import { SpecificationTable } from "@/components/sections/SpecificationTable";
import { requireMember } from "@/server/auth/session";
import {
  MAX_LEAGUE_PLAYERS,
  leagueWithPlayers,
  roundsPlayedByLeague,
} from "@/server/leagues/repository";
import { formatJoinCode } from "@/server/leagues/join-code";
import { nextFixture, weekdayName } from "@/server/leagues/fixtures";
import { routes } from "@/lib/site";

export const metadata: Metadata = { title: "Your league" };

/* ============================================================================
   A LEAGUE.

   Order is the argument. From the Brief: "the engine is not the leaderboard —
   it is social obligation. People return because they told a friend they would
   be there."

   So: the next fixture, then who is in it, then standings. A member opening
   this on their phone should learn when they are next expected before they
   learn where they are ranked.
   ========================================================================= */

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = await requireMember(routes.league(id));

  /* Scoped by membership inside the repository. A member who is not in this
     league gets null — indistinguishable from the league not existing, so this
     page cannot be used to discover which leagues exist. */
  const data = await leagueWithPlayers({ leagueId: id, viewerId: member.id });
  if (!data) notFound();

  const { league, season, players } = data;
  const roundsPlayed = await roundsPlayedByLeague(league.id);

  /* Week numbers only. §8, non-negotiable: "Show week numbers, not dates." */
  const next = nextFixture({
    roundsSubmitted: roundsPlayed,
    seasonWeeks: season.roundCount,
  });

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Your league"
        title={league.name}
        lead={`${players.length} of ${MAX_LEAGUE_PLAYERS} players · week ${Math.min(roundsPlayed + 1, season.roundCount)} of ${season.roundCount}`}
      />

      {/* ------------------------------------------------- 1. THE COMMITMENT */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Next round</Kicker>

        {next.status === "season-complete" ? (
          <>
            <H2>The season is done.</H2>
            <Body muted className="mt-2">
              All {season.roundCount} weeks are in. Final standings below.
            </Body>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <LaneNumeral muted>
                {String(next.fixture.week).padStart(2, "0")}
              </LaneNumeral>
              <div>
                <H2>{next.fixture.label}</H2>
                {/* The anchor is advisory. §6: "Thursday is the default night.
                    Most play together; the week accommodates everyone else." */}
                <Body className="mt-1">
                  Most of your league plays{" "}
                  <Data muted={false}>{weekdayName(league.anchorWeekday)}</Data>
                  {" — but any day this week counts."}
                </Body>
              </div>
            </div>

            <Caption className="mt-3">
              {next.weeksRemaining}{" "}
              {next.weeksRemaining === 1 ? "week" : "weeks"} left this season.
            </Caption>
          </>
        )}
      </Section>

      {/* ---------------------------------------------------- 2. WHO IS IN */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">Who is in</Kicker>
        <H2>Your league.</H2>

        <ul className="mt-4 flex flex-col gap-1">
          {players.map((player) => (
            <li
              key={player.memberId}
              className="flex items-center gap-2 border-t border-[var(--rule)]/30 py-2"
            >
              {player.memberId === member.id && <CentreDot className="size-[5px]" />}
              {/* Display names only. `fullName` is never selected by the query
                  that feeds this — see the note in the repository. */}
              <span className="text-body font-bold text-[var(--ink)]">
                {player.displayName}
              </span>
              {player.role === "captain" && (
                <span className="u-kicker text-[var(--ink-muted)]">Captain</span>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <H3>Bring someone in</H3>
          <Body muted className="mt-1">
            Share this code. It is the only way in — leagues are not listed
            anywhere.
          </Body>
          <p className="mt-2">
            <Data
              muted={false}
              className="text-h1 font-bold tracking-[0.08em]"
            >
              {formatJoinCode(league.joinCode)}
            </Data>
          </p>
          <Caption className="mt-1">
            Read it aloud if you like — there are no letters in it that sound
            like other letters.
          </Caption>
        </div>
      </Section>

      {/* --------------------------------------------------- 3. STANDINGS */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Standings</Kicker>
        <H2>Where everyone is.</H2>
        <div className="mt-4">
          <Pending label="League standings and scores (Workstream 9)" />
        </div>
        <Caption className="mt-3 max-w-[68ch]">
          Standings show display names and round numbers only — never dates or
          times. Your league is a competition, not a record of when you were
          where.
        </Caption>
      </Section>

      {/* ------------------------------------------------------- 4. DETAIL */}
      <Section ground="terrazzo" rhythm="tight">
        <SpecificationTable
          className="max-w-[46rem]"
          caption="The round"
          rows={[
            { label: "Discipline", value: "10m air rifle" },
            { label: "Shots", value: String(season.shotsPerRound) },
            { label: "Maximum", value: String(season.maxScore) },
            { label: "Scoring", value: "Machine-verified" },
            { label: "Weeks this season", value: String(season.roundCount) },
            { label: "Fixtures", value: "Asynchronous — the week, not the evening" },
          ]}
        />
        <Button href={routes.portal} variant="secondary" className="mt-6">
          Back to your club
        </Button>
      </Section>
    </>
  );
}
