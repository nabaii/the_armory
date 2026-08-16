import { cache } from "react";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { isDatabaseConfigured } from "@/db/client";
import { leaguesForMember } from "@/server/leagues/repository";
import { nextFixture, weekdayName } from "@/server/leagues/fixtures";
import { shootingFor, type ShootingSummary } from "./shooting";

/**
 * THE MEMBER'S COMPETITIVE RECORD — Members Portal §8.4.
 *
 *   "DESIGN RULE — One read model, not four ad hoc joins.
 *
 *    Compete is the only member-facing surface that spans both schemas. The
 *    leagues product lives in `public`; rounds, sessions and people live in
 *    `armory`; the two meet at `public.members.person_id`. Every query on this
 *    tab crosses that boundary. Build one read model for the member's
 *    competitive record rather than letting components join across schemas as
 *    they need to. Without it the join is reimplemented in four places with
 *    three different definitions of a personal best, and the first member to
 *    notice that their profile and the ladder disagree will be right."
 *
 * ===========================================================================
 * THE RULE IS ABOUT DEFINITIONS, NOT ABOUT ROUND TRIPS
 *
 * The cost being avoided is not the queries. It is that "personal best" is a
 * decision — whether a superseded card counts, whether a format change resets
 * it, whether a guest visit before joining is part of the member's history —
 * and a decision made in four components is four decisions.
 *
 * So this module is the only place either half of the system is asked about a
 * member's competitive standing, and every screen on Compete, the last-round
 * card on Today, and the keepsake card when it ships read from here. The
 * definitions live one layer further down, in src/domain/scoring.ts, which is
 * pure and tested; this assembles them across the boundary.
 *
 * ===========================================================================
 * WHY THIS ID PAIR IS THE ARGUMENT AND NOT A MEMBER OBJECT
 *
 * The two halves identify a person differently — `public.members.id` for the
 * leagues product, `armory.people.id` for everything else — and the join
 * between them is a nullable column. Taking both ids explicitly makes the
 * caller resolve that link (`resolveArmoryMember` does it once) rather than
 * letting this module re-derive it, and makes it impossible to call with one
 * half of a mismatched pair.
 */

export type CompetitiveRecord = {
  /** Every scored round, personal bests and the trend. §8.1's "Your record". */
  readonly shooting: ShootingSummary;
  /** Leagues this member is playing, with the week they owe. §8.1's fixtures. */
  readonly leagues: readonly LeagueStanding[];
  /**
   * The club Ladder position.
   *
   * Null until the Ladder opens — §8.6. NOT zero, and not a position of one in
   * a field of one, either of which would be a number the club had invented.
   */
  readonly ladder: LadderPosition | null;
};

export type LeagueStanding = {
  readonly id: string;
  readonly name: string;
  readonly playerCount: number;
  readonly roundsPlayed: number;
  readonly seasonWeeks: number;
  /** What the member owes this week, already phrased. Null when the season is done. */
  readonly nextFixtureLabel: string | null;
  readonly anchorWeekdayName: string;
};

export type LadderPosition = {
  readonly position: number;
  readonly of: number;
  /** Places gained or lost since the last recompute. Zero is a real answer. */
  readonly movement: number;
};

/**
 * Cached per request.
 *
 * Compete renders three regions from this and Today renders one card. Without
 * `cache` a single page load would run the whole cross-schema read four times,
 * and — worse — a slow query would make the four disagree if a round landed
 * between them. One read per request means every region on the screen is
 * describing the same instant.
 */
export const competitiveRecordFor = cache(
  async (ids: {
    readonly personId: string;
    readonly memberId: string;
  }): Promise<CompetitiveRecord> => {
    const empty: CompetitiveRecord = {
      shooting: { history: [], bests: [], cardCount: 0, mostRecent: null },
      leagues: [],
      ladder: null,
    };

    if (!isDatabaseConfigured() || !isArmoryDatabaseConfigured()) return empty;

    /* Both halves in parallel. They are independent reads on one pool, and the
       member is waiting on the slower of the two either way. */
    const [shooting, summaries] = await Promise.all([
      shootingFor(getArmoryDb(), ids.personId),
      leaguesForMember(ids.memberId),
    ]);

    const leagues: LeagueStanding[] = summaries.map(
      ({ league, season, playerCount, roundsPlayed }) => {
        /* Weeks, never dates. Leagues Spec §8: "Show week numbers, not dates."
           A dated table of named members is a record of who was in the building
           and when. */
        const next = nextFixture({
          roundsSubmitted: roundsPlayed,
          seasonWeeks: season.roundCount,
        });

        return {
          id: league.id,
          name: league.name,
          playerCount,
          roundsPlayed,
          seasonWeeks: season.roundCount,
          nextFixtureLabel:
            next.status === "season-complete" ? null : next.fixture.label,
          anchorWeekdayName: weekdayName(league.anchorWeekday),
        };
      },
    );

    return {
      shooting,
      leagues,
      /**
       * §8.2, §8.6. The Ladder ships when a roster exists to populate it, and
       * its two open items — the rolling window length and the season prize —
       * are the club's decisions, not engineering.
       *
       * Null rather than a computed position, because a ladder computed from a
       * club's first month ranks whoever happened to shoot most, and the member
       * who reads it as a statement about their shooting is being misled by
       * their own club. §8.6 specifies what renders instead: the accrual
       * statement, which is true today and becomes a position later.
       */
      ladder: null,
    };
  },
);

/**
 * §8.6's accrual statement, as a sentence.
 *
 *   "Until a roster exists, this region carries a single honest statement of
 *    accrual — 37 rounds recorded. Your position appears when the Ladder opens.
 *    That is not a placeholder."
 *
 * It lives here rather than in the page because the number and the claim have
 * to move together: the day the Ladder opens, this function returns null and
 * the region renders a position instead. A sentence written into a component
 * would have to be found and deleted by whoever ships that.
 */
export function accrualStatement(record: CompetitiveRecord): string | null {
  if (record.ladder) return null;

  const { cardCount } = record.shooting;

  /* Nothing recorded yet is a different sentence, and it must not read as a
     failure. A member who has never shot has not fallen behind — they have not
     started, and the club is telling them the counting begins when they do. */
  if (cardCount === 0) {
    return "Your rounds are recorded from your first session. Your position appears when the Ladder opens.";
  }

  return `${cardCount} ${cardCount === 1 ? "round" : "rounds"} recorded. Your position appears when the Ladder opens.`;
}
