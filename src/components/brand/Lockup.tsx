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
 *
 * ⚠ `min-w-[140px]` is a floor that CANNOT currently bind, and the number is
 * kept because it records the rule, not because it does work. Measured: the
 * live-text lockup is 191px at its default size and bottoms out at ~161px —
 * the descriptor is held at an 8px legibility floor, and "SHOOTING SPORTS
 * CLUB" at 8px with 130-unit tracking is 137px wide on its own. The 140px in
 * §3 is a figure for the DRAWN wordmark that Option B will deliver; it is not
 * reachable by Archivo set as live text. Do not "fix" this by lowering the
 * descriptor floor to make the number achievable — that trades a real
 * legibility guarantee for an arithmetic one.
 */
const MIN = {
  horizontal: "min-w-[140px]",
  stacked: "min-w-[140px]",
  reticle: "min-w-[24px]",
} as const;

/* ----------------------------------------------------------------------------
   SCALING — the lockup is ONE unit, driven by one font size.

   Previously only the wordmark carried a size (`text-h3`); the reticle was
   `size-4` and the gap was `gap-2`, both absolute. Two consequences, and the
   second is the one that mattered:

   1. A caller who made the wordmark smaller got a lockup with a reticle that
      did not move — the proportions §3 fixes were silently redrawn.
   2. The descriptor is sized in `em`, and with no font size on the lockup root
      that `em` resolved against the inherited BODY size (16px), not against
      the wordmark. So the descriptor sat at its 8px floor permanently and did
      not scale with the mark in either direction.

   Everything is now expressed in `em` against the root, so one custom property
   scales the whole lockup and the proportions are preserved by construction.
   The ratios below reproduce the previous rendering to within a sub-pixel at
   the default size (measured: 191.6px against 191.3px), so this is a
   refactor of the mechanism, not a change to the mark.

     --lockup-fs   the wordmark size, and the em base for everything else.
                   Defaults to the h3 token, which is what shipped before.
   -------------------------------------------------------------------------- */

const ROOT_SIZE = "[font-size:var(--lockup-fs,var(--text-h3))]";
/** 32px at the default 19px wordmark — the previous `size-4`. */
const RETICLE_SIZE = "size-[1.7em]";
/** 16px at the default 19px wordmark — the previous `gap-2`. */
const GAP_HORIZONTAL = "gap-[0.84em]";
/** 8px at the default 19px wordmark — the previous `gap-1`. */
const GAP_STACKED = "gap-[0.42em]";

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
        ROOT_SIZE,
        stacked
          ? `flex-col items-center ${GAP_STACKED}`
          : `flex-row items-center ${GAP_HORIZONTAL}`,
        MIN[variant],
        className,
      )}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : site.legalName}
    >
      {/* Clear space equal to the diameter of the centre dot, on all sides.
          The dot is r=9 of a 100 viewBox, so 18% of the reticle's own width. */}
      <Reticle mono={mono} className={cn(RETICLE_SIZE, "shrink-0 p-[3%]")} />

      <span
        className={cn(
          "flex flex-col",
          stacked ? "items-center" : "items-start",
        )}
        aria-hidden={decorative ? undefined : true}
      >
        {/* WORDMARK — Archivo expanded, tight tracking. Option B interim.
            `1em` rather than the h3 token directly: the root above resolves the
            token once, so the wordmark and the descriptor share one em base. */}
        <span className="u-display-wide text-[1em] font-bold leading-none tracking-[-0.02em] uppercase">
          The Armory
        </span>

        {/* DESCRIPTOR — squared, wide-tracked small caps. Never omitted.
            Sized relative to the wordmark, with an 8px floor so it cannot fall
            below legibility even if a caller shrinks the lockup. The `em` now
            resolves against the lockup root rather than against the inherited
            body size, so "relative to the wordmark" is finally true — this
            scales up with the mark, and stops at the floor on the way down.
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
