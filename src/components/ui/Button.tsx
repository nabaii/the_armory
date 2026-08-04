import Link from "next/link";
import { cn } from "@/lib/cn";

/* ============================================================================
   BUTTON / CTA

   The design problem the Brief sets: "signal exclusivity to the confident and
   welcome to the uncertain, on the same page, without diluting either. The
   headline sells the club; the second line rescues the hesitant. Lose the
   second line and you sell only to people who already feel entitled to be
   there."

   Resolution: EQUAL TAP TARGET, UNEQUAL VOICE.

   Both CTAs are the same height and the same font size, so neither is harder
   to hit on a phone. Dominance comes from fill alone. The spec asks for the
   secondary CTA to be "visually quieter but unmissable" — quieting it by
   shrinking it is precisely how a site loses the hesitant visitor, so it is
   quieted by removing its fill instead.

   Colour is inherited from the enclosing Section via --btn-fill and
   --btn-fill-ink, so a CTA is contrast-correct on every ground without being
   told which ground it is on. The ghost variant borders in full --ink, which
   is guaranteed >= 4.5:1 on its ground and therefore always clears the 3:1
   non-text contrast requirement.
   ========================================================================= */

type Variant = "primary" | "secondary";

const BASE = [
  // 48px tall on every variant. WCAG 2.5.5 wants 44px; this is a mobile-first
  // Nigerian audience and the booking flow has a three-minute budget.
  "inline-flex min-h-6 items-center justify-center gap-2",
  "px-4 py-2 rounded-control",
  "text-body font-display font-bold",
  "no-underline",
  "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-precision)]",
  // Never let a CTA label wrap mid-word on a narrow phone.
  "text-center [text-wrap:balance]",
].join(" ");

const VARIANTS: Record<Variant, string> = {
  /**
   * Apply for membership. Filled, and the loudest thing in its section.
   */
  primary: "bg-[var(--btn-fill)] text-[var(--btn-fill-ink)] hover:opacity-90",

  /**
   * Book a first visit. Hairline-ruled, label underlined for affordance.
   * Same size, quieter voice.
   */
  secondary: [
    "border border-[var(--ink)] text-[var(--ink)] bg-transparent",
    "underline decoration-1 underline-offset-4",
    "decoration-[color-mix(in_srgb,var(--ink)_45%,transparent)]",
    "hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]",
  ].join(" "),
};

export function Button({
  href,
  children,
  variant = "primary",
  className,
  dot = false,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  /**
   * Renders the centre-dot marker (Brand Guidelines §8) inside the label.
   * Useful on dark and Soffit Blue grounds, where the primary fill is not red
   * for contrast reasons — the dot keeps the brand accent present without
   * turning red into a plane.
   */
  dot?: boolean;
  /** For side effects on activation, e.g. dismissing the mobile nav panel. */
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(BASE, VARIANTS[variant], className)}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="size-1 shrink-0 rounded-full bg-ten-ring-red"
        />
      )}
      {children}
    </Link>
  );
}

/**
 * The homepage and page-level CTA pair.
 *
 * Stacks full-width on mobile so both are equally reachable with a thumb, sits
 * inline from 480px. The primary is always first in the DOM, so keyboard and
 * screen-reader order matches visual priority.
 */
export function CtaPair({
  primary,
  secondary,
  className,
}: {
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <Button href={primary.href} variant="primary">
        {primary.label}
      </Button>
      <Button href={secondary.href} variant="secondary">
        {secondary.label}
      </Button>
    </div>
  );
}
