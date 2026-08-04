import { cn } from "@/lib/cn";
import { Reticle } from "@/components/brand/Reticle";
import { site } from "@/lib/site";

/* ============================================================================
   THE LOCKUP

   Brand Guidelines §2, quoted because it is the single most load-bearing rule
   in the identity:

     "'SHOOTING SPORTS CLUB' is not an optional tagline. It is the element that
      files the name under sport rather than weaponry, and it does the heaviest
      positioning work in the identity. Use the wordmark without the descriptor
      only where the audience already knows the brand and space is genuinely
      constrained — embroidery, favicon, avatar. Never on first contact, never
      on the website header, never on signage."

   This component therefore has no variant that renders the wordmark without
   the descriptor. The `reticle` variant drops BOTH, which is the only
   permitted reduction, and is restricted to favicons and avatars.

   ----------------------------------------------------------------------------
   WORDMARK — OPTION B, interim implementation

   §3 flags a real tension: the supplied wordmark is set in a military stencil,
   "the segmented lettering of ammunition crates and ordnance boxes", which
   "pulls toward precisely the association this project exists to escape".
   Three options are offered; B is recommended — retain the reticle and the
   lockup structure, redraw the wordmark in a precision grotesque.

   Pending that redraw, the wordmark here is live text in Archivo at its
   expanded width. That is a faithful interim for Option B, it keeps the
   wordmark accessible and selectable, and it means the swap to a real vector
   is one file. It is NOT the supplied stencil, deliberately — shipping the
   stencil would be choosing Option A by default rather than deliberately,
   which §3 explicitly warns against.

   Tracked as a launch blocker: content-gate `logo-vector`.
   ========================================================================= */

type Variant = "horizontal" | "stacked" | "reticle";

/**
 * Minimum sizes from §3. Enforced in CSS rather than left to the caller,
 * because "below this the descriptor becomes illegible".
 *   with descriptor : 140px digital
 *   reticle alone   :  24px
 */
const MIN = {
  horizontal: "min-w-[140px]",
  stacked: "min-w-[140px]",
  reticle: "min-w-[24px]",
} as const;

export function Lockup({
  variant = "horizontal",
  mono = false,
  className,
  /**
   * `true` when the lockup is the site's home link, so the accessible name is
   * carried by the surrounding anchor rather than duplicated here.
   */
  decorative = false,
}: {
  variant?: Variant;
  mono?: boolean;
  className?: string;
  decorative?: boolean;
}) {
  /* Reticle alone. Favicon, avatar, embossing, embroidery, watermark — "only
     where the brand is already known". Never a first-contact surface. */
  if (variant === "reticle") {
    return (
      <Reticle
        mono={mono}
        className={cn("size-3", MIN.reticle, className)}
        title={decorative ? undefined : site.legalName}
      />
    );
  }

  const stacked = variant === "stacked";

  return (
    <span
      className={cn(
        "inline-flex select-none",
        stacked ? "flex-col items-center gap-1" : "flex-row items-center gap-2",
        MIN[variant],
        className,
      )}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : site.legalName}
    >
      {/* Clear space equal to the diameter of the centre dot, on all sides.
          The dot is r=9 of a 100 viewBox, so 18% of the reticle's own width. */}
      <Reticle mono={mono} className="size-4 shrink-0 p-[3%]" />

      <span
        className={cn(
          "flex flex-col",
          stacked ? "items-center" : "items-start",
        )}
        aria-hidden={decorative ? undefined : true}
      >
        {/* WORDMARK — Archivo expanded, tight tracking. Option B interim. */}
        <span className="u-display-wide text-h3 font-bold leading-none tracking-[-0.02em] uppercase">
          The Armory
        </span>

        {/* DESCRIPTOR — squared, wide-tracked small caps. Never omitted.
            Sized relative to the wordmark, with an 8px floor so it cannot fall
            below legibility even if a caller shrinks the lockup.
            Optical alignment: wide tracking adds trailing space after the final
            letter, so the negative right margin re-aligns it to the wordmark. */}
        <span
          className={cn(
            "u-display-wide tracking-descriptor -mr-[0.22em]",
            "mt-[0.4em] font-bold uppercase leading-none",
            "text-[max(0.5rem,0.36em)]",
          )}
        >
          {site.descriptor}
        </span>
      </span>
    </span>
  );
}
