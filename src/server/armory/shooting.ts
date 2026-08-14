import { desc, eq } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  cardsUntilTrend,
  describeScore,
  formatById,
  personalBests,
  standingRounds,
  trendFor,
  type ScoredRound,
} from "@/domain/scoring";

/**
 * A PERSON'S SHOOTING — §6.2's My shooting, and §6.3's result page.
 *
 *   §6.2: "Score history, personal best by discipline, trend. Phase 1 shows
 *    history; Phase 2 adds standing."
 *   §6.3, the guest link: "After the session it becomes their result page —
 *    their score, and a route to apply."
 *
 * ===========================================================================
 * ONE READ, TWO AUDIENCES, AND THE SECOND IS THE COMMERCIAL ONE
 *
 * A member opens this to see whether they are improving. A guest opens the same
 * data, on the link they were sent, having shot for the first time an hour ago
 * — and §3.2 makes that moment the club's whole acquisition funnel.
 *
 * So this function takes a person id and knows nothing about membership. A
 * guest has a person record (§3.1: applicant, guest and member are states of a
 * person, not separate tables), participations, and rounds against them. There
 * is no second query path for guests and no branch below that mentions them,
 * which is the only way to be sure the two surfaces show the same thing.
 *
 * ===========================================================================
 * THE ARITHMETIC IS NOT HERE
 *
 * Corrections, personal bests and trend are all decided by src/domain/
 * scoring.ts, which is pure and tested. This module reads rows and hands them
 * over. That split is the same one §4 forces on permissions and for the same
 * reason: a rule that can only be exercised with Postgres running is a rule
 * nobody re-checks.
 */

export type ShootingHistoryEntry = {
  readonly id: string;
  readonly discipline: string;
  readonly format: string;
  /** The format's label, or the raw id for a format since retired. */
  readonly formatLabel: string;
  /** As a person reads it — see `describeScore`. Never the stored integer. */
  readonly reads: string;
  readonly capturedAt: Date;
  /** True where a later round supersedes this one (§1.2 rule 3). */
  readonly superseded: boolean;
};

export type ShootingBest = {
  readonly discipline: string;
  readonly formatLabel: string;
  readonly reads: string;
  readonly capturedAt: Date;
  /** One line, or null where there are not enough cards yet. */
  readonly trend: string | null;
  /** How many more cards before a trend exists. Zero once there is one. */
  readonly cardsUntilTrend: number;
};

export type ShootingSummary = {
  readonly history: readonly ShootingHistoryEntry[];
  readonly bests: readonly ShootingBest[];
  /** Cards that still stand. The number a person means by "how many". */
  readonly cardCount: number;
  readonly mostRecent: ShootingHistoryEntry | null;
};

export async function shootingFor(
  tx: ArmoryReader,
  personId: string,
): Promise<ShootingSummary> {
  /**
   * Rounds reached through the person's participations.
   *
   * `rounds` has no person column — §3.3 hangs a round off a participation,
   * which is what ties a score to a visit, a lane and a session. The join is
   * the price of that, and it is the right shape: a score that existed without
   * a visit would be a score nobody could place.
   */
  const rows = await tx
    .select({
      id: schema.rounds.id,
      discipline: schema.rounds.discipline,
      format: schema.rounds.format,
      totalScore: schema.rounds.totalScore,
      capturedAt: schema.rounds.capturedAt,
      correctsRoundId: schema.rounds.correctsRoundId,
    })
    .from(schema.rounds)
    .innerJoin(
      schema.participations,
      eq(schema.participations.id, schema.rounds.participationId),
    )
    .where(eq(schema.participations.personId, personId))
    .orderBy(desc(schema.rounds.capturedAt));

  const scored: ScoredRound[] = rows.map((row) => ({
    id: row.id,
    discipline: row.discipline,
    format: row.format,
    totalScore: row.totalScore,
    capturedAt: row.capturedAt,
    correctsRoundId: row.correctsRoundId,
  }));

  const standing = standingRounds(scored);
  const standingIds = new Set(standing.map((round) => round.id));

  /**
   * History shows superseded cards, marked.
   *
   * The alternative — hiding them — was rejected because §1.2 rule 3 makes a
   * correction a visible act rather than an erasure, and because the person
   * most likely to look is the one who remembers shooting a 578 and now sees a
   * 478. A history that had quietly dropped the first would read as the club
   * having changed their score without telling them.
   */
  const history: ShootingHistoryEntry[] = standingRounds(scored)
    .concat(scored.filter((round) => !standingIds.has(round.id)))
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
    .map((round) => ({
      id: round.id,
      discipline: round.discipline,
      format: round.format,
      formatLabel: formatById(round.format)?.label ?? round.format,
      reads: readable(round.format, round.totalScore),
      capturedAt: round.capturedAt,
      superseded: !standingIds.has(round.id),
    }));

  const bests: ShootingBest[] = personalBests(scored).map((best) => {
    const trend = trendFor(scored, best.format);

    return {
      discipline: best.discipline,
      formatLabel: formatById(best.format)?.label ?? best.format,
      reads: readable(best.format, best.totalScore),
      capturedAt: best.capturedAt,
      trend: trend?.line ?? null,
      cardsUntilTrend: cardsUntilTrend(scored, best.format),
    };
  });

  return {
    history,
    bests,
    cardCount: standing.length,
    mostRecent: history.find((entry) => !entry.superseded) ?? null,
  };
}

/**
 * A stored score as a person reads it.
 *
 * A format the table no longer holds falls back to the raw integer rather than
 * guessing a scale. Guessing would be worse than plain: a decimal card rendered
 * as a whole number reads as a ten-fold improvement.
 */
function readable(format: string, totalScore: number): string {
  const known = formatById(format);
  return known ? describeScore(known, totalScore) : String(totalScore);
}
