import { cn } from "@/lib/cn";

/* ============================================================================
   THE RETICLE

   Brand Guidelines §3: "a segmented reticle — a grey ring with black tick
   elements and a solid red centre dot".

   Why this is the protected asset: "The reticle is a targeting device, not a
   weapon. It signals aim, focus and precision without depicting a firearm.
   This is exactly right, and it should be protected: the entire graphic system
   can be built from targets, rings, centres and scoring, and never from guns."

   The centre dot is "the brand's entire aggression budget" — one point of red
   against warm neutrals. It is red or it is absent; it is never another colour.

   ⚠ PLACEHOLDER. §3 says "Do not recreate the lockup. Use supplied vector
   files." This is a build-time stand-in drawn to the written description so
   layout, spacing and minimum sizes can be developed and tested. It is tracked
   as a launch blocker in src/lib/content-gate.ts (`logo-vector`), and swapping
   it is a single-file replacement.
   ========================================================================= */

export function Reticle({
  className,
  mono = false,
  title,
}: {
  className?: string;
  /**
   * Single-colour variant for engraving, embroidery and single-colour print.
   * Renders in `currentColor` — Reticle Black on light grounds, Chalk on dark.
   * The dot is omitted rather than recoloured, per the misuse rules.
   */
  mono?: boolean;
  /** Provide only when the reticle stands alone with no adjacent wordmark. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("block", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* The ring. Sight Grey is a genuine brand colour here, not a neutral. */}
      <circle
        cx="50"
        cy="50"
        r="41"
        fill="none"
        stroke={mono ? "currentColor" : "var(--color-sight-grey)"}
        strokeWidth="7"
      />

      {/* Tick elements at the cardinals — what makes the reticle "segmented".
          They overlay the ring so it reads as broken rather than continuous. */}
      <g
        stroke={mono ? "currentColor" : "var(--color-reticle-black)"}
        strokeWidth="9"
        strokeLinecap="butt"
      >
        <line x1="50" y1="2" x2="50" y2="24" />
        <line x1="50" y1="76" x2="50" y2="98" />
        <line x1="2" y1="50" x2="24" y2="50" />
        <line x1="76" y1="50" x2="98" y2="50" />
      </g>

      {/* The centre dot. The entire aggression budget. */}
      {!mono && <circle cx="50" cy="50" r="9" fill="var(--color-ten-ring-red)" />}
      {mono && <circle cx="50" cy="50" r="9" fill="currentColor" />}
    </svg>
  );
}

/* ----------------------------------------------------------------------------
   GRAPHIC DEVICES derived from the mark (Brand Guidelines §8).

   Restraint rule, quoted: "one device per composition. Rings, dots, mesh and
   oversized numerals in the same frame produce noise, and noise is the
   opposite of precision."
   ------------------------------------------------------------------------- */

/**
 * Concentric rings — target rings as structure. Dividers, low-opacity
 * watermarks, loading states, ladder and ranking graphics.
 */
export function ConcentricRings({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("block", className)}
      aria-hidden="true"
      focusable="false"
    >
      {[46, 36, 26, 16].map((r) => (
        <circle
          key={r}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
      <circle cx="50" cy="50" r="5" fill="currentColor" />
    </svg>
  );
}

/**
 * The centre point — a single red dot as marker. List bullets, active
 * navigation, map pins, current position on a ladder.
 */
export function CentreDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1 rounded-full bg-ten-ring-red", className)}
    />
  );
}
