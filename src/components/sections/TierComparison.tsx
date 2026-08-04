import { cn } from "@/lib/cn";
import { Body, Caption, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { CentreDot } from "@/components/brand/Reticle";
import { Pending } from "@/components/ui/Pending";
import { routes } from "@/lib/site";
import { GATED_PRICE, type Tier } from "@/lib/content";

/* ============================================================================
   TIER COMPARISON — spec §5: "Three columns, inclusions, gated pricing,
   per-tier CTA. Stacks on mobile."

   ----------------------------------------------------------------------------
   THE PRICE IS NOT A PRICE, AND CANNOT BECOME ONE

   Spec §9, acceptance criterion: "No membership price is published anywhere on
   the public site." Spec §3: prices are "gated: display 'On application' with
   an enquiry CTA, not a number."

   This is the most fragile rule in the specification. It survives design
   review, and then breaks in week three when someone reasonably suggests that
   a number would reduce enquiry friction. So `Tier.price` is a literal type
   with one legal value, and this component renders the constant rather than
   the field. There is no code path that prints a figure.

   The reason is positioning, not secrecy. From the Brief: membership must read
   as "access to a room, not a subscription to a facility", and "nobody buys a
   status membership from a button". The application IS the conversion event.

   ----------------------------------------------------------------------------
   COLOUR ENCODES ACCESS

   Brand Guidelines §4 asks that VIP Teal be reserved for member and VIP
   contexts so "it should feel earned". The top tier therefore renders on VIP
   Teal — the physical colour of the VIP deck furniture — and lower tiers stay
   on Terrazzo. The hierarchy is felt before a word is read, and it mirrors the
   building rather than being invented on a spreadsheet.

   Teal is single-ink (Chalk only clears AA on it), so the teal column carries
   no muted secondary text; it differentiates by weight and size instead.
   ========================================================================= */

const REGISTER: Record<Tier["register"], string> = {
  neutral:
    "bg-terrazzo [--ink:var(--color-reticle-black)] [--ink-muted:var(--color-sight-ink)] [--rule:var(--color-sight-grey)] [--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
  member:
    "bg-terrazzo [--ink:var(--color-reticle-black)] [--ink-muted:var(--color-sight-ink)] [--rule:var(--color-sight-grey)] [--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
  /* Single-ink ground: --ink-muted intentionally equals --ink. */
  vip: "bg-vip-teal [--ink:var(--color-chalk)] [--ink-muted:var(--color-chalk)] [--rule:var(--color-soffit-blue)] [--btn-fill:var(--color-chalk)] [--btn-fill-ink:var(--color-reticle-black)]",
};

export function TierComparison({
  tiers,
  className,
}: {
  tiers: readonly Tier[];
  className?: string;
}) {
  if (tiers.length === 0) {
    return (
      <div className={cn("border border-dashed border-sight-grey/50 p-4", className)}>
        <Pending label="Membership tiers — names, inclusions, founding cap (Founder)" />
        <Caption className="mt-2">
          Structure is built; values are content. Three tiers are assumed — an
          entry pass, the full membership, and a scarce top tier. Awaiting the
          founder&rsquo;s open decision on names and cap.
        </Caption>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-3",
        tiers.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2",
        className,
      )}
    >
      {tiers.map((tier) => (
        <TierColumn key={tier.slug} tier={tier} />
      ))}
    </div>
  );
}

function TierColumn({ tier }: { tier: Tier }) {
  return (
    <article
      className={cn(
        "flex flex-col p-3 lg:p-4",
        REGISTER[tier.register],
        tier.register === "vip" && "lg:-my-2 lg:py-6",
      )}
    >
      {tier.founding && (
        <Kicker className="mb-2 flex items-center gap-1" muted={false}>
          <CentreDot className="size-[5px]" />
          Founding cohort
        </Kicker>
      )}

      <H3>{tier.name}</H3>

      <Body muted className="mt-1">
        {tier.positioning}
      </Body>

      {/* Gated. The constant, never the field — and never a number. */}
      <p className="mt-3">
        <span className="font-display text-h3 font-bold text-[var(--ink)]">
          {GATED_PRICE}
        </span>
      </p>

      <ul className="mt-3 flex flex-1 flex-col gap-1">
        {tier.inclusions.map((inclusion) => (
          <li key={inclusion} className="flex gap-2 text-body text-[var(--ink)]">
            {/* The centre point as list bullet — Brand Guidelines §8. */}
            <span
              aria-hidden="true"
              className="mt-[0.6em] size-[5px] shrink-0 rounded-full bg-ten-ring-red"
            />
            <span>{inclusion}</span>
          </li>
        ))}
      </ul>

      {tier.founding && (
        <div className="mt-3 border-t border-[var(--rule)]/40 pt-2">
          <Caption muted={false}>{tier.founding.benefit}</Caption>
          {/* The cap renders only if it is genuine and permanent. A soft cap
              quietly exceeded "becomes a lie your best members eventually
              notice" — so an unresolved cap shows as outstanding, not as a
              plausible number. */}
          {tier.founding.cap === null && (
            <Pending label="Founding-member cap — is it real and permanent?" />
          )}
          {tier.founding.cap !== null && (
            <Caption className="mt-[2px]" muted={false}>
              Limited to {tier.founding.cap} founding members, closed
              permanently at launch.
            </Caption>
          )}
        </div>
      )}

      {/* Per-tier CTA. An application, not a checkout. */}
      <Button
        href={`${routes.enquire}?tier=${tier.slug}`}
        variant={tier.register === "vip" ? "primary" : "secondary"}
        className="mt-3 w-full"
      >
        Enquire about {tier.name}
      </Button>
    </article>
  );
}
