import type { Metadata } from "next";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { shootingFor } from "@/server/armory/shooting";
import { formatWeekdayDate } from "@/lib/time";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, Data, H2, Kicker } from "@/components/ui/Text";

/**
 * MY SHOOTING — §6.2.
 *
 *   "Score history, personal best by discipline, trend. PHASE 1 SHOWS HISTORY;
 *    PHASE 2 ADDS STANDING."
 *
 * ===========================================================================
 * THE SECOND SENTENCE IS AN INSTRUCTION AND THIS PAGE OBEYS IT
 *
 * There is no ladder here, no position, no comparison against another member —
 * §13 puts all of that in Phase 2 and says plainly what Phase 1 is for: "Score
 * capture in Phase 1 exists to populate them."
 *
 * That is a restraint worth defending, because a half-built standing is worse
 * than none. A ladder computed from a club's first month ranks whoever happened
 * to shoot most, and the member who reads it as a statement about their
 * shooting is being misled by their own club.
 *
 * So this page answers three questions and stops: what have I shot, what is my
 * best card, and am I getting better.
 *
 * ===========================================================================
 * A TREND THAT DOES NOT EXIST YET SAYS SO, AND SAYS WHAT WOULD MAKE IT
 *
 * src/domain/scoring.ts refuses to report a trend below four cards, for reasons
 * set out at length there. A screen that simply showed nothing would leave a
 * member wondering whether the club had lost their scores.
 *
 * So the absence is stated, with the number of cards still needed — which is
 * also, and not accidentally, a reason to book again.
 */

export const metadata: Metadata = { title: "Your shooting" };

export const dynamic = "force-dynamic";

export default async function ShootingPage() {
  const resolution = await resolveArmoryMember();

  if (resolution.state === "signed_out") {
    return (
      <Section>
        <PageHeader title="Your shooting" />
        <Body>Sign in to see your scores.</Body>
      </Section>
    );
  }

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
      <Section>
        <PageHeader title="Your shooting" />
        <Body>
          {personId
            ? "The club's system is not reachable just now."
            : "The club has no shooting record against this account yet."}
        </Body>
      </Section>
    );
  }

  const summary = await shootingFor(getArmoryDb(), personId);

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Your shooting"
        title={
          summary.mostRecent
            ? `Your last card was ${summary.mostRecent.reads}`
            : "Your shooting"
        }
        lead={
          summary.cardCount === 0
            ? "Nothing recorded yet. Your first card appears here the evening you shoot it."
            : `${summary.cardCount} ${summary.cardCount === 1 ? "card" : "cards"} recorded.`
        }
      />

      {summary.bests.length > 0 && (
        <Section aria-labelledby="bests">
          <H2 id="bests">Your best cards</H2>

          <ul className="mt-6 grid gap-6 sm:grid-cols-2">
            {summary.bests.map((best) => (
              <li
                key={`${best.discipline}-${best.formatLabel}`}
                className="border-t border-[--color-terrazzo] pt-4"
              >
                <Kicker>{best.discipline}</Kicker>
                <Data className="mt-1">{best.reads}</Data>
                <Caption muted className="mt-1">
                  {best.formatLabel} · {formatWeekdayDate(best.capturedAt)}
                </Caption>
                <Body className="mt-2">
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

      {summary.history.length > 0 && (
        <Section ground="soffit" aria-labelledby="history">
          <H2 id="history">Every card</H2>

          <ul className="mt-6 divide-y divide-[--color-terrazzo]">
            {summary.history.map((entry) => (
              <li
                key={entry.id}
                className="flex items-baseline gap-4 py-3"
              >
                <span
                  className={`w-24 shrink-0 text-2xl tabular-nums ${
                    entry.superseded ? "line-through opacity-60" : ""
                  }`}
                >
                  {entry.reads}
                </span>
                <span className="min-w-0 flex-1">
                  <Caption>{entry.formatLabel}</Caption>
                  <Caption muted>
                    {entry.discipline} · {formatWeekdayDate(entry.capturedAt)}
                    {/* §1.2 rule 3: a correction is visible, not an erasure.
                        A member who remembers shooting a 578 must not find it
                        silently gone. */}
                    {entry.superseded && " · corrected"}
                  </Caption>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
