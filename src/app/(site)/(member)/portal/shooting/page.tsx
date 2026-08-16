import type { Metadata } from "next";
import Link from "next/link";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { getMember } from "@/server/auth/session";
import { resolveArmoryMember } from "@/server/armory/member-session";
import {
  accrualStatement,
  competitiveRecordFor,
} from "@/server/armory/member-record";
import { shootingFor } from "@/server/armory/shooting";
import { canCaptainLeague } from "@/server/leagues/eligibility";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, Data, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { ScoreLine } from "@/components/member/ScoreLine";
import { formatWeekdayDate } from "@/lib/time";
import { routes } from "@/lib/site";

/**
 * COMPETE — Members Portal Design Specification §8.
 *
 *   "The retention surface, and the tab with the most already built behind it.
 *    Three regions on one scrolling screen: your record, standing,
 *    competitions."
 *
 * ===========================================================================
 * §8.6 — WHAT THIS SCREEN SAYS BEFORE THE LADDER OPENS
 *
 *   "Until a roster exists, this region carries a single honest statement of
 *    accrual — 37 rounds recorded. Your position appears when the Ladder opens.
 *
 *    That is not a placeholder. It tells the member their history is being
 *    kept, that it will matter, and that showing up now compounds. It converts
 *    a delay into an accumulation, at almost no build cost, and it satisfies P2
 *    rather than working around it."
 *
 * The sentence is produced by `accrualStatement` rather than written here, so
 * that the day the Ladder opens it returns null and this region renders a
 * position instead. A sentence typed into a component would have to be found
 * and deleted by whoever ships that.
 *
 * ===========================================================================
 * §8.2 — WHY THERE IS NO LADDER YET, AND IT IS NOT AN ENGINEERING GAP
 *
 *   "The ladder product exists; the open items are a rolling window length, a
 *    season prize and churn measurement, none of which are engineering. The
 *    Ladder ships when a roster exists to populate it, gated by two items
 *    already on the founder blocker list: a founding-member base, and a manual
 *    league pilot of four members with one weekly round and a spreadsheet.
 *
 *    The pilot deserves emphasis. It is listed as a blocker and it looks like
 *    the least serious item on the register — four people and a spreadsheet. It
 *    is in fact the only way to discover whether the club's league format is any
 *    good before it is enshrined in software and shown to a hundred and
 *    twenty-five members."
 *
 * ===========================================================================
 * §8.4 — EVERY QUERY ON THIS TAB CROSSES A SCHEMA BOUNDARY, AND EXACTLY ONE
 * MODULE DOES IT
 *
 * The leagues product lives in `public`; rounds and people live in `armory`.
 * This page reads `competitiveRecordFor` and nothing else, which is the read
 * model §8.4 requires — "without it the join is reimplemented in four places
 * with three different definitions of a personal best, and the first member to
 * notice that their profile and the ladder disagree will be right."
 */

export const metadata: Metadata = { title: "Compete" };

export const dynamic = "force-dynamic";

export default async function CompetePage() {
  const account = await getMember();
  if (!account) return null;

  const resolution = await resolveArmoryMember();

  /**
   * A person without a membership still has scores.
   *
   * §3.1 makes guest and member states of one person, and somebody here without
   * a membership has very likely shot as a guest — §3.2's acquisition funnel.
   * Their cards are theirs. Turning them away from their own scores would be
   * the club forgetting the visit it is trying to convert.
   */
  const personId =
    resolution.state === "member"
      ? resolution.member.personId
      : resolution.state === "no_membership"
        ? resolution.personId
        : null;

  if (!personId || !isArmoryDatabaseConfigured()) {
    return (
      <>
        <PageHeader kicker="Compete" title="Your record" />
        <Section ground="chalk">
          <Body>
            {personId
              ? "The club's system is not reachable just now."
              : "The club has no shooting record against this account yet."}
          </Body>
        </Section>
      </>
    );
  }

  /* One read model, not four ad hoc joins — §8.4. A person with no membership
     has no leagues row to join to, so their record comes from the shooting half
     alone rather than through a cross-schema read that would find nothing. */
  const record =
    resolution.state === "member"
      ? await competitiveRecordFor({ personId, memberId: account.id })
      : {
          shooting: await shootingFor(getArmoryDb(), personId),
          leagues: [],
          ladder: null,
        };

  const { shooting } = record;
  const accrual = accrualStatement(record);

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Compete"
        title={
          shooting.mostRecent
            ? `Your last card was ${shooting.mostRecent.reads}`
            : "Your record"
        }
        lead={
          shooting.cardCount === 0
            ? "Nothing recorded yet. Your first card appears here the evening you shoot it."
            : `${shooting.cardCount} ${shooting.cardCount === 1 ? "card" : "cards"} recorded.`
        }
      />

      {/* ============================================================ 1 of 3
          STANDING. Ships in Phase 1 carrying nothing but a number that grows,
          which §15 defends at length: "the entire retention argument for
          membership rests on a history that exists only if it is captured as it
          happens." */}
      <Section ground="chalk" rhythm="default" aria-labelledby="standing">
        <Kicker className="mb-2">Where you stand</Kicker>
        {record.ladder ? (
          <>
            <H2 id="standing">
              {ordinal(record.ladder.position)} of {record.ladder.of}
            </H2>
            <Body muted className="mt-2">
              {movementLine(record.ladder.movement)}
            </Body>
          </>
        ) : (
          <>
            <H2 id="standing">The Ladder is not open yet.</H2>
            <Body className="mt-2 max-w-[68ch]">{accrual}</Body>
          </>
        )}
      </Section>

      {/* ============================================================ 2 of 3
          YOUR RECORD — §8.1: last round, personal best per discipline with the
          date set, trend over the last twelve rounds. */}
      {shooting.bests.length > 0 && (
        <Section ground="chalk" rhythm="default" aria-labelledby="bests">
          <Kicker className="mb-2">Your record</Kicker>
          <H2 id="bests">Your best cards.</H2>

          <ul className="mt-6 grid gap-6 sm:grid-cols-2">
            {shooting.bests.map((best) => (
              <li
                key={`${best.discipline}-${best.formatLabel}`}
                className="border-t border-[var(--rule)]/30 pt-4"
              >
                <Kicker>{best.discipline}</Kicker>
                <Data className="mt-1">{best.reads}</Data>
                <Caption muted className="mt-1">
                  {best.formatLabel} · {formatWeekdayDate(best.capturedAt)}
                </Caption>
                <Body className="mt-2">
                  {/* §11's fourth field. A number without its relation to a
                      history tells a member almost nothing, and the count of
                      cards still needed is also — not accidentally — a reason
                      to book again. */}
                  {best.trend ??
                    `${best.cardsUntilTrend} more ${
                      best.cardsUntilTrend === 1 ? "card" : "cards"
                    } and we can tell you which way you are going.`}
                </Body>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {shooting.history.length > 0 && (
        <Section ground="soffit" rhythm="default" aria-labelledby="history">
          <Kicker className="mb-2">Every round</Kicker>
          <H2 id="history">Every card.</H2>

          <ul className="mt-6 flex flex-col divide-y divide-[var(--rule)]/25">
            {shooting.history.map((entry) => {
              const best = shooting.bests.find(
                (candidate) => candidate.formatLabel === entry.formatLabel,
              );

              return (
                <li key={entry.id} className="py-3">
                  <ScoreLine
                    score={{
                      reads: entry.reads,
                      discipline: entry.discipline,
                      formatLabel: entry.formatLabel,
                      capturedAt: entry.capturedAt,
                      relation: null,
                      isPersonalBest: best?.reads === entry.reads,
                      superseded: entry.superseded,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* ============================================================ 3 of 3
          COMPETITIONS. §8.3 keeps member-created competitions in Phase 2 —
          they are an addition to a working engine, not a substitute for a
          missing one. What ships is the leagues product that already exists. */}
      <Section ground="chalk" rhythm="default" aria-labelledby="competitions">
        <Kicker className="mb-2">Competitions</Kicker>

        {record.leagues.length === 0 ? (
          <>
            <H2 id="competitions">Nothing on yet.</H2>
            <Body muted className="mt-2 max-w-[68ch]">
              A league is four friends, one round each per week, over six weeks.
              Shoot yours whenever suits you — the week is the fixture, not the
              evening. The standings look after themselves.
            </Body>
          </>
        ) : (
          <>
            <H2 id="competitions">When you are next expected.</H2>
            <ul className="mt-6 flex flex-col gap-4">
              {record.leagues.map((league) => (
                <li key={league.id} className="border-t border-[var(--rule)]/30 pt-3">
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
                      {league.playerCount}{" "}
                      {league.playerCount === 1 ? "player" : "players"}
                    </Caption>
                  </div>

                  <Body className="mt-1">
                    {league.nextFixtureLabel ? (
                      <>
                        <Data muted={false}>{league.nextFixtureLabel}</Data>
                        <span className="text-[var(--ink-muted)]">
                          {` — still to shoot. Most play ${league.anchorWeekdayName}.`}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--ink-muted)]">
                        Season complete — all {league.seasonWeeks} weeks are in.
                      </span>
                    )}
                  </Body>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {canCaptainLeague(account.status) && (
            <Button href={routes.leagueNew} variant="primary">
              {record.leagues.length === 0 ? "Start a league" : "Start another"}
            </Button>
          )}
          <Button
            href={routes.leagueJoin}
            variant={canCaptainLeague(account.status) ? "secondary" : "primary"}
          >
            Join with a code
          </Button>
        </div>

        {/*
          §8.3's governing rule, stated to the member rather than only in the
          code. It is the sentence that makes member-created competitions safe
          to offer at all, and a member who understands it will trust the
          standings — "a member cannot corrupt the record, an organiser cannot
          adjust a result".
        */}
        <Caption className="mt-6 block max-w-[68ch]">
          Scores are recorded at the lane by a range officer, against your name.
          Nothing entered anywhere else counts, including here.
        </Caption>
      </Section>
    </>
  );
}

/* ============================================================================
   THE LADDER'S OWN WORDS — used the day it opens, and correct before then
   ========================================================================= */

function ordinal(position: number): string {
  const tens = position % 100;
  if (tens >= 11 && tens <= 13) return `${position}th`;
  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
}

/**
 * Movement, stated plainly.
 *
 * Zero is a real answer and gets a real sentence. "No change" is a fact about a
 * member's fortnight; a blank space reads as the club having lost track.
 */
function movementLine(movement: number): string {
  if (movement === 0) return "No change since the last recount.";
  const places = Math.abs(movement) === 1 ? "place" : "places";
  return movement > 0
    ? `Up ${movement} ${places}.`
    : `Down ${Math.abs(movement)} ${places}.`;
}
