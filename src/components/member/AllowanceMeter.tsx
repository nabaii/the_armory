import { cn } from "@/lib/cn";
import { Body, Caption, Data } from "@/components/ui/Text";
import { formatDate } from "@/lib/time";

/**
 * GUEST ALLOWANCE — Members Portal §11, used at booking step four and Me → Guests.
 *
 * ===========================================================================
 * THE COPY RULE THIS COMPONENT EXISTS TO HOLD
 *
 * §7.4, on overage friction:
 *
 *   "The charge appears once, at confirmation, as a line item. It is not
 *    confirmed twice, not warned about in advance, and not accompanied by a
 *    note that the allowance is exhausted. A member who performs mental
 *    arithmetic before inviting someone invites fewer people, and invitations
 *    are the only growth channel the club has."
 *
 * That is a rule about what this component MUST NOT DO, and it is the reason it
 * is one component rather than a number rendered wherever it is needed. Left to
 * individual screens, "2 of 6 remaining — after that, guests cost ₦X" would
 * appear somewhere within a month, because it is helpful and it is true. It is
 * also the sentence that makes a member invite one person instead of three.
 *
 * So: this states what remains and when the period turns. The overage price is
 * shown ONLY when `overage` is passed, which is only at confirmation, where the
 * member is committing to a specific number of guests and the charge is a line
 * item they are about to accept.
 *
 * ===========================================================================
 * AND IT NEVER SAYS "EXHAUSTED"
 *
 * Zero remaining renders as a fact about the period, not as a wall. The member
 * may still bring a guest — §4.2 blocks only when the allowance is spent AND
 * overage is declined, "an accepted overage is a sale, not a block" — and a
 * meter that announced a wall would be contradicting the capability service on
 * the screen where the member decides.
 */

export function AllowanceMeter({
  remaining,
  included,
  periodEnd,
  overage,
  className,
}: {
  readonly remaining: number;
  readonly included: number;
  /** When this allowance period turns over. */
  readonly periodEnd: Date;
  /**
   * The overage line, at confirmation only.
   *
   * `price` is already formatted in the club's currency by the money layer —
   * this component never touches kobo, because a number formatted twice is a
   * number formatted differently in two places.
   */
  readonly overage?: { readonly count: number; readonly price: string };
  readonly className?: string;
}) {
  const used = Math.max(0, included - remaining);

  return (
    <div className={cn("", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Body>
          <Data muted={false}>{remaining}</Data>
          <span className="text-[var(--ink-muted)]">
            {` guest ${remaining === 1 ? "visit" : "visits"} included, of ${included}`}
          </span>
        </Body>
        <Caption>Resets {formatDate(periodEnd)}</Caption>
      </div>

      {/*
        The bar is decorative and marked so. Every fact it draws is in the
        sentence above it, which is the order that survives a screen reader, a
        printed page and a member squinting at a phone in sunlight.
      */}
      {included > 0 && (
        <div
          aria-hidden="true"
          className="mt-1 flex gap-[3px]"
        >
          {Array.from({ length: included }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-[6px] flex-1 rounded-full",
                index < used
                  ? "bg-[var(--ink)]/25"
                  : "bg-[var(--ink)]",
              )}
            />
          ))}
        </div>
      )}

      {/*
        §7.4. Once, here, at the moment of commitment — never in advance, and
        never as a warning attached to the meter above.
      */}
      {overage && (
        <Body className="mt-2">
          {overage.count === 1
            ? `1 guest beyond your included visits — ${overage.price}.`
            : `${overage.count} guests beyond your included visits — ${overage.price}.`}
        </Body>
      )}
    </div>
  );
}
