import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * A TEXT LINK THAT IS STILL A TAP TARGET.
 *
 * The portal is full of secondary actions that should not be buttons — "your
 * whole record", "the whole week", "renew your membership" inside a remedy
 * card. Styled as a button each would give a screen four equal-weight calls to
 * action and no hierarchy at all.
 *
 * ===========================================================================
 * WHY IT IS A COMPONENT RATHER THAN A CLASS STRING
 *
 * `npm run responsive` found it. The first version of these was an inline
 * `underline decoration-1 underline-offset-4` link, which measured 26px tall
 * against WCAG 2.5.5's 44px — on the remedy card, which is the one thing on
 * Today a member taps while standing at a desk, quite possibly holding
 * something in the other hand.
 *
 * There were six copies of that class string. Patching the one the audit named
 * would have left five, and the next person to add a seventh would have copied
 * whichever they found first. So the padding, the minimum height and the
 * underline live here, and the audit has one place to fail.
 *
 * The negative inline margin is what keeps it looking like a link: the target
 * grows outward from the text on both sides rather than indenting it, so the
 * left edge still lines up with the paragraph above it.
 */
export function QuietAction({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        /* 44px of height, and enough width that the target is not a hairline
           on a short label. */
        "inline-flex min-h-[44px] items-center px-1 -mx-1",
        "text-body font-display font-bold text-[var(--ink)]",
        "underline decoration-1 underline-offset-4",
        "decoration-[color-mix(in_srgb,var(--ink)_45%,transparent)]",
        className,
      )}
    >
      {children}
    </Link>
  );
}
