/**
 * WCAG 2.1 relative luminance and contrast.
 *
 * This exists so the palette's accessibility is COMPUTED rather than asserted.
 * Spec §9 makes WCAG 2.1 AA an acceptance criterion and §4 of the Brand
 * Guidelines asks specifically that the red accent "be verified against WCAG AA
 * below 18px". A number written into a comment drifts the moment a hex changes;
 * a function does not.
 *
 * Used by the /brand reference page and by `npm run gate`.
 */

/** WCAG 2.1 relative luminance of an sRGB hex colour. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;

  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const linear = channels.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Contrast ratio between two hex colours, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Level = "AA body" | "AA large" | "fail";

/**
 * Thresholds:
 *   4.5:1  normal body text
 *   3.0:1  large text (>=24px, or >=18.66px bold), and non-text UI/graphics
 */
export function level(ratio: number): Level {
  if (ratio >= 4.5) return "AA body";
  if (ratio >= 3) return "AA large";
  return "fail";
}

export const round = (n: number) => Math.round(n * 100) / 100;

/* ---------------------------------------------------------------------------
   THE PALETTE, mirrored from tokens.css.

   Kept in TypeScript as well as CSS so it can be audited programmatically.
   These two lists must agree; `npm run gate` verifies the pairs below.
   -------------------------------------------------------------------------- */

export const palette = {
  "reticle-black": "#2A2A2B",
  "sight-grey": "#727377",
  "sight-ink": "#5A5B5E",
  "ten-ring-red": "#ED3036",
  "ten-ring-deep": "#C81E24",
  chalk: "#F6F5F2",
  terrazzo: "#DCD8D1",
  "range-teak": "#8A5A2E",
  "deck-oak": "#C29A63",
  "charred-timber": "#262523",
  "gabion-stone": "#9A9188",
  "soffit-blue": "#8FA6B2",
  "vip-teal": "#2F6E78",
  white: "#FFFFFF",
} as const;

export type PaletteName = keyof typeof palette;

/**
 * Pairs the build actually relies on. Each must hold at the stated level or
 * the gate fails — these are the combinations that appear in Section grounds,
 * Text components and Button variants.
 */
export const requiredPairs: Array<{
  fg: PaletteName;
  bg: PaletteName;
  need: "body" | "graphic";
  role: string;
}> = [
  // Light grounds — primary and secondary text
  { fg: "reticle-black", bg: "chalk", need: "body", role: "Body text on the default ground" },
  { fg: "sight-ink", bg: "chalk", need: "body", role: "Secondary text on Chalk" },
  { fg: "reticle-black", bg: "terrazzo", need: "body", role: "Body text on Terrazzo panels" },
  { fg: "sight-ink", bg: "terrazzo", need: "body", role: "Secondary text on Terrazzo" },

  // Dark grounds
  { fg: "chalk", bg: "charred-timber", need: "body", role: "Footer and dark-section text" },
  { fg: "terrazzo", bg: "charred-timber", need: "body", role: "Footer secondary text" },
  { fg: "chalk", bg: "range-teak", need: "body", role: "Text on Range Teak panels" },
  { fg: "chalk", bg: "vip-teal", need: "body", role: "Text on VIP Teal — member register" },
  { fg: "reticle-black", bg: "soffit-blue", need: "body", role: "Text on Soffit Blue — open register" },

  // Calls to action
  { fg: "white", bg: "ten-ring-deep", need: "body", role: "Primary CTA label on light grounds" },
  { fg: "reticle-black", bg: "chalk", need: "body", role: "Primary CTA label on dark grounds" },
  { fg: "chalk", bg: "reticle-black", need: "body", role: "Primary CTA label on Soffit Blue" },

  // Non-text: the brand accent and the focus ring, which only need 3:1
  { fg: "ten-ring-red", bg: "chalk", need: "graphic", role: "Centre dot / focus ring on Chalk" },
  { fg: "ten-ring-red", bg: "charred-timber", need: "graphic", role: "Centre dot / focus ring on Charred Timber" },
  { fg: "sight-grey", bg: "chalk", need: "graphic", role: "Hairline rules and dividers on Chalk" },

  /* The calendar's marks. Each is a non-text indicator carrying meaning on its
     own, so each needs 3:1 against the ground it is drawn on — and the ground
     is Chalk in both places by construction: the Diary's grid sits in a Chalk
     section, and Today's rail gives every cell a Chalk face precisely so these
     hold. Red measures 1.68:1 on Soffit Blue, which is the measurement that
     decision came from and the reason the pair below is the only one the build
     is allowed to rely on. */
  { fg: "ten-ring-red", bg: "chalk", need: "graphic", role: "Calendar: today's dot, and a day with something on" },
  { fg: "vip-teal", bg: "chalk", need: "graphic", role: "Calendar: the bar on a day the member is coming in" },
  { fg: "reticle-black", bg: "chalk", need: "graphic", role: "Calendar: a league round's outline, and the grid's rules" },
];

/* ============================================================================
   GLAZING — the composites, computed rather than pasted

   `src/styles/glaze.css` puts content-grade glass over a known ground, and the
   whole reason it is allowed to do so is that the resulting colour is
   COMPUTABLE. Snapshotting the six results as hex literals would make the gate
   agree with a stylesheet it had stopped reading; these are composited here
   from the same three numbers the CSS uses, and `glaze.test.ts` asserts the CSS
   still declares those numbers.
   ========================================================================= */

/** The pane's alpha. Mirrors `--glaze-tint` in glaze.css. */
export const GLAZE_TINT = 0.62;

/**
 * The field's darkest permitted density. Mirrors the ceiling of
 * `--field-major-alpha`, and the proof is written against it rather than
 * against the value in use, so the figures keep headroom.
 */
export const FIELD_ALPHA_MAX = 0.08;

/**
 * Normal-blend alpha compositing in sRGB gamma space.
 *
 * The same method base.css uses for the hero scrim and glass.css for the
 * chrome. Browsers do not composite in linear light, so neither does this — a
 * "more correct" linear blend here would produce numbers the screen disagrees
 * with, which is the only kind of wrong that matters.
 */
export function composite(fg: PaletteName, alpha: number, bg: string): string {
  const f = channels(palette[fg]);
  const b = channels(bg);
  const mix = f.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i]));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/** The three 0-255 channels of a six-digit hex colour. */
const channels = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A band with the setting-out field drawn on it, at its darkest. */
export const fieldOver = (ground: PaletteName): string =>
  composite(
    /* A dark band draws its drawing in light, a light one in Sight Grey — the
       same rule `u-field-inverse` applies in CSS. */
    DARK_GROUNDS.has(ground) ? "chalk" : "sight-grey",
    FIELD_ALPHA_MAX,
    palette[ground],
  );

const DARK_GROUNDS = new Set<PaletteName>([
  "charred-timber",
  "range-teak",
  "vip-teal",
]);

/** A pane of glazing over a field over `ground`. */
export const glazeOver = (ground: PaletteName): string =>
  composite(
    DARK_GROUNDS.has(ground) ? "charred-timber" : "chalk",
    GLAZE_TINT,
    fieldOver(ground),
  );

/**
 * The pairs a pane has to hold, on every ground that carries one.
 *
 * Soffit Blue is absent on purpose: it carries no glazing, because a light pane
 * over it puts Sight Ink at 4.48:1 and Ten Ring Red at 2.73:1. That decision is
 * enforced by `groundGlaze` returning null, and stating it here as a required
 * pair would assert the opposite.
 */
export const glazedPairs: Array<{
  ground: PaletteName;
  fg: PaletteName;
  need: "body" | "graphic";
  role: string;
}> = [
  { ground: "chalk", fg: "reticle-black", need: "body", role: "Pane body text on a Chalk band" },
  { ground: "chalk", fg: "sight-ink", need: "body", role: "Pane captions on a Chalk band" },
  { ground: "chalk", fg: "ten-ring-red", need: "graphic", role: "Pane markers on a Chalk band" },

  { ground: "terrazzo", fg: "reticle-black", need: "body", role: "Pane body text on a Terrazzo band" },
  { ground: "terrazzo", fg: "sight-ink", need: "body", role: "Pane captions on a Terrazzo band" },
  { ground: "terrazzo", fg: "ten-ring-red", need: "graphic", role: "Pane markers on a Terrazzo band" },

  { ground: "charred-timber", fg: "chalk", need: "body", role: "Dark pane body text on Charred Timber" },
  { ground: "charred-timber", fg: "terrazzo", need: "body", role: "Dark pane captions on Charred Timber" },
  { ground: "vip-teal", fg: "chalk", need: "body", role: "Dark pane body text on VIP Teal" },
  { ground: "vip-teal", fg: "terrazzo", need: "body", role: "Dark pane captions on VIP Teal" },
  { ground: "range-teak", fg: "chalk", need: "body", role: "Dark pane body text on Range Teak" },
  { ground: "range-teak", fg: "terrazzo", need: "body", role: "Dark pane captions on Range Teak" },
];

export function auditGlazedPairs() {
  return glazedPairs.map((pair) => {
    const surface = glazeOver(pair.ground);
    const ratio = round(contrast(palette[pair.fg], surface));
    const threshold = pair.need === "body" ? 4.5 : 3;
    return { ...pair, surface, ratio, threshold, pass: ratio >= threshold };
  });
}

export function auditRequiredPairs() {
  return requiredPairs.map((pair) => {
    const ratio = round(contrast(palette[pair.fg], palette[pair.bg]));
    const threshold = pair.need === "body" ? 4.5 : 3;
    return { ...pair, ratio, threshold, pass: ratio >= threshold };
  });
}
