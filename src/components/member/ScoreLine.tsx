import { cn } from "@/lib/cn";
import { Body, Caption, Data } from "@/components/ui/Text";
import { formatDate } from "@/lib/time";

/**
 * ONE ROUND, RENDERED — Members Portal §11. Used by Today, Compete, and the
 * keepsake card when it ships.
 *
 *   "ScoreLine — One round rendered: score, discipline, date, relation to
 *    history."
 *
 * ===========================================================================
 * "RELATION TO HISTORY" IS THE WHOLE COMPONENT
 *
 * A number on its own tells a member almost nothing. 561 is a good card or a
 * bad one depending entirely on the last twelve, and the member who cannot tell
 * which is the member who stops caring about the number. So the fourth field is
 * not decoration — it is the reason the other three are worth rendering.
 *
 * It arrives as a sentence from src/domain/scoring.ts rather than being
 * computed here, for the same reason §8.4 gives about the read model: a
 * personal best is a DEFINITION, and a component that decided what counted as
 * one would be a fourth definition of it.
 *
 * ===========================================================================
 * TONE — §8.5, AND IT APPLIES HERE TOO
 *
 *   "A personal best is stated with precision and a small mark of respect. No
 *    confetti, no animation, no exclamation. A good club, not a mobile game."
 *
 * A personal best is marked by ONE word and the centre dot. Nothing moves,
 * nothing is congratulated, and the number is set in the same face at the same
 * size as every other number in the club's system. The restraint is the
 * respect: a club that celebrates a 561 the way a game celebrates a coin has
 * told the member what it thinks the 561 is worth.
 */

export type Score = {
  /** Already formatted by the scoring domain — "561", "203.4". Never a raw int. */
  readonly reads: string;
  readonly discipline: string;
  /** The format's own label — "60 shots, decimal". */
  readonly formatLabel: string;
  readonly capturedAt: Date;
  /** §11's fourth field, as a sentence. Null where there is not enough history. */
  readonly relation: string | null;
  readonly isPersonalBest?: boolean;
  /**
   * Whether a correction has superseded this card.
   *
   * Shown rather than hidden. §1.2 rule 3 makes a correction a visible act, and
   * the member most likely to look is the one who remembers shooting a 578 and
   * now sees a 478 — a history that had quietly dropped the first would read as
   * the club having changed their score without telling them.
   */
  readonly superseded?: boolean;
};

export function ScoreLine({
  score,
  className,
}: {
  score: Score;
  className?: string;
}) {
  return (
    <div className={cn("", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Data
          muted={false}
          className={cn(score.superseded && "line-through opacity-60")}
        >
          {score.reads}
        </Data>
        <Body muted>
          {score.discipline} · {score.formatLabel}
        </Body>

        {score.isPersonalBest && !score.superseded && (
          <span className="inline-flex items-center gap-1 u-kicker text-[var(--ink)]">
            <span
              aria-hidden="true"
              className="size-1 shrink-0 rounded-full bg-ten-ring-red"
            />
            Personal best
          </span>
        )}
      </div>

      <Caption className="mt-1">
        {formatDate(score.capturedAt)}
        {score.relation ? ` · ${score.relation}` : ""}
        {score.superseded ? " · Superseded by a correction" : ""}
      </Caption>
    </div>
  );
}
