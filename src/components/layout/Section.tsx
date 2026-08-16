import { cn } from "@/lib/cn";
import { Container } from "@/components/layout/Container";

/* ============================================================================
   SECTION — the ground system, and the access register.

   Brand Guidelines §4 asks that Soffit Blue and VIP Teal "encode access":
   blue for open, welcoming contexts (first visit, snack bar, groups), teal for
   member and VIP contexts. That mirrors the actual deck furniture and makes
   the tiering legible "without a word of copy". This component is where that
   becomes structural rather than decorative.

   ----------------------------------------------------------------------------
   SINGLE-INK GROUNDS — a measured constraint, not a stylistic preference.

   Every foreground/ground pair in the palette was tested against WCAG 2.1 AA.
   Three grounds turn out to admit exactly ONE compliant body-text colour:

     Range Teak    #8A5A2E  → Chalk only (5.38:1). Terrazzo is 4.13, fails.
     VIP Teal      #2F6E78  → Chalk only (5.32:1). Terrazzo is 4.08, fails.
     Soffit Blue   #8FA6B2  → Reticle Black only (5.64:1). Never white/Chalk.

   Charred Timber is the exception and carries a full palette of compliant
   inks (Chalk 14.05, Terrazzo 10.78, Deck Oak 5.90, Soffit Blue 6.03).

   Consequence for design: Teak, Teal and Soffit Blue are SHORT-COPY accent
   panels — tier cards, pull quotes, CTA blocks. Long-form dark sections and
   the footer must use Charred Timber, which is the only dark ground that can
   carry layered text at three levels.

   Implementation: single-ink grounds resolve `--ink-muted` to `--ink`, so a
   component asking for muted text degrades to full ink instead of silently
   shipping a contrast failure. Differentiate secondary text there with size
   and weight instead of colour.
   ========================================================================= */

export type Ground =
  | "chalk"
  | "terrazzo"
  | "charred"
  | "teak"
  | "teal"
  | "soffit";

/* ----------------------------------------------------------------------------
   Ground → Tailwind classes. Each ground publishes four custom properties that
   descendants consume, so no component ever chooses its own colour:

     --ink         primary text        (always >= 4.5:1 on this ground)
     --ink-muted   secondary text      (== --ink on single-ink grounds)
     --rule        dividers, hairlines
     --btn-fill / --btn-fill-ink   primary CTA

   The primary CTA fill is NOT Ten Ring Red everywhere, and that is deliberate
   on two counts. First, non-text contrast: a #C81E24 fill measures only 2.67:1
   against Charred Timber and 2.25:1 against Soffit Blue, so the button's own
   edge would be hard to make out. Second, the 70/25/5 discipline — "red is a
   point, never a plane". So red owns the CTA on the light neutral grounds where
   it is legible and where the eye expects it, and dark grounds invert to a
   Chalk fill (14.05:1 / 5.38:1 / 5.32:1 edge contrast). Where red is displaced,
   it returns as the centre-dot marker instead, which is its role in §8 anyway.
   ------------------------------------------------------------------------- */

const GROUNDS: Record<Ground, { classes: string; singleInk: boolean }> = {
  /** Default page ground. The white render of the buildings. */
  chalk: {
    classes:
      "bg-chalk text-reticle-black [--ink:var(--color-reticle-black)] [--ink-muted:var(--color-sight-ink)] [--rule:var(--color-sight-grey)] [--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
    singleInk: false,
  },
  /** The signature surface of the building. Section grounds, cards, panels. */
  terrazzo: {
    classes:
      "bg-terrazzo text-reticle-black [--ink:var(--color-reticle-black)] [--ink-muted:var(--color-sight-ink)] [--rule:var(--color-sight-grey)] [--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
    singleInk: false,
  },
  /** Ribbed cladding. Dark sections, footers, the night register. */
  charred: {
    classes:
      "bg-charred-timber text-chalk [--ink:var(--color-chalk)] [--ink-muted:var(--color-terrazzo)] [--rule:var(--color-gabion-stone)] [--btn-fill:var(--color-chalk)] [--btn-fill-ink:var(--color-reticle-black)]",
    singleInk: false,
  },
  /** Firing-line counters and lattice. The strongest anti-tactical signal. */
  teak: {
    classes:
      "bg-range-teak text-chalk [--ink:var(--color-chalk)] [--ink-muted:var(--color-chalk)] [--rule:var(--color-deck-oak)] [--btn-fill:var(--color-chalk)] [--btn-fill-ink:var(--color-reticle-black)]",
    singleInk: true,
  },
  /** MEMBER register. Deeper and more private — it should feel earned. */
  teal: {
    classes:
      "bg-vip-teal text-chalk [--ink:var(--color-chalk)] [--ink-muted:var(--color-chalk)] [--rule:var(--color-soffit-blue)] [--btn-fill:var(--color-chalk)] [--btn-fill-ink:var(--color-reticle-black)]",
    singleInk: true,
  },
  /** OPEN register. Calm, hospitable. First visit, snack bar, groups. */
  soffit: {
    classes:
      "bg-soffit-blue text-reticle-black [--ink:var(--color-reticle-black)] [--ink-muted:var(--color-reticle-black)] [--rule:var(--color-reticle-black)] [--btn-fill:var(--color-reticle-black)] [--btn-fill-ink:var(--color-chalk)]",
    singleInk: true,
  },
};

/**
 * Vertical rhythm. Spec §6: "Generous vertical rhythm. Whitespace is the
 * primary signal of premium positioning — do not compress sections to reduce
 * scroll." Values stay inside the documented 8px scale.
 */
const RHYTHM = {
  tight: "py-8 lg:py-12", //  64 → 96
  default: "py-12 lg:py-16", //  96 → 128
  flush: "py-0",
} as const;

export function Section({
  children,
  ground = "chalk",
  rhythm = "default",
  bleed = false,
  className,
  id,
  "aria-labelledby": ariaLabelledBy,
}: {
  children: React.ReactNode;
  ground?: Ground;
  rhythm?: keyof typeof RHYTHM;
  /** Skip the Container — for full-bleed photography. */
  bleed?: boolean;
  className?: string;
  id?: string;
  "aria-labelledby"?: string;
}) {
  const g = GROUNDS[ground];
  return (
    <section
      id={id}
      aria-labelledby={ariaLabelledBy}
      data-ground={ground}
      data-single-ink={g.singleInk || undefined}
      className={cn(g.classes, RHYTHM[rhythm], className)}
    >
      {bleed ? children : <Container>{children}</Container>}
    </section>
  );
}

/** Exposed for the /brand reference page. */
export const groundNames = Object.keys(GROUNDS) as Ground[];
export const isSingleInk = (g: Ground) => GROUNDS[g].singleInk;

/**
 * A ground's colour contract, for a panel nested inside a different one.
 *
 * ===========================================================================
 * WHY THIS IS EXPORTED, AND WHEN IT IS THE RIGHT ANSWER
 *
 * Almost never. A `Section` establishes a ground and everything inside it
 * consumes `--ink`, `--rule` and the rest without choosing a colour, which is
 * the whole discipline this file enforces. Reaching for these classes directly
 * is how a component starts picking colours again.
 *
 * There is one case it does not cover, and it is a measured one rather than a
 * stylistic preference. Some marks are BRAND colours with a fixed value — the
 * Ten Ring Red centre dot most of all — and their contrast is a property of
 * what is behind them. Red measures 3.79:1 on Chalk and 1.68:1 on Soffit Blue,
 * so a red dot rendered inside a Soffit Blue section is a non-text indicator
 * at half the ratio WCAG 2.1 requires, and no amount of consuming `--ink`
 * fixes it because the dot is not ink.
 *
 * `BottomNav` hit this first and solved it the same way: rather than pick a
 * different red — which Brand Guidelines §3 forbids, and which would make the
 * dot a different dot on one surface — it gives the marker the opaque ground
 * the brand already guarantees it. This is that move, made reusable.
 *
 * So: use it to give a small panel a ground of its own, and never to colour
 * type. If what you want is text in a different colour, you want a `Section`.
 */
export const groundClasses = (ground: Ground): string => GROUNDS[ground].classes;
